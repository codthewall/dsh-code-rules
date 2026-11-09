/**
 * 修改规则文档的纯函数：每个函数接收旧文档，返回新文档与一句「改了什么」。
 *
 * 不碰磁盘，错误一律抛 RulesDocError，由命令层转成可读提示。
 */

import { RulesDocError, RULE_LEVELS, SECTION_TITLES } from './rules-doc.js';

const LEVEL_STRENGTH = { MUST: 3, SHOULD: 2, MAY: 1 };

/** 关键词 → 章节，用于 `add` 不传 --section 时推断。 */
const SECTION_HINTS = {
  2: ['文件', '目录', '结构', '路径', '放置', 'src', 'test', '模块'],
  3: ['命名', '名称', '变量名', '函数名', '大小写', 'camel', 'snake', 'pascal', '常量'],
  4: ['行数', '规模', '拆分', '长度', '文件大小', '函数不超过'],
  5: ['注释', '文档', '说明', 'docstring', 'jsdoc', '标题'],
  6: ['错误', '异常', '日志', 'error', 'log', '失败', '重试'],
  7: ['锁', '并发', '死锁', '超时', '线程', '事务', 'async'],
  8: ['测试', '自测', '验证', 'test', '覆盖', '断言'],
};

export function addRule(doc, { text, section, level = 'MUST' }) {
  const body = (text ?? '').trim();
  if (body === '') throw new RulesDocError('E_RULE_TEXT', '规则正文不能为空');
  if (!RULE_LEVELS.includes(level)) {
    throw new RulesDocError('E_RULE_LEVEL', `等级必须是 ${RULE_LEVELS.join(' / ')}，收到 ${level}`);
  }
  const no = section === undefined || section === null || section === ''
    ? inferSection(doc, body)
    : Number(section);
  const target = doc.sections.find((item) => item.no === no);
  if (!target) {
    throw new RulesDocError('E_SECTION_UNKNOWN', `没有第 ${no} 节，可用章节：2–8（9 是冻结清单）`);
  }
  const next = clone(doc);
  const rule = { id: nextRuleId(next), level, text: body };
  next.sections.find((item) => item.no === no).rules.push(rule);
  return { doc: next, changed: `新增 ${rule.id} · ${rule.level} · ${rule.text}（第 ${no} 节 ${SECTION_TITLES[no]}）` };
}

export function updateRule(doc, { id, text, level, remove = false, confirm = false }) {
  const next = clone(doc);
  let found = null;
  for (const section of next.sections) {
    const index = section.rules.findIndex((rule) => rule.id === id);
    if (index !== -1) {
      found = { section, index, rule: section.rules[index] };
      break;
    }
  }
  if (found === null) throw new RulesDocError('E_RULE_NOT_FOUND', `找不到规则 ${id}`);

  if (remove) {
    if (!confirm) throw new RulesDocError('E_CONFIRM_REQUIRED', `删除 ${id} 需要 --confirm`);
    found.section.rules.splice(found.index, 1);
    return { doc: next, changed: `删除 ${id}（${found.rule.text}）` };
  }

  const nextLevel = level ?? found.rule.level;
  if (!RULE_LEVELS.includes(nextLevel)) {
    throw new RulesDocError('E_RULE_LEVEL', `等级必须是 ${RULE_LEVELS.join(' / ')}，收到 ${nextLevel}`);
  }
  const weakened = LEVEL_STRENGTH[nextLevel] < LEVEL_STRENGTH[found.rule.level];
  if (weakened && !confirm) {
    throw new RulesDocError(
      'E_CONFIRM_REQUIRED',
      `把 ${id} 从 ${found.rule.level} 放宽到 ${nextLevel} 需要 --confirm`,
    );
  }
  const body = (text ?? '').trim() || found.rule.text;
  const parts = [];
  if (body !== found.rule.text) parts.push('改文本');
  if (nextLevel !== found.rule.level) parts.push(`等级 ${found.rule.level} → ${nextLevel}`);
  if (parts.length === 0) throw new RulesDocError('E_NO_CHANGE', `${id} 没有变化`);

  found.rule.text = body;
  found.rule.level = nextLevel;
  return { doc: next, changed: `${id} ${parts.join('，')}` };
}

export function freezeEntry(doc, { name, kind, reason, since }) {
  const target = (name ?? '').trim();
  if (target === '') throw new RulesDocError('E_FREEZE_NAME', '冻结项名称不能为空');
  if (doc.frozen.some((item) => item.name === target)) {
    throw new RulesDocError('E_FREEZE_EXISTS', `${target} 已经在冻结清单里`);
  }
  const next = clone(doc);
  next.frozen.push({
    name: target,
    kind: (kind ?? 'function').trim() || 'function',
    since: (since ?? '').trim() || '未记录',
    reason: (reason ?? '').trim() || '未说明理由',
  });
  return { doc: next, changed: `冻结 ${target}` };
}

export function unfreezeEntry(doc, { name, reason }) {
  const target = (name ?? '').trim();
  const why = (reason ?? '').trim();
  if (target === '') throw new RulesDocError('E_FREEZE_NAME', '解冻项名称不能为空');
  if (why === '') throw new RulesDocError('E_REASON_REQUIRED', '解冻必须带 --reason 说明理由');
  const index = doc.frozen.findIndex((item) => item.name === target);
  if (index === -1) throw new RulesDocError('E_FREEZE_NOT_FOUND', `${target} 不在冻结清单里`);
  const next = clone(doc);
  next.frozen.splice(index, 1);
  return { doc: next, changed: `解冻 ${target}（理由：${why}）` };
}

/** 关键词推断章节；推不出来就报错并列出可用节号，而不是随便塞。 */
export function inferSection(doc, text) {
  const haystack = String(text).toLowerCase();
  const scores = [];
  for (let no = 2; no <= 8; no += 1) {
    const hints = SECTION_HINTS[no] ?? [];
    let score = hints.filter((hint) => haystack.includes(hint.toLowerCase())).length * 2;
    const section = doc.sections.find((item) => item.no === no);
    for (const rule of section?.rules ?? []) {
      if (rule.text.toLowerCase().includes(haystack)) score += 1;
    }
    scores.push({ no, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) {
    throw new RulesDocError(
      'E_SECTION_AMBIGUOUS',
      `无法从文本推断章节，请用 --section=<2-8> 指定。可用：${scores.map((item) => `${item.no}.${SECTION_TITLES[item.no]}`).join(' ')}`,
    );
  }
  if (second && second.score === best.score) {
    throw new RulesDocError(
      'E_SECTION_AMBIGUOUS',
      `第 ${best.no} 节与第 ${second.no} 节同样匹配，请用 --section=<2-8> 指定`,
    );
  }
  return best.no;
}

export function nextRuleId(doc) {
  let max = 0;
  for (const section of doc.sections) {
    for (const rule of section.rules) {
      const match = /^R-(\d{3})$/.exec(rule.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `R-${String(max + 1).padStart(3, '0')}`;
}

function clone(doc) {
  return structuredClone(doc);
}
