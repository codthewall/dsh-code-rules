import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInjection, FULL_LIMIT, MAINTENANCE, SUMMARY_LIMIT } from '../lib/inject.js';
import { render } from '../lib/rules-doc.js';
import { makeDoc } from './helpers/doc.js';

const FROZEN = [
  { name: 'handleSubmit', kind: 'function', since: '2026-01-01', reason: '外部插件按名字调用，改名会破坏兼容' },
];

test('小文件：整份注入，末尾带维护指令', () => {
  const doc = makeDoc({ rulesPerSection: 1 });
  const size = render(doc).length;
  assert.ok(size <= FULL_LIMIT, `夹具应当小于 ${FULL_LIMIT}，实际 ${size}`);
  const text = buildInjection(doc);
  assert.match(text, /# 代码约束规则/);
  assert.match(text, /R-002/);
  assert.ok(text.endsWith(`${MAINTENANCE}\n`));
  assert.doesNotMatch(text, /已降级/);
});

test('中等文件：降级为摘要 + 章节索引，冻结清单保持完整', () => {
  const doc = makeDoc({ rulesPerSection: 20, frozen: FROZEN });
  const size = render(doc).length;
  assert.ok(size > FULL_LIMIT && size <= SUMMARY_LIMIT, `夹具应在 ${FULL_LIMIT}–${SUMMARY_LIMIT}，实际 ${size}`);
  const text = buildInjection(doc);
  assert.match(text, /已降级/);
  assert.match(text, /### 章节索引/);
  assert.match(text, /### 冻结清单（完整）/);
  assert.match(text, /handleSubmit（function，since 2026-01-01）：外部插件按名字调用/);
  assert.doesNotMatch(text, /1\. 总则（3 条原则）\n\n2\. 文件与目录（20 条）/);
});

test('超大文件：最小档，只保留 20 行摘要与冻结清单', () => {
  const doc = makeDoc({ rulesPerSection: 40, frozen: FROZEN });
  const size = render(doc).length;
  assert.ok(size > SUMMARY_LIMIT, `夹具应大于 ${SUMMARY_LIMIT}，实际 ${size}`);
  const text = buildInjection(doc);
  assert.match(text, /只注入最小档/);
  assert.match(text, /建议拆分或精简/);
  assert.match(text, /handleSubmit/);
  assert.ok(text.includes(MAINTENANCE));
});

test('关闭注入时返回空串', () => {
  assert.equal(buildInjection(makeDoc(), { enabled: false }), '');
  assert.equal(buildInjection(null), '');
});

test('冻结清单里的长理由在任何档位都不被截断', () => {
  const longReason = '理由'.repeat(200);
  const doc = makeDoc({ rulesPerSection: 40, frozen: [{ name: 'legacyApi', kind: 'class', reason: longReason }] });
  const text = buildInjection(doc);
  assert.ok(text.includes(longReason), '冻结理由必须整段出现');
});

test('阈值可配置：调小会降到最小档，调大则整份注入', () => {
  const doc = makeDoc({ rulesPerSection: 20, frozen: FROZEN });
  const size = render(doc).length;

  const squeezed = buildInjection(doc, { fullLimit: 1000, summaryLimit: 2000 });
  assert.match(squeezed, /只注入最小档/);

  const roomy = buildInjection(doc, { fullLimit: size + 10, summaryLimit: size + 20 });
  assert.match(roomy, /# 代码约束规则/);
  assert.doesNotMatch(roomy, /已降级|只注入最小档/);
});

test('阈值非法时回落到默认值，不会把注入搞成空串', () => {
  const doc = makeDoc({ rulesPerSection: 1 });
  for (const bad of [0, -5, 'abc', null, undefined, Number.NaN]) {
    const text = buildInjection(doc, { fullLimit: bad, summaryLimit: bad });
    assert.match(text, /# 代码约束规则/, `阈值 ${String(bad)} 应当回落到默认值`);
  }
});
