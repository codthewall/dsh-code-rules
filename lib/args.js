/**
 * 命令参数：第一个词是子命令，位置参数保持顺序，`--flag` / `--key=value` 收进对象。
 * 词里允许用引号包住空格，例如 `/rules add "所有导出函数都要有 JSDoc"`。
 */

/** 按空白切词，同时尊重成对的单/双引号；引号本身不进入结果。 */
function tokenize(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const char of input) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

export function parseArgs(rawInput) {
  const tokens = tokenize(String(rawInput ?? '').trim());
  const word = (tokens.shift() ?? '').toLowerCase();
  const positional = [];
  const flags = {};
  for (const token of tokens) {
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const index = body.indexOf('=');
      if (index === -1) flags[body.toLowerCase()] = true;
      else flags[body.slice(0, index).toLowerCase()] = body.slice(index + 1);
      continue;
    }
    positional.push(token);
  }
  return { word, positional, flags };
}

/** 把 `--section=3` 这类值读成正整数；非法值返回 undefined。 */
export function intFlag(value) {
  if (value === undefined || value === true) return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}
