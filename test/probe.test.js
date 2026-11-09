import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { probeRepo } from '../lib/probe.js';
import { buildInitialDoc } from '../lib/template.js';

const roots = [];

async function makeRepo(files) {
  const dir = await mkdtemp(join(tmpdir(), 'code-rules-probe-'));
  roots.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return dir;
}

after(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
});

describe('probeRepo', () => {
  it('没有语言标记文件时按源码后缀判断语言', async () => {
    const dir = await makeRepo({
      'lib/a.js': 'export const a = 1;\n',
      'lib/b.js': 'export const b = 2;\n',
      'lib/a.test.js': "import test from 'node:test';\n",
    });
    const facts = await probeRepo(dir);
    assert.equal(facts.language, 'javascript');
    assert.equal(facts.testCommand, 'node --test');
  });

  it('认 package.json 里的 test 脚本，tsconfig 优先判为 typescript', async () => {
    const dir = await makeRepo({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      'src/index.ts': 'export const x: number = 1;\n',
    });
    const facts = await probeRepo(dir);
    assert.equal(facts.language, 'typescript');
    assert.equal(facts.testCommand, 'npm test');
  });

  it('python 项目有测试文件才建议 pytest', async () => {
    const dir = await makeRepo({ 'pkg/main.py': 'def run():\n    pass\n' });
    assert.equal((await probeRepo(dir)).testCommand, null);

    const withTests = await makeRepo({
      'pkg/main.py': 'def run():\n    pass\n',
      'tests/test_main.py': 'def test_run():\n    pass\n',
    });
    assert.equal((await probeRepo(withTests)).testCommand, 'pytest');
  });

  it('探测不到测试命令时返回 null，而不是一段句子', async () => {
    const dir = await makeRepo({ 'notes.txt': 'hello\n' });
    const facts = await probeRepo(dir);
    assert.equal(facts.language, 'unknown');
    assert.equal(facts.testCommand, null);
  });

  it('只在有 src/lib/app 时给出主源码目录', async () => {
    const withoutSrc = await makeRepo({ 'pkg/a.js': 'export const a = 1;\n' });
    assert.equal(buildInitialDoc(await probeRepo(withoutSrc), { today: '2026-01-01' }).sections[0].rules[0].text,
      '新的源码文件按模块放进对应子目录，不要堆在仓库根。');

    const withSrc = await makeRepo({ 'src/a.js': 'export const a = 1;\n' });
    assert.equal(buildInitialDoc(await probeRepo(withSrc), { today: '2026-01-01' }).sections[0].rules[0].text,
      '新的源码文件放在 src/ 下。');
  });

  it('生成的第八节不会把「未探测到」塞进规则句', async () => {
    const dir = await makeRepo({ 'notes.txt': 'hello\n' });
    const doc = buildInitialDoc(await probeRepo(dir), { today: '2026-01-01' });
    const texts = doc.sections.flatMap((section) => section.rules.map((rule) => rule.text));
    assert.ok(texts.every((text) => !text.includes('未探测到')), texts.join('\n'));
    assert.ok(texts.some((text) => text.startsWith('提交前运行项目的测试命令')));
  });
});
