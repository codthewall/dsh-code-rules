/**
 * 解析宿主的 `@deepseek-ai/dsh-tools`。
 *
 * 这个仓库是以 `link:` 装进 profile 的，真实路径在 profile 作用域之外，
 * 裸 `import('@deepseek-ai/dsh-tools')` 会解析失败（宿主把它放在 app.asar 里，
 * 由 app-boot 的解析路由替 profile 内的包补上，link 出去的就漏了）。
 * 于是按「裸名 → 启动参数里的 app.asar → resourcesPath → 环境变量」依次试，
 * 全失败才返回 undefined，让调用方降级。
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELATIVE = ['node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'];

/** 从进程启动参数里找 dsh 安装根（桌面版把 `<resources>/app.asar/dsh` 直接放进 argv）。 */
function rootsFromArgv(argv) {
  const roots = [];
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.includes('app.asar')) continue;
    const index = arg.indexOf('app.asar');
    roots.push(arg.slice(0, index + 'app.asar'.length) + '/dsh');
  }
  return roots;
}

/** 候选说明符，按命中概率排序。 */
export function candidates(argv = process.argv, env = process.env) {
  const list = ['@deepseek-ai/dsh-tools'];
  const roots = [...rootsFromArgv(argv)];
  if (env.DSH_APP_ROOT) roots.push(env.DSH_APP_ROOT);
  if (typeof process.resourcesPath === 'string') roots.push(join(process.resourcesPath, 'app.asar', 'dsh'));
  for (const root of roots) {
    list.push(pathToFileURL(join(root, ...RELATIVE)).href);
  }
  return list;
}

/**
 * 逐个候选尝试导入，返回模块本身；全失败返回 undefined。
 * 每次调用都重新解析：宿主换安装位置后不必重启进程。
 */
export async function loadDshTools(options = {}) {
  const list = candidates(options.argv ?? process.argv, options.env ?? process.env);
  for (const specifier of list) {
    try {
      const module = await import(specifier);
      if (typeof module?.defineTool === 'function') return module;
    } catch {
      /* 下一个候选 */
    }
  }
  return undefined;
}
