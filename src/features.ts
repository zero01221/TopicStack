/**
 * 功能点分析（F04）：关键词推荐、自动编号、去重、冲突检查、
 * 验收条件补全、全手输规范化与未命中回退。
 *
 * 全部为确定性纯函数，不依赖任何外部 AI 或网络请求；未命中时自动回退
 * 通用 CRUD 骨架并给出提示，流程不阻断、不增设人工把关环节。
 */
import type { FeaturePoint, FeaturePriority, FeatureSource } from './types';
import { SUGGESTED_DEFAULTS } from './types';

/** 功能点草稿：编辑器与推荐器共用的宽松输入结构。 */
export interface FeatureDraft {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly acceptance?: readonly string[];
  readonly module?: string;
  readonly priority?: FeaturePriority;
  readonly source?: FeatureSource;
  readonly dependsOn?: readonly string[];
}

/** 单个关键词条目对应的功能点模板。 */
export interface FeatureTemplate {
  readonly keywords: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly acceptance: readonly string[];
  readonly module: string;
  readonly priority: FeaturePriority;
}

/** 推荐结果：功能点集合、命中关键词、是否回退与提示语。 */
export interface FeatureRecommendation {
  readonly features: readonly FeaturePoint[];
  readonly matchedKeywords: readonly string[];
  readonly fallback: boolean;
  readonly hint: string;
}

/** 功能点编号格式，与 src/types.ts 的字段约定一致。 */
export const FEATURE_ID_PATTERN = /^FP-\d{3}$/;

/** 未命中关键词时的提示语（不阻断、不增设人工步骤）。 */
export const FALLBACK_HINT = '建议手动调整';

/** 由少量入参构造完整功能点模板，保证描述与验收条件永远非空。 */
function template(
  keywords: readonly string[],
  title: string,
  module: string,
  priority: FeaturePriority = 'medium',
): FeatureTemplate {
  return {
    keywords,
    title,
    description: `提供${title}能力，覆盖输入校验、结果返回与异常处理`,
    acceptance: [
      `${title}：使用合法输入可得到预期结果`,
      `${title}：非法输入给出明确提示且不产生半成品`,
    ],
    module,
    priority,
  };
}

/**
 * 关键词 → 功能点映射表（二十八条，覆盖管理系统、电商、预约订单、
 * 数据分析、推荐、论坛社区、登录权限、文件上传、统计报表等常见毕设类型）。
 */
export const KEYWORD_FEATURE_MAP: readonly FeatureTemplate[] = [
  template(['管理系统', '信息系统', '后台管理'], '基础信息维护', '信息管理模块', 'high'),
  template(['图书馆', '图书', '借阅'], '图书检索与借阅', '资源模块'),
  template(['电商', '商城', '购物'], '商品目录管理', '商品模块'),
  template(['订单', '下单'], '订单流转管理', '交易模块'),
  template(['预约', '预订'], '预约登记与取消', '预约模块'),
  template(['数据分析', '统计', '报表'], '数据统计分析', '分析模块'),
  template(['可视化', '图表', '大屏'], '可视化看板', '展示模块'),
  template(['推荐', '协同过滤'], '个性化推荐', '推荐模块'),
  template(['论坛', '社区', '帖子'], '内容发布与回复', '内容模块'),
  template(['注册', '账号', '用户'], '用户注册与资料维护', '用户模块'),
  template(['登录', '认证', '身份'], '登录与身份认证', '认证模块', 'high'),
  template(['角色', '权限', '授权'], '角色权限分配', '权限模块'),
  template(['上传', '附件', '文件'], '文件上传与下载', '文件模块'),
  template(['爬虫', '采集'], '数据采集与清洗', '采集模块'),
  template(['检索', '搜索', '查询'], '组合条件检索', '查询模块'),
  template(['导出', 'excel'], '数据导出', '导出模块'),
  template(['消息', '通知', '评论'], '消息通知', '消息模块'),
  template(['评价', '评分'], '评分与评价', '评价模块'),
  template(['支付', '结算'], '支付结算', '支付模块'),
  template(['课程', '选课', '教学'], '课程与选课管理', '教学模块'),
  template(['宿舍', '公寓'], '宿舍信息管理', '后勤模块'),
  template(['考勤', '打卡'], '考勤登记', '考勤模块'),
  template(['排课', '课表'], '排课管理', '教务模块'),
  template(['日志', '审计'], '操作日志记录', '审计模块'),
  template(['缓存', '性能'], '热点数据缓存', '性能模块'),
  template(['毕设', '论文', '题目'], '题目申报与进度跟踪', '毕设模块'),
  template(['机器学习', '模型', '算法'], '模型推理服务', '算法模块'),
];

/** 所有题目都自带的基础功能点，保证推荐结果至少可用。 */
export const BASE_FEATURE_DRAFTS: readonly FeatureDraft[] = [
  {
    title: '用户登录与身份认证',
    description: '校验账号与口令，签发会话并返回角色信息',
    acceptance: ['合法账号可登录', '非法账号给出明确提示'],
    module: '认证模块',
    priority: 'high',
    source: 'auto',
  },
  {
    title: '用户信息维护',
    description: '提供用户资料的新增、编辑、查询与停用',
    acceptance: ['资料可保存并回显', '重复登录名被拒绝'],
    module: '用户模块',
    priority: 'high',
    source: 'auto',
  },
];

/** 未命中关键词时回退的通用 CRUD 骨架。 */
export const GENERIC_CRUD_DRAFTS: readonly FeatureDraft[] = [
  { title: '基础数据新增', module: '通用模块', source: 'auto', priority: 'medium' },
  { title: '基础数据列表查询', module: '通用模块', source: 'auto', priority: 'medium' },
  { title: '基础数据编辑', module: '通用模块', source: 'auto', priority: 'medium' },
  { title: '基础数据删除', module: '通用模块', source: 'auto', priority: 'medium' },
  { title: '操作结果提示', module: '通用模块', source: 'auto', priority: 'low' },
];

/** 去重合并阶段使用的中间结构。 */
interface MergedDraft {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  acceptance: string[];
  readonly module?: string;
  readonly priority?: FeaturePriority;
  readonly source?: FeatureSource;
  readonly dependsOn?: readonly string[];
}

/** 生成下一个未被占用的三位编号。 */
function nextId(used: ReadonlySet<string>): string {
  let index = 1;
  while (used.has(`FP-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `FP-${String(index).padStart(3, '0')}`;
}

/** 验收条件补全：为空时按功能点标题生成两条可执行条件。 */
function defaultAcceptance(title: string): readonly string[] {
  return [
    `${title}：使用合法输入可得到预期结果`,
    `${title}：非法输入给出明确提示且不产生半成品`,
  ];
}

/**
 * 规范化功能点集合：清洗空标题、按标题合并重复项、补全验收条件、
 * 重排并校验编号、过滤无效依赖。本函数幂等，重复调用结果完全一致。
 */
export function normalizeFeatures(drafts: readonly FeatureDraft[]): readonly FeaturePoint[] {
  const merged = new Map<string, MergedDraft>();
  for (const draft of drafts) {
    const title = (draft.title ?? '').replace(/\s+/g, ' ').trim();
    if (title.length === 0) {
      continue;
    }
    const key = title.toLowerCase();
    const existing = merged.get(key);
    const acceptance = (draft.acceptance ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (existing) {
      for (const item of acceptance) {
        if (!existing.acceptance.includes(item)) {
          existing.acceptance.push(item);
        }
      }
      continue;
    }
    merged.set(key, {
      id: draft.id,
      title,
      description: draft.description,
      acceptance: [...acceptance],
      module: draft.module,
      priority: draft.priority,
      source: draft.source,
      dependsOn: draft.dependsOn,
    });
  }

  const used = new Set<string>();
  const points: FeaturePoint[] = [];
  for (const draft of merged.values()) {
    const id = typeof draft.id === 'string'
      && FEATURE_ID_PATTERN.test(draft.id)
      && !used.has(draft.id)
      ? draft.id
      : nextId(used);
    used.add(id);
    points.push({
      id,
      title: draft.title,
      description: (draft.description ?? '').trim() || `提供${draft.title}能力，供上层模块调用`,
      acceptance: draft.acceptance.length > 0 ? draft.acceptance : defaultAcceptance(draft.title),
      module: (draft.module ?? '').trim() || '通用模块',
      priority: draft.priority ?? 'medium',
      source: draft.source ?? 'auto',
      dependsOn: (draft.dependsOn ?? []).filter((dependency) => FEATURE_ID_PATTERN.test(dependency)),
    });
  }
  return points;
}

/** 冲突检查：非法编号、重复编号、重复标题、空验收条件逐项列出。 */
export function checkFeatureConflicts(features: readonly FeaturePoint[]): readonly string[] {
  const conflicts: string[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const feature of features) {
    if (!FEATURE_ID_PATTERN.test(feature.id)) {
      conflicts.push(`非法编号: ${feature.id}`);
    }
    if (ids.has(feature.id)) {
      conflicts.push(`重复编号: ${feature.id}`);
    }
    ids.add(feature.id);
    const key = feature.title.toLowerCase();
    if (titles.has(key)) {
      conflicts.push(`重复标题: ${feature.title}`);
    }
    titles.add(key);
    if (feature.acceptance.length === 0) {
      conflicts.push(`空验收条件: ${feature.id}`);
    }
  }
  return conflicts;
}

/**
 * 全手输路径：用户只给若干标题，系统按同一套规范化规则产出合法功能点，
 * 并统一标记来源为 manual。
 */
export function createManualFeatures(lines: readonly string[]): readonly FeaturePoint[] {
  const drafts: FeatureDraft[] = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ title: line, source: 'manual' as FeatureSource }));
  return normalizeFeatures(drafts);
}

/**
 * 按题目关键词推荐功能点。命中时返回基础功能点 + 命中模板（不足五个时
 * 用通用骨架补齐）；未命中时回退通用 CRUD 骨架并给出「建议手动调整」提示。
 */
export function recommendFeatures(title: string): FeatureRecommendation {
  const lowered = title.toLowerCase();
  const matched = KEYWORD_FEATURE_MAP.filter((entry) => entry.keywords.some(
    (keyword) => lowered.includes(keyword.toLowerCase()),
  ));
  const matchedKeywords = [...new Set(matched.flatMap((entry) => entry.keywords.filter(
    (keyword) => lowered.includes(keyword.toLowerCase()),
  )))];
  const fallback = matched.length === 0;

  const drafts: FeatureDraft[] = [...BASE_FEATURE_DRAFTS];
  if (fallback) {
    drafts.push(...GENERIC_CRUD_DRAFTS);
  } else {
    // KEYWORD_FEATURE_MAP 的每一项本身就是功能点模板，可直接作为草稿使用。
    drafts.push(...matched);
  }
  const minimum = SUGGESTED_DEFAULTS.minRecommendedFeatures;
  if (!fallback && drafts.length < minimum) {
    drafts.push(...GENERIC_CRUD_DRAFTS.slice(0, minimum - drafts.length));
  }

  return {
    features: normalizeFeatures(drafts),
    matchedKeywords,
    fallback,
    hint: fallback ? FALLBACK_HINT : '',
  };
}
