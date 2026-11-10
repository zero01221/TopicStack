#!/usr/bin/env node
/**
 * TopicStack 统一判据入口（F01 建立，F02~F10 复用）。
 *
 * 能力边界（静态能力面约束）：只读文件 + 通用标准解析器（JSON.parse / 正则 /
 * XML 标签配对 / TypeScript compiler API 语法转译）+ 写验收记录；
 * 不加载子进程 / 网络 / VM 模块、不出现执行调用、动态 import 参数静态可解析，
 * 不调用任何编译、运行或安装命令，也不执行任何生成产物。
 * 转译仅用于让判据直接调用本系统自身的纯函数。
 *
 * 四种模式：
 *   node scripts/check.mjs --lint           静态代码检查（由 npm run lint 调用）
 *   node scripts/check.mjs --stamp=build    构建成功后写机器证据（由 npm run build 调用）
 *   node scripts/check.mjs F01              执行 F01 六条判据（原样保留）
 *   node scripts/check.mjs F0n              执行 F02~F10 判据并产出 AcceptanceRecord
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import JSZip from 'jszip';

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
 * 静态能力面白名单：判据入口只加载下列模块，不触碰子进程 / 网络 / VM / 外部服务。
 * typescript 仅用其编译器 API 做语法转译；jszip 仅解包文本；
 * 最后一项是本地生成的转译注册表（由 ensureTsCache 写出，只含 .tscache 内静态相对导入）。
 * F07-06 会用 AST 逐条核对静态 import 与动态 import(...) 的模块名，并与
 * tests/capability.ts 的镜像清单比对防漂移。
 */
const ALLOWED_IMPORTS = Object.freeze([
  'node:fs', 'node:crypto', 'node:path', 'node:url', 'typescript', 'jszip',
  '../.tscache/registry.mjs',
]);

/** 功能点元数据：stack 与应校验项数均为硬编码期望值，与实现无关。 */
const FEATURE_META = Object.freeze({
  F02: { stack: 'common', declaredChecks: 7 },
  F03: { stack: 'common', declaredChecks: 6 },
  F04: { stack: 'common', declaredChecks: 7 },
  F05: { stack: 'java/python', declaredChecks: 7 },
  F06: { stack: 'common', declaredChecks: 6 },
  F07: { stack: 'java/python', declaredChecks: 7 },
  F08: { stack: 'java/python', declaredChecks: 10 },
  F09: { stack: 'common', declaredChecks: 6 },
  F10: { stack: 'common', declaredChecks: 6 },
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
  // 命令链开始时先撤销成功戳；只有命令真正跑完才会重新置为 true，
  // 这样构建 / 静态检查中途失败时不会被上一轮的旧证据误判为 PASS。
  if (phase === 'build-start') {
    runs.build = { ok: false, distHash: '' };
  }
  if (phase === 'lint-start') {
    runs.lint = { ok: false };
  }
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
async function runLint() {
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
  // AST 级 import 审计：覆盖静态 import 与动态 import(...)，后者的参数
  // 必须是静态字符串字面量且在白名单内（B-01 补强，替代原先的正则匹配）。
  const capability = await importTs('tests/capability.ts');
  const importAudit = capability.auditModuleImports(selfSource, ALLOWED_IMPORTS);
  const importsOk = importAudit.ok && importAudit.moduleNames.length > 0;
  add(
    'L7',
    importsOk,
    importsOk
      ? `AST 级 import 审计通过，白名单模块: ${importAudit.moduleNames.join(', ')}`
      : `AST 级 import 审计未通过: ${importAudit.violations.join(' | ') || '无模块名'}`,
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

/**
 * 判据实际会载入的 TS 模块清单。转译注册表只对它们做静态相对导入，
 * 避免把测试文件（依赖 vitest）或含 CSS 导入的入口文件卷进模块图。
 */
const TS_CACHE_MODULES = Object.freeze([
  'src/types.ts',
  'src/project.ts',
  'src/features.ts',
  'src/stacks/index.ts',
  'src/stacks/java.ts',
  'src/stacks/python.ts',
  'src/generate.ts',
  'src/history.ts',
  'src/zip.ts',
  'tests/invariants.ts',
  'tests/capability.ts',
]);

/**
 * 生成本地转译注册表：用静态字符串字面量导入所有缓存模块，
 * 使 check.mjs 自身的动态 import(...) 参数是静态可解析的字符串，
 * 不再出现「拼接模块名 / 标识符表达式」这类无法静态判定的形态。
 */
function writeTsRegistry() {
  const lines = [];
  TS_CACHE_MODULES.forEach((rel, index) => {
    lines.push(`import * as m${index} from './${rel.replace(/\.tsx?$/, '.mjs')}';`);
  });
  lines.push('const MODULES = {');
  TS_CACHE_MODULES.forEach((rel, index) => {
    lines.push(`  ${JSON.stringify(rel)}: m${index},`);
  });
  lines.push('};');
  lines.push('export function loadModule(relPath) {');
  lines.push('  const found = MODULES[relPath];');
  lines.push('  if (!found) { throw new Error(`[转译缓存] 未登记模块: ${relPath}`); }');
  lines.push('  return found;');
  lines.push('}');
  writeFileSync(join(TS_CACHE_DIR, 'registry.mjs'), `${lines.join('\n')}\n`, 'utf8');
}

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
  walk('tests');
  writeTsRegistry();
  tsCacheReady = true;
}

/** 载入本系统自身的 TS 模块（真实实现，非替身）。 */
async function importTs(relPath) {
  ensureTsCache();
  // 动态 import 的参数是静态字符串字面量，且位于 ALLOWED_IMPORTS 白名单内，
  // 因此可被 AST 级能力面审计完整判定；注册表本身只做本地静态相对导入。
  const registry = await import('../.tscache/registry.mjs');
  return registry.loadModule(relPath);
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
async function runFeature(feature, baseItems) {
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
  let verdict = allPass && countMatch ? 'PASS' : 'BLOCKED';
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

  // F10 通过后再做九项全量回归收口；收口不通过则把本次记录同步改成 BLOCKED。
  let finalProblems = [];
  if (feature === 'F10' && verdict === 'PASS') {
    const final = await writeFinalRegression();
    if (!final.ok) {
      finalProblems = final.problems;
      verdict = 'BLOCKED';
      record.verdict = 'BLOCKED';
      writeJson(recordPath, record);
      const refreshed = JSON.parse(readFileSync(RECORDS_PATH, 'utf8'));
      const position = refreshed.findIndex((entry) => entry && entry.checkId === checkId);
      if (position >= 0) {
        refreshed[position] = record;
        writeJson(RECORDS_PATH, refreshed);
      }
    }
  }

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
  for (const problem of finalProblems) {
    console.log(`    收口问题: ${problem}`);
  }
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

/** F03：配置输入层与 exception-based 默认通过的六条判据。 */
async function f03Items() {
  const items = [];
  const project = await importTs('src/project.ts');
  const types = await importTs('src/types.ts');
  const mainSource = exists('src/main.tsx') ? readText('src/main.tsx') : '';
  const uiSource = exists('src/ui.tsx') ? readText('src/ui.tsx') : '';
  const baseline = engineeringBaseline('F03', ['F01', 'F02']);
  const sampleTitle = '基于 Java 的图书馆管理系统';

  items.push(await safeItem(
    'F03-01',
    '最小必填集合仅 title 且题目无建议默认值',
    'invariant',
    "必填字段恰为 ['title']；建议默认值表不含题目；表单中仅一个必填控件",
    async () => {
      const fields = [...project.REQUIRED_INPUT_FIELDS];
      const hasTitleDefault = Object.prototype.hasOwnProperty.call(
        types.SUGGESTED_DEFAULTS, 'title',
      );
      const requiredCount = (uiSource.match(/\brequired\b/g) ?? []).length;
      return {
        ok: JSON.stringify(fields) === '["title"]' && !hasTitleDefault && requiredCount === 1,
        actual: `必填字段=${fields.join(',')}, 题目默认值=${hasTitleDefault}, 必填控件数=${requiredCount}`,
        evidence: [
          'REQUIRED_INPUT_FIELDS 来自 src/project.ts',
          '建议默认值表来自 src/types.ts',
          `src/ui.tsx 中 required 出现次数=${requiredCount}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F03-02',
    '仅给 {title} 即可解析出合法完整配置',
    'parser',
    '配置全部必填字段可读，题目、技术栈与演示账号均非空',
    async () => {
      const result = project.normalize({ title: sampleTitle });
      const missing = project.REQUIRED_CONFIG_FIELDS.filter(
        (field) => result.config[field] === undefined || result.config[field] === null,
      );
      return {
        ok: missing.length === 0
          && result.config.title.length > 0
          && result.config.stackId.length > 0
          && result.config.auth.demoAccount.username.length > 0,
        actual: `缺失字段=${missing.join(',') || '无'}, 技术栈=${result.config.stackId}, 自动默认值数=${result.adoptedDefaults.length}`,
        evidence: ['输入只有 title，未传入任何版本、约束或勾选值'],
      };
    },
  ));

  items.push(await safeItem(
    'F03-03',
    '步骤枚举不含任何人工把关态（无 confirm 计数）',
    'invariant',
    "步骤恰为 input/analysis/techdoc/deliverables/history；main 与 ui 中禁用词计数为 0",
    async () => {
      const stepMatch = mainSource.match(/type\s+Step\s*=\s*([^;]+);/);
      const stepNames = stepMatch
        ? [...stepMatch[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
        : [];
      const forbidden = /confirm|review|approve|pending|确认|审核/gi;
      const mainHits = (mainSource.match(forbidden) ?? []).length;
      const uiHits = (uiSource.match(forbidden) ?? []).length;
      const expectedSteps = ['input', 'analysis', 'techdoc', 'deliverables', 'history'];
      return {
        ok: JSON.stringify(stepNames) === JSON.stringify(expectedSteps)
          && mainHits === 0 && uiHits === 0,
        actual: `步骤=${stepNames.join(',')}, main 禁用词=${mainHits}, ui 禁用词=${uiHits}`,
        evidence: [
          `src/main.tsx 步骤枚举: ${stepNames.join(' | ') || '无'}`,
          `src/ui.tsx 字符数=${uiSource.length}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F03-04',
    '版本号被覆盖后确实进入 config 并影响派生读取',
    'parser',
    '覆盖值出现在 versions、envBaseline.runtimeChecks 与 rawInput.versionInputs',
    async () => {
      const override = '用户自定义数据库版本';
      const result = project.normalize({
        title: sampleTitle,
        versionInputs: { db: override },
      });
      const inVersions = result.config.versions.db === override;
      const inDerived = result.config.envBaseline.runtimeChecks.some(
        (item) => item.expected === override,
      );
      const inRaw = result.config.rawInput.versionInputs.db === override;
      return {
        ok: inVersions && inDerived && inRaw,
        actual: `versions=${inVersions}, 派生读取=${inDerived}, 原始锚点=${inRaw}`,
        evidence: [`覆盖值="${override}"`],
      };
    },
  ));

  items.push(await safeItem(
    'F03-05',
    '异常提示组件含「一键采用建议值 / 自动修复」，且存在默认值可零操作继续（DOM 结构断言）',
    'invariant',
    '提示条含 role=alert、两个一键修复按钮、data-action 标记；五个版本默认值齐备',
    async () => {
      const structure = {
        fixLabel: uiSource.includes('一键采用建议值'),
        autoFixLabel: uiSource.includes('自动修复'),
        alertRole: uiSource.includes('role="alert"'),
        adoptAction: uiSource.includes('data-action="adopt-suggested"'),
        autoFixAction: uiSource.includes('data-action="auto-fix"'),
        buttonType: uiSource.includes('type="button"'),
      };
      const versionValues = Object.values(types.SUGGESTED_DEFAULTS.versions);
      const defaultsOk = versionValues.length === 5
        && versionValues.every((value) => typeof value === 'string' && value.length > 0);
      const zeroOpOk = project.normalize({ title: sampleTitle }).adoptedDefaults.length > 0;
      const ok = Object.values(structure).every(Boolean) && defaultsOk && zeroOpOk;
      return {
        ok,
        actual: `结构=${JSON.stringify(structure)}, 版本默认值齐备=${defaultsOk}, 零操作继续=${zeroOpOk}`,
        evidence: [
          `src/ui.tsx 静态 DOM 结构扫描字段: ${Object.keys(structure).join(', ')}`,
          `版本默认值数量=${versionValues.length}`,
        ],
      };
    },
  ));

  items.push(makeItem(
    'F03-06',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** F04：功能点分析的七条判据。 */
async function f04Items() {
  const items = [];
  const featuresModule = await importTs('src/features.ts');
  const featureSource = exists('src/features.ts') ? readText('src/features.ts') : '';
  const mainSource = exists('src/main.tsx') ? readText('src/main.tsx') : '';
  const uiSource = exists('src/ui.tsx') ? readText('src/ui.tsx') : '';
  const baseline = engineeringBaseline('F04', ['F01', 'F02', 'F03']);
  const sampleTitle = '基于 Java 的图书馆管理系统与订单预约平台，含数据分析、推荐系统、论坛社区与文件上传';

  items.push(await safeItem(
    'F04-01',
    '样本题目命中关键词表产出至少五个功能点',
    'parser',
    '命中关键词数大于零，功能点数 >= 5',
    async () => {
      const result = featuresModule.recommendFeatures(sampleTitle);
      return {
        ok: !result.fallback
          && result.matchedKeywords.length > 0
          && result.features.length >= 5,
        actual: `命中关键词=${result.matchedKeywords.length}, 功能点=${result.features.length}, 回退=${result.fallback}`,
        evidence: [
          `样本题目: ${sampleTitle}`,
          `命中关键词: ${result.matchedKeywords.join('、') || '无'}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F04-02',
    '编号全部匹配 FP-\\d{3} 且唯一',
    'invariant',
    '每个编号匹配 /^FP-\\d{3}$/ 且集合无重复',
    async () => {
      const points = featuresModule.recommendFeatures(sampleTitle).features;
      const ids = points.map((point) => point.id);
      const allValid = ids.every((id) => /^FP-\d{3}$/.test(id));
      const unique = new Set(ids).size === ids.length;
      return {
        ok: allValid && unique && ids.length > 0,
        actual: `编号=${ids.join(',')}, 格式全合法=${allValid}, 唯一=${unique}`,
        evidence: [`功能点数量=${points.length}`],
      };
    },
  ));

  items.push(await safeItem(
    'F04-03',
    '重复标题自动合并且无空验收条件',
    'invariant',
    '重复标题合并为一项，所有功能点 acceptance 非空',
    async () => {
      const drafts = [
        { title: '  用户登录  ', acceptance: ['首次条件'] },
        { title: '用户登录', acceptance: ['首次条件', '追加条件'] },
        { title: '数据导出' },
        { title: '   ' },
      ];
      const points = featuresModule.normalizeFeatures(drafts);
      const merged = points.length === 2;
      const acceptanceOk = points.every((point) => point.acceptance.length > 0);
      const unionOk = points[0]?.acceptance.includes('追加条件') === true;
      return {
        ok: merged && acceptanceOk && unionOk,
        actual: `合并后数量=${points.length}, 验收条件全非空=${acceptanceOk}, 条件已合并=${unionOk}`,
        evidence: [`输出标题: ${points.map((point) => point.title).join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F04-04',
    'normalizeFeatures() 幂等',
    'invariant',
    '对自身输出再次规范化，深比较完全相等',
    async () => {
      const first = featuresModule.normalizeFeatures([
        { title: '基础数据新增' },
        { title: '基础数据删除', acceptance: ['删除后查询不到'] },
      ]);
      const second = featuresModule.normalizeFeatures(first);
      const equal = JSON.stringify(first) === JSON.stringify(second);
      return {
        ok: equal && first.length > 0,
        actual: `深比较相等=${equal}, 功能点数=${first.length}`,
        evidence: [`首次编号: ${first.map((point) => point.id).join(',')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F04-05',
    '全手输路径产出同样合法的功能点且 source 为 manual',
    'parser',
    'createManualFeatures 结果编号合法、无冲突、来源全部为 manual',
    async () => {
      const points = featuresModule.createManualFeatures([
        '  用户登录 ', '', '订单查询', '订单查询',
      ]);
      const allValid = points.every((point) => /^FP-\d{3}$/.test(point.id));
      const allManual = points.length > 0 && points.every((point) => point.source === 'manual');
      const noConflicts = featuresModule.checkFeatureConflicts(points).length === 0;
      return {
        ok: allValid && allManual && noConflicts,
        actual: `数量=${points.length}, 编号合法=${allValid}, 来源全为 manual=${allManual}, 无冲突=${noConflicts}`,
        evidence: [`输出编号: ${points.map((point) => point.id).join(',')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F04-06',
    '未命中时回退通用 CRUD 骨架且不产生任何人工把关步骤',
    'invariant',
    'fallback=true 且功能点 >= 5 且提示为「建议手动调整」；features/main/ui 三处禁用词计数为 0',
    async () => {
      // 该样例刻意不含关键词表中的任何词，用于验证未命中回退路径。
      const result = featuresModule.recommendFeatures('甲乙丙丁戊');
      const forbidden = /confirm|review|approve|pending|确认|审核/gi;
      const hits = [featureSource, mainSource, uiSource]
        .map((text) => (text.match(forbidden) ?? []).length)
        .reduce((sum, count) => sum + count, 0);
      const stepMatch = mainSource.match(/type\s+Step\s*=\s*([^;]+);/);
      const stepNames = stepMatch
        ? [...stepMatch[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
        : [];
      const ok = result.fallback === true
        && result.features.length >= 5
        && result.hint === '建议手动调整'
        && hits === 0
        && stepNames.length === 5
        && stepNames.every((name) => !/confirm|review|approve|pending/i.test(name));
      return {
        ok,
        actual: `fallback=${result.fallback}, 骨架功能点=${result.features.length}, 提示="${result.hint}", 禁用词命中=${hits}, 步骤数=${stepNames.length}`,
        evidence: [
          `src/features.ts 字符数=${featureSource.length}`,
          `src/main.tsx 步骤枚举: ${stepNames.join(' | ')}`,
        ],
      };
    },
  ));

  items.push(makeItem(
    'F04-07',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** F05：双栈模板注册表与模板表的七条判据。 */
async function f05Items() {
  const items = [];
  const stacks = await importTs('src/stacks/index.ts');
  const javaMod = await importTs('src/stacks/java.ts');
  const pythonMod = await importTs('src/stacks/python.ts');
  const javaSource = exists('src/stacks/java.ts') ? readText('src/stacks/java.ts') : '';
  const pythonSource = exists('src/stacks/python.ts') ? readText('src/stacks/python.ts') : '';
  const registrySource = exists('src/stacks/index.ts') ? readText('src/stacks/index.ts') : '';
  const baseline = engineeringBaseline('F05', ['F01', 'F02', 'F03', 'F04']);
  const templates = [javaMod.javaTemplate, pythonMod.pythonTemplate];
  const requiredFields = [
    'stackId', 'label', 'dirTree', 'depsConfig', 'frontendCommon', 'backendFragments',
    'sqlDialect', 'readmeBaseline', 'envCheckItems', 'commentPolicy',
    'explainerAnchors', 'suggestedVersions',
  ];

  items.push(await safeItem(
    'F05-01',
    '注册表标识恰含 java 与 python',
    'invariant',
    "listStackIds() 恰好等于 ['java','python']",
    async () => {
      const ids = [...stacks.listStackIds()];
      return {
        ok: JSON.stringify(ids) === '["java","python"]',
        actual: `标识=${ids.join(',')}`,
        evidence: [`BUILTIN_TEMPLATES 数量=${stacks.BUILTIN_TEMPLATES.length}`],
      };
    },
  ));

  items.push(await safeItem(
    'F05-02',
    '每栈 StackTemplate 必填字段齐全',
    'invariant',
    '十二个必填字段均存在且非空，依赖文件与命令表有内容',
    async () => {
      const missing = [];
      for (const template of templates) {
        for (const field of requiredFields) {
          const value = template[field];
          if (value === undefined || value === null
            || (typeof value === 'string' && value.length === 0)
            || (Array.isArray(value) && value.length === 0)) {
            missing.push(`${template.stackId}.${field}`);
          }
        }
        if (!template.depsConfig.template || !template.readmeBaseline.commands.length) {
          missing.push(`${template.stackId}.依赖内容`);
        }
      }
      return {
        ok: missing.length === 0 && templates.length === 2,
        actual: `缺失字段=${missing.join(',') || '无'}`,
        evidence: [
          `Java 依赖文件=${javaMod.javaTemplate.depsConfig.file}`,
          `Python 依赖文件=${pythonMod.pythonTemplate.depsConfig.file}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F05-03',
    '静态扫描两张模板表无版本号 / 账号字面量',
    'invariant',
    '两份模板表的字符串字面量不含版本号、版本串或演示账号；版本取自建议默认值表',
    async () => {
      const javaHits = scanForbiddenLiterals(javaSource);
      const pythonHits = scanForbiddenLiterals(pythonSource);
      const usesDefaults = javaSource.includes('SUGGESTED_DEFAULTS')
        && pythonSource.includes('SUGGESTED_DEFAULTS')
        && javaSource.includes('suggestedVersions')
        && pythonSource.includes('suggestedVersions');
      return {
        ok: javaSource.length > 0 && pythonSource.length > 0
          && javaHits.length === 0 && pythonHits.length === 0 && usesDefaults,
        actual: `Java 命中=${javaHits.join(' | ') || '无'}, Python 命中=${pythonHits.join(' | ') || '无'}, 引用建议默认值表=${usesDefaults}`,
        evidence: [
          `src/stacks/java.ts (${javaSource.length} 字符)`,
          `src/stacks/python.ts (${pythonSource.length} 字符)`,
          `规则: ${FORBIDDEN_LITERAL_PATTERNS.map((rule) => rule.id).join(' / ')}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F05-04',
    '模拟注册第三栈后可直接查表且注册表长度加一，消费方无需改动',
    'invariant',
    'createStackRegistry() 注册 mock 后 size+1 且 get 返回合法模板；注册表与 UI 无栈标识分支',
    async () => {
      const registry = stacks.createStackRegistry();
      const before = registry.size();
      const mock = { ...javaMod.javaTemplate, stackId: 'newstack', label: '模拟第三栈' };
      registry.register(mock);
      const fetched = registry.get('newstack');
      const fetchedOk = Boolean(fetched)
        && fetched.stackId === 'newstack'
        && requiredFields.every((field) => fetched[field] !== undefined);
      const sizeOk = registry.size() === before + 1;
      const noBranchInRegistry = !/switch\s*\(|===\s*['"](?:java|python)['"]/.test(registrySource);
      const consumerFiles = ['src/ui.tsx', 'src/project.ts', 'src/features.ts'];
      const consumers = consumerFiles.filter((rel) => exists(rel)).map((rel) => readText(rel));
      const noBranchInConsumers = consumers.every(
        (text) => !/switch\s*\(|stackId\s*===\s*['"]/.test(text),
      );
      return {
        ok: sizeOk && fetchedOk && noBranchInRegistry && noBranchInConsumers,
        actual: `长度 ${before}→${registry.size()}, 查表成功=${fetchedOk}, 注册表无分支=${noBranchInRegistry}, 消费方无分支=${noBranchInConsumers}`,
        evidence: [
          `新增标识: ${registry.listIds().join(',')}`,
          `消费方静态扫描: ${consumerFiles.join(', ')}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F05-05',
    '两栈 sqlDialect 均覆盖所选 MySQL 版本禁用语法清单',
    'parser',
    "禁用语法含 OVER (/WITH ... AS/JSON_TABLE；能力表覆盖 MySQL 5.7 与 MySQL 8.0",
    async () => {
      const keywords = ['OVER (', 'WITH ... AS', 'JSON_TABLE'];
      const versions = ['MySQL 5.7', 'MySQL 8.0'];
      const problems = [];
      for (const template of templates) {
        for (const keyword of keywords) {
          if (!template.sqlDialect.disabledSyntaxes.includes(keyword)) {
            problems.push(`${template.stackId} 缺禁用语法 ${keyword}`);
          }
        }
        for (const version of versions) {
          const capability = template.sqlDialect.capabilityTable[version];
          if (!capability) {
            problems.push(`${template.stackId} 缺能力表 ${version}`);
            continue;
          }
          if (version === 'MySQL 5.7'
            && (capability.windowFunctions || capability.cte || capability.jsonTable)) {
            problems.push(`${template.stackId} 的旧版能力开关应为 false`);
          }
        }
        if (!template.sqlDialect.selectedDbVersion) {
          problems.push(`${template.stackId} 缺所选数据库版本`);
        }
      }
      return {
        ok: problems.length === 0,
        actual: `问题数=${problems.length}${problems.length > 0 ? ` (${problems.join('; ')})` : ''}`,
        evidence: [
          `Java 禁用语法数=${javaMod.javaTemplate.sqlDialect.disabledSyntaxes.length}`,
          `Python 禁用语法数=${pythonMod.pythonTemplate.sqlDialect.disabledSyntaxes.length}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F05-06',
    'pom.xml 模板 XML 标签配对通过，requirements.txt 模板每行格式合法',
    'parser',
    '通用标准解析器：XML 标签配对无异常；依赖清单每行符合名称==版本/注释/空行',
    async () => {
      const pom = javaMod.javaTemplate.depsConfig.template;
      const requirements = pythonMod.pythonTemplate.depsConfig.template;
      const xmlOk = xmlTagsBalanced(pom);
      const lineResult = requirementsLinesValid(requirements);
      const fileOk = javaMod.javaTemplate.depsConfig.file === 'pom.xml'
        && pythonMod.pythonTemplate.depsConfig.file === 'requirements.txt';
      return {
        ok: xmlOk && lineResult.ok && fileOk,
        actual: `XML 标签配对=${xmlOk}, 依赖行合法=${lineResult.ok}(内容行 ${lineResult.contentLines}), 文件名正确=${fileOk}`,
        evidence: [
          `pom.xml 模板字符数=${pom.length}`,
          `requirements.txt 模板字符数=${requirements.length}`,
        ],
      };
    },
  ));

  items.push(makeItem(
    'F05-07',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** 构造 F06~F10 判据共用的标准输入（真实调用 normalize / recommendFeatures）。 */
async function standardGenerateInput(title) {
  const project = await importTs('src/project.ts');
  const featuresModule = await importTs('src/features.ts');
  return {
    config: project.normalize({ title }).config,
    features: featuresModule.recommendFeatures(title).features,
  };
}

/** F06：渲染引擎与技术文档的六条判据。 */
async function f06Items() {
  const items = [];
  const generator = await importTs('src/generate.ts');
  const inv = await importTs('tests/invariants.ts');
  const baseline = engineeringBaseline('F06', ['F01', 'F02', 'F03', 'F04', 'F05']);
  const input = await standardGenerateInput(inv.F06_EXPECTED.sampleTitle);

  items.push(await safeItem(
    'F06-01',
    '同一输入连续两次 generate() 输出全等（确定性）',
    'invariant',
    '两次生成的文件树深比较完全相等，且纯文本哈希相等',
    async () => {
      const first = generator.generate(input);
      const second = generator.generate(input);
      const deep = JSON.stringify(first.files) === JSON.stringify(second.files);
      const hash = generator.hashTextFiles(first.files) === generator.hashTextFiles(second.files);
      return {
        ok: deep && hash && first.files.length > 0,
        actual: `深比较相等=${deep}, 哈希相等=${hash}, 文件数=${first.files.length}`,
        evidence: [`哈希=${generator.hashTextFiles(first.files)}`],
      };
    },
  ));

  items.push(await safeItem(
    'F06-02',
    'docs/技术文档.md 含「技术栈分析」「开发流程」两节且栈名 / 版本取自 config',
    'parser',
    '四节标题齐全；技术栈标识与五个版本值均来自 ProjectConfig',
    async () => {
      const result = generator.generate(input);
      const doc = generator.findFile(result.files, inv.F06_EXPECTED.techDocPath);
      const text = doc ?? '';
      const sectionsOk = inv.F06_EXPECTED.sections.every(
        (section) => text.includes(`## ${section}`),
      );
      const stackOk = text.includes(input.config.stackId) && text.includes(result.stackId);
      const versionsOk = Object.values(input.config.versions).every(
        (value) => text.includes(value),
      );
      return {
        ok: Boolean(doc) && sectionsOk && stackOk && versionsOk,
        actual: `文档存在=${Boolean(doc)}, 四节齐全=${sectionsOk}, 栈名同源=${stackOk}, 五版本同源=${versionsOk}`,
        evidence: [`文档字符数=${text.length}`, `版本值=${Object.values(input.config.versions).join(' / ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F06-03',
    '渲染器遇未替换占位符抛错（非静默放过）',
    'invariant',
    'renderTemplate 对未知键抛出含「未替换占位符」的异常；已知键正常渲染',
    async () => {
      let rejected = false;
      let message = '';
      try {
        generator.renderTemplate('前缀 {{missing.key}} 后缀', {}, '判据测试');
      } catch (error) {
        rejected = true;
        message = String(error?.message ?? error);
      }
      const normal = generator.renderTemplate('{{known}}', { known: '值' }, '判据测试');
      return {
        ok: rejected && message.includes('未替换占位符') && normal === '值',
        actual: `抛错=${rejected}, 信息="${message}", 正常渲染="${normal}"`,
        evidence: ['未知占位符键: missing.key'],
      };
    },
  ));

  items.push(await safeItem(
    'F06-04',
    '输出中不含占位符残留',
    'invariant',
    '全部交付物内容均不含占位符起始符',
    async () => {
      const result = generator.generate(input);
      const dirty = result.files
        .filter((file) => file.content.includes(inv.F06_EXPECTED.placeholderLeftover))
        .map((file) => file.path);
      return {
        ok: dirty.length === 0 && result.files.length > 0,
        actual: `残留文件=${dirty.join(',') || '无'}, 交付物数=${result.files.length}`,
        evidence: result.files.map((file) => `${file.path}(${file.content.length}字符)`),
      };
    },
  ));

  items.push(await safeItem(
    'F06-05',
    '固有属性断言：文档章节标题齐全（期望值外置在 invariants.ts）',
    'invariant',
    "章节期望值来自 tests/invariants.ts 的硬编码字面常量，且实际标题逐项命中",
    async () => {
      const expected = [...inv.F06_EXPECTED.sections];
      const doc = generator.findFile(
        generator.generate(input).files,
        inv.F06_EXPECTED.techDocPath,
      ) ?? '';
      const headings = [...doc.matchAll(/^##\s+(.+)$/gm)].map((entry) => entry[1].trim());
      const hit = expected.every((section) => headings.includes(section));
      return {
        ok: Array.isArray(expected) && expected.length === 4 && hit,
        actual: `外置期望=${expected.join(',')}, 实际标题=${headings.join(',')}`,
        evidence: ['期望值读取自 tests/invariants.ts，不来自生成结果'],
      };
    },
  ));

  items.push(makeItem(
    'F06-06',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** 用 TypeScript compiler API 对生成产物做语法解析，返回诊断文本列表。 */
function tsSyntaxDiagnostics(code, fileName) {
  const output = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  return (output.diagnostics ?? [])
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

/** 源码结构标记计数：类、公开方法、条件分支。 */
function countStructureMarkers(content) {
  const patterns = [
    /public\s+class\b/g,
    /public\s+\w+\s+\w+\s*\(/g,
    /\bif\s*\(/g,
    /^\s*def\s+\w+\s*\(/gm,
  ];
  return patterns.reduce((sum, pattern) => sum + (content.match(pattern) ?? []).length, 0);
}

/** F07：源码、中文注释与讲解材料的七条判据。 */
async function f07Items() {
  const items = [];
  const generator = await importTs('src/generate.ts');
  const inv = await importTs('tests/invariants.ts');
  const baseline = engineeringBaseline('F07', ['F01', 'F02', 'F03', 'F04', 'F05', 'F06']);
  const javaInput = await standardGenerateInput(inv.F06_EXPECTED.sampleTitle);
  const pythonInput = {
    config: (await importTs('src/project.ts')).normalize({
      title: inv.F06_EXPECTED.sampleTitle,
      stackChoice: 'python',
    }).config,
    features: javaInput.features,
  };

  items.push(await safeItem(
    'F07-01',
    '文件映射含 frontend/** 与 backend/**',
    'parser',
    '至少各有一个前端与后端交付物，且包含讲解材料',
    async () => {
      const paths = generator.generate(javaInput).files.map((file) => file.path);
      const front = paths.filter((path) => path.startsWith('frontend/'));
      const back = paths.filter((path) => path.startsWith('backend/'));
      return {
        ok: front.length > 0 && back.length > 0
          && paths.includes(inv.F07_EXPECTED.explainerPath),
        actual: `前端文件=${front.length}, 后端文件=${back.length}, 讲解材料=${paths.includes(inv.F07_EXPECTED.explainerPath)}`,
        evidence: [`交付物路径: ${paths.join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F07-02',
    '每个类 / public 方法 / 核心条件分支含中文注释块且含「做什么」「为什么」',
    'invariant',
    '每个源码文件中两个关键词的出现次数均 >= 结构标记数',
    async () => {
      const result = generator.generate(javaInput);
      const sources = result.files.filter((file) => /\.(java|py|ts|tsx|js)$/.test(file.path));
      const problems = [];
      for (const source of sources) {
        const markers = Math.max(countStructureMarkers(source.content), 1);
        for (const keyword of inv.F07_EXPECTED.commentKeywords) {
          const count = (source.content.match(new RegExp(keyword, 'g')) ?? []).length;
          if (count < markers) {
            problems.push(`${source.path}:${keyword}=${count}<${markers}`);
          }
        }
      }
      return {
        ok: sources.length > 0 && problems.length === 0,
        actual: `源码文件=${sources.length}, 不达标项=${problems.join(' | ') || '无'}`,
        evidence: sources.map((file) => `${file.path}: 结构标记=${countStructureMarkers(file.content)}`),
      };
    },
  ));

  items.push(await safeItem(
    'F07-03',
    'docs/讲解材料.md 每个锚点 file 与 symbol 均存在于同次输出',
    'invariant',
    '锚点集合非空；每个 file 在文件树中、每个 symbol 存在于该文件内容；文档含常见追问要点',
    async () => {
      const result = generator.generate(pythonInput);
      const doc = generator.findFile(result.files, inv.F07_EXPECTED.explainerPath) ?? '';
      const problems = [];
      for (const anchor of result.explainerAnchors) {
        const target = generator.findFile(result.files, anchor.file);
        if (target === undefined) {
          problems.push(`缺文件 ${anchor.file}`);
        } else if (!target.includes(anchor.symbol)) {
          problems.push(`缺符号 ${anchor.file}#${anchor.symbol}`);
        }
        if (!doc.includes(anchor.file) || !doc.includes(anchor.symbol)) {
          problems.push(`文档未列出 ${anchor.file}#${anchor.symbol}`);
        }
      }
      return {
        ok: result.explainerAnchors.length > 0 && problems.length === 0
          && doc.includes(inv.F07_EXPECTED.followUpHeading),
        actual: `锚点数=${result.explainerAnchors.length}, 问题=${problems.join(' | ') || '无'}, 追问要点=${doc.includes(inv.F07_EXPECTED.followUpHeading)}`,
        evidence: result.explainerAnchors.map((anchor) => `${anchor.file}#${anchor.symbol}`),
      };
    },
  ));

  items.push(await safeItem(
    'F07-04',
    '切换 java / python 产出不同的后端文件与依赖配置',
    'parser',
    '两栈依赖文件名不同、源码扩展名不同、后端内容集合不相等',
    async () => {
      const java = generator.generate(javaInput);
      const python = generator.generate(pythonInput);
      const jp = java.files.map((file) => file.path);
      const pp = python.files.map((file) => file.path);
      const javaBackend = java.files.filter((file) => file.path.startsWith('backend/'))
        .map((file) => file.content).join('\n');
      const pythonBackend = python.files.filter((file) => file.path.startsWith('backend/'))
        .map((file) => file.content).join('\n');
      const ok = jp.includes('backend/pom.xml')
        && pp.includes('backend/requirements.txt')
        && jp.some((path) => path.endsWith('.java'))
        && pp.some((path) => path.endsWith('.py'))
        && javaBackend !== pythonBackend;
      return {
        ok,
        actual: `Java依赖=pom.xml, Python依赖=requirements.txt, java源码=${jp.some((p) => p.endsWith('.java'))}, py源码=${pp.some((p) => p.endsWith('.py'))}, 内容不同=${javaBackend !== pythonBackend}`,
        evidence: [`Java 后端路径: ${jp.filter((p) => p.startsWith('backend/')).join(', ')}`,
          `Python 后端路径: ${pp.filter((p) => p.startsWith('backend/')).join(', ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F07-05',
    '独立锚点 B：生成产物 TS/TSX 语法解析无诊断、XML 配对、依赖清单行格式通过',
    'parser',
    'TypeScript compiler API / XML 标签配对 / 行格式三类通用解析器判定',
    async () => {
      const result = generator.generate(javaInput);
      const tsFiles = result.files.filter((file) => /\.(ts|tsx)$/.test(file.path));
      const diagnostics = tsFiles.flatMap((file) => tsSyntaxDiagnostics(file.content, file.path));
      const pom = generator.findFile(result.files, 'backend/pom.xml') ?? '';
      const xmlOk = pom.length > 0 && xmlTagsBalanced(pom);
      const python = generator.generate(pythonInput);
      const requirements = generator.findFile(python.files, 'backend/requirements.txt') ?? '';
      const lines = requirementsLinesValid(requirements);
      return {
        ok: tsFiles.length > 0 && diagnostics.length === 0 && xmlOk && lines.ok,
        actual: `TS/TSX 文件=${tsFiles.length}, 语法诊断=${diagnostics.length}, XML 配对=${xmlOk}, 依赖行合法=${lines.ok}`,
        evidence: [`诊断: ${diagnostics.join(' | ') || '无'}`, `requirements 内容行=${lines.contentLines}`],
      };
    },
  ));

  items.push(await safeItem(
    'F07-06',
    '静态能力面约束：判据入口不加载子进程 / 网络 / VM 模块、不出现执行调用、动态 import 参数静态可解析',
    'invariant',
    'AST 级 import 白名单 + 扩充禁用词元 + 拼接式动态 import 负向自测；明确不编译、不执行生成产物',
    async () => {
      const selfSource = readText('scripts/check.mjs');
      const capability = await importTs('tests/capability.ts');
      const audit = capability.auditCapability(selfSource, ALLOWED_IMPORTS);
      const mirrored = [...capability.CAPABILITY_ALLOWED_IMPORTS];
      const noDrift = JSON.stringify(mirrored) === JSON.stringify([...ALLOWED_IMPORTS]);
      // 负向自测：构造拼接式动态 import 的假脚本，确认判据确实能拦截（B-01）。
      const fakeBypass = "const m = await import('node:' + 'child_' + 'process');";
      const negative = capability.auditModuleImports(fakeBypass, ALLOWED_IMPORTS);
      // 本地转译注册表只允许本地静态相对导入，不引入裸能力模块。
      const registry = exists('.tscache/registry.mjs') ? readText('.tscache/registry.mjs') : '';
      const registryClean = registry.length > 0 && !/from\s+['"](?!\.)/.test(registry);
      return {
        ok: audit.ok && noDrift && !negative.ok && registryClean,
        actual: `AST import 通过=${audit.importAudit.ok}, 模块数=${audit.importAudit.moduleNames.length}, 禁用词元=${audit.bannedHits.join(',') || '无'}, require=${audit.requireCalls}, 镜像清单无漂移=${noDrift}, 拼接式动态 import 被拦截=${!negative.ok}, 注册表仅本地相对导入=${registryClean}`,
        evidence: [
          `判据入口导入模块: ${audit.importAudit.moduleNames.join(', ')}`,
          `违规项: ${audit.importAudit.violations.join(' | ') || '无'}`,
          '口径：静态能力面约束——不加载子进程/网络/VM 模块、不出现执行调用、动态 import 参数静态可解析',
        ],
      };
    },
  ));

  items.push(makeItem(
    'F07-07',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** SQL 词法解析：只做词法，不连库、不执行任何语句。 */
function sqlLex(sql) {
  const tokens = [];
  const errors = [];
  let depth = 0;
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let text = char;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        text += sql[index];
        if (sql[index] === quote) {
          closed = true;
          index += 1;
          break;
        }
        index += 1;
      }
      if (!closed) {
        errors.push(`引号未闭合: ${text.slice(0, 20)}`);
      }
      tokens.push({ type: 'quoted', text });
      continue;
    }
    if (char === '(' || char === ')' || char === ',' || char === ';') {
      if (char === '(') {
        depth += 1;
      }
      if (char === ')') {
        depth -= 1;
        if (depth < 0) {
          errors.push('括号多余闭合');
        }
      }
      tokens.push({ type: 'punct', text: char });
      index += 1;
      continue;
    }
    let word = '';
    while (index < sql.length && !/[\s(),;]/.test(sql[index])) {
      word += sql[index];
      index += 1;
    }
    tokens.push({ type: 'word', text: word });
  }
  if (depth !== 0) {
    errors.push('括号未配对');
  }
  return { ok: errors.length === 0, tokens, errors };
}

/** 从 schema 文本解析表名与列名，用于与 dataModel.entities 做结构断言。 */
function parseSchemaTables(sql) {
  const tables = [];
  let current = null;
  for (const line of sql.split(/\r?\n/)) {
    const open = line.match(/CREATE\s+TABLE\s+`([^`]+)`\s*\(/i);
    if (open) {
      current = { name: open[1], columns: [] };
      tables.push(current);
      continue;
    }
    if (current && /^\s*\)/.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const column = line.match(/^\s*`([^`]+)`\s/);
      if (column) {
        current.columns.push(column[1]);
      }
    }
  }
  return tables;
}

/** 抽取 Markdown 指定二级标题下的正文。 */
function markdownSection(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return '';
  }
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }
  return body.join('\n');
}

/** 抽取 README 中代码块内的命令行。 */
function fencedCommands(text) {
  const commands = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line.trim().length > 0) {
      commands.push(line.trim());
    }
  }
  return commands;
}

/** F08：SQL / README / 清单 / 环境自检 / A11 的十条判据。 */
async function f08Items() {
  const items = [];
  const generator = await importTs('src/generate.ts');
  const project = await importTs('src/project.ts');
  const featuresModule = await importTs('src/features.ts');
  const stacks = await importTs('src/stacks/index.ts');
  const inv = await importTs('tests/invariants.ts');
  const baseline = engineeringBaseline('F08', ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07']);
  const title = inv.F06_EXPECTED.sampleTitle;
  const baseFeatures = featuresModule.recommendFeatures(title).features;
  const buildInput = (a11, stackChoice = 'java') => ({
    config: project.normalize({
      title,
      stackChoice,
      a11Docs: a11
        ? { opening: true, midterm: true, defense: true }
        : { opening: false, midterm: false, defense: false },
    }).config,
    features: baseFeatures,
  });
  const input = buildInput(false);
  const result = generator.generate(input);
  const template = stacks.getStack(input.config.stackId);
  const schema = generator.findFile(result.files, 'sql/schema.sql') ?? '';
  const seed = generator.findFile(result.files, 'sql/seed.sql') ?? '';
  const readme = generator.findFile(result.files, 'README.md') ?? '';
  const manifest = generator.findFile(result.files, 'MANIFEST.md') ?? '';
  const envCheck = generator.findFile(result.files, 'env-check.md') ?? '';

  items.push(await safeItem(
    'F08-01',
    'SQL 词法解析无异常，CREATE TABLE >=1、字段含 COMMENT、无禁用语法',
    'parser',
    '通用词法解析器对 schema / seed 无错误；建表语句、COMMENT 与禁用语法清单均满足',
    async () => {
      const schemaLex = sqlLex(schema);
      const seedLex = sqlLex(seed);
      const schemaWords = schemaLex.tokens.map((token) => token.text.toUpperCase());
      const createCount = schemaWords.filter(
        (word, index) => word === 'CREATE' && schemaWords[index + 1] === 'TABLE',
      ).length;
      const commentOk = schemaWords.includes('COMMENT');
      const disabled = template.sqlDialect.disabledSyntaxes.filter(
        (syntax) => schema.includes(syntax) || seed.includes(syntax),
      );
      return {
        ok: schema.length > 0 && seed.length > 0 && schemaLex.ok && seedLex.ok
          && createCount >= 1 && commentOk && disabled.length === 0,
        actual: `schema词法=${schemaLex.ok}, seed词法=${seedLex.ok}, CREATE TABLE=${createCount}, COMMENT=${commentOk}, 禁用语法命中=${disabled.join(',') || '无'}`,
        evidence: [
          `schema 字符数=${schema.length}, seed 字符数=${seed.length}`,
          `词法错误: ${[...schemaLex.errors, ...seedLex.errors].join(' | ') || '无'}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F08-02',
    'schema 表名 / 字段经解析结果与 ctx.dataModel 结构断言一致',
    'parser',
    '解析出的表名集合与列名集合分别等于 dataModel.entities 的名称与字段',
    async () => {
      const tables = parseSchemaTables(schema);
      const expected = input.config.dataModel.entities;
      const problems = [];
      if (tables.length !== expected.length) {
        problems.push(`表数 ${tables.length} != ${expected.length}`);
      }
      for (const entity of expected) {
        const found = tables.find((table) => table.name === entity.name);
        if (!found) {
          problems.push(`缺表 ${entity.name}`);
          continue;
        }
        for (const field of entity.fields) {
          if (!found.columns.includes(field.name)) {
            problems.push(`缺列 ${entity.name}.${field.name}`);
          }
        }
      }
      return {
        ok: problems.length === 0 && tables.length > 0,
        actual: `解析表=${tables.map((table) => `${table.name}(${table.columns.join(',')})`).join(' | ')}, 问题=${problems.join(';') || '无'}`,
        evidence: [`dataModel 实体数=${expected.length}`],
      };
    },
  ));

  items.push(await safeItem(
    'F08-03',
    'seed 账号字段与 ctx.auth 及前端登录表单字段静态一致（替代登录冒烟）',
    'invariant',
    'seed 含演示账号、口令列、角色列；后端认证源码含同名列；登录表单含 loginFormFields',
    async () => {
      const auth = input.config.auth;
      const form = generator.findFile(result.files, 'frontend/src/LoginForm.tsx') ?? '';
      const authSource = result.files.find((file) => file.path.includes('AuthService'))?.content ?? '';
      const checks = {
        username: seed.includes(auth.demoAccount.username),
        password: seed.includes(auth.demoAccount.password),
        role: seed.includes(auth.demoAccount.role),
        passwordColumn: seed.includes(auth.passwordField) && authSource.includes(auth.passwordField),
        roleColumn: seed.includes(auth.roleField) && authSource.includes(auth.roleField),
        formFields: auth.loginFormFields.every((field) => form.includes(`name="${field}"`)),
        algo: seed.includes(auth.passwordAlgo),
      };
      return {
        ok: Object.values(checks).every(Boolean),
        actual: JSON.stringify(checks),
        evidence: [`登录表单字段=${auth.loginFormFields.join(',')}`, `口令算法=${auth.passwordAlgo}`],
      };
    },
  ));

  items.push(await safeItem(
    'F08-04',
    '生成产物 README 中每个版本号 ∈ ctx.versions、每条命令 ∈ 栈模板命令表、目录段 = 实际文件树',
    'parser',
    '三类集合差为零：版本、命令、目录路径',
    async () => {
      const versionValues = Object.values(input.config.versions);
      const versionTokens = [...new Set(readme.match(/\d+\.\d+(?:\.\d+)*/g) ?? [])];
      const badVersions = versionTokens.filter(
        (token) => !versionValues.some((value) => value.includes(token)),
      );
      const commands = fencedCommands(readme);
      const allowedCommands = template.readmeBaseline.commands.map((entry) => entry.command);
      const badCommands = commands.filter((command) => !allowedCommands.includes(command));
      const dirSection = markdownSection(readme, '目录说明');
      const listedPaths = [...dirSection.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
      const actualPaths = result.files.map((file) => file.path);
      const missingPaths = actualPaths.filter((path) => !listedPaths.includes(path));
      const extraPaths = listedPaths.filter((path) => !actualPaths.includes(path));
      return {
        ok: readme.length > 0 && badVersions.length === 0 && badCommands.length === 0
          && commands.length === allowedCommands.length
          && missingPaths.length === 0 && extraPaths.length === 0,
        actual: `版本=${versionTokens.join(',')} 违规=${badVersions.join(',') || '无'}; 命令=${commands.length}/${allowedCommands.length} 违规=${badCommands.join(' | ') || '无'}; 目录缺=${missingPaths.join(',') || '无'} 多=${extraPaths.join(',') || '无'}`,
        evidence: [
          `ctx.versions: ${versionValues.join(' / ')}`,
          `栈模板命令表: ${allowedCommands.join(' | ')}`,
        ],
      };
    },
  ));

  items.push(await safeItem(
    'F08-05',
    'JSON.parse（package.json / lockfile）通过',
    'parser',
    '本系统 package.json、package-lock.json 与生成产物 frontend/package.json 均可解析',
    async () => {
      const parsed = [];
      for (const rel of ['package.json', 'package-lock.json']) {
        const outcome = safeJson(rel);
        parsed.push({ rel, ok: outcome.ok });
      }
      let generatedOk = false;
      try {
        JSON.parse(generator.findFile(result.files, 'frontend/package.json') ?? '');
        generatedOk = true;
      } catch {
        generatedOk = false;
      }
      return {
        ok: parsed.every((entry) => entry.ok) && generatedOk,
        actual: `${parsed.map((entry) => `${entry.rel}=${entry.ok}`).join(', ')}, 生成产物 package.json=${generatedOk}`,
        evidence: parsed.map((entry) => `${entry.rel}: ${entry.ok ? 'JSON.parse OK' : '解析失败'}`),
      };
    },
  ));

  items.push(await safeItem(
    'F08-06',
    'MANIFEST.md 覆盖全部产物且 A12 标「待做」、无产物文件',
    'invariant',
    '清单路径集合 == 实际文件树；A12 待做标记存在；无 jar/exe/Docker 文件',
    async () => {
      const declared = [...manifest.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
      const actualPaths = result.files.map((file) => file.path);
      const missing = actualPaths.filter((path) => !declared.includes(path));
      const forbiddenFiles = actualPaths.filter((path) => /\.(jar|exe)$|Dockerfile/.test(path));
      return {
        ok: manifest.includes(inv.F08_EXPECTED.a12Note)
          && missing.length === 0 && forbiddenFiles.length === 0,
        actual: `清单条目=${declared.length}, 实际文件=${actualPaths.length}, 缺失=${missing.join(',') || '无'}, A12待做=${manifest.includes(inv.F08_EXPECTED.a12Note)}, 部署产物=${forbiddenFiles.join(',') || '无'}`,
        evidence: [`清单路径: ${declared.join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F08-07',
    'env-check.md 只含只读检查命令、不含安装动作与回填交互（静态文本产物）',
    'invariant',
    '扫描无 install / apt / yum / pip / 回填 / 核对类交互描述；命令来自模板只读检查表',
    async () => {
      const forbidden = ['install', 'apt-get', 'yum', 'pip', '请核对', '请填写', '请确认', '回填', '手动填写'];
      const hits = forbidden.filter((token) => envCheck.includes(token));
      const readOnlyCommands = template.envCheckItems.map((item) => item.command);
      const commandsPresent = readOnlyCommands.every((command) => envCheck.includes(command));
      return {
        ok: envCheck.length > 0 && hits.length === 0 && commandsPresent,
        actual: `静态文本字符数=${envCheck.length}, 违规词命中=${hits.join(',') || '无'}, 只读命令齐备=${commandsPresent}`,
        evidence: [`只读检查命令: ${readOnlyCommands.join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F08-08',
    'A11 未勾选不生成三文档、勾选时生成且事实字段全部为空占位',
    'invariant',
    '未勾选路径集合为空；勾选时三份文档均含四个事实字段且值为留空占位',
    async () => {
      const offPaths = generator.generate(buildInput(false)).files.map((file) => file.path);
      const onResult = generator.generate(buildInput(true));
      const offLeak = inv.F08_EXPECTED.a11Paths.filter((path) => offPaths.includes(path));
      const problems = [];
      for (const path of inv.F08_EXPECTED.a11Paths) {
        const doc = generator.findFile(onResult.files, path);
        if (!doc) {
          problems.push(`缺文档 ${path}`);
          continue;
        }
        for (const field of inv.F08_EXPECTED.emptyFields) {
          if (!doc.includes(`- ${field}：${inv.F08_EXPECTED.emptyPlaceholder}`)) {
            problems.push(`${path} 的 ${field} 未留空`);
          }
        }
      }
      return {
        ok: offLeak.length === 0 && problems.length === 0,
        actual: `未勾选泄漏=${offLeak.join(',') || '无'}, 勾选问题=${problems.join(';') || '无'}`,
        evidence: [`事实字段: ${inv.F08_EXPECTED.emptyFields.join(',')}`, `占位符: ${inv.F08_EXPECTED.emptyPlaceholder}`],
      };
    },
  ));

  items.push(await safeItem(
    'F08-09',
    '生成产物 README 含边界声明原句',
    'invariant',
    `README 原样包含「${inv.F08_EXPECTED.boundaryStatement}」`,
    async () => ({
      ok: readme.includes(inv.F08_EXPECTED.boundaryStatement),
      actual: `原句存在=${readme.includes(inv.F08_EXPECTED.boundaryStatement)}`,
      evidence: [`边界声明来自 tests/invariants.ts 硬编码字面常量`],
    }),
  ));

  items.push(makeItem(
    'F08-10',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** F09：快照 v_n 与历史的六条判据。 */
async function f09Items() {
  const items = [];
  const history = await importTs('src/history.ts');
  const project = await importTs('src/project.ts');
  const featuresModule = await importTs('src/features.ts');
  const generator = await importTs('src/generate.ts');
  const inv = await importTs('tests/invariants.ts');
  const baseline = engineeringBaseline('F09', ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08']);
  const rawTitle = '  基于 Java 的  图书馆 管理系统  ';
  const createdAt = '2026-11-10T00:00:00.000Z';
  const config = project.normalize({ title: rawTitle }).config;
  const features = featuresModule.recommendFeatures(rawTitle).features;
  const files = generator.generate({ config, features }).files;
  const first = history.buildSnapshot(config, features, files, [], createdAt);
  const second = history.buildSnapshot(config, features, files, [first], createdAt);
  const uiSource = exists('src/ui.tsx') ? readText('src/ui.tsx') : '';

  items.push(await safeItem(
    'F09-01',
    '快照版本自动 v_1、v_2 递增',
    'invariant',
    "nextVersion([]) === 'v_1'；已有 v_1 时下一版为 'v_2'",
    async () => {
      const zero = history.nextVersion([]);
      const one = history.nextVersion([first]);
      return {
        ok: zero === inv.F09_EXPECTED.firstVersion
          && one === inv.F09_EXPECTED.secondVersion
          && first.version === inv.F09_EXPECTED.firstVersion
          && second.version === inv.F09_EXPECTED.secondVersion,
        actual: `空列表=${zero}, 已有 v_1=${one}, 首版=${first.version}, 次版=${second.version}`,
        evidence: [`快照 id: ${first.id} / ${second.id}`],
      };
    },
  ));

  items.push(await safeItem(
    'F09-02',
    'localStorage 写入 / 读取往返一致',
    'parser',
    '内存存储适配器写入两份快照后读回，内容与原对象完全一致',
    async () => {
      const storage = history.createMemoryStorage();
      history.saveSnapshot(storage, first);
      history.saveSnapshot(storage, second);
      const loaded = history.listSnapshots(storage);
      const same = loaded.length === 2
        && JSON.stringify(loaded[0]) === JSON.stringify(first)
        && JSON.stringify(loaded[1]) === JSON.stringify(second);
      return {
        ok: same && history.STORAGE_KEY === inv.F09_EXPECTED.storageKey,
        actual: `读回条目=${loaded.length}, 往返一致=${same}, 存储键=${history.STORAGE_KEY}`,
        evidence: [`版本序列=${loaded.map((entry) => entry.version).join(',')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F09-03',
    'restore(snapshot) 重新生成的文件树 hash == manifestSummary.hash（纯文本哈希）',
    'invariant',
    '从快照重建后 hashTextFiles 结果等于摘要哈希，且不执行任何生成产物',
    async () => {
      const rebuilt = history.restore(first);
      const rebuiltHash = generator.hashTextFiles(rebuilt.files);
      return {
        ok: rebuiltHash === first.manifestSummary.hash
          && rebuilt.files.length === first.manifestSummary.fileCount
          && history.verifySnapshot(first),
        actual: `重建哈希=${rebuiltHash}, 摘要哈希=${first.manifestSummary.hash}, 文件数=${rebuilt.files.length}/${first.manifestSummary.fileCount}`,
        evidence: [`确定性重建路径数=${rebuilt.files.length}`],
      };
    },
  ));

  items.push(await safeItem(
    'F09-04',
    '历史条目名称自动生成（短名 + 版本 + 时间），面板支持查看 / 重新下载 / 删除',
    'invariant',
    'note 含短名、版本与时间；ui.tsx 含三个 data-action 入口且无手填命名控件',
    async () => {
      const short = history.shortTitle(rawTitle);
      const label = history.formatSnapshotLabel(rawTitle, first.version, createdAt);
      const autoNamed = first.note.includes(short)
        && first.note.includes(first.version)
        && first.note.includes(createdAt)
        && first.note.includes(label);
      const actions = ['view', 'redownload', 'delete']
        .filter((action) => uiSource.includes(`data-action="${action}"`));
      const noNameInput = !/name="(name|title|snapshotName)"/.test(uiSource);
      return {
        ok: autoNamed && actions.length === 3 && noNameInput,
        actual: `自动命名=${autoNamed}, 面板入口=${actions.join(',')}, 无手填命名控件=${noNameInput}`,
        evidence: [`note=${first.note}`, `短名=${short}`],
      };
    },
  ));

  items.push(await safeItem(
    'F09-05',
    'rawInput.title 原样出现在快照 note 中（独立锚点 A）',
    'rawInput',
    'note 含未经规范化的原始题目字符串，且 config.rawInput.title 未被改写',
    async () => ({
      ok: first.note.includes(rawTitle)
        && first.config.rawInput.title === rawTitle
        && first.config.title !== rawTitle,
      actual: `原样出现=${first.note.includes(rawTitle)}, 锚点未改写=${first.config.rawInput.title === rawTitle}, 规范化题目不同=${first.config.title !== rawTitle}`,
      evidence: [`原始题目="${rawTitle}"`, `规范化题目="${first.config.title}"`],
    }),
  ));

  items.push(makeItem(
    'F09-06',
    '构建 + 全量回归通过（工程侧机器证据）',
    'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS + 本点测试齐备',
    baseline.ok ? '全部条件成立' : '存在未成立条件',
    baseline.ok ? 'PASS' : 'FAIL',
    baseline.evidence,
  ));

  return items;
}

/** 九项全量回归收口：产出 checks/CHK-FINAL.json。 */
async function writeFinalRegression() {
  const project = await importTs('src/project.ts');
  const featuresModule = await importTs('src/features.ts');
  const generator = await importTs('src/generate.ts');
  const stacks = await importTs('src/stacks/index.ts');
  const javaMod = await importTs('src/stacks/java.ts');
  const zipModule = await importTs('src/zip.ts');
  const history = await importTs('src/history.ts');
  const inv = await importTs('tests/invariants.ts');
  const title = inv.F06_EXPECTED.sampleTitle;
  const config = project.normalize({ title }).config;
  const features = featuresModule.recommendFeatures(title).features;
  const result = generator.generate({ config, features });
  const pythonResult = generator.generate({
    config: project.normalize({ title, stackChoice: 'python' }).config,
    features,
  });
  const readme = generator.findFile(result.files, 'README.md') ?? '';
  const schema = generator.findFile(result.files, 'sql/schema.sql') ?? '';
  const seed = generator.findFile(result.files, 'sql/seed.sql') ?? '';
  const manifest = generator.findFile(result.files, 'MANIFEST.md') ?? '';
  const items = [];

  items.push(await safeItem('R-01', '工程侧构建 / 类型 / lint', 'parser',
    'build/lint 成功戳 + dist 哈希一致 + 前序记录全 PASS',
    async () => {
      const base = engineeringBaseline('F10', [
        'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09',
      ]);
      return { ok: base.ok, actual: base.ok ? '全部条件成立' : '存在未成立条件', evidence: base.evidence };
    }));

  items.push(await safeItem('R-02', '固有属性断言集（期望值外置）', 'invariant',
    'invariants.ts 零 import、无派生配置 / 生成器引用、字面常量齐备',
    async () => {
      const source = readText('tests/invariants.ts');
      const forbidden = EXPECTED.forbiddenInvariantTokens.filter((token) => source.includes(token));
      const noImports = !/\bimport\s|\brequire\s*\(/.test(source);
      const literals = source.includes(EXPECTED.expectedScriptsLiteral)
        && EXPECTED.invariantRequiredTokens.every((token) => source.includes(token));
      return {
        ok: forbidden.length === 0 && noImports && literals,
        actual: `禁止引用=${forbidden.join(',') || '无'}, 零 import=${noImports}, 字面常量=${literals}`,
        evidence: [`扫描字符数=${source.length}`],
      };
    }));

  items.push(await safeItem('R-03', '独立锚点 A：rawInput 原样出现', 'rawInput',
    '快照 note 与技术文档均含未经规范化的原始题目',
    async () => {
      const snapshot = history.buildSnapshot(config, features, result.files, [], '2026-11-10T00:00:00.000Z');
      const tech = generator.findFile(result.files, 'docs/技术文档.md') ?? '';
      return {
        ok: snapshot.note.includes(config.rawInput.title) && tech.includes(config.rawInput.title),
        actual: `note 含原文=${snapshot.note.includes(config.rawInput.title)}, 技术文档含原文=${tech.includes(config.rawInput.title)}`,
        evidence: [`rawInput.title="${config.rawInput.title}"`],
      };
    }));

  items.push(await safeItem('R-04', '独立锚点 B：五类通用解析器', 'parser',
    'JSON.parse / XML 标签配对 / SQL 词法 / TS 语法解析 / JSZip 解包 全部通过',
    async () => {
      const jsonOk = safeJson('package.json').ok && safeJson('package-lock.json').ok;
      const xmlOk = xmlTagsBalanced(generator.findFile(result.files, 'backend/pom.xml') ?? '');
      const sqlOk = sqlLex(schema).ok && sqlLex(seed).ok;
      const tsFiles = result.files.filter((file) => /\.(ts|tsx)$/.test(file.path));
      const tsOk = tsFiles.length > 0
        && tsFiles.every((file) => tsSyntaxDiagnostics(file.content, file.path).length === 0);
      const buffer = await zipModule.buildZipBuffer(result.files);
      const zip = await JSZip.loadAsync(buffer);
      const zipCount = Object.keys(zip.files).filter((name) => !zip.files[name].dir).length;
      const zipOk = zipCount === result.files.length;
      return {
        ok: jsonOk && xmlOk && sqlOk && tsOk && zipOk,
        actual: `JSON=${jsonOk}, XML=${xmlOk}, SQL=${sqlOk}, TS=${tsOk}, ZIP=${zipOk}`,
        evidence: [`TS/TSX 文件=${tsFiles.length}`, `ZIP 条目=${zipCount}/${result.files.length}`],
      };
    }));

  items.push(await safeItem('R-05', '确定性与同源一致性', 'invariant',
    '两次生成全等；README 版本取自 config；seed / 表单 / 认证字段一致',
    async () => {
      const twice = JSON.stringify(generator.generate({ config, features }).files)
        === JSON.stringify(result.files);
      const versionsOk = Object.values(config.versions).every((value) => readme.includes(value));
      const form = generator.findFile(result.files, 'frontend/src/LoginForm.tsx') ?? '';
      const accountOk = seed.includes(config.auth.demoAccount.username)
        && seed.includes(config.auth.passwordField)
        && config.auth.loginFormFields.every((field) => form.includes(`name="${field}"`));
      return {
        ok: twice && versionsOk && accountOk,
        actual: `两次全等=${twice}, 版本同源=${versionsOk}, 账号字段同源=${accountOk}`,
        evidence: [`版本清单=${Object.values(config.versions).join(' / ')}`],
      };
    }));

  items.push(await safeItem('R-06', '双栈覆盖与可扩展', 'parser',
    'java / python 后端文件不同；注册第三栈后可直接查表',
    async () => {
      const javaPaths = result.files.filter((file) => file.path.startsWith('backend/'))
        .map((file) => file.path);
      const pythonPaths = pythonResult.files.filter((file) => file.path.startsWith('backend/'))
        .map((file) => file.path);
      const different = JSON.stringify(javaPaths) !== JSON.stringify(pythonPaths);
      const registry = stacks.createStackRegistry();
      const before = registry.size();
      registry.register({ ...javaMod.javaTemplate, stackId: 'newstack' });
      const extended = registry.size() === before + 1
        && registry.get('newstack')?.stackId === 'newstack';
      return {
        ok: different && extended,
        actual: `双栈不同=${different}, 第三栈可扩展=${extended}`,
        evidence: [`注册表 ${before}→${registry.size()}`],
      };
    }));

  items.push(await safeItem('R-07', '交付物完整性与 A12 / A11 规则', 'invariant',
    'MANIFEST 覆盖全部产物、A12 标待做且无产物、A11 勾选才生成',
    async () => {
      const declared = [...manifest.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]);
      const coverage = result.files.every((file) => declared.includes(file.path));
      const a12 = manifest.includes(inv.F08_EXPECTED.a12Note)
        && !result.files.some((file) => /\.(jar|exe)$|Dockerfile/.test(file.path));
      const off = generator.generate({
        config: project.normalize({
          title,
          a11Docs: { opening: false, midterm: false, defense: false },
        }).config,
        features,
      });
      const on = generator.generate({
        config: project.normalize({
          title,
          a11Docs: { opening: true, midterm: true, defense: true },
        }).config,
        features,
      });
      const a11Ok = off.files.every((file) => !inv.F08_EXPECTED.a11Paths.includes(file.path))
        && inv.F08_EXPECTED.a11Paths.every(
          (path) => on.files.some((file) => file.path === path),
        );
      return {
        ok: coverage && a12 && a11Ok,
        actual: `清单覆盖=${coverage}, A12待做=${a12}, A11按勾选=${a11Ok}`,
        evidence: [`清单条目=${declared.length}`, `实际文件=${result.files.length}`],
      };
    }));

  items.push(await safeItem('R-08', '注释与讲解锚点', 'invariant',
    '每个源码文件的做什么 / 为什么计数覆盖结构标记；锚点 file 与 symbol 均存在',
    async () => {
      const sources = result.files.filter((file) => /\.(java|py|ts|tsx)$/.test(file.path));
      const commentOk = sources.length > 0 && sources.every((file) => {
        const markers = Math.max(countStructureMarkers(file.content), 1);
        return inv.F07_EXPECTED.commentKeywords.every(
          (keyword) => (file.content.match(new RegExp(keyword, 'g')) ?? []).length >= markers,
        );
      });
      const anchorOk = result.explainerAnchors.length > 0
        && result.explainerAnchors.every((anchor) => {
          const target = generator.findFile(result.files, anchor.file);
          return target !== undefined && target.includes(anchor.symbol);
        });
      return {
        ok: commentOk && anchorOk,
        actual: `中文注释覆盖=${commentOk}, 锚点有效=${anchorOk}`,
        evidence: [`源码文件=${sources.length}`, `锚点=${result.explainerAnchors.map((a) => `${a.file}#${a.symbol}`).join(', ')}`],
      };
    }));

  items.push(await safeItem('R-09', '提交证据完整性、边界声明、静态能力面与无 push', 'invariant',
    '十份 AcceptanceRecord 全 PASS；README 含边界声明原句；判据入口静态能力面审计通过且不含 push 动作',
    async () => {
      const records = safeJson('checks/records.json');
      const allRecords = Array.isArray(records.value)
        && records.value.length === inv.F10_EXPECTED.totalRecords
        && records.value.every((entry) => entry.verdict === 'PASS'
          && entry.declaredChecks === entry.evaluatedChecks
          && entry.unknownCount === 0);
      const boundary = readText('README.md').includes(inv.F08_EXPECTED.boundaryStatement);
      // 静态能力面约束：AST 级 import 白名单、禁用词元、动态 import 参数静态可解析；
      // 另以拼接词元确认判据入口不含 push 动作（避免自命中）。
      const selfSource = readText('scripts/check.mjs');
      const capability = await importTs('tests/capability.ts');
      const capabilityOk = capability.auditCapability(selfSource, ALLOWED_IMPORTS).ok;
      const noPush = !selfSource.includes('git' + ' push');
      return {
        ok: allRecords && boundary && capabilityOk && noPush,
        actual: `十份记录全 PASS=${allRecords}, 边界声明=${boundary}, 静态能力面通过=${capabilityOk}, 判据入口无 push=${noPush}`,
        evidence: [
          `台账条目数=${Array.isArray(records.value) ? records.value.length : 0}`,
          '口径：静态能力面约束，非「不可能发起命令」的绝对声明',
        ],
      };
    }));

  const declaredChecks = items.length;
  const evaluatedChecks = items.filter(
    (item) => item.verdict === 'PASS' || item.verdict === 'FAIL',
  ).length;
  const unknownCount = items.filter((item) => item.verdict === 'UNKNOWN').length;
  const allPass = items.every((item) => item.verdict === 'PASS');
  const ok = allPass && declaredChecks === inv.F10_EXPECTED.regressionItems
    && declaredChecks === evaluatedChecks && unknownCount === 0;
  const verdict = ok ? 'PASS' : 'BLOCKED';
  const recordPath = join(CHECKS_DIR, 'CHK-FINAL.json');
  const record = {
    checkId: 'CHK-FINAL',
    feature: 'FINAL',
    items,
    declaredChecks,
    evaluatedChecks,
    unknownCount,
    evidence: [
      { path: 'checks/records.json', sha256: hashBuffer(readFileSync(RECORDS_PATH)) },
      { path: 'README.md', sha256: hashBuffer(readFileSync(absPath('README.md'))) },
      { path: 'src/generate.ts', sha256: hashBuffer(readFileSync(absPath('src/generate.ts'))) },
    ],
    verdict,
    createdAt: '',
  };
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
  console.log(`[check] CHK-FINAL 九项收口: ${items.map((item) => `${item.id}=${item.verdict}`).join(' ')}`);
  console.log(`[check] CHK-FINAL verdict=${verdict}`);
  return {
    ok,
    problems: items.filter((item) => item.verdict !== 'PASS')
      .map((item) => `${item.id}: ${item.actual}`),
  };
}

/** F10：ZIP 导出与全链路联调的六条判据。 */
async function f10Items() {
  const items = [];
  const project = await importTs('src/project.ts');
  const featuresModule = await importTs('src/features.ts');
  const generator = await importTs('src/generate.ts');
  const zipModule = await importTs('src/zip.ts');
  const history = await importTs('src/history.ts');
  const inv = await importTs('tests/invariants.ts');
  const baseline = engineeringBaseline('F10', [
    'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09',
  ]);
  const title = inv.F06_EXPECTED.sampleTitle;
  const config = project.normalize({ title }).config;
  const features = featuresModule.recommendFeatures(title).features;
  const result = generator.generate({ config, features });

  items.push(await safeItem(
    'F10-01',
    'JSZip 解包后文件树与 generate() 一致、条目集合 == MANIFEST、每条目非空、无路径穿越',
    'parser',
    '压缩包条目集合 = 文件树 = 清单声明集合；内容非空；路径均安全',
    async () => {
      const buffer = await zipModule.buildZipBuffer(result.files);
      const zip = await JSZip.loadAsync(buffer);
      const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
      const actualPaths = result.files.map((file) => file.path).sort();
      const manifest = generator.findFile(result.files, 'MANIFEST.md') ?? '';
      const declared = [...manifest.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]).sort();
      let nonEmpty = true;
      for (const name of names) {
        const content = await zip.files[name].async('string');
        if (content.length === 0) {
          nonEmpty = false;
        }
      }
      const safe = names.every((name) => zipModule.isSafeDeliverablePath(name));
      return {
        ok: JSON.stringify(names) === JSON.stringify(actualPaths)
          && JSON.stringify(names) === JSON.stringify(declared)
          && nonEmpty && safe && names.length > 0,
        actual: `ZIP条目=${names.length}, 文件树=${actualPaths.length}, 清单=${declared.length}, 非空=${nonEmpty}, 路径安全=${safe}`,
        evidence: [`前五个条目: ${names.slice(0, 5).join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F10-02',
    'npm test 全绿 + npm run build + npm run lint 退出码 0',
    'parser',
    '工程侧机器证据：成功戳、dist 哈希一致、九个前序功能点全 PASS、测试文件齐备',
    async () => ({
      ok: baseline.ok,
      actual: baseline.ok ? '全部条件成立' : '存在未成立条件',
      evidence: baseline.evidence,
    }),
  ));

  items.push(await safeItem(
    'F10-03',
    '本系统 README 每条命令 ∈ scripts ∪ {npm ci}，声明 Node 版本 == engines.node',
    'parser',
    '命令白名单无违规；README 精确包含 engines.node 值并如实注明未在 20 LTS 实跑',
    async () => {
      const readmeText = readText('README.md');
      const commands = extractReadmeCommands(readmeText);
      const pkg = safeJson('package.json').value;
      const scripts = pkg?.scripts ?? {};
      const allowed = new Set([...Object.keys(scripts), 'ci']);
      const classified = commands.map(classifyCommand);
      const bad = classified.filter((entry) => !entry.ok || !allowed.has(entry.script));
      const engine = pkg?.engines?.node ?? '';
      const declared = readmeText.includes(`\`${engine}\``);
      const honest = readmeText.includes('未在 Node 20 LTS 上实跑验证')
        && readmeText.includes('已在 Node v22.22.2');
      const noInstall = !commands.some((command) => command.trim() === 'npm install');
      return {
        ok: bad.length === 0 && declared && honest && noInstall && engine.length > 0,
        actual: `命令数=${commands.length}, 违规=${bad.map((entry) => entry.raw).join(' | ') || '无'}, engines.node=${engine}, 声明一致=${declared}, 如实注明=${honest}, 无 npm install=${noInstall}`,
        evidence: [`允许脚本集合=${[...allowed].join(',')}`, `命令清单=${commands.join(' | ')}`],
      };
    },
  ));

  items.push(await safeItem(
    'F10-04',
    '端到端 {title} → 生成 → 快照 → ZIP 全链路无异常且无人工把关步骤',
    'parser',
    '纯函数调用链全部成功；main / ui 源码禁用词计数为 0',
    async () => {
      const snapshot = history.buildSnapshot(config, features, result.files, [], '2026-11-10T00:00:00.000Z');
      const rebuilt = history.restore(snapshot);
      const buffer = await zipModule.buildZipBuffer(rebuilt.files);
      const zip = await JSZip.loadAsync(buffer);
      const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
      const forbidden = /confirm|review|approve|pending|确认|审核/gi;
      const sources = ['src/main.tsx', 'src/ui.tsx']
        .filter((rel) => exists(rel)).map((rel) => readText(rel));
      const hits = sources.reduce(
        (sum, text) => sum + (text.match(forbidden) ?? []).length, 0,
      );
      return {
        ok: entries.length === result.files.length && hits === 0
          && history.verifySnapshot(snapshot),
        actual: `链路 ZIP 条目=${entries.length}/${result.files.length}, 禁用词命中=${hits}, 快照可重建=${history.verifySnapshot(snapshot)}`,
        evidence: ['链路: normalize → recommendFeatures → generate → buildSnapshot → restore → buildZipBuffer → JSZip.loadAsync'],
      };
    },
  ));

  items.push(await safeItem(
    'F10-05',
    '全部 10 份 AcceptanceRecord 齐备且均为 PASS',
    'invariant',
    '九个前序记录全 PASS + 十个功能点判据位齐备 + 本次 F10 判据全 PASS（收口 R-09 复核十份）',
    async () => {
      const records = safeJson('checks/records.json');
      // 排除本点自身：上一次 BLOCKED 运行可能留下旧的 F10 记录，本轮会覆盖它；
      // R-09 在写入后再复核完整十份记录。
      const prior = Array.isArray(records.value)
        ? records.value.filter((entry) => entry && entry.feature !== 'F10')
        : [];
      const priorOk = prior.length === 9 && prior.every((entry) => entry.verdict === 'PASS'
        && entry.declaredChecks === entry.evaluatedChecks
        && entry.unknownCount === 0);
      const declaredFeatures = Object.keys(FEATURE_META).length + 1;
      return {
        ok: priorOk && declaredFeatures === inv.F10_EXPECTED.totalRecords,
        actual: `前序记录=${prior.length} 全PASS=${priorOk}, 功能点判据位=${declaredFeatures}/${inv.F10_EXPECTED.totalRecords}`,
        evidence: [`前序编号=${prior.map((entry) => entry.feature).join(',')}`],
      };
    },
  ));

  items.push(makeItem(
    'F10-06',
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
  F03: f03Items,
  F04: f04Items,
  F05: f05Items,
  F06: f06Items,
  F07: f07Items,
  F08: f08Items,
  F09: f09Items,
  F10: f10Items,
});

const argument = process.argv[2] ?? '';
if (argument.startsWith('--stamp=')) {
  runStamp(argument.slice('--stamp='.length));
} else if (argument === '--lint') {
  const ok = await runLint();
  if (ok) {
    runStamp('lint');
  }
  process.exitCode = ok ? 0 : 1;
} else if (argument === EXPECTED.feature) {
  runF01();
} else if (Object.prototype.hasOwnProperty.call(FEATURE_BUILDERS, argument)) {
  const items = await FEATURE_BUILDERS[argument]();
  await runFeature(argument, items);
} else {
  console.error(`[check] BLOCKED: 未知或未实现的判据目标 "${argument}"`);
  console.log('BLOCKED');
  process.exitCode = 1;
}
