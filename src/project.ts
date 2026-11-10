/**
 * ProjectConfig 单一数据源（F02）。
 *
 * 职责：把「只填了题目」的用户输入规范化为完整配置，保存不可变的原始输入锚点，
 * 自动带出可被覆盖的建议默认值，并派生环境基准等只读结构。
 *
 * 约束：本文件不内联任何版本号或演示账号字面量；所有建议值均从
 * src/types.ts 的建议默认值表读取，便于工程侧静态扫描证明无漂移。
 */
import type {
  A11Docs,
  Auth,
  CommentPolicy,
  Constraints,
  DataModel,
  DirTree,
  EnvBaseline,
  ExplainerAnchor,
  NormalizeInput,
  NormalizeResult,
  ProjectConfig,
  ProjectInput,
  RawInput,
  Versions,
} from './types';
import {
  ENV_CHECK_ITEMS,
  STACK_KEYWORD_HINTS,
  SUGGESTED_DEFAULTS,
} from './types';

/** 全局唯一必填输入字段：题目，且没有建议默认值。 */
export const REQUIRED_INPUT_FIELDS = ['title'] as const;

/** 规范化后配置必须具备的顶层字段路径（判据用，不含任何版本或账号值）。 */
export const REQUIRED_CONFIG_FIELDS = [
  'rawInput',
  'title',
  'constraints',
  'stackId',
  'versions',
  'dataModel',
  'auth',
  'dirTree',
  'commentPolicy',
  'explainerAnchors',
  'a11Docs',
  'envBaseline',
] as const;

/** 判断入参是否已是规范化结果。 */
function isNormalizeResult(value: NormalizeInput): value is NormalizeResult {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<NormalizeResult>;
  return Boolean(candidate.config) && Array.isArray(candidate.adoptedDefaults);
}

/** 判断入参是否已是完整配置。 */
function isProjectConfig(value: NormalizeInput): value is ProjectConfig {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ProjectConfig>;
  return Boolean(candidate.rawInput)
    && typeof candidate.title === 'string'
    && Boolean(candidate.versions);
}

/** 递归冻结对象，保证原始输入锚点不会被任何派生逻辑改写。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

/** 题目规范化：只折叠空白与首尾空格，不改写用户原文的语义。 */
function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** 约束文本解析：按常见分隔符切分为硬性约束条目。 */
function parseHardRequirements(text: string): readonly string[] {
  return text
    .split(/[,，;；\r\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * 关键词 → 技术栈推荐。未命中任何关键词时回退建议默认栈，
 * 全程自动完成，不产生任何人工把关步骤。
 */
export function recommendStackId(title: string): string {
  const lowered = title.toLowerCase();
  for (const hint of STACK_KEYWORD_HINTS) {
    if (hint.keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))) {
      return hint.stackId;
    }
  }
  return SUGGESTED_DEFAULTS.stackId;
}

/**
 * 规范化入口：输入 → 完整 ProjectConfig + 自动采用的默认值清单。
 * 幂等：把本函数的返回值再次传入会原样返回。
 * 必填缺失时明确抛错阻断，绝不静默产出半成品。
 */
export function normalize(input: NormalizeInput): NormalizeResult {
  // 已是规范化结果：直接返回，保证 normalize(normalize(x)) === normalize(x)。
  if (isNormalizeResult(input)) {
    return input;
  }

  let source: ProjectInput;
  if (isProjectConfig(input)) {
    source = {
      title: input.rawInput.title,
      constraintsText: input.rawInput.constraintsText,
      stackChoice: input.rawInput.stackChoice,
      versionInputs: input.rawInput.versionInputs,
      school: input.constraints.school,
      advisor: input.constraints.advisor,
      hardRequirements: input.constraints.hardRequirements,
      notes: input.constraints.notes,
      a11Docs: input.a11Docs,
      dataModel: input.dataModel,
      auth: input.auth,
      dirTree: input.dirTree,
      commentPolicy: input.commentPolicy,
      explainerAnchors: input.explainerAnchors,
    };
  } else {
    source = input;
  }

  const rawTitle = source.title ?? '';
  const title = normalizeTitle(rawTitle);
  if (title.length === 0) {
    throw new Error('配置规范化失败：必填字段 title 缺失，请提供毕设题目');
  }

  const adoptedDefaults: string[] = [];
  const versionInputs: Readonly<Record<string, string>> = source.versionInputs ?? {};

  // 版本组：用户覆盖值优先，其余从建议默认值表带出并记录采用的默认值。
  const versions: Record<keyof Versions, string> = { ...SUGGESTED_DEFAULTS.versions };
  for (const key of Object.keys(versions) as (keyof Versions)[]) {
    const override = versionInputs[key];
    if (typeof override === 'string' && override.trim().length > 0) {
      versions[key] = override.trim();
    } else {
      adoptedDefaults.push(`versions.${key}`);
    }
  }

  // 技术栈：用户显式选择优先，否则按题目关键词自动推荐，默认通过不阻断。
  let stackId: string;
  if (typeof source.stackChoice === 'string' && normalizeTitle(source.stackChoice).length > 0) {
    stackId = normalizeTitle(source.stackChoice);
  } else {
    stackId = recommendStackId(title);
    adoptedDefaults.push('stackId');
  }

  // 约束：留空使用建议默认约束集；填写时按分隔符解析。
  const parsedConstraints = parseHardRequirements(source.constraintsText ?? '');
  const constraints: Constraints = {
    school: source.school,
    advisor: source.advisor,
    hardRequirements: source.hardRequirements
      ?? (parsedConstraints.length > 0
        ? parsedConstraints
        : [...SUGGESTED_DEFAULTS.constraints.hardRequirements]),
    notes: source.notes,
  };
  if (!source.hardRequirements && parsedConstraints.length === 0) {
    adoptedDefaults.push('constraints.hardRequirements');
  }

  const dataModel: DataModel = source.dataModel ?? SUGGESTED_DEFAULTS.dataModel;
  if (!source.dataModel) {
    adoptedDefaults.push('dataModel');
  }

  const auth: Auth = source.auth
    ? { ...SUGGESTED_DEFAULTS.auth, ...source.auth }
    : SUGGESTED_DEFAULTS.auth;
  if (!source.auth) {
    adoptedDefaults.push('auth');
  }

  const dirTree: DirTree = source.dirTree ?? SUGGESTED_DEFAULTS.dirTree;
  if (!source.dirTree) {
    adoptedDefaults.push('dirTree');
  }

  const commentPolicy: CommentPolicy = source.commentPolicy
    ?? SUGGESTED_DEFAULTS.commentPolicy;
  if (!source.commentPolicy) {
    adoptedDefaults.push('commentPolicy');
  }

  const explainerAnchors: readonly ExplainerAnchor[] = source.explainerAnchors
    ?? SUGGESTED_DEFAULTS.explainerAnchors;
  if (!source.explainerAnchors) {
    adoptedDefaults.push('explainerAnchors');
  }

  const a11Docs: A11Docs = { ...SUGGESTED_DEFAULTS.a11Docs, ...(source.a11Docs ?? {}) };
  if (!source.a11Docs) {
    adoptedDefaults.push('a11Docs');
  }

  // 环境基准是派生结构：每个版本值都会进入 runtimeChecks 供产物读取。
  const runtimeChecks = (Object.keys(versions) as (keyof Versions)[]).map((key) => ({
    name: key,
    expected: versions[key],
  }));
  const envBaseline: EnvBaseline = {
    os: SUGGESTED_DEFAULTS.envBaseline.os,
    runtimeChecks,
    checkItems: ENV_CHECK_ITEMS,
    localOnly: SUGGESTED_DEFAULTS.envBaseline.localOnly,
  };
  adoptedDefaults.push('envBaseline');

  // 原始输入锚点：原样留存并冻结，与所有派生字段物理隔离。
  const rawInput: RawInput = deepFreeze({
    title: rawTitle,
    constraintsText: source.constraintsText ?? '',
    stackChoice: source.stackChoice ?? '',
    versionInputs: deepFreeze({ ...versionInputs }),
  });

  const config: ProjectConfig = {
    rawInput,
    title,
    constraints,
    stackId,
    versions,
    dataModel,
    auth,
    dirTree,
    commentPolicy,
    explainerAnchors,
    a11Docs,
    envBaseline,
  };

  return { config, adoptedDefaults };
}
