/**
 * `rules_update` 工具：规格与注册。
 *
 * `defineTool` 只有宿主里才有，所以加载器做成可注入的缝：
 * 测试传一个恒等函数就能覆盖到「参数表 → 执行 → 落盘」整条链路，
 * 不必在仓库里伪造 `@deepseek-ai/dsh-tools`。
 */

export const TOOL_NAME = 'rules_update';

const DESCRIPTION = [
  '维护项目代码约束规则文件 CODE-RULES.md：新增/修改/删除规则、冻结或解冻标识符。',
  '改完代码后如果出现了新的约定或违反了现有约定，用它更新规则并写清理由。',
].join('');

/** 参数表（宿主会把它转成 JSON Schema 并做校验）。 */
export function toolParameters() {
  return {
    op: { type: 'string', required: true, description: 'add | update | remove | freeze | unfreeze' },
    note: { type: 'string', required: true, description: '为什么改：一句话变更理由' },
    target: { type: 'string', description: 'update/remove 的规则 id（R-001）或 unfreeze 的标识符名' },
    text: { type: 'string', description: 'add/update 的规则正文' },
    level: { type: 'string', description: 'MUST | SHOULD | MAY，默认 MUST' },
    section: { type: 'string', description: '第几节（2-8），省略时按关键词推断' },
    reason: { type: 'string', description: 'freeze/unfreeze 的理由' },
  };
}

/** 组装工具定义；`handle(args, exec)` 返回给模型的文本。 */
export function createToolSpec(defineTool, handle) {
  return defineTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: toolParameters(),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args, exec) => handle(args, exec),
  });
}

/**
 * 注册工具。宿主没有 `@deepseek-ai/dsh-tools` 时只报一句话并跳过，
 * 绝不能因此让整个插件起不来。
 */
export async function registerTool({ ctx, loadTools, handle, onError }) {
  let defineTool;
  try {
    ({ defineTool } = await loadTools());
  } catch {
    onError(`未找到 @deepseek-ai/dsh-tools，跳过 ${TOOL_NAME} 工具注册`);
    return false;
  }
  if (typeof defineTool !== 'function') {
    onError(`${TOOL_NAME} 注册失败：defineTool 不可用`);
    return false;
  }
  try {
    ctx.inject(['tools'], (scope) => {
      scope.tools.register(createToolSpec(defineTool, handle));
    });
  } catch (error) {
    onError(`${TOOL_NAME} 工具注册失败：${error?.message ?? error}`);
    return false;
  }
  return true;
}
