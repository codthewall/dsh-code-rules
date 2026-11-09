/**
 * 环形快照：`.rules/history/v-1.md`（上一代）、`v-2.md`（上上代）。
 *
 * 顺序不可调换：先 `v-1 → v-2`，再把当前内容写进 `v-1`，最后才允许覆盖正文。
 * 任何一步写不进去，调用方都必须放弃这次修改。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const HISTORY_DIR = '.rules/history';

export class SnapshotError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SnapshotError';
    this.code = 'E_SNAPSHOT_WRITE';
    this.cause = cause;
  }
}

export function historyDir(cwd) {
  return join(cwd, HISTORY_DIR);
}

export function snapshotPath(cwd, generation) {
  return join(historyDir(cwd), `v-${generation}.md`);
}

/** 读取某一代快照；不存在时返回 null。 */
export async function readSnapshot(cwd, generation) {
  try {
    return await readFile(snapshotPath(cwd, generation), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new SnapshotError(`读取第 ${generation} 代快照失败`, error);
  }
}

/**
 * 把当前正文推进历史：v-1 → v-2，当前 → v-1。
 * @param {string} cwd
 * @param {string} currentText 即将被覆盖的正文
 */
export async function rotateSnapshots(cwd, currentText) {
  try {
    await mkdir(historyDir(cwd), { recursive: true });
    const previous = await readSnapshot(cwd, 1);
    if (previous !== null) await writeFile(snapshotPath(cwd, 2), previous, 'utf8');
    await writeFile(snapshotPath(cwd, 1), currentText, 'utf8');
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError('快照写入失败，本次修改已放弃', error);
  }
}
