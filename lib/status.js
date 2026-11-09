/**
 * `/rules status` 的文本产出：读文件、解析、拼一段给人看的摘要。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, parse, RulesDocError, RULES_FILE } from './rules-doc.js';

/**
 * 读取并解析工作目录下的规则文件。
 * @returns {Promise<{ doc: object } | { missing: true }>}
 */
export async function loadRulesDoc(cwd) {
  const path = join(cwd, RULES_FILE);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { missing: true };
    throw error;
  }
  return { doc: parse(text, { file: RULES_FILE }) };
}

/** 解析成功时的多行摘要。 */
export function formatSummary(doc, { enabled } = {}) {
  const stats = describe(doc);
  const lines = [
    `${RULES_FILE} · v${stats.version}`,
    `语言：${doc.language || '未标注'}`,
    '章节：9/9 齐全',
    `规则：${stats.total} 条（MUST ${stats.counts.MUST} / SHOULD ${stats.counts.SHOULD} / MAY ${stats.counts.MAY}）`,
    `冻结项：${stats.frozen}`,
  ];
  if (doc.updated) lines.push(`更新时间：${doc.updated}`);
  if (enabled !== undefined) lines.push(`本会话注入：${enabled ? '开' : '关'}`);
  const last = doc.changelog.at(-1);
  if (last) lines.push(`最近变更：${last}`);
  return lines.join('\n');
}

/** 未找到文件时的提示。 */
export function formatMissing(cwd) {
  return `未找到 ${RULES_FILE}（在 ${cwd}）。运行 /rules init 生成。`;
}

/** 解析失败时的提示：错误码 + 可读原因 + 补救建议。 */
export function formatError(error) {
  if (error instanceof RulesDocError) {
    return `解析 ${RULES_FILE} 失败：${error.code} · ${error.message}。修正后重试，或运行 /rules init --force 重新生成。`;
  }
  if (error?.code?.startsWith?.('E_')) {
    return `${error.message}`;
  }
  return `读取 ${RULES_FILE} 失败：${error?.message ?? String(error)}`;
}

/** 一次调用拿全 status 文本。 */
export async function statusText(cwd, { enabled } = {}) {
  if (!cwd) return `无法确定当前会话的工作目录，暂不能读取 ${RULES_FILE}。`;
  try {
    const result = await loadRulesDoc(cwd);
    if ('missing' in result) return formatMissing(cwd);
    return formatSummary(result.doc, { enabled });
  } catch (error) {
    return formatError(error);
  }
}
