import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { apply } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 最小的假 ctx：只实现插件用到的四个口子。 */
function makeCtx(cwd) {
  const registered = { sections: [], commands: [] };
  const ctx = {
    inject(_deps, callback) {
      callback(ctx);
    },
    systemPrompt: {
      section(definition) {
        registered.sections.push(definition);
      },
    },
    commands: {
      register(definition) {
        registered.commands.push(definition);
      },
    },
    workingDirectory: {
      async ensure() {
        return cwd;
      },
    },
  };
  return { ctx, registered };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-code-rules-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('apply 注册一个注入段与一个 /rules 命令', () => {
  const { ctx, registered } = makeCtx('C:\\work');
  apply(ctx);
  assert.equal(registered.sections.length, 1);
  assert.equal(registered.sections[0].name, 'code-rules');
  assert.equal(typeof registered.sections[0].order, 'number');
  assert.equal(registered.sections[0].text(), '');
  assert.equal(registered.commands.length, 1);
  assert.equal(registered.commands[0].name, 'rules');
  assert.equal(typeof registered.commands[0].handler, 'function');
});

test('空目录下 /rules status 提示未找到文件', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await registered.commands[0].handler({ agent: {}, rawInput: 'status', signal: undefined });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /未找到 CODE-RULES\.md/);
    assert.match(result.text, /\/rules init/);
  });
});

test('不带参数等价于 status', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await registered.commands[0].handler({ agent: {}, rawInput: '', signal: undefined });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /未找到 CODE-RULES\.md/);
  });
});

test('合规文件下报出章节、规则数与等级分布', async () => {
  await withTempDir(async (dir) => {
    await copyFile(join(here, 'fixtures', 'minimal.md'), join(dir, 'CODE-RULES.md'));
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await registered.commands[0].handler({ agent: {}, rawInput: 'status', signal: undefined });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /v1/);
    assert.match(result.text, /章节：9\/9 齐全/);
    assert.match(result.text, /规则：7 条（MUST 5 \/ SHOULD 2 \/ MAY 0）/);
    assert.match(result.text, /冻结项：0/);
  });
});

test('解析失败时给出错误码而不是崩溃', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'CODE-RULES.md'), '---\nschema: 1\n---\n\n# 代码约束规则\n', 'utf8');
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await registered.commands[0].handler({ agent: {}, rawInput: 'status', signal: undefined });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /E_SECTION_MISSING/);
  });
});

test('未知子命令返回错误结果', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await registered.commands[0].handler({ agent: {}, rawInput: 'deploy', signal: undefined });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /未知子命令/);
  });
});
