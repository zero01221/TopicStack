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
  return values;
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

/** 确定性生成入口：目前输出技术文档，后续功能点在此增量追加交付物。 */
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
  const files: Deliverable[] = [buildTechDoc(ctx)];
  return {
    files,
    stackId: input.config.stackId,
    config: input.config,
    features: input.features,
    explainerAnchors: [],
  };
}
