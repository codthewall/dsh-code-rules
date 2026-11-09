# 手动冒烟清单

自动测试覆盖不了「插件在真实宿主里被加载、命令和工具出现在会话里」这一段。每次发版前，在一台装好 DSH Desktop 的机器上按下面的顺序走一遍，全绿才算可发。

## 0. 准备

1. 仓库已在本地，`node --test --test-timeout=60000 test/*.test.js` 全绿。
2. 记录当前 desktop profile 的 bundle 列表，便于事后核对：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& "D:\deepseek_harness\DeepSeek Harness.exe" --expose-internals `
  "D:\deepseek_harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add "link:<仓库绝对路径>"
```

3. **完全退出 DSH Desktop 再重新打开**（关窗口不够，进程还在读旧 bundle 表）。
4. 新建一个空目录作为测试项目，在 Desktop 里把工作目录切过去。

## 1. 插件被加载

- [ ] 插件列表里能看到 `dsh-code-rules`，没有 `skipping profile bundle` 之类的告警。
- [ ] 启动日志里没有本插件的抛错。

## 2. `/rules status`（无文件）

- [ ] 敲 `/rules`，返回「还没有 CODE-RULES.md」，并提示用 `/rules init`。
- [ ] 敲 `/rules status`，同上；不会创建任何文件。

## 3. `/rules init`

- [ ] `/rules init` 成功，项目根出现 `CODE-RULES.md`。
- [ ] 文件头 front-matter 有 `schema: 1`、`language:`（是这个项目真实的语言）、`updated:`。
- [ ] 九个章节齐全，规则行形如 `- R-001 · MUST · …`。
- [ ] 第八节写的是这个项目真实的测试命令，或一句不带占位符的通用要求；**不能**出现「未识别语言」「未探测到测试命令」这类空话。
- [ ] 变更记录里有「初始生成」一条。
- [ ] 再敲一次 `/rules init`，应拒绝覆盖并提示 `--force`。

## 4. 注入生效

- [ ] 随便问一个与代码无关的问题，模型回复里不应复述规则文件——注入是背景约束，不是话题。
- [ ] 让它「按项目约定新增一个函数」，它应当遵守命名与文件位置约定（看它写出来的代码，而不是它的自述）。
- [ ] `/rules off` 后再问一次，约束应当消失；`/rules on` 后恢复。

## 5. 写入路径

- [ ] `/rules add "新增接口必须有契约测试。" --section=8` → 版本号 +1，文件里出现新规则，变更记录追加一行。
- [ ] `/rules add "…" --section=3 --level=SHOULD` → 规则落在第三节且等级为 SHOULD。
- [ ] `/rules update R-001 --text="…"` → 该条文本被替换，id 不变。
- [ ] `/rules update R-001 --level=MAY` → 被拒绝，提示放宽等级需要确认。
- [ ] `/rules freeze handleSubmit --reason="对外契约"` → 第九节 YAML 块里出现该项。
- [ ] `/rules unfreeze handleSubmit`（不带理由）→ 被拒绝；带 `--reason` 才成功。
- [ ] 每次成功写入后，`.rules/history/v-1.md` 是上一版全文。

## 6. 回退

- [ ] 连续改两次，`/rules rollback 1` → 内容回到上一版，且这次回退本身进了变更记录。
- [ ] `/rules rollback 2` → 回到上上版。
- [ ] 历史不足时 `/rules rollback 2` 给出可读错误，不是堆栈。

## 7. `rules_update` 工具

- [ ] 问模型「你能更新 CODE-RULES.md 吗」，它能说出工具名 `rules_update`，说明工具已注册。
- [ ] 让它执行一次 `add`，文件应当被真实改动，且回复里说明改了什么。
- [ ] `op` 传一个不存在的值，返回一句可读提示，不抛异常。

## 8. 关票前

- [ ] `git status` 干净（除本次冒烟产生的临时文件）。
- [ ] 把上面任何一条不通过的，记进对应 issue 再关。
