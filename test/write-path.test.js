import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { addRule } from '../lib/mutations.js';
import { parse, RULES_FILE } from '../lib/rules-doc.js';
import { readSnapshot, rotateSnapshots } from '../lib/snapshots.js';
import { commitDoc, readCurrentDoc, writeInitial } from '../lib/write.js';
import { makeDoc } from './helpers/doc.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rules-write-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('首次生成写文件；已存在时无 --force 拒绝、有 --force 覆盖', async () => {
  await withTempDir(async (dir) => {
    await writeInitial(dir, makeDoc({ rulesPerSection: 1 }));
    const { doc } = await readCurrentDoc(dir);
    assert.equal(doc.version, 1);
    assert.equal(doc.sections.length, 7);

    await assert.rejects(() => writeInitial(dir, makeDoc()), /已存在/);
    await writeInitial(dir, makeDoc({ rulesPerSection: 2 }), { force: true });
    const after = await readCurrentDoc(dir);
    assert.equal(after.doc.sections[0].rules.length, 2);
    // force 覆盖也要先留快照
    assert.match(await readSnapshot(dir, 1), /R-001/);
  });
});

test('commitDoc 先落快照再改正文，版本号递增且变更记录追加', async () => {
  await withTempDir(async (dir) => {
    await writeInitial(dir, makeDoc({ rulesPerSection: 1 }));
    const current = await readCurrentDoc(dir);
    const { doc: next, changed } = addRule(current.doc, { text: '单文件不超过 300 行', section: 4 });
    const result = await commitDoc(dir, next, changed);
    assert.equal(result.version, 2);

    const after = await readCurrentDoc(dir);
    assert.equal(after.doc.version, 2);
    assert.equal(after.doc.changelog.at(-1).includes('新增 R-008'), true);

    const snapshot = await readSnapshot(dir, 1);
    assert.equal(parse(snapshot).version, 1, 'v-1 应当是修改前的正文');
    assert.equal(after.doc.sections.find((s) => s.no === 4).rules.length, 2);
  });
});

test('环形快照最多保留两代，v-2 是最旧的一代', async () => {
  await withTempDir(async (dir) => {
    await writeInitial(dir, makeDoc({ version: 1 }));
    for (const version of [2, 3]) {
      const current = await readCurrentDoc(dir);
      await commitDoc(dir, { ...current.doc, version }, `测试第 ${version} 版`);
    }
    assert.equal(parse(await readSnapshot(dir, 1)).version, 2);
    assert.equal(parse(await readSnapshot(dir, 2)).version, 1);
    await assert.rejects(() => readSnapshot(dir, 3).then((text) => {
      if (text === null) throw new Error('无第三代');
    }), /无第三代/);
  });
});

test('快照写不进去时，正文一个字节都不动', async () => {
  await withTempDir(async (dir) => {
    await writeInitial(dir, makeDoc());
    const before = await readFile(join(dir, RULES_FILE), 'utf8');
    // 用一个同名文件占住 .rules，让 mkdir 失败
    await writeFile(join(dir, '.rules'), 'not a directory', 'utf8');

    const current = await readCurrentDoc(dir);
    const { doc: next, changed } = addRule(current.doc, { text: '禁止在循环里发网络请求', section: 7 });
    await assert.rejects(() => commitDoc(dir, next, changed), (error) => {
      assert.equal(error.code, 'E_SNAPSHOT_WRITE');
      return true;
    });
    assert.equal(await readFile(join(dir, RULES_FILE), 'utf8'), before);
  });
});

test('没有规则文件时 commitDoc 报 E_NO_RULES_FILE', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => commitDoc(dir, makeDoc(), 'x'), (error) => error.code === 'E_NO_RULES_FILE');
  });
});

test('rotateSnapshots 直接推进历史', async () => {
  await withTempDir(async (dir) => {
    await rotateSnapshots(dir, 'v1 正文');
    assert.equal(await readSnapshot(dir, 1), 'v1 正文');
    await rotateSnapshots(dir, 'v2 正文');
    assert.equal(await readSnapshot(dir, 1), 'v2 正文');
    assert.equal(await readSnapshot(dir, 2), 'v1 正文');
  });
});
