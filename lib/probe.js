/**
 * `/rules init` 的仓库探测：只读、只取样，不做全仓扫描。
 *
 * 探测失败一律降级为「未探测到」，绝不因为某个文件读不了就让 init 整体失败。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '.next',
  '.venv',
  '__pycache__',
  '.rules',
]);

const LANGUAGE_MARKERS = [
  ['typescript', ['tsconfig.json']],
  ['javascript', ['package.json']],
  ['python', ['pyproject.toml', 'setup.py', 'requirements.txt']],
  ['go', ['go.mod']],
  ['rust', ['Cargo.toml']],
  ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
  ['csharp', ['*.csproj', '*.sln']],
  ['cpp', ['CMakeLists.txt']],
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.h', '.hpp',
]);

const SAMPLE_LIMIT = 8;
const SAMPLE_LINES = 200;

/** 探测一个仓库，产出生成规则文件所需的事实。 */
export async function probeRepo(cwd) {
  const topLevel = await listTopLevel(cwd);
  const language = await detectLanguage(cwd, topLevel.files);
  const testCommand = await detectTestCommand(cwd, language);
  const lint = await detectLint(cwd, topLevel.files);
  const readme = await readReadme(cwd, topLevel.files);
  const samples = await readSamples(cwd, topLevel);
  const naming = detectNaming(samples, language);

  return {
    cwd,
    language,
    dirs: topLevel.dirs,
    files: topLevel.files,
    testCommand,
    lint,
    readme,
    samples,
    naming,
    warnings: topLevel.warnings,
  };
}

async function listTopLevel(cwd) {
  const dirs = [];
  const files = [];
  const warnings = [];
  let entries;
  try {
    entries = await readdir(cwd, { withFileTypes: true });
  } catch (error) {
    return { dirs, files, warnings: [`无法读取目录：${error?.message ?? error}`] };
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) dirs.push(entry.name);
    else if (entry.isFile()) files.push(entry.name);
  }
  dirs.sort();
  files.sort();
  return { dirs, files, warnings };
}

async function detectLanguage(cwd, files) {
  for (const [language, markers] of LANGUAGE_MARKERS) {
    for (const marker of markers) {
      if (marker.startsWith('*')) {
        const suffix = marker.slice(1);
        if (files.some((name) => name.endsWith(suffix))) return language;
        continue;
      }
      if (files.includes(marker)) return language;
    }
  }
  return 'unknown';
}

async function detectTestCommand(cwd, language) {
  if (language === 'javascript' || language === 'typescript') {
    const pkg = await readJson(join(cwd, 'package.json'));
    const script = pkg?.scripts?.test;
    if (typeof script === 'string' && script.trim() !== '') return 'npm test';
    return 'npm test';
  }
  if (language === 'python') return 'pytest';
  if (language === 'go') return 'go test ./...';
  if (language === 'rust') return 'cargo test';
  if (language === 'java') return 'mvn test';
  if (language === 'csharp') return 'dotnet test';
  if (language === 'cpp') return 'ctest';
  return '未探测到测试命令，请手动补一条';
}

async function detectLint(cwd, files) {
  const found = [];
  const checks = [
    ['eslint', ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json', '.eslintrc.js']],
    ['prettier', ['.prettierrc', '.prettierrc.json', 'prettier.config.js']],
    ['tsconfig', ['tsconfig.json']],
    ['ruff', ['ruff.toml', '.ruff.toml']],
    ['golangci', ['.golangci.yml', '.golangci.yaml']],
  ];
  for (const [name, markers] of checks) {
    if (markers.some((marker) => files.includes(marker))) found.push(name);
  }
  return found;
}

async function readReadme(cwd, files) {
  const name = files.find((file) => /^readme(\.md|\.txt)?$/i.test(file));
  if (!name) return null;
  const text = await readText(join(cwd, name), 6000);
  if (text === null) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => line.startsWith('#')) ?? '';
  const paragraph = [];
  let started = false;
  for (const line of lines) {
    if (line === '' || line.startsWith('#') || line.startsWith('![') || line.startsWith('```')) {
      if (started && paragraph.length > 0) break;
      continue;
    }
    started = true;
    paragraph.push(line);
    if (paragraph.length === 3) break;
  }
  return { name, heading: heading.replace(/^#+\s*/, ''), paragraph };
}

async function readSamples(cwd, topLevel) {
  const candidates = [];
  const dirsToScan = ['src', ...topLevel.dirs.filter((dir) => dir !== 'src')].slice(0, 4);
  for (const dir of dirsToScan) {
    await collectSources(join(cwd, dir), dir, candidates, 0);
  }
  for (const file of topLevel.files) {
    if (SOURCE_EXTENSIONS.has(extname(file))) candidates.push(file);
  }
  const picked = candidates.slice(0, SAMPLE_LIMIT);
  const samples = [];
  for (const path of picked) {
    const text = await readText(join(cwd, path), 20000);
    if (text === null) continue;
    const lines = text.split(/\r?\n/).slice(0, SAMPLE_LINES);
    samples.push({ path, lines, size: text.length });
  }
  return samples;
}

async function collectSources(directory, prefix, out, depth) {
  if (depth > 1 || out.length >= SAMPLE_LIMIT * 3) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectSources(join(directory, entry.name), relative, out, depth + 1);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry.name))) out.push(relative);
  }
}

function detectNaming(samples, language) {
  const counts = { camelCase: 0, snake_case: 0, PascalCase: 0 };
  for (const sample of samples) {
    for (const line of sample.lines) {
      for (const match of line.matchAll(/\b(?:const|let|var|function|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        countStyle(match[1], counts);
      }
      for (const match of line.matchAll(/^\s*(?:public|private|protected)?\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        countStyle(match[1], counts);
      }
    }
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [style, hits] = ranked[0];
  if (hits === 0) {
    return { style: language === 'python' ? 'snake_case' : 'camelCase', evidence: 0 };
  }
  return { style, evidence: hits };
}

function countStyle(name, counts) {
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) counts.PascalCase += 1;
  else if (/^[a-z][A-Za-z0-9]*$/.test(name)) counts.camelCase += 1;
  else if (/^[a-z][a-z0-9_]*$/.test(name)) counts.snake_case += 1;
}

async function readText(path, limit) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > limit) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(path) {
  const text = await readText(path, 200000);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extname(name) {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}
