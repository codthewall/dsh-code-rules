# dsh-code-rules

给 DeepSeek Harness 用的项目级「代码约束规则」插件：把一份 `CODE-RULES.md` 自动注入每一轮对话，并提供命令和工具让规则随代码一起演进。

生成的文件长这样（节选）：

````markdown
---
schema: 1
language: typescript
updated: 2026-11-09
---

# 代码约束规则

## 1. 总则

- 可读性优先于聪明的写法。

## 4. 单文件规模上限

- R-006 · MUST · 单个源文件不超过 400 行，超出就按职责拆分。

## 9. 冻结清单

```yaml
frozen:
  - name: handleSubmit
    kind: function
    since: 2026-01-01
    reason: 外部插件按名字调用
```

## 变更记录

- 2026-11-09 v1 · 初始生成（探测到 typescript · 6 个顶层目录 · 8 个样本文件）
````

## 安装

先确认你用的是哪个 profile：Desktop 应用只读 `profiles/desktop`，`dsh web` 读 `profiles/web`，装错目录会表现为「插件列表里根本没有它」。

```bash
# web
dsh plugin --profile web add link:<本仓库绝对路径>

# desktop：必须走宿主自带 CLI，裸 dsh 会拒绝（该 profile 由 Electron 应用独占管理）
$env:ELECTRON_RUN_AS_NODE='1'
& "<DSH 安装目录>\DeepSeek Harness.exe" --expose-internals `
  "<DSH 安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add "link:<本仓库绝对路径>"
```

装完**完全退出 DSH 再启动**（插件树只在启动时组装，关窗口不算）。之后在任意项目里敲 `/rules init`。

发版前的手动验证步骤见 [`docs/smoke.md`](docs/smoke.md)。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/rules init [--force] [--ai]` | 探测仓库（语言栈、目录、测试命令、命名风格）并生成 `CODE-RULES.md`；`--ai` 再让 Agent 读几个真实文件精修 |
| `/rules status` | 版本、规则数、等级分布、冻结项、本会话注入开关 |
| `/rules add <文本> [--section=2-8] [--level=MUST\|SHOULD\|MAY]` | 新增一条规则，省略 `--section` 时按关键词推断 |
| `/rules update <R-001> [新文本] [--level=…]` | 改规则；放宽等级要 `--confirm` |
| `/rules update <R-001> --remove --confirm` | 删规则 |
| `/rules freeze <名称> [--kind=function] [--reason=…]` | 把函数/类/常量名锁进冻结清单 |
| `/rules unfreeze <名称> --reason=…` | 解冻，必须写理由 |
| `/rules rollback [1\|2]` | 退回上一代 / 上上代 |
| `/rules off` / `/rules on` | 只关/开当前会话的注入 |

不带子命令等价于 `/rules status`。

## 注入策略

每轮开始时按文件体积分三档，冻结清单任何档位都完整保留：

| 体积 | 注入内容 |
| --- | --- |
| ≤ 6000 字符 | 全文 |
| ≤ 12000 字符 | 40 行摘要 + 章节索引 + 冻结清单 |
| > 12000 字符 | 20 行摘要 + 冻结清单 + 超限提示 |

三档末尾都会附一句维护指令：改完代码后若有新的或违反的约定，调用 `rules_update` 更新规则并说明原因。

## 三层开关

优先级从高到低：

1. **会话**：`/rules off`、`/rules on`，只影响当前会话，不落盘。
2. **项目**：`.rules/settings.json` 里 `{ "enabled": false }`。
3. **全局**：`cordis.patch.yml` 里本插件的 `config.defaultEnabled`，默认 `true`。

## 历史与回退

每次修改前，旧正文先推进 `.rules/history/`：

- `v-1.md`：上一代
- `v-2.md`：上上代

写入顺序是 `v-1 → v-2`、当前 → `v-1`、最后才覆盖正文；快照写不进去就放弃整次修改，正文一个字节都不动。`/rules rollback 1` 会回到 `v-1`，并且这次回退本身也进历史、版本号继续往上加。

建议把 `CODE-RULES.md` 和 `.rules/` 一起提交，别 gitignore——回退能力靠的就是这两个文件。

## 给模型用的工具

`rules_update`，参数 `op`（add / update / remove / freeze / unfreeze）、`note`（必填，变更理由）、`target`、`text`、`level`、`section`、`reason`。和命令走同一条写入路径，同样落快照、同样记变更记录。

## 文件格式约定

- 九个固定章节：`## 1. 总则` … `## 9. 冻结清单`，其后是 `## 变更记录`。
- 规则行固定格式：`- R-012 · MUST · 正文`（中点 U+00B7；编号全局递增）。
- 冻结清单是 `yaml` 代码块，顶层键 `frozen`，每项含 `name` / `kind` / `since` / `reason`。
- 解析错误会带错误码，例如 `E_SECTION_MISSING`、`E_RULE_SYNTAX`、`E_SCHEMA_UNSUPPORTED`。

## 开发

```bash
npm test        # node --test，无第三方依赖
```

模块划分：

| 文件 | 职责 |
| --- | --- |
| `lib/rules-doc.js` | 解析 / 渲染 / 校验，纯函数 |
| `lib/inject.js` | 三档注入文本 |
| `lib/snapshots.js` | 环形快照 |
| `lib/write.js` | 唯一写路径：快照 → 正文 → 变更记录 |
| `lib/mutations.js` | add / update / freeze / unfreeze |
| `lib/probe.js` | 首次生成的仓库探测 |
| `lib/template.js` | 九节骨架 |
| `lib/status.js` | `/rules status` 的文本 |
| `lib/args.js` | `rawInput` 解析 |
| `lib/tool.js` | `rules_update` 的定义与注册（加载器可注入，方便测试） |
| `lib/tool-call.js` | 工具调用 → 写入路径 |
| `index.js` | 挂到 DSH：命令、注入段、工具、三层开关 |

## 不做的事

monorepo 分影响范围、根据 diff 自动推断规则、强制拦截不合规代码、可视化编辑器、导出 ESLint 配置、多语言界面。理由见 `docs/adr/`。
