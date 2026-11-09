/**
 * 首次生成：把探测到的事实填进九节骨架。
 *
 * 原则是「写这个仓库自己」，而不是一份放之四海皆准的模板：
 * 目录名、命名风格、测试命令都来自探测结果。
 */

import { SECTION_TITLES } from './rules-doc.js';

export function buildInitialDoc(facts, { today }) {
  const rules = [];
  const add = (section, level, text) => {
    const id = `R-${String(rules.length + 1).padStart(3, '0')}`;
    rules.push({ id, level, text, section });
    return id;
  };

  const primaryDir = pickPrimaryDir(facts);
  const testDir = pickTestDir(facts);
  add(2, 'MUST', `新的源码文件放在 ${primaryDir}/ 下。`);
  add(2, 'MUST', `测试文件放在 ${testDir}/ 下，与源码目录结构保持一致。`);
  if (facts.dirs.length > 0) {
    add(2, 'SHOULD', `顶层目录保持 ${facts.dirs.slice(0, 6).join(' / ')} 这几类，新增平行目录要说明理由。`);
  }

  const style = facts.naming?.style ?? 'camelCase';
  add(3, 'MUST', `变量与函数使用 ${style}。`);
  add(3, 'MUST', '类型、类与组件使用 PascalCase。');
  add(3, 'MUST', '常量使用全大写加下划线。');

  add(4, 'MUST', '单个源文件不超过 400 行，超出就按职责拆分。');
  add(4, 'MUST', '单个函数不超过 60 行，嵌套不超过 4 层。');

  add(5, 'SHOULD', '导出的函数写一段说明用途、参数与返回值的注释。');
  add(5, 'MAY', '复杂分支前写一行「为什么」，而不是复述代码做了什么。');

  add(6, 'MUST', '不吞掉异常，至少记录一次，并保留原始错误。');
  add(6, 'MUST', '对外返回的错误带可读的错误码与上下文。');

  add(7, 'MUST', '同时持有多把锁时按固定顺序获取，避免交叉等待。');
  add(7, 'SHOULD', '异步等待都带超时，避免无限挂起。');

  add(8, 'MUST', `提交前运行 ${facts.testCommand}。`);
  add(8, 'SHOULD', '新增行为先写一个会失败的测试，再让它通过。');

  const sections = [];
  for (let no = 2; no <= 8; no += 1) {
    sections.push({ no, rules: rules.filter((rule) => rule.section === no).map(({ id, level, text }) => ({ id, level, text })) });
  }

  const language = facts.language === 'unknown' ? '' : facts.language;
  const entry = `初始生成（探测到 ${language || '未识别语言'} · ${facts.dirs.length} 个顶层目录 · ${facts.samples.length} 个样本文件）`;

  return {
    schema: 1,
    language,
    updated: today,
    principles: [
      '可读性优先于聪明的写法。',
      '显式优于隐式：能写清楚的地方不留猜测空间。',
      '改动要小，一次只解决一个问题，提交信息说明做了什么。',
    ],
    sections,
    frozen: [],
    changelog: [`${today} v1 · ${entry}`],
    version: 1,
  };
}

/** 供 `/rules init` 输出的一段人话说明，讲清这次依据了什么。 */
export function describeFacts(facts) {
  const lines = [
    `语言：${facts.language === 'unknown' ? '未识别' : facts.language}`,
    `顶层目录：${facts.dirs.length > 0 ? facts.dirs.join('、') : '未探测到'}`,
    `测试命令：${facts.testCommand}`,
    `命名风格：${facts.naming?.style ?? '未探测到'}（${facts.naming?.evidence ?? 0} 处证据）`,
    `lint 配置：${facts.lint.length > 0 ? facts.lint.join('、') : '未探测到'}`,
    `样本文件：${facts.samples.length} 个`,
  ];
  if (facts.readme?.heading) lines.push(`README：${facts.readme.heading}`);
  for (const warning of facts.warnings ?? []) lines.push(`注意：${warning}`);
  return lines.join('\n');
}

export function sectionTitle(no) {
  return SECTION_TITLES[no] ?? `第 ${no} 节`;
}

function pickPrimaryDir(facts) {
  const preferred = ['src', 'lib', 'app', 'source'];
  const hit = facts.dirs.find((dir) => preferred.includes(dir));
  return hit ?? facts.dirs.find((dir) => dir !== 'test' && dir !== 'tests') ?? 'src';
}

function pickTestDir(facts) {
  const hit = facts.dirs.find((dir) => ['test', 'tests', '__tests__', 'spec'].includes(dir));
  return hit ?? 'test';
}
