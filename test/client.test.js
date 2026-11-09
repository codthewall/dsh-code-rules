import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'lib', 'client.js');

/**
 * 客户端插件是 `window.__ModuleLoader__.load({...})` 包起来的脚本，不能在 Node 里直接
 * import。这里用 vm 造一个最小浏览器环境，把 factory 跑出来。
 */
async function loadClient({ primitivesAvailable = true } = {}) {
  const source = await readFile(clientPath, 'utf8');
  let captured;
  const window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec;
      },
    },
  };
  vm.runInNewContext(source, { window, console });

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => undefined,
  };
  const primitives = { Switch: function Switch() {} };

  const module = captured.factory((name) => {
    if (name === 'react') return React;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      if (!primitivesAvailable) throw new Error('module not available');
      return primitives;
    }
    throw new Error(`unexpected require: ${name}`);
  });

  return { spec: captured, module, React };
}

function makeCtx(served = ['code-rules'], snapshotValue = {}) {
  const registered = [];
  const injected = [];
  const scope = {
    getSnapshot: () => ({ value: snapshotValue, writable: true }),
    subscribe: () => () => {},
    set: async () => true,
  };
  return {
    registered,
    injected,
    scope,
    ctx: {
      effect(fn) {
        return fn();
      },
      configForms: {
        whileServed(namespaces, callback) {
          return callback(new Set(namespaces.filter((ns) => served.includes(ns))));
        },
        get(ns) {
          return served.includes(ns) ? scope : null;
        },
      },
      slots: {
        inject(name, factory) {
          injected.push(name);
          return factory();
        },
        register(definition, component) {
          registered.push({ definition, component });
          return () => {};
        },
      },
    },
  };
}

describe('设置页整页', () => {
  it('模块声明了入口 id 与最小服务集', async () => {
    const { spec, module } = await loadClient();
    assert.equal(spec.id, 'dsh-code-rules');
    // vm 里跑出来的数组跨 realm，deepStrictEqual 会因原型不同而失败，转成本地数组再比。
    assert.deepEqual([...module.inject], ['slots']);
    assert.equal(typeof module.apply, 'function');
    assert.equal(module.__internals.ENTRY_ID, 'code-rules');
    assert.equal(module.__internals.CONFIG_NS, 'code-rules');
  });

  it('宿主提供命名空间时，往 settings.section 挂一个导航项', async () => {
    const { module } = await loadClient();
    const { ctx, registered, injected } = makeCtx();
    module.apply(ctx);

    assert.deepEqual([...injected], ['settings.section']);
    assert.equal(registered.length, 1);
    const { definition } = registered[0];
    assert.equal(definition.name, 'settings.section');
    assert.equal(definition.id, 'code-rules');
    assert.equal(definition.label(), '代码约束规则');
    assert.equal(typeof definition.inject().scope.set, 'function');
  });

  it('宿主没 serve 命名空间时仍然挂导航项，只是没有可编辑的 scope', async () => {
    const { module } = await loadClient();
    const { ctx, registered } = makeCtx([]);
    module.apply(ctx);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].definition.inject().scope, null);
  });

  it('宿主没有 configForms 服务时也不抛错', async () => {
    const { module } = await loadClient();
    const { ctx, registered } = makeCtx();
    delete ctx.configForms;
    module.apply(ctx);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].definition.inject().scope, null);
  });

  it('草稿从配置快照来，缺字段时回落到默认值', async () => {
    const { module } = await loadClient();
    const { draftFrom } = module.__internals;
    assert.deepEqual({ ...draftFrom({}) }, { defaultEnabled: true, fullLimit: 6000, summaryLimit: 12000 });
    assert.deepEqual(
      { ...draftFrom({ value: { defaultEnabled: false, fullLimit: 3000, summaryLimit: '9000' } }) },
      { defaultEnabled: false, fullLimit: 3000, summaryLimit: 9000 },
    );
  });

  it('样式里带页面的类名', async () => {
    const { module } = await loadClient();
    assert.ok(module.__internals.CSS.includes('.dcr-page'));
    assert.ok(module.__internals.CSS.includes('.dcr-card'));
  });

  it('整页能渲染出标题与三张卡片', async () => {
    const { module } = await loadClient();
    const scope = {
      getSnapshot: () => ({
        value: { defaultEnabled: true, fullLimit: 6000, summaryLimit: 12000 },
        writable: true,
      }),
      subscribe: () => () => {},
      set: async () => true,
    };
    const tree = module.__internals.CodeRulesSection({ scope });

    const nodes = [];
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return;
      nodes.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);

    assert.ok(nodes.some((node) => node.props?.className === 'dcr-page'));
    assert.equal(nodes.filter((node) => node.props?.className === 'dcr-card').length, 3);
    assert.ok(nodes.some((node) => node.children?.includes('代码约束规则')));
  });

  it('控件库里没有 Switch 时退回原生 checkbox，页面照常渲染', async () => {
    const { module } = await loadClient({ primitivesAvailable: false });
    const scope = {
      getSnapshot: () => ({ value: {}, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    };
    const tree = module.__internals.CodeRulesSection({ scope });

    const nodes = [];
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return;
      nodes.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);

    // 组件是惰性的：桩里的 createElement 不会执行函数组件，自己调一次看它渲染什么。
    const switchNode = nodes.find((node) => typeof node.type === 'function');
    const rendered = switchNode.type(switchNode.props);
    assert.equal(rendered.type, 'input');
    assert.equal(rendered.props.type, 'checkbox');
    assert.equal(nodes.filter((node) => node.props?.className === 'dcr-card').length, 3);
  });
});
