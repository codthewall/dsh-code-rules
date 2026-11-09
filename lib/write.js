/**
 * 唯一写路径的内核：先落快照，再覆盖正文，最后追加变更记录。
 *
 * 顺序不能变：快照写不进去就抛错，正文一个字节都不会动。
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse, render, RULES_FILE } from './rules-doc.js';
import { rotateSnapshots, SnapshotError } from './snapshots.js';

export class WriteError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'WriteError';
    this.code = code;
    this.cause = cause;
  }
}

/** 今天（本地时区），格式 YYYY-MM-DD。 */
export function today(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 读取并解析当前规则文件；不存在时返回 null。 */
export async function readCurrentDoc(cwd) {
  let text;
  try {
    text = await readFile(join(cwd, RULES_FILE), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new WriteError('E_READ_FAILED', `读取 ${RULES_FILE} 失败：${error?.message ?? error}`, error);
  }
  return { text, doc: parse(text) };
}

/**
 * 提交一次修改：版本 +1、追加变更记录、推进快照，然后覆盖正文。
 * @param {string} cwd
 * @param {object} nextDoc 修改后的文档
 * @param {string} changeLog 变更记录里的一句话
 */
export async function commitDoc(cwd, nextDoc, changeLog) {
  const current = await readCurrentDoc(cwd);
  if (current === null) throw new WriteError('E_NO_RULES_FILE', `未找到 ${RULES_FILE}，先运行 /rules init`);

  const date = today();
  const version = current.doc.version + 1;
  const doc = {
    ...nextDoc,
    updated: date,
    version,
    changelog: [...current.doc.changelog, `${date} v${version} · ${changeLog}`],
  };
  const text = render(doc);

  try {
    await rotateSnapshots(cwd, current.text);
  } catch (error) {
    if (error instanceof SnapshotError) throw new WriteError(error.code, error.message, error);
    throw error;
  }
  await writeAtomic(join(cwd, RULES_FILE), text);
  return { version, changed: changeLog, text };
}

/** 首次生成：文件已存在且没有 --force 时拒绝。 */
export async function writeInitial(cwd, doc, { force = false } = {}) {
  const path = join(cwd, RULES_FILE);
  const existing = await readCurrentDoc(cwd);
  if (existing !== null) {
    if (!force) {
      throw new WriteError('E_EXISTS', `${RULES_FILE} 已存在。用 /rules init --force 覆盖（覆盖前会自动快照）。`);
    }
    try {
      await rotateSnapshots(cwd, existing.text);
    } catch (error) {
      if (error instanceof SnapshotError) throw new WriteError(error.code, error.message, error);
      throw error;
    }
  }
  const text = render(doc);
  await writeAtomic(path, text);
  return { text };
}

async function writeAtomic(path, text) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, text, 'utf8');
  try {
    await rename(temp, path);
  } catch (error) {
    throw new WriteError('E_WRITE_FAILED', `写入 ${RULES_FILE} 失败：${error?.message ?? error}`, error);
  }
}
