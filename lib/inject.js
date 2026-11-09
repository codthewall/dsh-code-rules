/**
 * 每轮注入：按文件体积自动降级，但冻结清单任何档位都不截断。
 */

import { render, SECTION_TITLES } from './rules-doc.js';

export const FULL_LIMIT = 6000;
export const SUMMARY_LIMIT = 12000;

export const MAINTENANCE = '改完代码后，如果新增或违反了约定，调用 rules_update 更新 CODE-RULES.md 并说明原因；不要静默修改。';

/**
 * @param {object|null} doc 解析后的规则文档
 * @param {{ enabled?: boolean }} [options]
 * @returns {string} 注入文本；关闭或无文件时返回空串
 */
export function buildInjection(doc, { enabled = true } = {}) {
  if (!enabled || !doc) return '';
  const full = render(doc);
  const size = full.length;
  if (size <= FULL_LIMIT) return withInstruction(full);
  if (size <= SUMMARY_LIMIT) {
    const body = [
      `## 代码约束规则（摘要 · 全文 ${size} 字符，超过 ${FULL_LIMIT} 已降级）`,
      '',
      ...summaryLines(doc, 40),
      '',
      '### 章节索引',
      '',
      ...sectionIndex(doc),
      '',
      '### 冻结清单（完整）',
      '',
      ...freezeLines(doc),
    ].join('\n');
    return withInstruction(body);
  }
  const body = [
    `## 代码约束规则（摘要 · 全文 ${size} 字符，超过 ${SUMMARY_LIMIT}，只注入最小档）`,
    '',
    ...summaryLines(doc, 20),
    '',
    '### 冻结清单（完整）',
    '',
    ...freezeLines(doc),
    '',
    `> 规则文件已超过 ${SUMMARY_LIMIT} 字符，建议拆分或精简；需要细节时直接读取 CODE-RULES.md。`,
  ].join('\n');
  return withInstruction(body);
}

function withInstruction(body) {
  return `${body.replace(/\s+$/, '')}\n\n---\n${MAINTENANCE}\n`;
}

function summaryLines(doc, limit) {
  const lines = [];
  for (const principle of doc.principles.slice(0, 6)) lines.push(`- ${principle}`);
  for (const section of doc.sections) {
    for (const rule of section.rules.slice(0, 2)) {
      lines.push(`- ${rule.id} · ${rule.level} · ${rule.text}`);
    }
  }
  return lines.slice(0, limit);
}

function sectionIndex(doc) {
  const lines = [`1. ${SECTION_TITLES[1]}（${doc.principles.length} 条原则）`];
  for (let no = 2; no <= 8; no += 1) {
    const section = doc.sections.find((item) => item.no === no);
    lines.push(`${no}. ${SECTION_TITLES[no]}（${section?.rules.length ?? 0} 条）`);
  }
  lines.push(`9. ${SECTION_TITLES[9]}（${doc.frozen.length} 项）`);
  return lines;
}

function freezeLines(doc) {
  if (doc.frozen.length === 0) return ['（空）'];
  return doc.frozen.map((item) => {
    const since = item.since ? `，since ${item.since}` : '';
    return `- ${item.name}（${item.kind || '未标注'}${since}）：${item.reason || '未记录理由'}`;
  });
}
