/**
 * 配置输入层与异常提示（F03，后续功能点在此增量接入编辑器与预览）。
 *
 * 交互口径：exception-based 默认通过。用户只需填写毕设题目这一个字段；
 * 技术栈、基准版本组、约束与可选文档框架全部由系统自动带出建议值，
 * 可覆盖但不必操作。只有输入出现异常时才显示提示条，且每条提示都带
 * 「一键采用建议值 / 自动修复」；流程中没有任何人工把关环节。
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { A11Docs, FeaturePriority, ProjectConfig, Versions } from './types';
import { SUGGESTED_DEFAULTS } from './types';
import { normalize, recommendStackId } from './project';
import type { FeatureDraft } from './features';
import {
  checkFeatureConflicts,
  normalizeFeatures,
  recommendFeatures,
} from './features';

/** 基准版本组的五个可覆盖字段。 */
export const VERSION_FIELDS: readonly { readonly key: keyof Versions; readonly label: string }[] = [
  { key: 'language', label: '语言版本' },
  { key: 'framework', label: '后端框架版本' },
  { key: 'db', label: '数据库版本' },
  { key: 'frontend', label: '前端版本' },
  { key: 'node', label: 'Node 版本' },
];

/** A11 三个可选文档框架，默认不勾选，事实性字段由用户自行填写。 */
export const A11_FIELDS: readonly { readonly key: keyof A11Docs; readonly label: string }[] = [
  { key: 'opening', label: '开题报告框架' },
  { key: 'midterm', label: '中期检查框架' },
  { key: 'defense', label: '答辩提纲' },
];

/** 表单派生结果：可能为完整配置，也可能因异常暂时为空。 */
interface FormOutcome {
  readonly config: ProjectConfig | null;
  readonly adoptedDefaults: readonly string[];
  readonly error: string;
}

/** 异常提示条属性：消息与一键修复动作。 */
export interface ExceptionNoticeProps {
  readonly message: string;
  readonly onAdopt: () => void;
}

/**
 * 异常提示组件：只在异常时渲染，且始终提供两个等价的一键修复入口。
 * 采用建议值后所有可选字段回到系统默认值，用户无需任何额外操作即可继续。
 */
export function ExceptionNotice({ message, onAdopt }: ExceptionNoticeProps): ReactElement {
  return (
    <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm text-amber-800">{message}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-action="adopt-suggested"
          onClick={onAdopt}
          className="rounded bg-amber-700 px-3 py-1 text-sm text-white"
        >
          一键采用建议值
        </button>
        <button
          type="button"
          data-action="auto-fix"
          onClick={onAdopt}
          className="rounded border border-amber-600 px-3 py-1 text-sm text-amber-800"
        >
          自动修复
        </button>
      </div>
    </div>
  );
}

/** 功能点编辑器属性：题目只用于关键词推荐，本身不是必填输入。 */
export interface FeatureEditorProps {
  readonly title: string;
}

/**
 * 功能点编辑器（F04）：展示关键词推荐结果，支持增删改、编辑验收条件、
 * 切换全手输，并实时显示规范化编号与冲突项。
 */
export function FeatureEditor({ title }: FeatureEditorProps): ReactElement {
  const recommendation = useMemo(() => recommendFeatures(title), [title]);
  const [drafts, setDrafts] = useState<readonly FeatureDraft[]>(
    () => recommendation.features.map((feature) => ({
      id: feature.id,
      title: feature.title,
      description: feature.description,
      acceptance: feature.acceptance,
      module: feature.module,
      priority: feature.priority,
      source: feature.source,
      dependsOn: feature.dependsOn,
    })),
  );
  const features = useMemo(() => normalizeFeatures(drafts), [drafts]);
  const conflicts = useMemo(() => checkFeatureConflicts(features), [features]);

  const updateRow = (index: number, patch: FeatureDraft): void => {
    setDrafts((previous) => previous.map((row, position) => (
      position === index ? { ...row, ...patch } : row
    )));
  };
  const addRow = (): void => {
    setDrafts((previous) => [...previous, { title: '', source: 'manual' }]);
  };
  const removeRow = (index: number): void => {
    setDrafts((previous) => previous.filter((_, position) => position !== index));
  };
  const switchToManual = (): void => {
    setDrafts([{ title: '', source: 'manual' }]);
  };

  return (
    <div className="mt-3">
      <p className="text-xs text-slate-500">
        命中关键词 {recommendation.matchedKeywords.length} 个；
        {recommendation.fallback
          ? `未命中，已回退通用 CRUD 骨架，${recommendation.hint}`
          : '按题目关键词自动推荐'}
        。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
        >
          新增功能点
        </button>
        <button
          type="button"
          onClick={switchToManual}
          className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
        >
          清空并手输
        </button>
      </div>

      <ul className="mt-3 space-y-3">
        {drafts.map((row, index) => (
          <li key={`feature-row-${index}`} className="rounded border border-slate-200 p-3">
            <p className="text-xs text-slate-400">
              编号 {features[index]?.id ?? '待分配'} · 来源 {row.source ?? 'auto'}
            </p>
            <label className="mt-2 block text-xs text-slate-600">
              标题
              <input
                value={row.title ?? ''}
                onChange={(event) => updateRow(index, { title: event.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              描述
              <input
                value={row.description ?? ''}
                onChange={(event) => updateRow(index, { description: event.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              验收条件（用竖线分隔）
              <input
                value={(row.acceptance ?? []).join('|')}
                onChange={(event) => updateRow(index, {
                  acceptance: event.target.value
                    .split('|')
                    .map((segment) => segment.trim())
                    .filter((segment) => segment.length > 0),
                })}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs text-slate-600">
              优先级
              <select
                value={row.priority ?? 'medium'}
                onChange={(event) => updateRow(index, {
                  priority: event.target.value as FeaturePriority,
                })}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="mt-2 rounded border border-rose-300 px-3 py-1 text-xs text-rose-700"
            >
              删除
            </button>
          </li>
        ))}
      </ul>

      <section className="mt-4 rounded bg-slate-50 p-3" aria-label="功能点摘要">
        <p className="text-xs text-slate-600">规范化后功能点数：{features.length}</p>
        <p className="text-xs text-slate-600">
          编号：{features.map((feature) => feature.id).join(' / ') || '无'}
        </p>
        <p className="text-xs text-slate-600">
          冲突项：{conflicts.length === 0 ? '无' : conflicts.join('、')}
        </p>
      </section>
    </div>
  );
}

/** 配置表单：唯一必填项是题目，其余控件均有系统建议默认值。 */
export function ConfigForm(): ReactElement {
  const [title, setTitle] = useState<string>('');
  const [stackChoice, setStackChoice] = useState<string>('');
  const [versionInputs, setVersionInputs] = useState<Record<keyof Versions, string>>(
    () => ({ ...SUGGESTED_DEFAULTS.versions }),
  );
  const [constraintsText, setConstraintsText] = useState<string>('');
  const [a11, setA11] = useState<A11Docs>(() => ({ ...SUGGESTED_DEFAULTS.a11Docs }));

  // 技术栈按题目关键词自动推荐；用户显式输入优先，未命中回退建议默认栈。
  const recommendedStackId = recommendStackId(title);
  const effectiveStackId = stackChoice.trim().length > 0 ? stackChoice.trim() : recommendedStackId;

  // 默认自动通过：只填题目即可得到完整配置，不产生任何人工步骤。
  const outcome = useMemo<FormOutcome>(() => {
    if (title.trim().length === 0) {
      return { config: null, adoptedDefaults: [], error: '' };
    }
    try {
      const result = normalize({
        title,
        constraintsText,
        stackChoice: effectiveStackId,
        versionInputs,
        a11Docs: a11,
      });
      return { config: result.config, adoptedDefaults: result.adoptedDefaults, error: '' };
    } catch (error) {
      return {
        config: null,
        adoptedDefaults: [],
        error: String(error instanceof Error ? error.message : error),
      };
    }
  }, [title, constraintsText, effectiveStackId, versionInputs, a11]);

  const emptyVersionLabels = VERSION_FIELDS
    .filter((field) => versionInputs[field.key].trim().length === 0)
    .map((field) => field.label);
  const notice = emptyVersionLabels.length > 0
    ? `以下版本字段留空：${emptyVersionLabels.join('、')}；系统已备好建议默认值，可一键采用后零操作继续。`
    : outcome.error;

  /** 一键采用建议值：把所有可选字段恢复为系统默认值。 */
  const adoptSuggested = (): void => {
    setVersionInputs({ ...SUGGESTED_DEFAULTS.versions });
    setStackChoice('');
    setConstraintsText('');
    setA11({ ...SUGGESTED_DEFAULTS.a11Docs });
  };

  const updateVersion = (key: keyof Versions, value: string): void => {
    setVersionInputs((previous) => ({ ...previous, [key]: value }));
  };

  const toggleA11 = (key: keyof A11Docs): void => {
    setA11((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      {notice.length > 0 ? <ExceptionNotice message={notice} onAdopt={adoptSuggested} /> : null}

      <label className="block text-sm font-medium text-slate-700" htmlFor="thesis-title">
        毕设题目（唯一必填）
      </label>
      <input
        id="thesis-title"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="例如：基于 Java 的图书馆管理系统"
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-slate-400">
        系统按题目自动推荐技术栈：{recommendedStackId}；其余字段已自动带出建议值，可覆盖但不必操作。
      </p>

      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="stack-choice">
        技术栈（可输入任意标识以覆盖推荐值）
      </label>
      <input
        id="stack-choice"
        value={stackChoice}
        onChange={(event) => setStackChoice(event.target.value)}
        placeholder={recommendedStackId}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">基准版本组（均可覆盖）</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {VERSION_FIELDS.map((field) => (
            <label key={field.key} className="text-xs text-slate-600">
              {field.label}
              <input
                value={versionInputs[field.key]}
                onChange={(event) => updateVersion(field.key, event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="constraints-text">
        学校 / 导师硬性约束（留空使用默认约束集）
      </label>
      <textarea
        id="constraints-text"
        value={constraintsText}
        onChange={(event) => setConstraintsText(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">A11 可选文档框架（主动勾选才生成）</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {A11_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={a11[field.key]}
                onChange={() => toggleA11(field.key)}
              />
              {field.label}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="mt-6 rounded bg-slate-50 p-4" aria-label="配置摘要">
        <h3 className="text-sm font-medium text-slate-700">当前配置摘要（自动派生）</h3>
        {outcome.config === null ? (
          <p className="mt-2 text-xs text-slate-500">填写题目后即可自动生成完整配置。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            <li>题目：{outcome.config.title}</li>
            <li>技术栈：{outcome.config.stackId}</li>
            <li>版本组：{Object.values(outcome.config.versions).join(' / ')}</li>
            <li>自动采用的默认值数量：{outcome.adoptedDefaults.length}</li>
            <li>原始题目锚点：{outcome.config.rawInput.title}</li>
          </ul>
        )}
      </section>

      {title.trim().length > 0 ? (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-medium text-slate-700">功能点分析（自动推荐 + 手动调整）</h3>
          <FeatureEditor key={title} title={title} />
        </div>
      ) : null}
    </div>
  );
}
