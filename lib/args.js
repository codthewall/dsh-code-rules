/**
 * 命令参数：第一个词是子命令，位置参数保持顺序，`--flag` / `--key=value` 收进对象。
 */

export function parseArgs(rawInput) {
  const tokens = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean);
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
