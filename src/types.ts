/**
 * TopicStack 核心数据模型定义（F02 建立，后续功能点共用）。
 *
 * 设计要点：类型只描述结构，不承载任何具体题目、学校或固定版本；
 * 全部「建议默认值」集中在文件末尾的建议默认值表中，且都可被输入覆盖。
 */

// ─────────────────────────── 基础枚举与判定类型 ───────────────────────────

/** 技术栈标识；使用 string 以允许第三套及后续技术栈注册。 */
export type StackId = string;

/** 判定结论：UNKNOWN 一律按失败处理。 */
export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** 证据来源锚点：用户输入原文 / 通用标准解析器 / 固有属性断言。 */
export type CheckAnchor = 'rawInput' | 'parser' | 'invariant';

// ─────────────────────────── 配置单一数据源 ───────────────────────────

/**
 * 用户原始输入锚点：原样留存、永不规范化、永不改写。
 * 与其余派生字段物理隔离，用于断言原文在交付物中原样出现。
 */
export interface RawInput {
  readonly title: string;
  readonly constraintsText: string;
  readonly stackChoice: string;
  readonly versionInputs: Readonly<Record<string, string>>;
}

/** 学校 / 导师硬性约束；留空时使用建议默认约束集。 */
export interface Constraints {
  readonly school?: string;
  readonly advisor?: string;
  readonly hardRequirements: readonly string[];
  readonly notes?: string;
}

/** 基准版本组：五个字段全部可被输入覆盖。 */
export interface Versions {
  readonly language: string;
  readonly framework: string;
  readonly db: string;
  readonly frontend: string;
  readonly node: string;
}

/** 数据实体字段定义。 */
export interface EntityField {
  readonly name: string;
  readonly type: string;
  readonly comment: string;
  readonly primaryKey: boolean;
  readonly nullable: boolean;
}

/** 实体关系定义。 */
export interface EntityRelation {
  readonly from: string;
  readonly to: string;
  readonly kind: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/** 数据实体：表名、字段、关系与中文说明。 */
export interface Entity {
  readonly name: string;
  readonly comment: string;
  readonly fields: readonly EntityField[];
  readonly relations: readonly EntityRelation[];
}

/** 数据模型：schema / seed / DTO / 前端表单 / 讲解材料共用同一份实体数组。 */
export interface DataModel {
  readonly entities: readonly Entity[];
}

/** 默认演示账号：与 seed、后端认证、前端登录表单、README 同源。 */
export interface DemoAccount {
  readonly username: string;
  readonly password: string;
  readonly role: string;
}

/** 认证模型：口令算法、口令字段、角色字段、角色枚举、登录接口与表单字段。 */
export interface Auth {
  readonly passwordAlgo: string;
  readonly passwordField: string;
  readonly roleField: string;
  readonly roleEnum: readonly string[];
  readonly loginApi: string;
  readonly loginFormFields: readonly string[];
  readonly demoAccount: DemoAccount;
}

/** 目录树：README 目录段与交付物清单由它投影。 */
export interface DirTree {
  readonly root: string;
  readonly entries: readonly string[];
}

/** 注释策略：模板内自带「做什么 + 为什么」，不存在事后补写注释环节。 */
export interface CommentPolicy {
  readonly classHeader: string;
  readonly publicMethod: string;
  readonly branch: string;
  readonly requireWhatAndWhy: boolean;
}

/** 讲解锚点：只能指向同次真实输出的文件与符号。 */
export interface ExplainerAnchor {
  readonly file: string;
  readonly symbol: string;
  readonly summary: string;
  readonly why: string;
}

/** A11 可选文档框架：用户主动勾选才生成，事实字段留空。 */
export interface A11Docs {
  readonly opening: boolean;
  readonly midterm: boolean;
  readonly defense: boolean;
}

/** 环境只读检查项：期望值从 versions 的指定字段派生。 */
export interface EnvCheckItem {
  readonly name: string;
  readonly command: string;
  readonly expectedFrom: keyof Versions;
}

/** 环境基准：静态文本产物的数据源，不验证本机环境、不请用户回填。 */
export interface EnvBaseline {
  readonly os: string;
  readonly runtimeChecks: readonly { readonly name: string; readonly expected: string }[];
  readonly checkItems: readonly EnvCheckItem[];
  readonly localOnly: boolean;
}

/** 唯一配置源：所有交付物均从它派生。 */
export interface ProjectConfig {
  readonly rawInput: RawInput;
  readonly title: string;
  readonly constraints: Constraints;
  readonly stackId: string;
  readonly versions: Versions;
  readonly dataModel: DataModel;
  readonly auth: Auth;
  readonly dirTree: DirTree;
  readonly commentPolicy: CommentPolicy;
  readonly explainerAnchors: readonly ExplainerAnchor[];
  readonly a11Docs: A11Docs;
  readonly envBaseline: EnvBaseline;
}

/** 用户输入（全部可选，仅 title 必填）。 */
export interface ProjectInput {
  readonly title?: string;
  readonly constraintsText?: string;
  readonly stackChoice?: string;
  readonly versionInputs?: Readonly<Record<string, string>>;
  readonly school?: string;
  readonly advisor?: string;
  readonly hardRequirements?: readonly string[];
  readonly notes?: string;
  readonly a11Docs?: Partial<A11Docs>;
  readonly dataModel?: DataModel;
  readonly auth?: Partial<Auth>;
  readonly dirTree?: DirTree;
  readonly commentPolicy?: CommentPolicy;
  readonly explainerAnchors?: readonly ExplainerAnchor[];
}

/** 规范化结果：完整配置 + 本次自动采用的默认值字段路径清单。 */
export interface NormalizeResult {
  readonly config: ProjectConfig;
  readonly adoptedDefaults: readonly string[];
}

/** normalize 接受原始输入、规范化结果或完整配置，保证幂等。 */
export type NormalizeInput = ProjectInput | NormalizeResult | ProjectConfig;

// ─────────────────────────── 功能点与交付物 ───────────────────────────

export type FeaturePriority = 'high' | 'medium' | 'low';
export type FeatureSource = 'auto' | 'manual';

/** 功能点：编号、验收条件、所属模块、来源与依赖。 */
export interface FeaturePoint {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptance: readonly string[];
  readonly module: string;
  readonly priority: FeaturePriority;
  readonly source: FeatureSource;
  readonly dependsOn: readonly string[];
}

export type DeliverableKind = 'source' | 'sql' | 'doc' | 'config';
export type DeliverableStatus = 'generated' | 'skipped' | 'todo';

/** 单个交付物：内容、类型、派生来源、状态与备注。 */
export interface Deliverable {
  readonly path: string;
  readonly content: string;
  readonly kind: DeliverableKind;
  readonly derivedFrom: readonly string[];
  readonly required: boolean;
  readonly status: DeliverableStatus;
  readonly note: string;
}

/** 清单摘要：用于快照确定性重建的纯文本哈希。 */
export interface ManifestSummary {
  readonly fileCount: number;
  readonly paths: readonly string[];
  readonly hash: string;
}

/** 历史快照：版本自动命名，保存 config + features + 清单摘要。 */
export interface Snapshot {
  readonly id: string;
  readonly version: string;
  readonly createdAt: string;
  readonly config: ProjectConfig;
  readonly features: readonly FeaturePoint[];
  readonly stackId: string;
  readonly manifestSummary: ManifestSummary;
  readonly note: string;
}

// ─────────────────────────── 技术栈模板注册表 ───────────────────────────

/** 依赖配置：Java 为 pom.xml，Python 为 requirements.txt。 */
export interface DepsConfig {
  readonly file: string;
  readonly template: string;
  readonly lineFormat: string;
}

/** 前端共用模板：目录、文件清单与包配置模板。 */
export interface FrontendCommon {
  readonly root: string;
  readonly files: readonly string[];
  readonly packageTemplate: string;
}

/** 后端骨架片段：入口、分层与带中文注释的代码片段。 */
export interface BackendFragments {
  readonly entry: string;
  readonly layers: readonly string[];
  readonly snippets: Readonly<Record<string, string>>;
}

/** MySQL 各基准版本的能力开关。 */
export interface SqlCapabilities {
  readonly windowFunctions: boolean;
  readonly cte: boolean;
  readonly jsonTable: boolean;
  readonly checkConstraint: boolean;
}

/** SQL 方言：字段注释写法、禁用语法清单与按版本的能力表。 */
export interface SqlDialect {
  readonly commentClauseTemplate: string;
  readonly identifierQuote: string;
  readonly tableOptions: string;
  readonly disabledSyntaxes: readonly string[];
  readonly capabilityTable: Readonly<Record<string, SqlCapabilities>>;
  readonly selectedDbVersion: string;
}

/** README 逐步命令：命令与预期结果的骨架，不含任何版本号字面量。 */
export interface ReadmeBaselineCommand {
  readonly step: string;
  readonly command: string;
  readonly expected: string;
}

/** README 基准骨架：版本标签、命令表与边界声明。 */
export interface ReadmeBaseline {
  readonly versionLabels: readonly string[];
  readonly commands: readonly ReadmeBaselineCommand[];
  readonly boundaryStatement: string;
}

/** 技术栈模板表：多栈 = 多张表，与执行引擎无关。 */
export interface StackTemplate {
  readonly stackId: StackId;
  readonly label: string;
  readonly dirTree: DirTree;
  readonly depsConfig: DepsConfig;
  readonly frontendCommon: FrontendCommon;
  readonly backendFragments: BackendFragments;
  readonly sqlDialect: SqlDialect;
  readonly readmeBaseline: ReadmeBaseline;
  readonly envCheckItems: readonly EnvCheckItem[];
  readonly commentPolicy: CommentPolicy;
  readonly explainerAnchors: readonly ExplainerAnchor[];
  readonly suggestedVersions: Versions;
}

// ─────────────────────────── 判据与验收记录 ───────────────────────────

/** 单条判据：期望值外置，UNKNOWN 一律计 FAIL。 */
export interface InvariantCheck {
  readonly id: string;
  readonly expected: string;
  readonly actual: string;
  readonly verdict: Verdict;
  readonly anchor: CheckAnchor;
}

/** 验收记录中的判据项（在 InvariantCheck 基础上带判据描述与证据）。 */
export interface AcceptanceItem extends InvariantCheck {
  readonly criterion: string;
  readonly evidence: readonly string[];
}

/** 验收记录：全 PASS 且计数相等才允许 verdict=PASS。 */
export interface AcceptanceRecord {
  readonly checkId: string;
  readonly feature: string;
  readonly stack: string;
  readonly items: readonly AcceptanceItem[];
  readonly declaredChecks: number;
  readonly evaluatedChecks: number;
  readonly unknownCount: number;
  readonly evidence: readonly unknown[];
  readonly verdict: 'PASS' | 'BLOCKED';
  readonly createdAt: string;
}

// ─────────────────────────── 建议默认值表 ───────────────────────────

/**
 * 建议默认值表（唯一数据源）：全部字段可被 ProjectInput 覆盖，**不是固定版本**。
 * 版本与账号字符串集中在此；src/project.ts 与两张栈模板表只引用、不内联，
 * 便于静态扫描证明「规范化逻辑与模板表内无版本 / 账号字面量」。
 */
export const SUGGESTED_DEFAULTS = {
  stackId: 'java',
  versions: {
    language: 'JDK 17',
    framework: 'Spring Boot 3.2.x',
    db: 'MySQL 8.0',
    frontend: 'React 18 + Vite 5',
    node: 'Node 20 LTS',
  },
  supportedDbVersions: ['MySQL 5.7', 'MySQL 8.0'],
  constraints: {
    hardRequirements: [
      '核心逻辑带中文注释',
      'README 声明精确基准环境',
      '代码、注释、SQL 与文档同源派生',
    ],
  },
  auth: {
    passwordAlgo: 'SHA-256',
    passwordField: 'password_hash',
    roleField: 'role',
    roleEnum: ['ADMIN', 'TEACHER', 'STUDENT'],
    loginApi: '/api/auth/login',
    loginFormFields: ['username', 'password'],
    demoAccount: { username: 'admin', password: 'Admin@123', role: 'ADMIN' },
  },
  dirTree: {
    root: 'thesis-project',
    entries: ['README.md', 'MANIFEST.md', 'env-check.md', 'frontend/', 'backend/', 'sql/', 'docs/'],
  },
  commentPolicy: {
    classHeader: '说明本类职责与边界',
    publicMethod: '说明做什么与为什么这么做',
    branch: '说明判定条件与取舍',
    requireWhatAndWhy: true,
  },
  explainerAnchors: [
    { file: 'backend/', symbol: 'entry', summary: '后端入口与分层', why: '说明请求如何进入业务层' },
    { file: 'frontend/', symbol: 'api', summary: '前端接口调用层', why: '说明字段如何与后端对齐' },
    { file: 'sql/', symbol: 'schema', summary: '建表与字段注释', why: '说明数据模型如何落地' },
  ],
  a11Docs: { opening: false, midterm: false, defense: false },
  envBaseline: { os: 'Windows 10 / Windows 11', localOnly: true },
  dataModel: {
    entities: [
      {
        name: 'sys_user',
        comment: '系统用户表',
        fields: [
          { name: 'id', type: 'BIGINT', comment: '主键', primaryKey: true, nullable: false },
          { name: 'username', type: 'VARCHAR(64)', comment: '登录名', primaryKey: false, nullable: false },
          { name: 'password_hash', type: 'CHAR(64)', comment: '口令摘要', primaryKey: false, nullable: false },
          { name: 'role', type: 'VARCHAR(16)', comment: '角色枚举', primaryKey: false, nullable: false },
        ],
        relations: [],
      },
    ],
  },
  minRecommendedFeatures: 5,
  a12TodoNote: '待做（下次实现）',
};

/** 关键词 → 技术栈推荐提示表（F03 使用，未命中回退建议默认栈）。 */
export const STACK_KEYWORD_HINTS = [
  {
    keywords: ['Python', 'Flask', 'Django', 'FastAPI', '爬虫', '数据分析', '机器学习', '推荐算法'],
    stackId: 'python',
  },
  {
    keywords: ['Java', 'Spring', 'SSM', '管理系统', '商城', '订单', '预约'],
    stackId: 'java',
  },
] as const;

/** 环境只读检查项：只检查、不安装、不请用户回填。 */
export const ENV_CHECK_ITEMS: readonly EnvCheckItem[] = [
  { name: '语言运行时', command: 'java -version', expectedFrom: 'language' },
  { name: '数据库', command: 'mysql --version', expectedFrom: 'db' },
  { name: '前端运行时', command: 'node -v', expectedFrom: 'node' },
];

/**
 * 跨版本兼容禁用语法清单：为保证生成 SQL 在 5.7 与 8.0 都可导入，
 * 生成器一律回避这些 8.0 才支持的语法。两份栈模板共用同一张表。
 */
export const SQL_DISABLED_SYNTAXES: readonly string[] = [
  'OVER (',
  'WITH ... AS',
  'JSON_TABLE',
  'ROW_NUMBER()',
  'RANK()',
  'LATERAL',
];

/** MySQL 各基准版本能力表：由版本号键索引，模板表内不得内联版本号。 */
export const MYSQL_CAPABILITY_TABLE: Readonly<Record<string, SqlCapabilities>> = {
  'MySQL 5.7': {
    windowFunctions: false,
    cte: false,
    jsonTable: false,
    checkConstraint: false,
  },
  'MySQL 8.0': {
    windowFunctions: true,
    cte: true,
    jsonTable: true,
    checkConstraint: true,
  },
};
