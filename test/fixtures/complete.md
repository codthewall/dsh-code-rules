---
schema: 1
language: typescript
updated: 2026-11-09
---

# 代码约束规则

## 1. 总则

- 可读性优先于聪明的写法。
- 显式优于隐式。
- 改动要小，提交要能讲清一件事。

## 2. 文件与目录

- R-001 · MUST · 源码放在 src/ 下，测试放在 test/ 下。
- R-002 · MUST · 一个目录的入口文件统一叫 index.ts。

## 3. 命名

- R-003 · MUST · 变量与函数使用 camelCase。
- R-004 · MUST · 类型与类使用 PascalCase。

## 4. 单文件规模上限

- R-005 · SHOULD · 单个源文件不超过 400 行。
- R-006 · MUST · 单个函数不超过 60 行。

## 5. 注释与文档

- R-007 · SHOULD · 导出的函数写一段说明用途的注释。
- R-008 · MAY · 复杂分支前写一行「为什么」。

## 6. 错误处理与日志

- R-009 · MUST · 不吞掉异常，至少记录一次。
- R-010 · MUST · 对外错误要有可读的错误码。

## 7. 并发与死锁

- R-011 · MUST · 同时持有多把锁时按固定顺序获取。
- R-012 · SHOULD · 异步等待都带超时。

## 8. 自测与验证

- R-013 · MUST · 提交前运行 npm test。
- R-014 · SHOULD · 新增行为先写失败的测试。

## 9. 冻结清单

```yaml
frozen:
  - name: findUserById
    kind: function
    since: 2026-05-01
    reason: 公共 API, 外部已调用
  - name: UserRecord
    kind: type
    since: 2026-06-11
    reason: 数据库映射结构
```

## 变更记录

- 2026-06-11 v2 · 冻结 UserRecord
- 2026-05-01 v1 · 初始生成
