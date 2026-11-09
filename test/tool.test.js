import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { executeToolCall } from '../index.js';
import { createToolSpec, registerTool, TOOL_NAME } from '../lib/tool.js';

const here = dirname(fileURLToPath(import.meta.url));
const roots = [];
const EXEC = { agent: { session: 's1' } };

after(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
});

async function seedRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'code-rules-tool-'));
  roots.push(dir);
  await copyFile(join(here, 'fixtures', 'complete.md'), join(dir, 'CODE-RULES.md'));
  return dir;
}

function makeState(cwd) {
  return {
    config: {},
    sessions: new Map(),
    wd: {
      get: () => cwd,
      ensure: async () => cwd,
    },
  };
}

function makeCtx() {
  const registered = [];
  return {
    registered,
    ctx: {
      inject(_deps, callback) {
        callback({ tools: { register: (definition) => registered.push(definition) } });
      },
      logger: { warn: () => {} },
    },
  };
}

const identityDefineTool = (spec) => spec;

function build(state) {
  return createToolSpec(identityDefineTool, (args, exec) => executeToolCall(state, args, exec));
}

describe('rules_update 工具', () => {
  it('注册后暴露完整参数表与文本渲染', async () => {
    const { ctx, registered } = makeCtx();
    const ok = await registerTool({
      ctx,
      loadTools: async () => ({ defineTool: identityDefineTool }),
      handle: () => 'ok',
      onError: () => assert.fail('不该报错'),
    });
    assert.equal(ok, true);
    assert.equal(registered.length, 1);
    const spec = registered[0];
    assert.equal(spec.name, TOOL_NAME);
    assert.deepEqual(Object.keys(spec.parameters).sort(), [
      'level', 'note', 'op', 'reason', 'section', 'target', 'text',
    ]);
    assert.deepEqual(spec.output.render({}, '已写入'), [{ type: 'text', text: '已写入' }]);
  });

  it('宿主找不到 defineTool 时只报错、不注册', async () => {
    const { ctx, registered } = makeCtx();
    const messages = [];
    const ok = await registerTool({
      ctx,
      loadTools: async () => {
        throw new Error('module not found');
      },
      handle: () => 'ok',
      onError: (message) => messages.push(message),
    });
    assert.equal(ok, false);
    assert.equal(registered.length, 0);
    assert.match(messages[0], /dsh-tools/);
  });

  it('add 走 commitDoc：返回新版本号，文件里能读到新规则', async () => {
    const cwd = await seedRepo();
    const spec = build(makeState(cwd));
    const text = await spec.execute(
      { op: 'add', note: '出现新的约定', text: '新增接口必须有契约测试。', section: '8' },
      EXEC,
    );
    assert.match(text, /已写入 v3/);
    assert.match(await readFile(join(cwd, 'CODE-RULES.md'), 'utf8'), /新增接口必须有契约测试/);
  });

  it('update 与 freeze 复用同一条写路径', async () => {
    const cwd = await seedRepo();
    const spec = build(makeState(cwd));
    const updated = await spec.execute(
      { op: 'update', target: 'R-001', text: '源码按模块放。', note: '措辞收紧' },
      EXEC,
    );
    assert.match(updated, /v3/);
    const frozen = await spec.execute(
      { op: 'freeze', target: 'loadProfileDirectory', reason: '对外契约', note: '新增冻结' },
      EXEC,
    );
    assert.match(frozen, /v4/);
    const doc = await readFile(join(cwd, 'CODE-RULES.md'), 'utf8');
    assert.match(doc, /源码按模块放/);
    assert.match(doc, /loadProfileDirectory/);
  });

  it('未知操作给一句可读提示，而不是抛异常', async () => {
    const cwd = await seedRepo();
    const spec = build(makeState(cwd));
    const text = await spec.execute({ op: 'rename', note: '试试' }, EXEC);
    assert.match(text, /未知操作：rename/);
  });
});
