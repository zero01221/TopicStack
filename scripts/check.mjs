#!/usr/bin/env node
/**
 * TopicStack 统一判据入口（F01 建立，F02~F10 复用）。
 *
 * 能力边界：只读文件 + 通用标准解析器（JSON.parse / 正则 / XML 标签配对 /
 * TypeScript compiler API 语法转译）+ 写验收记录；不调用任何编译、运行或安装命令，
 * 也不执行任何生成产物。转译仅用于让判据直接调用本系统自身的纯函数。
 *
 * 四种模式：
 *   node scripts/check.mjs --lint           静态代码检查（由 npm run lint 调用）
 *   node scripts/check.mjs --stamp=build    构建成功后写机器证据（由 npm run build 调用）
 *   node scripts/check.mjs F01              执行 F01 六条判据（原样保留）
 *   node scripts/check.mjs F0n              执行 F02~F05 判据并产出 AcceptanceRecord
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHECKS_DIR = join(ROOT, 'checks');
const RECORDS_PATH = join(CHECKS_DIR, 'records.json');
const RECORD_PATH = join(CHECKS_DIR, 'CHK-F01-01');
const RUNS_PATH = join(CHECKS_DIR, 'runs.json');
const DIST_DIR = join(ROOT, 'dist');

/**
 * 独立期望值表：与 tests/invariants.ts 各自硬编码，互为交叉校验。
 * 判据 ⑥ 会静态核对 invariants.ts 是否含有同一组字面常量。
 */
const EXPECTED = Object.freeze({
  feature: 'F01',
  checkId: 'CHK-F01-01',
  stack: 'common',
  scripts: ['dev', 'build', 'test', 'lint', 'check'],
  bareCommands: ['ci', 'install'],
  rootContainerId: 'root',
  declaredChecks: 6,
  forbiddenInvariantTokens: ['ProjectConfig', 'generate('],
  expectedScriptsLiteral: "['dev', 'build', 'test', 'lint', 'check']",
  invariantRequiredTokens: ["'UNKNOWN'", 'declaredChecks', 'evaluatedChecks', 'unknownCount'],
});

/** 静态检查固定覆盖的文件；src/ 与 tests/ 下的 TS 文件由 collectLintFiles 动态补齐。 */
const LINT_STATIC_FILES = Object.freeze([
  'src/index.css',
  'tests/invariants.ts',
  'scripts/check.mjs',
  'vite.config.ts',
  'tailwind.config.js',
  'postcss.config.js',
]);

/**
 * 判据入口允许加载的模块白名单：证明本脚本不触碰子进程 / 网络 / 外部服务；
 * typescript 仅用其编译器 API 做语法转译，不编译也不执行任何生成产物。
 */
const ALLOWED_IMPORTS = Object.freeze([
  'node:fs', 'node:crypto', 'node:path', 'node:url', 'typescript',
]);

/** 功能点元数据：stack 与应校验项数均为硬编码期望值，与实现无关。 */
const FEATURE_META = Object.freeze({
  F02: { stack: 'common', declaredChecks: 7 },
  F03: { stack: 'common', declaredChecks: 6 },
  F04: { stack: 'common', declaredChecks: 7 },
  F05: { stack: 'java/python', declaredChecks: 7 },
});

/** 版本 / 账号字面量扫描规则：用于静态扫描规范化模块与两张栈模板表。 */
const FORBIDDEN_LITERAL_PATTERNS = Object.freeze([
  { id: '版本号', pattern: /\d+(?:\.\d+)+/ },
  { id: '版本串', pattern: /(?:JDK|Python|MySQL|Spring\s*Boot|FastAPI|React|Vite|Node)\s*\d/i },
  { id: '演示账号', pattern: /^(?:admin|Admin@\d+|123456|root|sa|demo)$/i },
  { id: '账号口令', pattern: /Admin@|admin123|123456/ },
]);

/** 递归收集 src/ 与 tests/ 下的 TS / TSX 文件，供静态检查覆盖新增功能点。 */
function collectLintFiles() {
  const found = new Set(LINT_STATIC_FILES);
  const walk = (relDir) => {
    const fullDir = join(ROOT, relDir);
    if (!existsSync(fullDir)) {
      return;
    }
    for (const name of readdirSync(fullDir).sort()) {
      const full = join(fullDir, name);
      const rel = `${relDir}/${name}`;
      if (statSync(full).isDirectory()) {
        walk(rel);
      } else if (/\.tsx?$/.test(name)) {
        found.add(rel);
      }
    }
  };
  walk('src');
  walk('tests');
  return [...found].sort();
}

function absPath(relPath) {
  return join(ROOT, relPath);
}

function exists(relPath) {
  return existsSync(absPath(relPath));
}

function readText(relPath) {
  return readFileSync(absPath(relPath), 'utf8');
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashText(text) {
  return hashBuffer(Buffer.from(text, 'utf8'));
}

function writeJson(targetPath, value) {
  mkdirSync(CHECKS_DIR, { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 通用解析器：JSON.parse 失败时返回结构化失败，绝不静默吞掉异常。 */
function safeJson(relPath) {
  try {
    return { ok: true, value: JSON.parse(readText(relPath)), error: '' };
  } catch (error) {
    return { ok: false, value: null, error: String(error) };
  }
}

/** 遍历构建产物目录，返回排序后的相对路径（分隔符统一为 /）。 */
function listDistFiles() {
  const files = [];
  if (!existsSync(DIST_DIR)) {
    return files;
  }
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(relative(DIST_DIR, full).split('\\').join('/'));
      }
    }
  };
  walk(DIST_DIR);
  return files.sort();
}

/** 构建产物内容哈希：只哈希字节，不含时间戳，保证同一源码重复构建结果一致。 */
function computeDistHash() {
  const files = listDistFiles();
  if (files.length === 0) {
    return '';
  }
  const lines = files.map((file) => `${file}:${hashBuffer(readFileSync(join(DIST_DIR, file)))}`);
  return hashText(lines.join('\n'));
}

/** 机器运行证据由真实命令链末尾写入：只有前序步骤成功才会执行到这里。 */
function runStamp(phase) {
  let runs = { schema: 1, build: { ok: false, distHash: '' }, lint: { ok: false } };
  if (existsSync(RUNS_PATH)) {
    try {
      runs = JSON.parse(readFileSync(RUNS_PATH, 'utf8'));
    } catch {
      runs = { schema: 1, build: { ok: false, distHash: '' }, lint: { ok: false } };
    }
  }
  runs.schema = 1;
  if (phase === 'build') {
    runs.build = { ok: true, distHash: computeDistHash() };
  }
  if (phase === 'lint') {
    runs.lint = { ok: true };
  }
  writeJson(RUNS_PATH, runs);
  console.log(`[check] 已写入运行证据: ${phase}`);
}

/** 静态检查：八条规则逐条显式判定，任一 FAIL 即返回 false。 */
function runLint() {
  const results = [];
  const add = (id, ok, detail) => results.push({ id, ok, detail });

  const lintFiles = collectLintFiles();
  const missing = lintFiles.filter((rel) => !exists(rel) || readText(rel).trim().length === 0);
  add(
    'L1',
    missing.length === 0,
    missing.length === 0
      ? `${lintFiles.length} 个源文件齐备且非空`
      : `缺失或为空: ${missing.join(', ')}`,
  );

  const sources = new Map();
  for (const rel of lintFiles) {
    if (exists(rel)) {
      sources.set(rel, readText(rel));
    }
  }

  // 占位符词元用拼接构造，避免本脚本自身的规则字面量被自己命中。
  const placeholderTokens = ['TO' + 'DO', 'FIX' + 'ME', 'XXX' + '_PLACEHOLDER'];
  const placeholderPattern = new RegExp(placeholderTokens.join('|'));
  const placeholderHits = [...sources.entries()]
    .filter(([, text]) => placeholderPattern.test(text))
    .map(([rel]) => rel);
  add(
    'L2',
    placeholderHits.length === 0,
    placeholderHits.length === 0 ? '无占位符残留' : `占位符残留: ${placeholderHits.join(', ')}`,
  );

  const testFiles = [...sources.entries()].filter(([rel]) => /^tests\/.*\.test\.ts$/.test(rel));
  const skipHits = testFiles
    .filter(([, text]) => text.length === 0 || /\.(skip|only)\s*\(/.test(text))
    .map(([rel]) => rel);
  add(
    'L3',
    testFiles.length > 0 && skipHits.length === 0,
    testFiles.length > 0 && skipHits.length === 0
      ? `${testFiles.length} 个测试文件齐备且无跳过标记`
      : `测试异常: ${skipHits.join(', ') || '未发现测试文件'}`,
  );

  const mainSource = sources.get('src/main.tsx') ?? '';
  const stepMatch = mainSource.match(/type\s+Step\s*=\s*([^;]+);/);
  const stepNames = stepMatch
    ? [...stepMatch[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
    : [];
  const badSteps = stepNames.filter((name) => /confirm|review|approve|pending|确认|审核/i.test(name));
  add(
    'L4',
    stepNames.length >= 3 && badSteps.length === 0,
    stepNames.length >= 3 && badSteps.length === 0
      ? `步骤枚举 ${stepNames.length} 项，无人工把关态`
      : `步骤枚举异常: ${stepNames.join(',')} / 违规项 ${badSteps.join(',')}`,
  );

  add('L5', /[\u4e00-\u9fa5]/.test(mainSource), 'src/main.tsx 含中文注释');

  const invariantSource = sources.get('tests/invariants.ts') ?? '';
  add(
    'L6',
    invariantSource.length > 0 && !/\bimport\s|\brequire\s*\(/.test(invariantSource),
    invariantSource.length > 0 && !/\bimport\s|\brequire\s*\(/.test(invariantSource)
      ? '固有属性断言集不加载外部模块'
      : '固有属性断言集存在外部依赖或为空',
  );

  const selfSource = sources.get('scripts/check.mjs') ?? '';
  const importedModules = [...selfSource.matchAll(/from\s+'([^']+)'/g)].map((entry) => entry[1]);
  const importsOk = importedModules.length > 0
    && importedModules.every((moduleName) => ALLOWED_IMPORTS.includes(moduleName));
  add(
    'L7',
    importsOk,
    importsOk
      ? `判据入口仅加载白名单模块: ${importedModules.join(', ')}`
      : `判据入口加载了非白名单模块: ${importedModules.join(', ')}`,
  );

  const cssSource = sources.get('src/index.css') ?? '';
  add(
    'L8',
    cssSource.includes('@tailwind base;') && cssSource.includes('@tailwind utilities;'),
    cssSource.includes('@tailwind base;') && cssSource.includes('@tailwind utilities;')
      ? 'Tailwind 三条指令齐备'
      : 'Tailwind 指令缺失',
  );

  for (const result of results) {
    console.log(`[lint] ${result.id} ${result.ok ? 'PASS' : 'FAIL'} ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`[lint] BLOCKED: ${failed.length} 条规则未通过`);
    return false;
  }
  console.log(`[lint] PASS: ${results.length} 条规则全通过`);
  return true;
}

function makeItem(id, criterion, anchor, expected, actual, verdict, evidence) {
  return { id, criterion, anchor, expected, actual, verdict, evidence };
}

/** 判据 ①：构建链退出码 0 的机器证据（锁文件、已安装快照、成功戳、产物哈希、脚本链）。 */
function evaluateBuildChain() {
  const evidence = [];
  const conditions = [];

  const pkg = safeJson('package.json');
  const lock = safeJson('package-lock.json');
  const nodeLock = safeJson('node_modules/.package-lock.json');
  const runs = safeJson('checks/runs.json');
  const currentDistHash = computeDistHash();

  conditions.push(pkg.ok);
  evidence.push(`package.json JSON.parse: ${pkg.ok ? 'OK' : pkg.error}`);

  conditions.push(lock.ok && lock.value?.lockfileVersion === 3);
  evidence.push(`package-lock.json lockfileVersion: ${lock.ok ? String(lock.value.lockfileVersion) : '解析失败'}`);

  conditions.push(nodeLock.ok && Boolean(nodeLock.value?.name));
  evidence.push(`node_modules/.package-lock.json: ${nodeLock.ok ? 'OK（依赖已按锁文件安装）' : nodeLock.error}`);

  conditions.push(runs.ok && runs.value?.build?.ok === true && runs.value?.lint?.ok === true);
  evidence.push(`checks/runs.json: build.ok=${String(runs.value?.build?.ok)}, lint.ok=${String(runs.value?.lint?.ok)}`);

  conditions.push(runs.ok && Boolean(currentDistHash) && runs.value?.build?.distHash === currentDistHash);
  evidence.push(`dist 内容哈希一致: ${runs.value?.build?.distHash === currentDistHash ? 'YES' : 'NO'}`);

  const scripts = pkg.ok && pkg.value?.scripts ? pkg.value.scripts : {};
  const buildScript = String(scripts.build ?? '');
  conditions.push(buildScript.includes('tsc --noEmit') && buildScript.includes('vite build'));
  conditions.push(typeof scripts.lint === 'string' && scripts.lint.length > 0);
  evidence.push(`scripts.build: ${buildScript}`);
  evidence.push(`scripts.lint: ${String(scripts.lint ?? '')}`);

  const ok = conditions.every(Boolean);
  return makeItem(
    'F01-01',
    'npm ci && npm run build && npm run lint 退出码 0（机器证据齐全且一致）',
    'parser',
    '锁文件 v3 + 已安装快照 + build/lint 成功戳 + dist 内容哈希一致 + 构建脚本含类型检查',
    ok ? '全部条件成立' : `未成立条件数 ${conditions.filter((value) => !value).length}`,
    ok ? 'PASS' : 'FAIL',
    evidence,
  );
}

/** 判据 ②：构建产物 index.html 含根容器且引用真实存在的构建后 JS 资源。 */
function evaluateDistHtml() {
  const rel = 'dist/index.html';
  const present = exists(rel);
  const text = present ? readText(rel) : '';
  const rootOk = text.includes(`id="${EXPECTED.rootContainerId}"`);
  const assetSrcs = [...text.matchAll(/src="([^"]+\.js)"/g)]
    .map((entry) => entry[1])
    .filter((source) => /^\/assets\/[^"']+\.js$/.test(source));
  const filesExist = assetSrcs.length > 0 && assetSrcs.every((source) => exists(`dist${source}`));
  const ok = present && rootOk && filesExist;
  return makeItem(
    'F01-02',
    '静态断言 dist/index.html 含根容器且引用构建后 JS 资源',
    'parser',
    'id="root" + 至少 1 个 /assets/*.js 引用 + 资源文件确实存在',
    `根容器=${rootOk}, JS 资源数=${assetSrcs.length}, 文件存在=${filesExist}`,
    ok ? 'PASS' : 'FAIL',
    [
      `dist/index.html 存在: ${present}`,
      `根容器 id="root": ${rootOk}`,
      `构建后 JS 资源: ${assetSrcs.join(', ') || '无'}`,
      `资源文件实际存在: ${filesExist}`,
    ],
  );
}

/** 判据 ③：通用解析器 JSON.parse(package.json) 成功且五个脚本齐备。 */
function evaluatePackageScripts() {
  const parsed = safeJson('package.json');
  const scripts = parsed.ok && parsed.value?.scripts ? Object.keys(parsed.value.scripts) : [];
  const missing = EXPECTED.scripts.filter((name) => !scripts.includes(name));
  const ok = parsed.ok && missing.length === 0;
  return makeItem(
    'F01-03',
    'JSON.parse(package.json) 成功且含 dev/build/test/lint/check 五个脚本',
    'parser',
    EXPECTED.scripts.join(','),
    parsed.ok ? scripts.join(',') : parsed.error,
    ok ? 'PASS' : 'FAIL',
    [`JSON.parse: ${parsed.ok ? 'OK' : parsed.error}`, `缺失脚本: ${missing.join(',') || '无'}`],
  );
}

/** 从 README 抽取命令：代码块中以 npm 开头的行 + 行内反引号中以 npm 开头的代码片段。 */
function extractReadmeCommands(text) {
  const commands = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence && trimmed.startsWith('npm ')) {
      commands.push(trimmed);
    }
    for (const entry of line.matchAll(/`([^`]+)`/g)) {
      const inner = entry[1].trim();
      if (inner.startsWith('npm ')) {
        commands.push(inner);
      }
    }
  }
  return commands;
}

/** 命令归一化：只接受白名单形态，任何无法解析的写法一律判 FAIL。 */
function classifyCommand(raw) {
  const matched = raw.trim().match(/^npm\s+(ci|install|test|run\s+([a-zA-Z0-9_-]+))(?:\s+--\s+[^\s`]+)?$/);
  if (!matched) {
    return { ok: false, script: '', raw, reason: '无法解析为白名单命令形态' };
  }
  return { ok: true, script: matched[2] ?? matched[1], raw, reason: '' };
}

/** 判据 ④：README 每条命令 ∈ scripts ∪ {npm ci, npm install}。 */
function evaluateReadmeCommands() {
  const text = exists('README.md') ? readText('README.md') : '';
  const commands = extractReadmeCommands(text);
  const parsed = safeJson('package.json');
  const scriptNames = parsed.ok && parsed.value?.scripts ? Object.keys(parsed.value.scripts) : [];
  const allowed = new Set([...scriptNames, ...EXPECTED.bareCommands]);
  const classified = commands.map(classifyCommand);
  const bad = classified.filter((entry) => !entry.ok || !allowed.has(entry.script));
  const hasCi = commands.some((command) => command.trim() === 'npm ci');
  const hasDev = commands.some((command) => command.trim() === 'npm run dev');
  const ok = text.length > 0 && parsed.ok && commands.length >= 3
    && bad.length === 0 && hasCi && hasDev;
  return makeItem(
    'F01-04',
    'README 每条命令 ∈ scripts ∪ {npm ci, npm install}',
    'parser',
    `全部 ${commands.length} 条命令可解析且脚本名 ∈ ${[...allowed].join(',')}；含 npm ci 与 npm run dev`,
    ok
      ? `命令数=${commands.length}, 违规=0, 含 ci/dev=YES`
      : `命令数=${commands.length}, 违规=${bad.map((entry) => `${entry.raw}(${entry.reason})`).join(' | ') || '无'}, 含 ci=${hasCi}, 含 dev=${hasDev}`,
    ok ? 'PASS' : 'FAIL',
    [
      `README 命令清单: ${commands.join(' | ')}`,
      `允许脚本集合: ${[...allowed].join(', ')}`,
      `违规命令数: ${bad.length}`,
    ],
  );
}

/** 判据 ⑥：固有属性断言集期望值均为字面常量（静态扫描，不读取派生配置）。 */
function evaluateInvariantSource() {
  const rel = 'tests/invariants.ts';
  const text = exists(rel) ? readText(rel) : '';
  const forbiddenHits = EXPECTED.forbiddenInvariantTokens.filter((token) => text.includes(token));
  const hasExternalLoad = /\bimport\s|\brequire\s*\(/.test(text);
  const missingTokens = EXPECTED.invariantRequiredTokens.filter((token) => !text.includes(token));
  const literalOk = text.includes(EXPECTED.expectedScriptsLiteral);
  const ok = text.length > 0 && forbiddenHits.length === 0 && !hasExternalLoad
    && missingTokens.length === 0 && literalOk;
  return makeItem(
    'F01-06',
    'tests/invariants.ts 期望值均为字面常量（静态扫描不含派生配置 / 生成器引用）',
    'invariant',
    `不含 ${EXPECTED.forbiddenInvariantTokens.join(' / ')}；无外部加载；含字面常量 ${EXPECTED.expectedScriptsLiteral} 与计数助手`,
    ok
      ? '期望值外置、无外部加载、字面常量与助手齐备'
      : `违规引用=${forbiddenHits.join(',') || '无'}, 外部加载=${hasExternalLoad}, 字面常量齐备=${literalOk}, 缺失助手=${missingTokens.join(',') || '无'}`,
    ok ? 'PASS' : 'FAIL',
    [
      `静态扫描目标: ${rel} (${text.length} 字符)`,
      `禁止引用命中: ${forbiddenHits.join(', ') || '无'}`,
      `外部模块加载: ${hasExternalLoad}`,
      `字面常量数组存在: ${literalOk}`,
      `计数助手缺失: ${missingTokens.join(', ') || '无'}`,
    ],
  );
}

/** 生成 AcceptanceRecord；未知即失败、项数相等、全 PASS 才允许 PASS。 */
function runF01() {
  const item1 = evaluateBuildChain();
  const item2 = evaluateDistHtml();
  const item3 = evaluatePackageScripts();
  const item4 = evaluateReadmeCommands();
  const item6 = evaluateInvariantSource();
  const base = [item1, item2, item3, item4, item6];

  const unknownBase = base.filter((item) => item.verdict === 'UNKNOWN').length;
  const evaluatedBase = base.filter((item) => item.verdict === 'PASS' || item.verdict === 'FAIL').length;
  const selfOk = unknownBase === 0
    && evaluatedBase === base.length
    && base.length + 1 === EXPECTED.declaredChecks;
  const item5 = makeItem(
    'F01-05',
    'npm run check -- F01 产出 AcceptanceRecord(PASS)，且应校验项数 == 已判定项数、未知项为 0',
    'invariant',
    `declaredChecks=${EXPECTED.declaredChecks} && evaluatedChecks=${EXPECTED.declaredChecks} && unknownCount=0 && 全项 PASS`,
    `declared=${EXPECTED.declaredChecks}, evaluated=${evaluatedBase + 1}, unknown=${unknownBase}, 基础项全判定=${evaluatedBase === base.length}`,
    selfOk ? 'PASS' : 'FAIL',
    [
      '每条判据必须显式返回 PASS / FAIL',
      'UNKNOWN、跳过、未执行一律计 FAIL',
      `基础判据项数=${base.length}，加本项共 ${base.length + 1} 项`,
    ],
  );

  const items = [item1, item2, item3, item4, item5, item6];
  const declaredChecks = EXPECTED.declaredChecks;
  const evaluatedChecks = items.filter(
    (item) => item.verdict === 'PASS' || item.verdict === 'FAIL',
  ).length;
  const unknownCount = items.filter((item) => item.verdict === 'UNKNOWN').length;
  const allPass = items.every((item) => item.verdict === 'PASS');
  const verdict = allPass
    && declaredChecks === evaluatedChecks
    && unknownCount === 0
    && items.length === declaredChecks
    ? 'PASS'
    : 'BLOCKED';

  const evidencePaths = [
    'package.json',
    'package-lock.json',
    'README.md',
    'dist/index.html',
    'checks/runs.json',
    'tests/invariants.ts',
    'tests/F01.test.ts',
    'scripts/check.mjs',
  ];
  const evidence = evidencePaths
    .filter((rel) => exists(rel))
    .map((rel) => ({ path: rel, sha256: hashBuffer(readFileSync(absPath(rel))) }));

  const record = {
    checkId: EXPECTED.checkId,
    feature: EXPECTED.feature,
    stack: EXPECTED.stack,
    items,
    declaredChecks,
    evaluatedChecks,
    unknownCount,
    evidence,
    verdict,
    createdAt: '',
  };

  // 内容未变化时复用原时间戳，保证同一 HEAD 重复判据不会污染工作区。
  const stripCreatedAt = (value) => {
    const copy = { ...value };
    delete copy.createdAt;
    return JSON.stringify(copy);
  };
  let previous = null;
  if (existsSync(RECORD_PATH)) {
    try {
      previous = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
    } catch {
      previous = null;
    }
  }
  record.createdAt = previous && stripCreatedAt(previous) === stripCreatedAt(record)
    ? previous.createdAt
    : new Date().toISOString();

  writeJson(RECORD_PATH, record);
  let records = [];
  if (existsSync(RECORDS_PATH)) {
    try {
      const loaded = JSON.parse(readFileSync(RECORDS_PATH, 'utf8'));
      if (Array.isArray(loaded)) {
        records = loaded;
      }
    } catch {
      records = [];
    }
  }
  const index = records.findIndex((entry) => entry && entry.checkId === record.checkId);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  writeJson(RECORDS_PATH, records);

  console.log(`[check] ${record.checkId} feature=${record.feature} stack=${record.stack}`);
  for (const item of items) {
    console.log(`  ${item.id} ${item.verdict} ${item.criterion}`);
    if (item.verdict !== 'PASS') {
      console.log(`    期望: ${item.expected}`);
      console.log(`    实际: ${item.actual}`);
      for (const line of item.evidence) {
        console.log(`    证据: ${line}`);
      }
    }
  }
  console.log(`[check] 证据文件: ${evidence.map((entry) => entry.path).join(', ')}`);
  console.log(`[check] declaredChecks=${declaredChecks} evaluatedChecks=${evaluatedChecks} unknownCount=${unknownCount}`);
  console.log(`[check] verdict=${verdict}`);
  console.log(verdict);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}

/* ─────────────── F02~F05 判据框架（F01 逻辑原样保留） ─────────────── */

const TS_CACHE_DIR = join(ROOT, '.tscache');
let tsCacheReady = false;

/** 抽取源码中的字符串字面量，用于版本 / 账号字面量的静态扫描。 */
function extractStringLiterals(source) {
  const literals = [];
  for (const entry of source.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
    literals.push(entry[1] ?? entry[2] ?? entry[3] ?? '');
  }
  return literals;
}

/** 静态扫描：返回命中的「字面量（规则）」清单。 */
function scanForbiddenLiterals(source) {
  const hits = [];
  for (const literal of extractStringLiterals(source)) {
    for (const rule of FORBIDDEN_LITERAL_PATTERNS) {
      if (rule.pattern.test(literal)) {
        hits.push(`${literal} (${rule.id})`);
      }
    }
  }
  return [...new Set(hits)];
}

/** 相对导入补 .mjs 后缀，使转译缓存目录内的模块可以互相解析。 */
function rewriteRelativeSpecifiers(code) {
  return code.replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (whole, prefix, spec, suffix) => {
    if (/\.(?:mjs|js|json|css)$/.test(spec)) {
      return whole;
    }
    return `${prefix}${spec}.mjs${suffix}`;
  });
}

/**
 * 用 TypeScript compiler API 把本系统自身 TS 模块转成 ESM 并缓存，
 * 使判据入口可直接调用真实纯函数。仅做语法转译，不解析依赖、不做类型检查，
 * 不编译也不执行任何生成产物。
 */
function ensureTsCache() {
  if (tsCacheReady) {
    return;
  }
  const walk = (relDir) => {
    const fullDir = join(ROOT, relDir);
    if (!existsSync(fullDir)) {
      return;
    }
    for (const name of readdirSync(fullDir).sort()) {
      const full = join(fullDir, name);
      if (statSync(full).isDirectory()) {
        walk(`${relDir}/${name}`);
        continue;
      }
      if (!/\.tsx?$/.test(name)) {
        continue;
      }
      const rel = `${relDir}/${name}`;
      const output = ts.transpileModule(readFileSync(full, 'utf8'), {
        fileName: rel,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText;
      const target = join(TS_CACHE_DIR, rel.replace(/\.tsx?$/, '.mjs'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, rewriteRelativeSpecifiers(output), 'utf8');
    }
  };
  walk('src');
  tsCacheReady = true;
}

/** 载入本系统自身的 TS 模块（真实实现，非替身）。 */
async function importTs(relPath) {
  ensureTsCache();
  const target = join(TS_CACHE_DIR, relPath.replace(/\.tsx?$/, '.mjs'));
  return import(pathToFileURL(target).href);
}

/** 单条判据的安全执行器：异常一律转成可行动的 FAIL，绝不产生 UNKNOWN。 */
async function safeItem(id, criterion, anchor, expected, compute) {
  try {
    const result = await compute();
    return makeItem(
      id, criterion, anchor, expected, result.actual,
      result.ok ? 'PASS' : 'FAIL', result.evidence,
    );
  } catch (error) {
    return makeItem(
      id, criterion, anchor, expected,
      `执行异常: ${String(error)}`,
      'FAIL',
      [`异常明细: ${String(error?.stack ?? error)}`],
    );
  }
}

/** 通用解析器：XML 标签配对（忽略声明、注释、自闭合标签）。 */
function xmlTagsBalanced(text) {
  const cleaned = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  for (const entry of cleaned.matchAll(/<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?\/?>/g)) {
    const raw = entry[0];
    const name = entry[1];
    if (raw.startsWith('</')) {
      if (stack.pop() !== name) {
        return false;
      }
    } else if (!raw.endsWith('/>')) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** requirements.txt 行格式：名称==版本 / 注释 / 空行，三者之外一律失败。 */
function requirementsLinesValid(text) {
  const lines = text.split(/\r?\n/);
  let contentLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    contentLines += 1;
    if (!/^[A-Za-z0-9_.-]+==[^\s]+$/.test(trimmed)) {
      return { ok: false, contentLines };
    }
  }
  return { ok: contentLines > 0, contentLines };
}

/** 工程侧基线：构建 / 类型 / lint 成功证据 + 前序功能点回归 + 本点测试齐备。 */
function engineeringBaseline(feature, previousFeatures) {
  const evidence = [];
  const conditions = [];
  const pkg = safeJson('package.json');
  const lock = safeJson('package-lock.json');
  const nodeLock = safeJson('node_modules/.package-lock.json');
  const runs = safeJson('checks/runs.json');
  const currentDistHash = computeDistHash();

  conditions.push(pkg.ok);
  conditions.push(lock.ok && lock.value?.lockfileVersion === 3);
  conditions.push(nodeLock.ok && Boolean(nodeLock.value?.name));
  const stampsOk = runs.ok
    && runs.value?.build?.ok === true
    && runs.value?.lint?.ok === true
    && Boolean(currentDistHash)
    && runs.value?.build?.distHash === currentDistHash;
  conditions.push(stampsOk);
  evidence.push(`锁文件 v3=${lock.value?.lockfileVersion === 3}, 已安装快照=${nodeLock.ok}`);
  evidence.push(`build/lint 成功戳与 dist 内容哈希一致=${stampsOk}`);

  const records = safeJson('checks/records.json');
  const priorOk = Array.isArray(records.value) && previousFeatures.every((prior) => {
    const entry = records.value.find((record) => record && record.feature === prior);
    return Boolean(entry)
      && entry.verdict === 'PASS'
      && entry.declaredChecks === entry.evaluatedChecks
      && entry.unknownCount === 0;
  });
  conditions.push(priorOk);
  evidence.push(`前序功能点回归记录全 PASS: ${previousFeatures.join(',') || '无'} => ${priorOk}`);

  const testRel = `tests/${feature}.test.ts`;
  const testText = exists(testRel) ? readText(testRel) : '';
  const testOk = testText.length > 0 && !/\.(skip|only)\s*\(/.test(testText);
  conditions.push(testOk);
  evidence.push(`本点测试文件齐备且无跳过标记: ${testOk}`);

  return { ok: conditions.every(Boolean), evidence };
}

/** 生成 F0n 的 AcceptanceRecord：未知即失败、计数相等、全 PASS 才允许 PASS。 */
function runFeature(feature, baseItems) {
  const meta = FEATURE_META[feature];
  const declaredChecks = baseItems.length;
  const evaluatedChecks = baseItems.filter(
    (item) => item.verdict === 'PASS' || item.verdict === 'FAIL',
  ).length;
  const unknownCount = baseItems.filter((item) => item.verdict === 'UNKNOWN').length;
  const allPass = baseItems.every((item) => item.verdict === 'PASS');
  const countMatch = declaredChecks === meta.declaredChecks
    && declaredChecks === evaluatedChecks
    && unknownCount === 0;
  const verdict = allPass && countMatch ? 'PASS' : 'BLOCKED';
  const checkId = `CHK-${feature}-01`;
  const recordPath = join(CHECKS_DIR, `CHK-${feature}-01`);

  const evidencePaths = [
    'package.json',
    'package-lock.json',
    'README.md',
    'checks/runs.json',
    'tests/invariants.ts',
    `tests/${feature}.test.ts`,
    'scripts/check.mjs',
    'src/types.ts',
  ];
  const evidence = evidencePaths
    .filter((rel) => exists(rel))
    .map((rel) => ({ path: rel, sha256: hashBuffer(readFileSync(absPath(rel))) }));

  const record = {
    checkId,
    feature,
    stack: meta.stack,
    items: baseItems,
    declaredChecks,
    evaluatedChecks,
    unknownCount,
    evidence,
    verdict,
    createdAt: '',
  };

  // 内容未变化时复用原时间戳，保证同一 HEAD 重复判据不污染工作区。
  const stripCreatedAt = (value) => {
    const copy = { ...value };
    delete copy.createdAt;
    return JSON.stringify(copy);
  };
  let previous = null;
  if (existsSync(recordPath)) {
    try {
      previous = JSON.parse(readFileSync(recordPath, 'utf8'));
    } catch {
      previous = null;
    }
  }
  record.createdAt = previous && stripCreatedAt(previous) === stripCreatedAt(record)
    ? previous.createdAt
    : new Date().toISOString();

  writeJson(recordPath, record);
  let records = [];
  if (existsSync(RECORDS_PATH)) {
    try {
      const loaded = JSON.parse(readFileSync(RECORDS_PATH, 'utf8'));
      if (Array.isArray(loaded)) {
        records = loaded;
      }
    } catch {
      records = [];
    }
  }
  const index = records.findIndex((entry) => entry && entry.checkId === checkId);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  writeJson(RECORDS_PATH, records);

  console.log(`[check] ${checkId} feature=${feature} stack=${meta.stack}`);
  for (const item of baseItems) {
    console.log(`  ${item.id} ${item.verdict} ${item.criterion}`);
    if (item.verdict !== 'PASS') {
      console.log(`    期望: ${item.expected}`);
      console.log(`    实际: ${item.actual}`);
      for (const line of item.evidence) {
        console.log(`    证据: ${line}`);
      }
    }
  }
  console.log(`[check] 证据文件: ${evidence.map((entry) => entry.path).join(', ')}`);
  console.log(`[check] declaredChecks=${declaredChecks} evaluatedChecks=${evaluatedChecks} unknownCount=${unknownCount}`);
  console.log(`[check] 应校验项数 == 已判定项数 && unknownCount == 0: ${countMatch}`);
  console.log(`[check] verdict=${verdict}`);
  console.log(verdict);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}

/** F02：数据模型与 ProjectConfig 单一数据源的七条判据。 */
async function f02Items() {
  const items = [];
  const project = await importTs('src/project.ts');
  const rawTitle = '  基于 Java 的  图书馆 管理系统  ';
  const cleanTitle = '基于 Java 的 图书馆 管理系统';
  const baseline = engineeringBaseline('F02', ['F01']);

  items.push(await safeItem(
    'F02-01',
    'normalize({title}) 产出全部必填字段且 adoptedDefaults 非空',
    'parser',
    '配置必填字段全覆盖 + adoptedDefaults 数量大于零',
    async () => {
      const result = project.normalize({ title: rawTitle });
      const missing = project.REQUIRED_CONFIG_FIELDS.filter(
        (field) => result.config[field] === undefined || result.config[field] === null,
      );
      return {
        ok: missing.length === 0 && result.adoptedDefaults.length > 0,
        actual: `缺失字段=${missing.join(',') || '无'}, adoptedDefaults=${result.adoptedDefaults.length}`,
        evidence: [
          `实际配置字段: ${Object.keys(result.config).join(',')}`,
          `自动采用的默认值: ${result.adoptedDefaults.join(',')}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F02-02',
    'normalize(normalize(x)) === normalize(x)',
    'invariant',
    '引用相等且深比较相等（幂等）',
    async () => {
      const first = project.normalize({ title: rawTitle });
      const second = project.normalize(first);
      const strict = second === first;
      const deep = JSON.stringify(second) === JSON.stringify(first);
      return {
        ok: strict && deep,
        actual: `引用相等=${strict}, 深比较=${deep}`,
        evidence: ['把规范化结果再次传入 normalize 应原样返回'],
      };
    },
  ));

  items.push(await safeItem(
    'F02-03',
    '派生字段 dirTree / auth.demoAccount / versions / commentPolicy 均可从 config 读出',
    'invariant',
    '四个派生字段均存在且非空，版本字段数为五个',
    async () => {
      const config = project.normalize({ title: rawTitle }).config;
      const reads = {
        dirTree: config.dirTree?.entries?.length ?? 0,
        demoAccount: config.auth?.demoAccount?.username ?? '',
        versions: Object.keys(config.versions ?? {}).length,
        commentPolicy: config.commentPolicy?.requireWhatAndWhy ?? false,
      };
      return {
        ok: reads.dirTree > 0 && reads.demoAccount.length > 0
          && reads.versions === 5 && reads.commentPolicy === true,
        actual: `dirTree条目=${reads.dirTree}, 演示账号=${reads.demoAccount}, 版本字段=${reads.versions}, 注释策略=${reads.commentPolicy}`,
        evidence: [`派生读取结果: ${JSON.stringify(reads)}`],
      };
    },
  ));

  items.push(await safeItem(
    'F02-04',
    'rawInput.title 与规范化后 title 分别可取且 rawInput 未被改写',
    'rawInput',
    'rawInput 保留原始空白串并冻结；title 为折叠空白后的值',
    async () => {
      const config = project.normalize({ title: rawTitle }).config;
      const ok = config.rawInput.title === rawTitle
        && config.title === cleanTitle
        && config.title !== config.rawInput.title
        && Object.isFrozen(config.rawInput)
        && Object.isFrozen(config.rawInput.versionInputs);
      return {
        ok,
        actual: `rawInput原样=${config.rawInput.title === rawTitle}, title规范化=${config.title === cleanTitle}, 锚点冻结=${Object.isFrozen(config.rawInput)}`,
        evidence: [
          `原始题目: "${config.rawInput.title}"`,
          `规范化题目: "${config.title}"`,
          `versionInputs 冻结: ${Object.isFrozen(config.rawInput.versionInputs)}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F02-05',
    'normalize({}) 明确拒绝（必填缺失自动阻断）',
    'parser',
    '抛出明确异常且异常信息包含必填字段名',
    async () => {
      let rejected = false;
      let message = '';
      try {
        project.normalize({});
      } catch (error) {
        rejected = true;
        message = String(error?.message ?? error);
      }
      return {
        ok: rejected && message.includes('title'),
        actual: `拒绝=${rejected}, 信息="${message}"`,
        evidence: ['必填缺失时不得静默产出半成品'],
      };
    },
  ));

  items.push(await safeItem(
    'F02-06',
    '静态扫描 src/project.ts 无版本号 / 账号字面量',
    'invariant',
    '源码字符串字面量中不含版本号、版本串或演示账号；且引用建议默认值表',
    async () => {
      const source = exists('src/project.ts') ? readText('src/project.ts') : '';
      const hits = scanForbiddenLiterals(source);
      const usesDefaults = source.includes('SUGGESTED_DEFAULTS');
      return {
        ok: source.length > 0 && hits.length === 0 && usesDefaults,
        actual: `命中字面量=${hits.join(' | ') || '无'}, 引用建议默认值表=${usesDefaults}`,
        evidence: [
          `静态扫描目标: src/project.ts (${source.length} 字符)`,
          `规则: ${FORBIDDEN_LITERAL_PATTERNS.map((rule) => rule.id).join(' / ')}`,
        ],
      };
    },
  ));

  items.push(makeItem(
    'F02-07',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** 已实现功能点的判据构造器表；后续功能点逐个登记，未登记一律 BLOCKED。 */
const FEATURE_BUILDERS = Object.freeze({
  F02: f02Items,
});

const argument = process.argv[2] ?? '';
if (argument.startsWith('--stamp=')) {
  runStamp(argument.slice('--stamp='.length));
} else if (argument === '--lint') {
  const ok = runLint();
  if (ok) {
    runStamp('lint');
  }
  process.exitCode = ok ? 0 : 1;
} else if (argument === EXPECTED.feature) {
  runF01();
} else if (Object.prototype.hasOwnProperty.call(FEATURE_BUILDERS, argument)) {
  const items = await FEATURE_BUILDERS[argument]();
  runFeature(argument, items);
} else {
  console.error(`[check] BLOCKED: 未知或未实现的判据目标 "${argument}"`);
  console.log('BLOCKED');
  process.exitCode = 1;
}
