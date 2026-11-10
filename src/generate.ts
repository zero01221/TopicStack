/**
 * 确定性生成器（F06 建立，F07 / F08 增量接入源码、SQL、README 与其余交付物）。
 *
 * 设计口径：本模块只做「模板 + 上下文 → 字符串文件映射」，是纯函数；
 * 不编译、不启动、不连接数据库、不执行任何生成产物，也不发起网络请求。
 * 同一输入连续两次 generate() 的输出必须完全相等。
 */
import type {
  Deliverable,
  ExplainerAnchor,
  FeaturePoint,
  ProjectConfig,
  StackTemplate,
} from './types';
import { getStack } from './stacks/index';

/** generate() 的输入：完整配置 + 功能点集合。 */
export interface GenerateInput {
  readonly config: ProjectConfig;
  readonly features: readonly FeaturePoint[];
}

/** 渲染上下文：单一数据源 + 已解析的技术栈模板 + 占位符取值表。 */
export interface GenerateContext {
  readonly config: ProjectConfig;
  readonly features: readonly FeaturePoint[];
  readonly template: StackTemplate;
  readonly values: Readonly<Record<string, string>>;
}

/** 生成结果：虚拟文件树 + 上下文摘要 + 讲解锚点。 */
export interface GenerateResult {
  readonly files: readonly Deliverable[];
  readonly stackId: string;
  readonly config: ProjectConfig;
  readonly features: readonly FeaturePoint[];
  readonly explainerAnchors: readonly ExplainerAnchor[];
}

/** 占位符形态：{{字母数字点}}，渲染后不允许残留。 */
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_.]+)\}\}/g;

/**
 * 结构性占位符取值：与项目基准版本无关的固定文本。
 * 所有「版本类」取值一律来自 ctx.config.versions，不在此硬编码。
 */
const STRUCTURAL_VALUES: Readonly<Record<string, string>> = {
  'project.groupId': 'com.example.thesis',
  'project.artifactId': 'thesis-app',
  'project.version': '1.0.0',
  'project.entryClass': 'ThesisApplication',
  'project.controllerClass': 'DemoController',
  'project.serviceClass': 'DemoService',
  'project.mapperClass': 'DemoMapper',
  'project.database': 'thesis_db',
  'project.port': '8080',
  'deps.mavenModelVersion': '4.0.0',
  'deps.frontendDevCommand': 'vite',
  'deps.startupBody': 'startServer();',
  'deps.controllerBody': 'return handleRequest();',
  'deps.serviceBody': 'return applyRules();',
  'deps.mapperBody': 'Row queryByKey(String key);',
  'deps.uvicorn': '0.27.0',
  'deps.mysqlDriver': '8.3.0',
  'deps.pydantic': '2.6.0',
  'deps.appFactory': 'createApp()',
  'deps.routerBody': 'router = buildRouter()',
  'deps.repositoryBody': 'repository = buildRepository()',
};

/**
 * 渲染引擎：把模板中的占位符替换为 ctx 派生值。
 * 遇未知键或渲染后仍残留起始符时直接抛错，绝不静默产出半成品。
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
  source: string,
): string {
  const missing: string[] = [];
  const rendered = template.replace(PLACEHOLDER_PATTERN, (whole: string, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      missing.push(key);
      return whole;
    }
    return values[key];
  });
  if (missing.length > 0) {
    throw new Error(
      `[渲染引擎] ${source} 存在未替换占位符: ${[...new Set(missing)].join(', ')}`,
    );
  }
  if (rendered.includes('{{')) {
    throw new Error(`[渲染引擎] ${source} 渲染后仍残留占位符起始符`);
  }
  return rendered;
}

/** 构造单个交付物；派生来源字段统一指向 ProjectConfig 路径。 */
export function makeDeliverable(
  path: string,
  content: string,
  kind: Deliverable['kind'],
  derivedFrom: readonly string[],
  note = '',
): Deliverable {
  return { path, content, kind, derivedFrom, required: true, status: 'generated', note };
}

/**
 * 纯文本哈希（FNV-1a，按路径排序）：供快照确定性重建使用。
 * 只哈希字符串，不执行任何生成代码。
 */
export function hashTextFiles(files: readonly Deliverable[]): string {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const encoder = new TextEncoder();
  let hash = 0x811c9dc5;
  for (const file of ordered) {
    const bytes = encoder.encode(`${file.path}\0${file.content}\0`);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}

/** 从虚拟文件树中按路径取内容；不存在返回 undefined 由调用方明确处理。 */
export function findFile(
  files: readonly Deliverable[],
  path: string,
): string | undefined {
  return files.find((file) => file.path === path)?.content;
}

/** 构造占位符取值表：版本一律取自 ProjectConfig，结构值取自固定表。 */
export function buildValues(
  config: ProjectConfig,
  template: StackTemplate,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = { ...STRUCTURAL_VALUES };
  for (const [key, value] of Object.entries(config.versions)) {
    values[`versions.${key}`] = value;
  }
  values['project.title'] = config.title;
  values['project.rawTitle'] = config.rawInput.title;
  values['project.stackId'] = config.stackId;
  values['project.stackLabel'] = template.label;
  values['auth.username'] = config.auth.demoAccount.username;
  values['auth.password'] = config.auth.demoAccount.password;
  values['auth.role'] = config.auth.demoAccount.role;
  values['auth.loginApi'] = config.auth.loginApi;
  values['auth.passwordField'] = config.auth.passwordField;
  values['auth.roleField'] = config.auth.roleField;
  // 依赖锁定用的纯数字短版本从同一个版本标签派生，避免另写字面量造成漂移。
  values['deps.frameworkPin'] = extractVersionPin(config.versions.framework);
  values['deps.dbPin'] = extractVersionPin(config.versions.db);
  return values;
}

/** 从人类可读的版本标签中抽取数字短版本，用于依赖锁定行。 */
export function extractVersionPin(label: string): string {
  const matched = label.match(/\d+(?:\.\d+)*/);
  return matched ? matched[0] : '0';
}

/** 技术文档：技术栈分析 + 开发流程 + 目录结构 + 环境说明。 */
export function buildTechDoc(ctx: GenerateContext): Deliverable {
  const { config, template, values, features } = ctx;
  const versionRows = Object.entries(config.versions)
    .map(([key, value]) => `| ${key} | ${value} | 由 ProjectConfig.versions.${key} 派生 |`)
    .join('\n');
  const dirRows = template.dirTree.entries.map((entry) => `- \`${entry}\``).join('\n');
  const featureRows = features.length > 0
    ? features.map((feature) => `- ${feature.id} ${feature.title}（${feature.module}）`).join('\n')
    : '- 尚未提供功能点，后续可在功能点分析阶段补充';

  const content = [
    '# 技术文档',
    '',
    `> 题目：${config.title}`,
    `> 原始输入锚点：${config.rawInput.title}`,
    `> 技术栈：${template.label}（${config.stackId}）`,
    '',
    '## 技术栈分析',
    '',
    `本毕设采用 **${template.label}**，目录与依赖配置由栈模板表按 \`${config.stackId}\` 查表得到。`,
    '版本清单全部来自同一个 ProjectConfig，README、构建配置、SQL 与源码引用同一份取值。',
    '',
    '| 版本项 | 基准版本 | 来源 |',
    '| --- | --- | --- |',
    versionRows,
    '',
    '## 开发流程',
    '',
    '1. 输入毕设题目与可选约束，系统自动规范化为完整配置。',
    '2. 关键词推荐功能点，按编号去重并补全验收条件。',
    '3. 按技术栈模板表渲染源码、注释、讲解材料与文档。',
    '4. 由同一份数据模型派生 schema、seed、认证字段与前端表单。',
    '5. 汇总交付物清单与环境自检文本，打包为 ZIP 交付。',
    '',
    '### 功能点清单',
    '',
    featureRows,
    '',
    '## 目录结构',
    '',
    dirRows,
    '',
    '## 环境说明',
    '',
    `- 建议操作系统：${config.envBaseline.os}`,
    `- 语言运行时：${values['versions.language']}`,
    `- 后端框架：${values['versions.framework']}`,
    `- 数据库：${values['versions.db']}`,
    `- 前端与 Node：${values['versions.frontend']} / ${values['versions.node']}`,
    '- 本系统不验证你的本机环境；按基准环境准备即可按上述步骤运行。',
    '',
  ].join('\n');
  return makeDeliverable('docs/技术文档.md', content, 'doc', [
    'ProjectConfig.title', 'ProjectConfig.versions', 'ProjectConfig.stackId',
  ]);
}

/* ────────────────────── F07：源码、中文注释与讲解材料 ────────────────────── */

/** 后端源码骨架：类 / 公开方法 / 条件分支三处都带「做什么 + 为什么」中文注释。 */
const JAVA_SOURCE_TEMPLATE = `/**
 * 做什么：{{symbol.summary}}
 * 为什么：{{symbol.why}}
 * 文件：{{file.path}}
 */
package {{project.groupId}};

public class {{symbol.name}} {

    /**
     * 做什么：执行 {{symbol.method}} 并把输入规范化为统一结果
     * 为什么：公开方法是对外调用边界，必须写清输入约束与失败语义
     */
    public String {{symbol.method}}(String input) {
        // 做什么：先拦截非法输入；为什么：避免异常穿透到数据层并产生半成品结果
        if (input == null || input.isEmpty()) {
            return "非法输入";
        }
        // 做什么：返回规范化结果；为什么：保持与上层约定一致，便于讲解与排查
        return "{{symbol.name}}:" + input;
    }
}
`;

/** Python 后端源码骨架：同样在模块、函数与分支三处写明做什么与为什么。 */
const PYTHON_SOURCE_TEMPLATE = `# 做什么：{{symbol.summary}}
# 为什么：{{symbol.why}}
# 文件：{{file.path}}
MODULE_NAME = "{{symbol.name}}"


def {{symbol.method}}(value):
    """
    做什么：执行 {{symbol.method}} 并返回规范化结果
    为什么：对外函数是调用边界，必须写清输入约束与失败语义
    """
    # 做什么：先拦截非法输入；为什么：避免异常穿透到数据层并产生半成品结果
    if value is None or value == "":
        return "非法输入"
    # 做什么：返回规范化结果；为什么：保持与上层约定一致，便于讲解与排查
    return MODULE_NAME + ":" + value
`;

/** 第三套及后续技术栈的通用源码骨架：无需改动本生成器即可产出可讲解源码。 */
const GENERIC_SOURCE_TEMPLATE = `/**
 * 做什么：{{symbol.summary}}
 * 为什么：{{symbol.why}}
 * 文件：{{file.path}}
 */
function {{symbol.method}}(input) {
    // 做什么：拦截非法输入；为什么：避免异常穿透并产生半成品结果
    if (input === null || input === undefined) {
        return "非法输入";
    }
    // 做什么：返回规范化结果；为什么：保持与上层约定一致
    return "{{symbol.name}}:" + input;
}
`;

/** 源码模板查表：多栈 = 多行，未登记的技术栈自动使用通用骨架。 */
const SOURCE_TEMPLATES: Readonly<Record<string, string>> = {
  java: JAVA_SOURCE_TEMPLATE,
  python: PYTHON_SOURCE_TEMPLATE,
};

/** 前端共用 TS / TSX 模板：字段名与后端认证、seed、README 同源。 */
const FRONTEND_FILES: readonly { readonly path: string; readonly template: string }[] = [
  {
    path: 'frontend/index.html',
    template: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>{{project.title}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  },
  {
    path: 'frontend/src/main.tsx',
    template: `/**
 * 做什么：挂载前端应用入口
 * 为什么：把渲染起点收敛到单一文件，便于讲解调用链
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoginForm } from './LoginForm';

/** 做什么：组合页面；为什么：保持入口职责单一 */
export function App(): JSX.Element {
  return <LoginForm />;
}

// 做什么：取得根容器；为什么：容器缺失时明确报错，不静默白屏
const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少根容器');
}
createRoot(container).render(<App />);
`,
  },
  {
    path: 'frontend/src/api.ts',
    template: `/**
 * 做什么：统一封装登录请求
 * 为什么：请求字段名必须与后端认证字段、seed 账号、登录表单保持一致
 */
export interface LoginPayload {
  username: string;
  password: string;
}

/** 做什么：发起登录请求；为什么：传输层与业务层解耦 */
export async function login(payload: LoginPayload): Promise<string> {
  // 做什么：调用认证接口；为什么：接口路径由 ProjectConfig.auth 派生
  const response = await fetch('{{auth.loginApi}}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.text();
}
`,
  },
  {
    path: 'frontend/src/LoginForm.tsx',
    template: `/**
 * 做什么：渲染登录表单并收集用户名与口令
 * 为什么：表单字段名必须与后端认证字段、seed 账号字段保持静态一致
 */
import React, { useState } from 'react';

export function LoginForm(): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form action="{{auth.loginApi}}" method="post">
      <label>
        用户名
        <input name="username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label>
        密码
        <input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit">登录</button>
    </form>
  );
}
`,
  },
];

/** 生成前端文件：包配置由 JSON.stringify 产出，其余由模板渲染。 */
export function buildFrontendFiles(ctx: GenerateContext): readonly Deliverable[] {
  const { values } = ctx;
  const packageJson = JSON.stringify({
    name: values['project.artifactId'],
    private: true,
    scripts: { dev: values['deps.frontendDevCommand'] },
    dependencies: { react: values['versions.frontend'] },
  }, null, 2);
  const files: Deliverable[] = [
    makeDeliverable('frontend/package.json', `${packageJson}\n`, 'config', [
      'ProjectConfig.versions', 'StackTemplate.frontendCommon',
    ]),
  ];
  for (const entry of FRONTEND_FILES) {
    files.push(makeDeliverable(
      entry.path,
      renderTemplate(entry.template, values, entry.path),
      'source',
      ['ProjectConfig.auth', 'ProjectConfig.title', 'StackTemplate.frontendCommon'],
    ));
  }
  return files;
}

/** 由栈模板的分层元数据派生源码符号，避免把技术栈判断散落各处。 */
export function buildBackendFiles(ctx: GenerateContext): readonly Deliverable[] {
  const { template, values } = ctx;
  const depsPath = `backend/${template.depsConfig.file}`;
  const files: Deliverable[] = [
    makeDeliverable(
      depsPath,
      renderTemplate(template.depsConfig.template, values, depsPath),
      'config',
      ['StackTemplate.depsConfig', 'ProjectConfig.versions'],
    ),
  ];

  const entryPath = template.backendFragments.entry;
  const baseDir = entryPath.slice(0, entryPath.lastIndexOf('/'));
  const extension = entryPath.split('.').pop() ?? 'txt';
  const sourceTemplate = SOURCE_TEMPLATES[template.stackId] ?? GENERIC_SOURCE_TEMPLATE;
  const descriptors = [
    {
      path: entryPath,
      name: values['project.entryClass'].replace(/[^A-Za-z0-9_]/g, ''),
      method: 'start',
      summary: '启动应用并装配各分层',
      why: '把初始化逻辑集中在入口，便于追踪调用链',
    },
    ...template.backendFragments.layers.map((layer) => ({
      path: `${baseDir}/${layer}/${capitalize(layer)}.${extension}`,
      name: capitalize(layer),
      method: 'handle',
      summary: `承担 ${layer} 分层的职责`,
      why: '分层隔离后，核心逻辑集中且便于中文注释与讲解',
    })),
  ];

  for (const descriptor of descriptors) {
    const fileValues: Record<string, string> = {
      ...values,
      'symbol.name': descriptor.name || 'Module',
      'symbol.method': descriptor.method,
      'symbol.summary': descriptor.summary,
      'symbol.why': descriptor.why,
      'file.path': descriptor.path,
    };
    files.push(makeDeliverable(
      descriptor.path,
      renderTemplate(sourceTemplate, fileValues, descriptor.path),
      'source',
      ['StackTemplate.backendFragments', 'ProjectConfig.versions'],
    ));
  }
  return files;
}

/** 首字母大写，供类名 / 文件名派生使用。 */
function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

/** 从真实文件树中挑选讲解锚点，保证 file 与 symbol 都指向同次输出。 */
export function buildExplainerAnchors(
  files: readonly Deliverable[],
): readonly ExplainerAnchor[] {
  const candidates: { readonly path: string; readonly symbol: string }[] = [
    { path: 'frontend/src/api.ts', symbol: 'login' },
    { path: 'frontend/src/LoginForm.tsx', symbol: 'username' },
    { path: 'docs/技术文档.md', symbol: '技术栈分析' },
  ];
  const anchors: ExplainerAnchor[] = [];
  const backend = files.find((file) => /\.(java|py|js)$/.test(file.path)
    && file.path.startsWith('backend/'));
  if (backend) {
    const symbol = ['handle', 'start'].find((name) => backend.content.includes(name));
    if (symbol) {
      candidates.push({ path: backend.path, symbol });
    }
  }
  for (const candidate of candidates) {
    const target = files.find((file) => file.path === candidate.path);
    if (!target || !target.content.includes(candidate.symbol)) {
      continue;
    }
    anchors.push({
      file: candidate.path,
      symbol: candidate.symbol,
      summary: `说明 ${candidate.path} 中 ${candidate.symbol} 的职责与调用关系`,
      why: '锚点只能指向同次真实输出的文件与符号，避免注释描述不存在的实现',
    });
  }
  return anchors;
}

/** 讲解材料：按模块说明职责、调用链、数据流、设计取舍与常见追问回答要点。 */
export function buildExplainerDoc(
  ctx: GenerateContext,
  anchors: readonly ExplainerAnchor[],
): Deliverable {
  const lines: string[] = [
    '# 核心逻辑讲解材料',
    '',
    '> 本材料只指向真实文件与真实符号；不含自测题、不设人工讲解关卡。',
    `> 技术栈：${ctx.template.label}（${ctx.config.stackId}）`,
    '',
    '## 模块职责与调用链',
    '',
    '### 前端表单与接口调用层',
    '',
    '- 职责：收集用户名与口令，统一封装认证请求。',
    '- 调用链：LoginForm → api.login → 后端认证接口 → 数据访问层。',
    '- 数据流：表单字段 → LoginPayload → JSON 请求体 → 后端 DTO → sys_user 表。',
    '',
    '### 后端分层',
    '',
    '- 职责：入口装配分层，控制层接收请求，业务层编排规则，数据层读写表。',
    '- 调用链：Application → controller.handle → service.handle → mapper.handle。',
    '- 数据流：请求参数 → 业务规则 → 实体字段 → schema.sql 中的列。',
    '',
    '### 数据模型与文档',
    '',
    '- 职责：同一份 ProjectConfig 派生 schema、seed、README 与前端表单字段。',
    '- 数据流：ProjectConfig.dataModel.entities → 表 / 列 / COMMENT → seed 账号。',
    '',
    '## 关键设计取舍',
    '',
    '- 版本、字段、账号只保留一份取值来源，避免 README 与构建配置互相漂移。',
    '- 注释与代码由同一模板一次产出，杜绝「注释描述不存在的实现」。',
    '- 生成失败即抛错阻断，不静默产出半成品。',
    '- 不编译、不启动、不连库：系统只产出文本与 ZIP，能否在本机运行由基准环境声明保证。',
    '',
    '## 常见追问与回答要点',
    '',
    '- 追问：版本号为什么没有写死在模板里？回答要点：模板只放占位符，取值全部来自 ProjectConfig.versions。',
    '- 追问：登录表单字段名如何与数据库对齐？回答要点：三者引用同一份 auth 配置，字段名静态一致。',
    '- 追问：为什么 SQL 回避窗口函数与 CTE？回答要点：为保证在所选 MySQL 各个基准版本都能导入。',
    '- 追问：讲解材料会不会引用不存在的符号？回答要点：锚点从同次输出的文件树中筛选并校验。',
    '',
    '## 锚点清单（文件 / 符号 / 职责）',
    '',
  ];
  for (const anchor of anchors) {
    lines.push(`- \`${anchor.file}\` → \`${anchor.symbol}\`：${anchor.summary}；${anchor.why}`);
  }
  lines.push('');
  return makeDeliverable('docs/讲解材料.md', lines.join('\n'), 'doc', [
    'StackTemplate.explainerAnchors', 'GenerateResult.files',
  ]);
}

/** 确定性生成入口：技术文档 + 前后端源码 + 中文注释 + 讲解材料。 */
export function generate(input: GenerateInput): GenerateResult {
  const template = getStack(input.config.stackId);
  if (!template) {
    throw new Error(`[生成器] 未注册的技术栈: ${input.config.stackId}`);
  }
  if (input.config.title.length === 0) {
    throw new Error('[生成器] 题目为空，拒绝生成半成品');
  }
  const ctx: GenerateContext = {
    config: input.config,
    features: input.features,
    template,
    values: buildValues(input.config, template),
  };
  const files: Deliverable[] = [
    buildTechDoc(ctx),
    ...buildFrontendFiles(ctx),
    ...buildBackendFiles(ctx),
  ];
  const explainerAnchors = buildExplainerAnchors(files);
  files.push(buildExplainerDoc(ctx, explainerAnchors));
  return {
    files,
    stackId: input.config.stackId,
    config: input.config,
    features: input.features,
    explainerAnchors,
  };
}
