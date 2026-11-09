/**
 * 插件入口：把纯函数层接到 DSH 的四个扩展点上。
 *
 * - 每轮注入：`systemPrompt.section`，读文件必须同步（框架不 await 段文本）。
 * - `/rules <子命令>`：命令 handler，可异步落盘。
 * - `rules_update` 工具：给模型改规则用，`defineTool` 从宿主按需导入。
 * - 三层开关：会话 > 项目 `.rules/settings.json` > 插件配置 `defaultEnabled`。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { intFlag, parseArgs } from './lib/args.js';
import { buildInjection } from './lib/inject.js';
import { addRule, freezeEntry, unfreezeEntry, updateRule } from './lib/mutations.js';
import { probeRepo } from './lib/probe.js';
import { parse, RULES_FILE, RulesDocError } from './lib/rules-doc.js';
import { readSnapshot } from './lib/snapshots.js';
import { statusText } from './lib/status.js';
import { buildInitialDoc, describeFacts } from './lib/template.js';
import { commitDoc, readCurrentDoc, today, writeInitial } from './lib/write.js';

const SETTINGS_FILE = '.rules/settings.json';
const SECTION_ORDER = 500;
const TOOL_NAME = 'rules_update';
const PARSE_CACHE_SIZE = 8;

/** 正文没变就不必重新解析：每轮注入都读同一个文件。 */
const docCache = new Map();

export function apply(ctx, config = {}) {
  const state = { config, wd: null, sessions: new Map() };

  ctx.inject(['workingDirectory'], (scope) => {
    state.wd = scope.workingDirectory;
  });
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: 'code-rules',
      order: SECTION_ORDER,
      text: (context) => injectionFor(state, context),
    });
  });
  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      definitionId: 'dsh-code-rules',
      name: 'rules',
      description: '查看与维护项目代码约束规则（CODE-RULES.md）',
      input: { hint: '[init|status|add|update|freeze|unfreeze|rollback|off|on|help] …' },
      handler: ({ agent, rawInput }) => handle(state, agent, rawInput),
    });
  });
  registerTool(ctx, state);
}

/* ---------------------------------- 注入 ---------------------------------- */

function injectionFor(state, context) {
  const session = context?.agent?.session;
  if (!session) return '';
  const cwd = cwdSync(state, session);
  if (!cwd || !enabledFor(state, session, cwd)) return '';
  let text;
  try {
    text = readFileSync(join(cwd, RULES_FILE), 'utf8');
  } catch {
    return '';
  }
  try {
    return buildInjection(parseCached(text), { enabled: true });
  } catch {
    return '';
  }
}

function parseCached(text) {
  const hit = docCache.get(text);
  if (hit) return hit;
  const doc = parse(text);
  if (docCache.size >= PARSE_CACHE_SIZE) docCache.delete(docCache.keys().next().value);
  docCache.set(text, doc);
  return doc;
}

function cwdSync(state, session) {
  try {
    return state.wd?.get?.(session) ?? null;
  } catch {
    return null;
  }
}

async function cwdAsync(state, agent) {
  if (!agent) return null;
  try {
    await state.wd?.ensure?.(agent);
  } catch {
    /* 落到 get() 的兜底 */
  }
  return cwdSync(state, agent.session);
}

/* --------------------------------- 开关 ---------------------------------- */

function enabledFor(state, session, cwd) {
  if (session && state.sessions.has(session)) return state.sessions.get(session);
  const project = projectEnabled(cwd);
  if (project !== undefined) return project;
  return state.config.defaultEnabled !== false;
}

function projectEnabled(cwd) {
  try {
    const raw = readFileSync(join(cwd, SETTINGS_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.enabled === 'boolean' ? parsed.enabled : undefined;
  } catch {
    return undefined;
  }
}

/* --------------------------------- 命令 ---------------------------------- */

async function handle(state, agent, rawInput) {
  const { word, positional, flags } = parseArgs(rawInput);
  const name = word || 'status';
  const cwd = await cwdAsync(state, agent);
  const session = agent?.session;

  if (name === 'help') return ok(HELP);
  if (name === 'off' || name === 'on') {
    if (!session) return fail(new RulesDocError('E_NO_SESSION', '当前会话不可用'));
    state.sessions.set(session, name === 'on');
    return ok(`本会话已${name === 'on' ? '开启' : '关闭'}代码约束规则注入。`);
  }

  try {
    switch (name) {
      case 'status': {
        if (!cwd) return fail(new RulesDocError('E_NO_CWD', '无法确定当前会话的工作目录'));
        const enabled = enabledFor(state, session, cwd);
        return ok(await statusText(cwd, { enabled }));
      }
      case 'init': {
        if (!cwd) return fail(new RulesDocError('E_NO_CWD', '无法确定工作目录，/rules init 需要在项目目录里运行'));
        const facts = await probeRepo(cwd);
        const doc = buildInitialDoc(facts, { today: today() });
        await writeInitial(cwd, doc, { force: flags.force === true });
        const lines = [
          `已生成 ${RULES_FILE}（v${doc.version ?? 1}）`,
          describeFacts(facts),
        ];
        if (flags.ai === true) {
          const steered = await steerRefine(agent, facts);
          lines.push(
            steered
              ? '已把精修任务交给当前 Agent：它会读几个代表性文件，用 rules_update 把通版骨架改成本仓库真正在用的约定。'
              : '（当前环境无法自动精修：--ai 需要宿主提供 agent.steer，骨架已生成，可手动补充。）',
          );
        }
        lines.push('', '建议把该文件与 .rules/ 一起提交；下一轮起规则自动注入。');
        return ok(lines.join('\n'));
      }
      case 'add': {
        const current = await requireDoc(cwd);
        const { doc, changed } = addRule(current.doc, {
          text: positional.join(' '),
          section: intFlag(flags.section),
          level: levelFlag(flags),
        });
        const { version } = await commitDoc(cwd, doc, changed);
        return ok(`v${version} · ${changed}`);
      }
      case 'update': {
        const current = await requireDoc(cwd);
        const [id, ...rest] = positional;
        const { doc, changed } = updateRule(current.doc, {
          id: id?.toUpperCase(),
          text: rest.join(' '),
          level: flags.level === undefined ? undefined : levelFlag(flags),
          remove: flags.remove === true,
          confirm: flags.confirm === true,
        });
        const { version } = await commitDoc(cwd, doc, changed);
        return ok(`v${version} · ${changed}`);
      }
      case 'freeze': {
        const current = await requireDoc(cwd);
        const { doc, changed } = freezeEntry(current.doc, {
          name: positional[0],
          kind: flags.kind,
          reason: flags.reason,
          since: flags.since,
        });
        const { version } = await commitDoc(cwd, doc, changed);
        return ok(`v${version} · ${changed}`);
      }
      case 'unfreeze': {
        const current = await requireDoc(cwd);
        const { doc, changed } = unfreezeEntry(current.doc, {
          name: positional[0],
          reason: flags.reason,
        });
        const { version } = await commitDoc(cwd, doc, changed);
        return ok(`v${version} · ${changed}`);
      }
      case 'rollback': {
        const generation = Number(positional[0] ?? 1);
        if (generation !== 1 && generation !== 2) {
          throw new RulesDocError('E_ROLLBACK_GENERATION', '只能回退到 1（上一代）或 2（上上代）');
        }
        const target = await requireDoc(cwd);
        const text = await readSnapshot(cwd, generation);
        if (text === null) {
          throw new RulesDocError('E_NO_SNAPSHOT', `没有第 ${generation} 代快照，先做一次修改再来`);
        }
        const doc = parse(text);
        const label = generation === 1 ? '上一代' : '上上代';
        const { version } = await commitDoc(cwd, doc, `回退到${label}（原 v${doc.version}）`);
        return ok(`已回退到${label}，当前 v${version}（回退前的 ${target.doc.version} 已存入历史）`);
      }
      default:
        return fail(new RulesDocError('E_UNKNOWN_WORD', `未知子命令：${name}\n\n${HELP}`));
    }
  } catch (error) {
    return fail(error);
  }
}

function levelFlag(flags) {
  return String(flags.level ?? 'MUST').toUpperCase();
}

async function requireDoc(cwd) {
  if (!cwd) throw new RulesDocError('E_NO_CWD', '无法确定当前会话的工作目录');
  const current = await readCurrentDoc(cwd);
  if (current === null) {
    throw new RulesDocError('E_NO_RULES_FILE', `未找到 ${RULES_FILE}，先运行 /rules init`);
  }
  return current;
}

const HELP = [
  '/rules init [--force] [--ai]       探测仓库并生成 CODE-RULES.md（--ai 让 Agent 精修）',
  '/rules status                      查看规则数量、冻结项、注入状态',
  '/rules add <文本> [--section=2-8] [--level=MUST|SHOULD|MAY]',
  '/rules update <R-001> [新文本] [--level=…] [--remove --confirm]',
  '/rules freeze <名称> [--kind=function|class|常量] [--reason=…]',
  '/rules unfreeze <名称> --reason=…   解冻必须写理由',
  '/rules rollback [1|2]              退回上一代 / 上上代',
  '/rules off | /rules on             只关本会话的注入',
].join('\n');

/**
 * `init --ai`：把「精修这份骨架」交给当前 Agent。
 * 宿主没提供 steer / dsh-llm 时返回 false，命令照常成功。
 */
async function steerRefine(agent, facts) {
  if (typeof agent?.steer !== 'function') return false;
  try {
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
    agent.steer(
      createUserMessage({
        content: [
          {
            type: 'text',
            text: [
              `刚生成了 ${RULES_FILE}（${describeFacts(facts)}）。`,
              '请读一遍仓库里 5–10 个代表性文件，把这份通用骨架改成本仓库真正在用的约定：',
              '删掉确实不会执行的条款，补上你观察到的、模板里没写的规则。',
              '用 rules_update 逐条改（op=add / update / remove，note 写清理由），不要编造没看到的约定。',
            ].join(''),
          },
        ],
        source: { kind: 'user' },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- 工具 ---------------------------------- */

function registerTool(ctx, state) {
  void (async () => {
    let defineTool;
    try {
      ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
    } catch {
      warn(ctx, '未找到 @deepseek-ai/dsh-tools，跳过 rules_update 工具注册');
      return;
    }
    try {
      ctx.inject(['tools'], (scope) => {
        scope.tools.register(
          defineTool({
            name: TOOL_NAME,
            description:
              '维护项目代码约束规则文件 CODE-RULES.md：新增/修改/删除规则、冻结或解冻标识符。改完代码后如果出现了新的约定或违反了现有约定，用它更新规则并写清理由。',
            parameters: {
              op: { type: 'string', required: true, description: 'add | update | remove | freeze | unfreeze' },
              note: { type: 'string', required: true, description: '为什么改：一句话变更理由' },
              target: { type: 'string', description: 'update/remove 的规则 id（R-001）或 unfreeze 的标识符名' },
              text: { type: 'string', description: 'add/update 的规则正文' },
              level: { type: 'string', description: 'MUST | SHOULD | MAY，默认 MUST' },
              section: { type: 'string', description: '第几节（2-8），省略时按关键词推断' },
              reason: { type: 'string', description: 'freeze/unfreeze 的理由' },
            },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: value }],
            },
            async execute(args, exec) {
              const cwd = await cwdAsync(state, exec?.agent);
              const note = String(args?.note ?? '').trim() || '模型维护';
              try {
                switch (args?.op) {
                  case 'add': {
                    const current = await requireDoc(cwd);
                    const payload = addRule(current.doc, {
                      text: args.text,
                      section: args.section === undefined ? undefined : Number(args.section),
                      level: String(args.level ?? 'MUST').toUpperCase(),
                    });
                    const { version } = await commitDoc(cwd, payload.doc, `${payload.changed}｜${note}`);
                    return `已写入 v${version} · ${payload.changed}`;
                  }
                  case 'update': {
                    const current = await requireDoc(cwd);
                    const payload = updateRule(current.doc, {
                      id: String(args.target ?? '').toUpperCase(),
                      text: args.text,
                      level: args.level === undefined ? undefined : String(args.level).toUpperCase(),
                      confirm: true,
                    });
                    const { version } = await commitDoc(cwd, payload.doc, `${payload.changed}｜${note}`);
                    return `已写入 v${version} · ${payload.changed}`;
                  }
                  case 'remove': {
                    const current = await requireDoc(cwd);
                    const payload = updateRule(current.doc, {
                      id: String(args.target ?? '').toUpperCase(),
                      remove: true,
                      confirm: true,
                    });
                    const { version } = await commitDoc(cwd, payload.doc, `${payload.changed}｜${note}`);
                    return `已写入 v${version} · ${payload.changed}`;
                  }
                  case 'freeze': {
                    const current = await requireDoc(cwd);
                    const payload = freezeEntry(current.doc, {
                      name: args.target,
                      kind: args.kind,
                      reason: args.reason ?? note,
                    });
                    const { version } = await commitDoc(cwd, payload.doc, `${payload.changed}｜${note}`);
                    return `已写入 v${version} · ${payload.changed}`;
                  }
                  case 'unfreeze': {
                    const current = await requireDoc(cwd);
                    const payload = unfreezeEntry(current.doc, {
                      name: args.target,
                      reason: args.reason ?? note,
                    });
                    const { version } = await commitDoc(cwd, payload.doc, `${payload.changed}｜${note}`);
                    return `已写入 v${version} · ${payload.changed}`;
                  }
                  default:
                    return `未知操作：${args?.op}（可用 add/update/remove/freeze/unfreeze）`;
                }
              } catch (error) {
                return describeFailure(error);
              }
            },
          }),
        );
      });
    } catch (error) {
      warn(ctx, `rules_update 工具注册失败：${error?.message ?? error}`);
    }
  })();
}

/* --------------------------------- 小工具 --------------------------------- */

function ok(text) {
  return { kind: 'success', text };
}

function fail(error) {
  return { kind: 'error', text: describeFailure(error) };
}

function describeFailure(error) {
  if (error instanceof RulesDocError) return `${error.message}（${error.code}）`;
  if (typeof error?.code === 'string' && error.code.startsWith('E_')) return `${error.message}（${error.code}）`;
  return `操作失败：${error?.message ?? String(error)}`;
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[dsh-code-rules] ${message}`);
  } catch {
    /* 日志不可用就静默 */
  }
}
