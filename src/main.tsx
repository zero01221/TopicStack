import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ConfigForm } from './ui';

/**
 * 极简步骤编排：只描述数据流向（录入 → 分析 → 文档 → 交付 → 历史）。
 * 步骤之间由程序自动流转，不设置任何人工把关环节。
 */
export type Step = 'input' | 'analysis' | 'techdoc' | 'deliverables' | 'history';

/** 步骤元数据：数组顺序即渲染顺序，后续功能点在此增补界面内容。 */
export interface StepMeta {
  readonly id: Step;
  readonly label: string;
  readonly summary: string;
}

/** 步骤清单（字面常量，便于判据做静态解析）。 */
export const STEP_META: readonly StepMeta[] = [
  { id: 'input', label: '题目输入', summary: '填写毕设题目与可选约束' },
  { id: 'analysis', label: '功能点分析', summary: '关键词推荐与手动调整' },
  { id: 'techdoc', label: '技术文档', summary: '技术栈、流程与目录预览' },
  { id: 'deliverables', label: '交付物生成', summary: '源码、文档、SQL 与压缩包' },
  { id: 'history', label: '历史快照', summary: '查看与重新下载历史版本' },
];

/** 应用外壳：录入步骤接入配置表单，其余步骤由后续功能点增量补齐。 */
export function App(): ReactElement {
  const [current, setCurrent] = useState<Step>('input');
  const active: StepMeta = STEP_META.find((item) => item.id === current) ?? STEP_META[0];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">TopicStack · 毕设辅助生成系统</h1>
        <p className="mt-2 text-sm text-slate-500">纯前端本地演示 · 不联网 · 无账号体系</p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="步骤导航">
        {STEP_META.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCurrent(item.id)}
            className={
              item.id === current
                ? 'rounded bg-slate-800 px-3 py-1 text-sm text-white'
                : 'rounded border border-slate-300 px-3 py-1 text-sm text-slate-600'
            }
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="rounded border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-800">{active.label}</h2>
        <p className="mt-2 text-sm text-slate-600">{active.summary}</p>
        {current === 'input' ? (
          <ConfigForm />
        ) : (
          <p className="mt-4 text-xs text-slate-400">该步骤的界面将在后续功能点逐步接入。</p>
        )}
      </section>
    </main>
  );
}

/** 挂载根容器：index.html 中的 #root 必须存在，否则明确报错而非静默白屏。 */
const container: HTMLElement | null = document.getElementById('root');
if (container === null) {
  throw new Error('[TopicStack] 未找到根容器 #root，请检查 index.html');
}
createRoot(container).render(<App />);
