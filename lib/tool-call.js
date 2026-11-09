/**
 * `rules_update` 的执行体。
 *
 * 与 `/rules` 命令共用 mutations + commitDoc 这一条写路径，只是把入参换成
 * 工具的参数表形状，返回值是给模型看的一段文本（失败也不抛，转成一句可读的错误）。
 */

import { addRule, freezeEntry, unfreezeEntry, updateRule } from './mutations.js';
import { RULES_FILE, RulesDocError } from './rules-doc.js';
import { commitDoc, readCurrentDoc } from './write.js';

export async function runToolCall(cwd, args, { note = '模型维护' } = {}) {
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
}

async function requireDoc(cwd) {
  if (!cwd) throw new RulesDocError('E_NO_CWD', '无法确定当前会话的工作目录');
  const current = await readCurrentDoc(cwd);
  if (current === null) {
    throw new RulesDocError('E_NO_RULES_FILE', `未找到 ${RULES_FILE}，先运行 /rules init`);
  }
  return current;
}

function describeFailure(error) {
  if (error instanceof RulesDocError) return `${error.message}（${error.code}）`;
  if (typeof error?.code === 'string' && error.code.startsWith('E_')) return `${error.message}（${error.code}）`;
  return `操作失败：${error?.message ?? String(error)}`;
}
