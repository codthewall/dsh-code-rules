/**
 * dsh-code-rules 的 host 入口。
 *
 * 目前只做两件事：注册 `/rules` 命令（status）与一个占位的系统提示段。
 * 后续票会往这里继续加：init 生成、三档注入、写入路径、rollback、
 * rules_update 工具、三层开关。
 */

import { statusText } from './lib/status.js';

const SECTION_NAME = 'code-rules';
const SECTION_ORDER = 40;
const COMMAND_NAME = 'rules';

const KNOWN_WORDS = ['status'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.inject(['commands', 'systemPrompt', 'workingDirectory'], (scope) => {
    scope.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      // 注入内容在后续票里实现；现在返回空串，等于不占上下文。
      text: () => '',
    });

    scope.commands.register({
      name: COMMAND_NAME,
      description: '查看本仓库的 CODE-RULES.md（代码约束规则）',
      input: { hint: '[status]' },
      handler: async ({ agent, rawInput, signal }) => {
        const word = rawInput.trim().split(/\s+/)[0] ?? '';
        if (word !== '' && !KNOWN_WORDS.includes(word)) {
          return {
            kind: 'error',
            text: `未知子命令：${word}。当前可用：/rules、/rules status。`,
          };
        }
        const cwd = await scope.workingDirectory.ensure(agent, signal);
        return { kind: 'success', text: await statusText(cwd) };
      },
    });
  });
}
