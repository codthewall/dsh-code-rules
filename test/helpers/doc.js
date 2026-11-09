/** 构造可渲染的规则文档，供多个测试共用。 */
export function makeDoc({ principles = 3, rulesPerSection = 1, frozen = [], version = 1 } = {}) {
  const sections = [];
  let index = 0;
  for (let no = 2; no <= 8; no += 1) {
    const rules = [];
    for (let i = 0; i < rulesPerSection; i += 1) {
      index += 1;
      rules.push({
        id: `R-${String(index).padStart(3, '0')}`,
        level: 'MUST',
        text: `第 ${no} 节的第 ${i + 1} 条规则，正文用于占位与体积测试。`,
      });
    }
    sections.push({ no, rules });
  }
  return {
    schema: 1,
    language: 'typescript',
    updated: '2026-11-09',
    version,
    principles: Array.from({ length: principles }, (_, i) => `原则 ${i + 1}：可读性优先于聪明的写法。`),
    sections,
    frozen,
    changelog: [`2026-11-09 v${version} · 测试数据`],
  };
}
