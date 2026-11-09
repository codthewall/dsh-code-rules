/**
 * CODE-RULES.md 的纯函数层：解析、渲染、校验、统计。
 *
 * 这一层不碰磁盘、不碰 DSH —— 输入输出都是字符串与普通对象，
 * 因此可以在 `node --test` 里直接测，不需要起 Harness。
 */

export const SCHEMA_VERSION = 1;

/** 规则文件固定放在项目根，文件名不随开关或语言变化。 */
export const RULES_FILE = 'CODE-RULES.md';

/** 固定的九节骨架。第 9 节是冻结清单，其后是变更记录。 */
export const SECTION_TITLES = {
  1: '总则',
  2: '文件与目录',
  3: '命名',
  4: '单文件规模上限',
  5: '注释与文档',
  6: '错误处理与日志',
  7: '并发与死锁',
  8: '自测与验证',
  9: '冻结清单',
};

export const RULE_LEVELS = ['MUST', 'SHOULD', 'MAY'];

export const CHANGELOG_TITLE = '变更记录';

const RULE_LINE = /^- (R-\d{3}) · (MUST|SHOULD|MAY) · (.+)$/;
const SECTION_HEADING = /^## (\d+)\. (.+)$/;
const FREEZE_FENCE = '```yaml';

/** 带错误码的解析错误，命令层据此给出可读提示。 */
export class RulesDocError extends Error {
  constructor(code, message, line = 0) {
    super(line > 0 ? `${message}（第 ${line} 行）` : message);
    this.name = 'RulesDocError';
    this.code = code;
    this.line = line;
  }
}

/**
 * 解析一份规则文件。
 * @param {string} text
 * @param {{ file?: string }} [options]
 */
export function parse(text, { file = 'CODE-RULES.md' } = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const { front, bodyStart } = parseFrontMatter(lines, file);

  const sections = [];
  const changelog = [];
  let current = null;
  let inChangelog = false;

  for (let i = bodyStart; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (current) current.body.push({ text: '', line: lineNo });
      continue;
    }
    const heading = SECTION_HEADING.exec(trimmed);
    if (heading) {
      current = { no: Number(heading[1]), title: heading[2].trim(), body: [], line: lineNo };
      sections.push(current);
      continue;
    }
    if (trimmed === `## ${CHANGELOG_TITLE}`) {
      inChangelog = true;
      current = null;
      continue;
    }
    if (trimmed.startsWith('# ')) continue; // 文档标题，不参与解析
    if (current) {
      current.body.push({ text: raw, line: lineNo });
      continue;
    }
    if (inChangelog) {
      changelog.push({ text: trimmed, line: lineNo });
      continue;
    }
    throw new RulesDocError('E_CONTENT_OUTSIDE_SECTION', '内容必须位于某个二级标题之下', lineNo);
  }

  const byNumber = indexSections(sections);
  const principles = parsePrinciples(byNumber.get(1).body);
  const rules = [];
  for (let no = 2; no <= 8; no += 1) {
    rules.push({ no, rules: parseRuleSection(byNumber.get(no)) });
  }
  const frozen = parseFreeze(byNumber.get(9).body);
  const entries = parseChangelog(changelog);

  return {
    schema: Number(front.schema),
    language: front.language ?? '',
    updated: front.updated ?? '',
    principles,
    sections: rules,
    frozen,
    changelog: entries,
    version: maxVersion(entries),
  };
}

/**
 * 把文档渲染成规范形态的文本。
 * `parse(render(doc))` 与 `render(parse(text))` 在规范文本上互为逆运算。
 */
export function render(doc) {
  const out = ['---', `schema: ${doc.schema ?? SCHEMA_VERSION}`];
  if (doc.language) out.push(`language: ${doc.language}`);
  if (doc.updated) out.push(`updated: ${doc.updated}`);
  out.push('---', '', '# 代码约束规则', '');

  for (let no = 1; no <= 9; no += 1) {
    out.push(`## ${no}. ${SECTION_TITLES[no]}`, '');
    if (no === 1) {
      for (const principle of doc.principles ?? []) out.push(`- ${principle}`);
    } else if (no === 9) {
      out.push(FREEZE_FENCE, ...renderFrozen(doc.frozen ?? []), '```');
    } else {
      const section = (doc.sections ?? []).find((item) => item.no === no);
      for (const rule of section?.rules ?? []) {
        out.push(`- ${rule.id} · ${rule.level} · ${rule.text}`);
      }
    }
    out.push('');
  }

  out.push(`## ${CHANGELOG_TITLE}`, '');
  for (const entry of doc.changelog ?? []) out.push(`- ${entry}`);
  return `${out.join('\n')}\n`;
}

/**
 * 校验一份已经构造好的文档对象（不是文本）。返回问题清单，空数组表示通过。
 */
export function validate(doc) {
  const problems = [];
  const seen = new Set();
  if (!Array.isArray(doc.principles) || doc.principles.length === 0) {
    problems.push(problem('E_PRINCIPLES_EMPTY', '第 1 节「总则」至少要有一条原则'));
  }
  for (let no = 2; no <= 8; no += 1) {
    const section = (doc.sections ?? []).find((item) => item.no === no);
    if (!section) {
      problems.push(problem('E_SECTION_MISSING', `缺少第 ${no} 节「${SECTION_TITLES[no]}」`));
      continue;
    }
    for (const rule of section.rules) {
      if (seen.has(rule.id)) problems.push(problem('E_RULE_DUPLICATE', `规则编号重复：${rule.id}`));
      seen.add(rule.id);
      if (!RULE_LEVELS.includes(rule.level)) {
        problems.push(problem('E_RULE_LEVEL', `${rule.id} 的等级必须是 MUST/SHOULD/MAY`, 0, rule.id));
      }
      if (!rule.text || !rule.text.trim()) {
        problems.push(problem('E_RULE_EMPTY', `${rule.id} 缺少规则正文`, 0, rule.id));
      }
    }
  }
  const frozenNames = new Set();
  for (const item of doc.frozen ?? []) {
    if (!item.name) problems.push(problem('E_FREEZE_NAME', '冻结项缺少 name'));
    else if (frozenNames.has(item.name)) problems.push(problem('E_FREEZE_DUPLICATE', `冻结项重复：${item.name}`));
    else frozenNames.add(item.name);
  }
  if (!Array.isArray(doc.changelog) || doc.changelog.length === 0) {
    problems.push(problem('E_CHANGELOG_EMPTY', '变更记录至少要有一行'));
  }
  return problems;
}

/** 统计一份文档的规模信息，供置顶摘要与 status 使用。 */
export function describe(doc) {
  const counts = { MUST: 0, SHOULD: 0, MAY: 0 };
  for (const section of doc.sections ?? []) {
    for (const rule of section.rules) counts[rule.level] += 1;
  }
  return {
    version: doc.version ?? maxVersion(doc.changelog ?? []),
    total: counts.MUST + counts.SHOULD + counts.MAY,
    counts,
    frozen: (doc.frozen ?? []).length,
    sections: (doc.sections ?? []).length,
  };
}

function problem(code, message, line = 0, ruleId = '') {
  return { code, message, line, ruleId };
}

function parseFrontMatter(lines, file) {
  const front = {};
  if ((lines[0] ?? '').trim() !== '---') {
    throw new RulesDocError('E_FRONT_MATTER_MISSING', `${file} 必须以 --- 文件头开始`, 1);
  }
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '---') {
      checkSchema(front, i + 1);
      return { front, bodyStart: i + 1 };
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!match) throw new RulesDocError('E_FRONT_MATTER', '文件头每行应为 `key: value`', i + 1);
    front[match[1]] = unquote(match[2]);
  }
  throw new RulesDocError('E_FRONT_MATTER', '文件头缺少结束的 ---', lines.length);
}

function checkSchema(front, line) {
  if (front.schema === undefined) throw new RulesDocError('E_SCHEMA_MISSING', '文件头缺少 schema', line);
  if (Number(front.schema) !== SCHEMA_VERSION) {
    throw new RulesDocError(
      'E_SCHEMA_UNSUPPORTED',
      `不认识的 schema 版本：${front.schema}（本插件只支持 ${SCHEMA_VERSION}）`,
      line,
    );
  }
}

function indexSections(sections) {
  const byNumber = new Map();
  for (const section of sections) {
    if (section.no < 1 || section.no > 9) {
      throw new RulesDocError('E_SECTION_UNKNOWN', `未知的章节编号 ${section.no}`, section.line);
    }
    if (byNumber.has(section.no)) {
      throw new RulesDocError('E_SECTION_DUPLICATE', `第 ${section.no} 节重复出现`, section.line);
    }
    if (section.title !== SECTION_TITLES[section.no]) {
      throw new RulesDocError(
        'E_SECTION_TITLE',
        `第 ${section.no} 节标题应为「${SECTION_TITLES[section.no]}」，实际为「${section.title}」`,
        section.line,
      );
    }
    byNumber.set(section.no, section);
  }
  const missing = [];
  for (let no = 1; no <= 9; no += 1) if (!byNumber.has(no)) missing.push(no);
  if (missing.length > 0) {
    throw new RulesDocError('E_SECTION_MISSING', `缺少章节：${missing.join('、')}`, 0);
  }
  return byNumber;
}

function parsePrinciples(body) {
  const principles = [];
  for (const entry of body) {
    const text = entry.text.trim();
    if (text === '') continue;
    if (text.startsWith('- ')) {
      principles.push(text.slice(2).trim());
      continue;
    }
    throw new RulesDocError('E_PRINCIPLE_SYNTAX', '第 1 节每条原则应以「- 」开头', entry.line);
  }
  if (principles.length === 0) {
    throw new RulesDocError('E_PRINCIPLES_EMPTY', '第 1 节「总则」至少要有一条原则', body[0]?.line ?? 0);
  }
  return principles;
}

function parseRuleSection(section) {
  const rules = [];
  for (const entry of section.body) {
    const text = entry.text.trim();
    if (text === '') continue;
    const match = RULE_LINE.exec(text);
    if (!match) {
      throw new RulesDocError(
        'E_RULE_SYNTAX',
        '规则行格式应为「- R-012 · MUST · 正文」',
        entry.line,
      );
    }
    rules.push({ id: match[1], level: match[2], text: match[3].trim() });
  }
  return rules;
}

function parseFreeze(body) {
  const start = body.findIndex((entry) => entry.text.trim() === FREEZE_FENCE);
  if (start === -1) {
    throw new RulesDocError(
      'E_FREEZE_MISSING',
      '第 9 节缺少 ```yaml 冻结块（空清单也应写 frozen: []）',
      body[0]?.line ?? 0,
    );
  }
  const end = body.findIndex((entry, index) => index > start && entry.text.trim() === '```');
  if (end === -1) {
    throw new RulesDocError('E_FREEZE_MISSING', '冻结块的 ```yaml 没有闭合', body[start].line);
  }

  const frozen = [];
  let current = null;
  let declared = false;
  for (const entry of body.slice(start + 1, end)) {
    const text = entry.text.trim();
    if (text === '' || text.startsWith('#')) continue;
    if (!declared) {
      const match = /^frozen\s*:(.*)$/.exec(text);
      if (!match) throw new RulesDocError('E_FREEZE_SYNTAX', '冻结块顶层必须是 `frozen:`', entry.line);
      declared = true;
      const rest = match[1].trim();
      if (rest === '[]' || rest === '') continue;
      throw new RulesDocError('E_FREEZE_SYNTAX', '`frozen:` 之后只能是空值或 []', entry.line);
    }
    if (text.startsWith('- ')) {
      current = {};
      frozen.push(current);
      assignField(current, text.slice(2), entry.line);
      continue;
    }
    if (!current) throw new RulesDocError('E_FREEZE_SYNTAX', '冻结项字段缺少所在的列表项', entry.line);
    assignField(current, text, entry.line);
  }
  if (!declared) throw new RulesDocError('E_FREEZE_SYNTAX', '冻结块缺少 `frozen:` 行', body[start].line);

  for (const item of frozen) {
    if (!item.name) throw new RulesDocError('E_FREEZE_NAME', '冻结项缺少 name 字段', body[start].line);
  }
  return frozen;
}

function assignField(item, text, line) {
  const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
  if (!match) throw new RulesDocError('E_FREEZE_SYNTAX', `无法解析冻结项字段：${text}`, line);
  item[match[1]] = unquote(match[2]);
}

function parseChangelog(entries) {
  const changelog = [];
  for (const entry of entries) {
    if (!entry.text.startsWith('- ')) {
      throw new RulesDocError('E_CHANGELOG_SYNTAX', '变更记录每行应以「- 」开头', entry.line);
    }
    changelog.push(entry.text.slice(2).trim());
  }
  if (changelog.length === 0) throw new RulesDocError('E_CHANGELOG_EMPTY', '变更记录至少要有一行');
  return changelog;
}

function renderFrozen(frozen) {
  if (frozen.length === 0) return ['frozen: []'];
  const out = ['frozen:'];
  for (const item of frozen) {
    out.push(`  - name: ${quoteIfNeeded(item.name)}`);
    for (const key of ['kind', 'since', 'reason']) {
      if (item[key]) out.push(`    ${key}: ${quoteIfNeeded(item[key])}`);
    }
  }
  return out;
}

function quoteIfNeeded(value) {
  const text = String(value);
  return /[:#'"]/.test(text) ? `'${text.replace(/'/g, "''")}'` : text;
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function maxVersion(entries) {
  let version = 0;
  for (const entry of entries) {
    const match = /v(\d+)/.exec(entry);
    if (match) version = Math.max(version, Number(match[1]));
  }
  return version || 1;
}
