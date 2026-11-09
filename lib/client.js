/**
 * 浏览器端：在设置页左侧导航里加一个「代码约束规则」整页，样式对齐内置设置页
 * （标题 + 分组卡片 + 右上角保存）。
 *
 * 只在宿主真的为 `code-rules` 命名空间提供了配置表单时才挂载——宿主侧 `index.js`
 * 导出了 `Config`，`configForms` 才会 serve 它；没 serve 就什么都不渲染。
 *
 * 结构照官方 `dsh-client-ui-settings-shell` 与 `dsh-pet` 的 `settings.section`：
 * - 入口 `window.__ModuleLoader__.load({ id, factory(require) })`
 * - 导出 `apply(ctx)` 与 `inject`（服务名）
 * - 依赖只声明确实必须的 `slots` 与 `configForms`
 */

window.__ModuleLoader__.load({
	id: 'dsh-code-rules',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		let primitives = {};
		try {
			primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {};
		} catch (error) {
			// 控件库缺失不该让整页消失：下面会退回原生 checkbox。
			console.warn(
				'[dsh-code-rules] 设置页控件模块不可用：' + (error instanceof Error ? error.message : String(error)),
			);
		}

		const ENTRY_ID = 'code-rules';
		const CONFIG_NS = 'code-rules';
		const SECTION_ORDER = 30;

		const DEFAULTS = { defaultEnabled: true, fullLimit: 6000, summaryLimit: 12000 };

		const COPY = {
			title: '代码约束规则',
			description: '把项目根目录的 CODE-RULES.md 注入每一轮对话，让写代码的人和模型照着同一份约定走。',
			groupInjection: '注入',
			groupBudget: '注入预算',
			groupCommands: '命令',
			enabled: '默认注入',
			enabledHint: '新会话默认带上规则；会话里用 /rules off、/rules on 可以临时关开，不受这里影响。',
			fullLimit: '全文上限（字符）',
			fullLimitHint: '规则文件不超过这个长度就整份注入；留空或填 0 会用默认值。',
			summaryLimit: '摘要上限（字符）',
			summaryLimitHint: '超过全文上限就降级成摘要；再超过这个长度，只注入摘要与完整冻结清单。',
			commandsHint: '/rules init 生成；add / update / freeze / unfreeze 维护；rollback 回退；status 看当前版本。',
			save: '保存',
			saving: '保存中…',
			reset: '恢复默认',
			saved: '已保存。',
			unchanged: '没有改动。',
			saveFailed: '宿主没有接受这些值，请稍后重试。',
			unavailable: '这个 profile 暂时没有提供配置项，插件本身仍然可用。',
		};

		const STYLE_ID = 'dsh-code-rules-settings-style';
		const CSS = [
			'.dcr-page{display:flex;flex-direction:column;gap:14px;padding:2px 2px 28px;}',
			'.dcr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}',
			'.dcr-title{margin:0;font-size:16px;font-weight:600;}',
			'.dcr-desc{margin:6px 0 0;font-size:12px;line-height:1.6;opacity:.66;max-width:640px;}',
			'.dcr-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}',
			'.dcr-btn{height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(127,127,127,.32);',
			'background:transparent;color:inherit;font-size:12px;cursor:pointer;}',
			'.dcr-btn:hover:not(:disabled){border-color:rgba(127,127,127,.55);}',
			'.dcr-btn:disabled{opacity:.45;cursor:default;}',
			'.dcr-btn-primary{background:rgba(86,132,255,.92);border-color:transparent;color:#fff;}',
			'.dcr-btn-primary:hover:not(:disabled){background:rgba(86,132,255,1);}',
			'.dcr-card{border:1px solid rgba(127,127,127,.18);border-radius:10px;padding:14px 16px 16px;}',
			'.dcr-card-title{margin:0 0 12px;font-size:13px;font-weight:600;opacity:.9;}',
			'.dcr-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;}',
			'.dcr-row + .dcr-row{border-top:1px solid rgba(127,127,127,.12);}',
			'.dcr-label{font-size:13px;display:flex;align-items:center;gap:6px;}',
			'.dcr-help{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;',
			'border-radius:50%;border:1px solid rgba(127,127,127,.45);font-size:10px;opacity:.6;cursor:help;}',
			'.dcr-input{width:120px;height:28px;padding:0 8px;border-radius:6px;text-align:right;',
			'border:1px solid rgba(127,127,127,.32);background:rgba(127,127,127,.06);color:inherit;font-size:12px;}',
			'.dcr-hint{margin:6px 0 0;font-size:11px;line-height:1.6;opacity:.55;}',
			'.dcr-msg{font-size:12px;}',
			'.dcr-msg-ok{color:#3fa66a;}',
			'.dcr-msg-error{color:#e0564a;}',
		].join('');

		function installStyle() {
			if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		function readState(scope) {
			if (!scope || typeof scope.getSnapshot !== 'function') return null;
			const snapshot = scope.getSnapshot();
			if (!snapshot || typeof snapshot !== 'object') return null;
			return snapshot;
		}

		function draftFrom(snapshot) {
			const value = snapshot?.value ?? {};
			const number = (input, fallback) => {
				const parsed = typeof input === 'string' ? Number.parseInt(input, 10) : input;
				return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
			};
			return {
				defaultEnabled: value.defaultEnabled !== false,
				fullLimit: number(value.fullLimit, DEFAULTS.fullLimit),
				summaryLimit: number(value.summaryLimit, DEFAULTS.summaryLimit),
			};
		}

		function sameDraft(a, b) {
			return (
				a.defaultEnabled === b.defaultEnabled &&
				a.fullLimit === b.fullLimit &&
				a.summaryLimit === b.summaryLimit
			);
		}

		function CodeRulesSection(props) {
			const scope = props.scope;
			const [snapshot, setSnapshot] = React.useState(() => readState(scope));
			const [draft, setDraft] = React.useState(() => draftFrom(readState(scope)));
			const [saving, setSaving] = React.useState(false);
			const [message, setMessage] = React.useState(null);

			React.useEffect(() => {
				if (!scope || typeof scope.subscribe !== 'function') return undefined;
				const sync = () => {
					const next = readState(scope);
					setSnapshot(next);
					setDraft(draftFrom(next));
				};
				sync();
				return scope.subscribe(sync);
			}, [scope]);

			if (snapshot === null) {
				return React.createElement('p', { className: 'dcr-hint' }, COPY.unavailable);
			}

			const saved = draftFrom(snapshot);
			const dirty = !sameDraft(draft, saved);
			const writable = snapshot.writable !== false && Boolean(scope) && typeof scope.set === 'function';
			const SwitchControl =
				typeof primitives.Switch === 'function'
					? primitives.Switch
					: (props) =>
							React.createElement('input', {
								type: 'checkbox',
								checked: Boolean(props.checked),
								disabled: props.disabled,
								'aria-label': props.label,
								onChange: (event) => props.onChange?.(event.target.checked),
							});

			const edit = (field, value) => {
				setMessage(null);
				setDraft((current) => ({ ...current, [field]: value }));
			};

			const commit = async (next, success) => {
				setSaving(true);
				setMessage(null);
				let delivered = true;
				try {
					for (const field of ['defaultEnabled', 'fullLimit', 'summaryLimit']) {
						if (next[field] === saved[field]) continue;
						const result = await scope.set(field, next[field]);
						if (result === false) delivered = false;
					}
				} catch {
					delivered = false;
				} finally {
					setSaving(false);
				}
				setMessage(delivered ? { kind: 'ok', text: success } : { kind: 'error', text: COPY.saveFailed });
			};

			const onSave = () => {
				if (!writable) return;
				if (!dirty) {
					setMessage({ kind: 'ok', text: COPY.unchanged });
					return;
				}
				void commit(draft, COPY.saved);
			};

			const onReset = () => {
				if (!writable) return;
				setDraft({ ...DEFAULTS });
				void commit({ ...DEFAULTS }, COPY.saved);
			};

			const numberRow = (field, label, hint) =>
				React.createElement(
					'div',
					{ className: 'dcr-row' },
					React.createElement(
						'div',
						null,
						React.createElement(
							'div',
							{ className: 'dcr-label' },
							label,
							React.createElement('span', { className: 'dcr-help', title: hint }, '?'),
						),
						React.createElement('p', { className: 'dcr-hint' }, hint),
					),
					React.createElement('input', {
						className: 'dcr-input',
						type: 'number',
						min: 1000,
						step: 500,
						value: String(draft[field]),
						disabled: !writable || saving,
						onChange: (event) => {
							const parsed = Number.parseInt(event.target.value, 10);
							edit(field, Number.isFinite(parsed) ? parsed : 0);
						},
					}),
				);

			return React.createElement(
				'div',
				{ className: 'dcr-page' },
				React.createElement(
					'div',
					{ className: 'dcr-head' },
					React.createElement(
						'div',
						null,
						React.createElement('h2', { className: 'dcr-title' }, COPY.title),
						React.createElement('p', { className: 'dcr-desc' }, COPY.description),
					),
					React.createElement(
						'div',
						{ className: 'dcr-actions' },
						message
							? React.createElement(
									'span',
									{ className: `dcr-msg dcr-msg-${message.kind === 'ok' ? 'ok' : 'error'}` },
									message.text,
								)
							: null,
						React.createElement(
							'button',
							{ className: 'dcr-btn', type: 'button', disabled: !writable || saving, onClick: onReset },
							COPY.reset,
						),
						React.createElement(
							'button',
							{
								className: 'dcr-btn dcr-btn-primary',
								type: 'button',
								disabled: !writable || saving || !dirty,
								onClick: onSave,
							},
							saving ? COPY.saving : COPY.save,
						),
					),
				),
				React.createElement(
					'section',
					{ className: 'dcr-card' },
					React.createElement('h3', { className: 'dcr-card-title' }, COPY.groupInjection),
					React.createElement(
						'div',
						{ className: 'dcr-row' },
						React.createElement(
							'div',
							null,
							React.createElement('div', { className: 'dcr-label' }, COPY.enabled),
							React.createElement('p', { className: 'dcr-hint' }, COPY.enabledHint),
						),
						React.createElement(SwitchControl, {
							checked: draft.defaultEnabled,
							label: COPY.enabled,
							disabled: !writable || saving,
							onChange: (checked) => edit('defaultEnabled', checked),
						}),
					),
				),
				React.createElement(
					'section',
					{ className: 'dcr-card' },
					React.createElement('h3', { className: 'dcr-card-title' }, COPY.groupBudget),
					numberRow('fullLimit', COPY.fullLimit, COPY.fullLimitHint),
					numberRow('summaryLimit', COPY.summaryLimit, COPY.summaryLimitHint),
				),
				React.createElement(
					'section',
					{ className: 'dcr-card' },
					React.createElement('h3', { className: 'dcr-card-title' }, COPY.groupCommands),
					React.createElement('p', { className: 'dcr-hint' }, COPY.commandsHint),
				),
			);
		}

		function apply(ctx) {
			installStyle();
			ctx.effect(
				() =>
					ctx.configForms.whileServed([CONFIG_NS], (served) =>
						ctx.slots.inject('settings.section', () => {
							// 宿主没 serve 这个命名空间就别占一个空的导航项。
							if (!served.has(CONFIG_NS)) return () => {};
							return ctx.slots.register(
								{
									name: 'settings.section',
									id: ENTRY_ID,
									order: SECTION_ORDER,
									label: () => COPY.title,
									inject: () => ({ scope: ctx.configForms.get(CONFIG_NS) }),
								},
								CodeRulesSection,
							);
						}),
					),
				'code-rules: settings section',
			);
		}

		exports.apply = apply;
		exports.inject = ['slots', 'configForms'];
		exports.__internals = { COPY, CSS, DEFAULTS, ENTRY_ID, CONFIG_NS, CodeRulesSection, draftFrom };
		return module.exports;
	},
});
