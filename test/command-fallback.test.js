import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from '../index.js';
import { candidates, loadDshTools } from '../lib/load-tools.js';

const RELATIVE_TAIL = 'node_modules/@deepseek-ai/dsh-tools/lib/index.js';

/** 只实现 apply 用到的口子；commands.register 的行为由用例注入。 */
function makeCtx(register) {
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
    commands: { register },
    workingDirectory: {
      get() {
        return 'C:\\work';
      },
      async ensure() {
        return 'C:\\work';
      },
    },
  };
  return { ctx, registered };
}

/** 临时把 stderr 吞掉，避免降级路径的告警污染测试输出。 */
async function withoutStderr(run) {
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return await run();
  } finally {
    process.stderr.write = original;
  }
}

test('candidates 先试裸包名，再从启动参数里推出 app.asar 下的 dsh 根', () => {
  const list = candidates(['C:\\app\\DeepSeek Harness.exe', 'D:/res/app.asar/dsh'], {});
  assert.equal(list[0], '@deepseek-ai/dsh-tools');
  const fromArgv = list.find((specifier) => specifier.includes('/app.asar/dsh/'));
  assert.ok(fromArgv, '应当从 argv 推出 app.asar/dsh 候选');
  assert.ok(fromArgv.startsWith('file:///'));
  assert.ok(fromArgv.endsWith(RELATIVE_TAIL));
});

test('candidates 认得 DSH_APP_ROOT，并且没有 app.asar 时只留下裸包名', () => {
  const withEnv = candidates(['node'], { DSH_APP_ROOT: 'E:/alt/app.asar/dsh' });
  assert.ok(withEnv.some((specifier) => specifier.includes('E:/alt/app.asar/dsh/') || specifier.includes('E%3A/alt/app.asar/dsh/')));

  const bare = candidates(['node', 'plugin.js'], {});
  assert.deepEqual(bare, ['@deepseek-ai/dsh-tools']);
});

test('loadDshTools 解析不到时返回 undefined，而不是抛错', async () => {
  const module = await loadDshTools({ argv: ['node', 'plugin.js'], env: {} });
  assert.equal(module, undefined);
});

test('commands.register 抛「已注册」时回退到 /code-rules', async () => {
  const names = [];
  const { ctx } = makeCtx((definition) => {
    names.push(definition.name);
    if (definition.name === 'rules') {
      throw new Error('command "rules" is already registered in this scope');
    }
  });

  await withoutStderr(async () => apply(ctx));

  assert.deepEqual(names, ['rules', 'code-rules']);
});

test('commands.register 抛别的错时只告警，不吞掉也不重复注册', async () => {
  const names = [];
  const { ctx, registered } = makeCtx((definition) => {
    names.push(definition.name);
    throw new Error('boom');
  });

  await withoutStderr(async () => apply(ctx));

  assert.deepEqual(names, ['rules']);
  assert.equal(registered.commands.length, 0);
});
