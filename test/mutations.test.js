import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addRule,
  freezeEntry,
  inferSection,
  nextRuleId,
  unfreezeEntry,
  updateRule,
} from '../lib/mutations.js';
import { RulesDocError } from '../lib/rules-doc.js';
import { makeDoc } from './helpers/doc.js';

function code(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof RulesDocError, `应当抛 RulesDocError，实际 ${error?.name}`);
    return error.code;
  }
  return null;
}

test('addRule 按关键词推断章节', () => {
  const doc = makeDoc();
  assert.equal(inferSection(doc, '并发访问共享缓存时必须先取锁'), 7);
  assert.equal(inferSection(doc, '提交前运行测试'), 8);
  const { doc: next, changed } = addRule(doc, { text: '并发访问共享缓存时必须先取锁' });
  assert.equal(next.sections.find((s) => s.no === 7).rules.length, 2);
  assert.match(changed, /第 7 节/);
  assert.match(changed, /MUST/);
});

test('addRule 拒绝空正文与未知章节', () => {
  const doc = makeDoc();
  assert.equal(code(() => addRule(doc, { text: '   ' })), 'E_RULE_TEXT');
  assert.equal(code(() => addRule(doc, { text: '规则', section: 99 })), 'E_SECTION_UNKNOWN');
  assert.equal(code(() => addRule(doc, { text: '规则', section: 2, level: 'NEVER' })), 'E_RULE_LEVEL');
});

test('关键词同等命中时报歧义，不瞎猜', () => {
  const doc = makeDoc();
  assert.equal(code(() => inferSection(doc, '完全无关的一句话')), 'E_SECTION_AMBIGUOUS');
});

test('updateRule 放宽等级需要 --confirm', () => {
  const doc = makeDoc();
  const id = nextRuleId(doc); // 未使用，仅确认自增格式
  assert.equal(id, 'R-008');
  assert.equal(code(() => updateRule(doc, { id: 'R-001', level: 'MAY' })), 'E_CONFIRM_REQUIRED');
  const { doc: next, changed } = updateRule(doc, { id: 'R-001', level: 'MAY', confirm: true });
  assert.match(changed, /MUST → MAY/);
  assert.equal(next.sections[0].rules[0].level, 'MAY');
});

test('updateRule 删除需要 confirm，且无变化会报 E_NO_CHANGE', () => {
  const doc = makeDoc();
  assert.equal(code(() => updateRule(doc, { id: 'R-001', remove: true })), 'E_CONFIRM_REQUIRED');
  assert.equal(code(() => updateRule(doc, { id: 'R-001', text: doc.sections[0].rules[0].text })), 'E_NO_CHANGE');
  assert.equal(code(() => updateRule(doc, { id: 'R-999', text: 'x' })), 'E_RULE_NOT_FOUND');
  const { doc: next } = updateRule(doc, { id: 'R-001', remove: true, confirm: true });
  assert.equal(next.sections[0].rules.length, 0);
});

test('冻结不可重复；解冻必须带理由', () => {
  const doc = makeDoc({ frozen: [{ name: 'emit', kind: 'function', since: '2026-01-01', reason: '事件名对外' }] });
  assert.equal(code(() => freezeEntry(doc, { name: 'emit' })), 'E_FREEZE_EXISTS');
  const { doc: frozen2, changed } = freezeEntry(doc, { name: 'TaskId', kind: 'type', reason: '序列化格式' });
  assert.match(changed, /冻结 TaskId/);
  assert.equal(frozen2.frozen.length, 2);
  assert.equal(code(() => unfreezeEntry(frozen2, { name: 'emit' })), 'E_REASON_REQUIRED');
  assert.equal(code(() => unfreezeEntry(frozen2, { name: 'missing', reason: '因为' })), 'E_FREEZE_NOT_FOUND');
  const { changed: unfroze } = unfreezeEntry(frozen2, { name: 'emit', reason: '上游已改名' });
  assert.match(unfroze, /理由：上游已改名/);
});
