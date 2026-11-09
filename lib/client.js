/**
 * 浏览器端：在「插件」设置页里给 dsh-code-rules 挂一张卡片，只有一个总开关。
 *
 * 卡片只在宿主真的为 `code-rules` 这个命名空间提供了配置表单时出现——
 * 宿主侧 `index.js` 导出了 `Config`，`configForms` 才会 serve 它；
 * 没 serve（宿主版本太旧、插件没加载完）就什么都不渲染，不报错。
 *
 * 写法对齐官方 `dsh-client-ui-settings-shell`：
 * - 入口 `window.__ModuleLoader__.load({ id, factory(require) })`
 * - 导出 `apply(ctx)` 与 `inject`（服务名）
 * - 依赖只声明确实存在且必须的两个：`slots`、`configForms`
 */

window.__ModuleLoader__.load({
	id: 'dsh-code-rules',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

		/** 设置页里的条目 id。 */
		const ENTRY_ID = 'code-rules';
		/** 宿主为插件提供的配置命名空间，等于 cordis.patch.yml 里的 id。 */
		const CONFIG_NS = 'code-rules';

		const COPY = {
			title: '代码约束规则',
			summary: '把项目里的 CODE-RULES.md 注入每一轮对话。',
			toggle: '默认注入',
			hint: '新会话默认带上 CODE-RULES.md；在会话里用 /rules off、/rules on 可以临时关开，不影响这里。',
			unavailable: '这个 profile 暂时没有提供配置项，插件本身仍然可用。',
			saving: '保存中…',
			saveFailed: '宿主没有接受这个值，已保留原值供你重试。',
		};

		function readState(scope) {
			if (!scope || typeof scope.getSnapshot !== 'function') return null;
			const snapshot = scope.getSnapshot();
			if (!snapshot || typeof snapshot !== 'object') return null;
			return snapshot;
		}

		function CodeRulesCard(props) {
			if (props.view === 'summary') return COPY.summary;

			const scope = props.scope;
			const [snapshot, setSnapshot] = React.useState(() => readState(scope));
			const [saving, setSaving] = React.useState(false);
			const [failed, setFailed] = React.useState(false);

			React.useEffect(() => {
				if (!scope || typeof scope.subscribe !== 'function') return undefined;
				const sync = () => setSnapshot(readState(scope));
				sync();
				return scope.subscribe(sync);
			}, [scope]);

			const onToggle = async (checked) => {
				if (saving) return;
				if (!scope || typeof scope.set !== 'function') {
					setFailed(true);
					return;
				}
				setSaving(true);
				setFailed(false);
				try {
					const delivered = await scope.set('defaultEnabled', checked);
					setFailed(delivered === false);
				} catch {
					setFailed(true);
				} finally {
					setSaving(false);
				}
			};

			if (snapshot === null) {
				return React.createElement('p', { className: 'code-rules-hint' }, COPY.unavailable);
			}

			const enabled = snapshot.value?.defaultEnabled !== false;
			const Switch = primitives.Switch;

			return React.createElement(
				'div',
				{ className: 'code-rules-card' },
				React.createElement(
					'label',
					{ className: 'code-rules-toggle' },
					React.createElement('span', null, COPY.toggle),
					React.createElement(Switch, {
						checked: enabled,
						label: COPY.toggle,
						disabled: saving || snapshot.writable === false,
						onChange: onToggle,
					}),
				),
				React.createElement('p', { className: 'code-rules-hint' }, COPY.hint),
				saving ? React.createElement('p', { className: 'code-rules-hint' }, COPY.saving) : null,
				failed ? React.createElement('p', { className: 'code-rules-error' }, COPY.saveFailed) : null,
			);
		}

		function apply(ctx) {
			ctx.effect(
				() =>
					ctx.configForms.whileServed([CONFIG_NS], (served) =>
						ctx.slots.inject('plugins.item', () => {
							// 宿主没 serve 这个命名空间就别占位置：一张「暂时不可用」的空卡片只是噪音。
							if (!served.has(CONFIG_NS)) return () => {};
							return ctx.slots.register(
								{
									name: 'plugins.item',
									id: ENTRY_ID,
									order: 60,
									label: () => COPY.title,
									inject: () => ({ scope: ctx.configForms.get(CONFIG_NS) }),
								},
								CodeRulesCard,
							);
						}),
					),
				'code-rules: settings card',
			);
		}

		exports.apply = apply;
		exports.inject = ['slots', 'configForms'];
		exports.__internals = { COPY, ENTRY_ID, CONFIG_NS, CodeRulesCard };
		return module.exports;
	},
});
