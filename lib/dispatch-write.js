/**
 * 写入类子命令：add / update / freeze / unfreeze / rollback。
 *
 * 它们共享同一条写路径（`commitDoc`：先落快照、再改正文、版本 +1），
 * 所以放在一起，入口只负责把结果包成成功/失败两种返回。
 */

import { intFlag } from './args.js';
import { addRule, freezeEntry, unfreezeEntry, updateRule } from './mutations.js';
import { parse, RULES_FILE, RulesDocError } from './rules-doc.js';
import { readSnapshot } from './snapshots.js';
import { commitDoc, readCurrentDoc } from './write.js';

const WRITE_WORDS = new Set(['add', 'update', 'freeze', 'unfreeze', 'rollback']);

/** 这个子命令会不会改文件（入口据此决定走写路径还是读路径）。 */
export function isWriteWord(word) {
  return WRITE_WORDS.has(word);
}

/**
 * 执行一个写入子命令，返回给用户看的文本。
 * 失败一律抛错，由入口统一转成 `{kind:'error'}`。
 */
export async function runWriteWord(word, { cwd, positional, flags }) {
  const level = levelFlag(flags);
  switch (word) {
    case 'add': {
      const current = await requireDoc(cwd);
      const { doc, changed } = addRule(current.doc, {
        text: positional.join(' '),
        section: intFlag(flags.section),
        level,
      });
      const { version } = await commitDoc(cwd, doc, changed);
      return `v${version} · ${changed}`;
    }
    case 'update': {
      const current = await requireDoc(cwd);
      const [id, ...rest] = positional;
      const { doc, changed } = updateRule(current.doc, {
        id: id?.toUpperCase(),
        text: rest.join(' '),
        level: flags.level === undefined ? undefined : level,
        remove: flags.remove === true,
        confirm: flags.confirm === true,
      });
      const { version } = await commitDoc(cwd, doc, changed);
      return `v${version} · ${changed}`;
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
      return `v${version} · ${changed}`;
    }
    case 'unfreeze': {
      const current = await requireDoc(cwd);
      const { doc, changed } = unfreezeEntry(current.doc, {
        name: positional[0],
        reason: flags.reason,
      });
      const { version } = await commitDoc(cwd, doc, changed);
      return `v${version} · ${changed}`;
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
      return `已回退到${label}，当前 v${version}（回退前的 ${target.doc.version} 已存入历史）`;
    }
    default:
      throw new RulesDocError('E_UNKNOWN_WORD', `未知子命令：${word}`);
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
