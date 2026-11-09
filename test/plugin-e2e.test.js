import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { apply } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 最小的假 ctx：只实现插件用到的四个口子。 */
function makeCtx(cwd) {
  const registered = { sections: [], commands: [], tools: [] };
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
    tools: {
      register(definition) {
        registered.tools.push(definition);
      },
    },
    workingDirectory: {
      get() {
        return cwd;
      },
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

function runner(registered) {
  return (rawInput, session = 's1') =>
    registered.commands[0].handler({ agent: { session }, rawInput, signal: undefined });
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
    const result = await runner(registered)('status');
    assert.equal(result.kind, 'success');
    assert.match(result.text, /未找到 CODE-RULES\.md/);
    assert.match(result.text, /\/rules init/);
  });
});

test('不带参数等价于 status', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await runner(registered)('');
    assert.equal(result.kind, 'success');
    assert.match(result.text, /未找到 CODE-RULES\.md/);
  });
});

test('合规文件下报出章节、规则数与等级分布', async () => {
  await withTempDir(async (dir) => {
    await copyFile(join(here, 'fixtures', 'minimal.md'), join(dir, 'CODE-RULES.md'));
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await runner(registered)('status');
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
    const result = await runner(registered)('status');
    assert.equal(result.kind, 'success');
    assert.match(result.text, /E_SECTION_MISSING/);
  });
});

test('未知子命令返回错误结果', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const result = await runner(registered)('deploy');
    assert.equal(result.kind, 'error');
    assert.match(result.text, /未知子命令/);
  });
});

test('端到端：init → add → freeze → rollback → off/on', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const run = runner(registered);
    const inject = (session = 's1') => registered.sections[0].text({ agent: { session } });

    const init = await run('init');
    assert.equal(init.kind, 'success', init.text);
    assert.match(init.text, /已生成 CODE-RULES\.md（v1）/);
    assert.match(init.text, /下一轮起规则自动注入/);
    assert.match(await readFile(join(dir, 'CODE-RULES.md'), 'utf8'), /R-001/);
    assert.match(inject(), /# 代码约束规则/);

    const add = await run('add 单文件不超过 200 行 --section=4 --level=SHOULD');
    assert.equal(add.kind, 'success', add.text);
    assert.match(add.text, /v2/);
    assert.match(add.text, /新增 R-016 · SHOULD/);

    const freeze = await run('freeze handleSubmit --reason=外部插件按名字调用');
    assert.equal(freeze.kind, 'success', freeze.text);
    assert.match(freeze.text, /v3/);

    const status = await run('status');
    assert.match(status.text, /v3/);
    assert.match(status.text, /规则：16 条（MUST 11 \/ SHOULD 4 \/ MAY 1）/);
    assert.match(status.text, /冻结项：1/);
    assert.match(status.text, /本会话注入：开/);

    const badUnfreeze = await run('unfreeze handleSubmit');
    assert.equal(badUnfreeze.kind, 'error');
    assert.match(badUnfreeze.text, /E_REASON_REQUIRED/);

    const rollback = await run('rollback 1');
    assert.equal(rollback.kind, 'success', rollback.text);
    assert.match(rollback.text, /已回退到上一代，当前 v4/);
    const afterRollback = await run('status');
    assert.match(afterRollback.text, /v4/);
    assert.match(afterRollback.text, /冻结项：0/);

    const off = await run('off');
    assert.match(off.text, /已关闭/);
    assert.equal(inject(), '');
    assert.match((await run('status')).text, /本会话注入：关/);

    const on = await run('on');
    assert.match(on.text, /已开启/);
    assert.match(inject(), /# 代码约束规则/);
  });
});

test('项目级 .rules/settings.json 可关闭注入，会话级 on 能覆盖回来', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx);
    const run = runner(registered);
    await run('init');
    await mkdir(join(dir, '.rules'), { recursive: true });
    await writeFile(join(dir, '.rules', 'settings.json'), JSON.stringify({ enabled: false }), 'utf8');

    assert.equal(registered.sections[0].text({ agent: { session: 's1' } }), '');
    await run('on');
    assert.match(registered.sections[0].text({ agent: { session: 's1' } }), /# 代码约束规则/);
    // 另一个会话仍受项目设置影响
    assert.equal(registered.sections[0].text({ agent: { session: 's2' } }), '');
  });
});

test('插件配置 defaultEnabled=false 时默认不注入', async () => {
  await withTempDir(async (dir) => {
    const { ctx, registered } = makeCtx(dir);
    apply(ctx, { defaultEnabled: false });
    await runner(registered)('init');
    assert.equal(registered.sections[0].text({ agent: { session: 's1' } }), '');
    await runner(registered)('on');
    assert.match(registered.sections[0].text({ agent: { session: 's1' } }), /# 代码约束规则/);
  });
});

test('没有工作目录时不崩，只是不注入', async () => {
  const { ctx, registered } = makeCtx(null);
  apply(ctx);
  assert.equal(registered.sections[0].text({ agent: { session: 's1' } }), '');
  const result = await registered.commands[0].handler({ agent: { session: 's1' }, rawInput: 'status' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /无法确定/);
});
