import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { describe, parse, render, RulesDocError, validate } from '../lib/rules-doc.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

async function readFixture(name) {
  const text = await readFile(join(fixtures, name), 'utf8');
  return text.replace(/\r\n/g, '\n');
}

const CASES = ['minimal.md', 'complete.md', 'empty-freeze.md'];

for (const name of CASES) {
  test(`render(parse()) 与夹具逐字节一致：${name}`, async () => {
    const text = await readFixture(name);
    assert.equal(render(parse(text)), text);
  });

  test(`parse(render()) 与首次解析结果一致：${name}`, async () => {
    const text = await readFixture(name);
    const doc = parse(text);
    const again = parse(render(doc));
    assert.deepEqual(again, doc);
  });

  test(`validate 通过：${name}`, async () => {
    const doc = parse(await readFixture(name));
    assert.deepEqual(validate(doc), []);
  });
}

test('complete.md 的统计正确', async () => {
  const doc = parse(await readFixture('complete.md'));
  const stats = describe(doc);
  assert.equal(stats.total, 14);
  assert.deepEqual(stats.counts, { MUST: 9, SHOULD: 4, MAY: 1 });
  assert.equal(stats.frozen, 2);
  assert.equal(stats.version, 2);
  assert.equal(doc.language, 'typescript');
  assert.equal(doc.frozen[0].name, 'findUserById');
});

test('空冻结清单解析为 []', async () => {
  const doc = parse(await readFixture('empty-freeze.md'));
  assert.deepEqual(doc.frozen, []);
  assert.equal(describe(doc).version, 2);
});

function errorOf(text) {
  try {
    parse(text);
  } catch (error) {
    assert.ok(error instanceof RulesDocError, `应为 RulesDocError，实际 ${error}`);
    return error;
  }
  assert.fail('应当抛出 RulesDocError');
}

const HEAD = '---\nschema: 1\nlanguage: typescript\nupdated: 2026-11-09\n---\n\n# 代码约束规则\n\n';

test('缺章节报 E_SECTION_MISSING', () => {
  const text = `${HEAD}## 1. 总则\n\n- 原则。\n\n## 2. 文件与目录\n\n- R-001 · MUST · 放 src/。\n`;
  assert.equal(errorOf(text).code, 'E_SECTION_MISSING');
});

test('规则行格式错误报 E_RULE_SYNTAX 并带行号', async () => {
  const broken = (await readFixture('minimal.md')).replace(
    '- R-002 · MUST · 变量与函数使用 camelCase。',
    '- R-002 MUST 变量与函数使用 camelCase。',
  );
  const error = errorOf(broken);
  assert.equal(error.code, 'E_RULE_SYNTAX');
  assert.ok(error.line > 0);
});

test('冻结块缺失报 E_FREEZE_MISSING', async () => {
  const broken = (await readFixture('minimal.md')).replace('```yaml\nfrozen: []\n```', '（没有冻结块）');
  assert.equal(errorOf(broken).code, 'E_FREEZE_MISSING');
});

test('schema 不认识报 E_SCHEMA_UNSUPPORTED', async () => {
  const broken = (await readFixture('minimal.md')).replace('schema: 1', 'schema: 7');
  assert.equal(errorOf(broken).code, 'E_SCHEMA_UNSUPPORTED');
});

test('章节标题写错报 E_SECTION_TITLE', async () => {
  const broken = (await readFixture('minimal.md')).replace('## 3. 命名', '## 3. 命名规范');
  assert.equal(errorOf(broken).code, 'E_SECTION_TITLE');
});

test('冻结项缺少 name 报 E_FREEZE_NAME', async () => {
  const broken = (await readFixture('minimal.md')).replace(
    'frozen: []',
    'frozen:\n  - kind: function',
  );
  assert.equal(errorOf(broken).code, 'E_FREEZE_NAME');
});

test('render 的产物可以被再次解析（含多行冻结清单）', async () => {
  const doc = parse(await readFixture('complete.md'));
  const text = render(doc);
  assert.match(text, /- name: findUserById/);
  assert.match(text, /reason: 公共 API, 外部已调用/);
  assert.deepEqual(parse(text).frozen, doc.frozen);
});
