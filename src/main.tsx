import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import './index.css';
import { ConfigForm, HistoryPanel } from './ui';
import type { FeaturePoint, ProjectConfig, Snapshot } from './types';
import { generate } from './generate';
import {
  buildSnapshot,
  createMemoryStorage,
  deleteSnapshot,
  listSnapshots,
  restore,
  saveSnapshot,
  type StorageLike,
} from './history';

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

/** 浏览器用 localStorage，缺少该能力时回退到内存存储。 */
function resolveStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // 环境不提供 localStorage 时静默回退，不影响页面渲染。
  }
  return createMemoryStorage();
}

const storage: StorageLike = resolveStorage();

/** 应用外壳：录入、历史与其余步骤的增量容器。 */
export function App(): ReactElement {
  const [current, setCurrent] = useState<Step>('input');
  const [snapshots, setSnapshots] = useState<readonly Snapshot[]>(() => listSnapshots(storage));
  const [message, setMessage] = useState<string>('');
  const active: StepMeta = STEP_META.find((item) => item.id === current) ?? STEP_META[0];

  /** 生成交付物、写入快照，历史只存配置与清单摘要。 */
  const handleGenerate = (config: ProjectConfig, features: readonly FeaturePoint[]): void => {
    const result = generate({ config, features });
    const snapshot = buildSnapshot(config, features, result.files, snapshots);
    saveSnapshot(storage, snapshot);
    setSnapshots(listSnapshots(storage));
    setMessage(`已保存 ${snapshot.version}，本次交付物 ${result.files.length} 个`);
  };

  /** 查看：从快照确定性重建文件树，不执行任何生成代码。 */
  const handleView = (snapshot: Snapshot): void => {
    const rebuilt = restore(snapshot);
    setMessage(`${snapshot.note} ｜ 重建文件 ${rebuilt.files.length} 个`);
  };

  /** 重新下载 ZIP：按快照重建后打包，文件名自动派生。 */
  const handleDownload = async (snapshot: Snapshot): Promise<void> => {
    const rebuilt = restore(snapshot);
    const zip = new JSZip();
    for (const file of rebuilt.files) {
      zip.file(file.path, file.content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${snapshot.version}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /** 删除：从持久化列表移除并刷新界面。 */
  const handleDelete = (id: string): void => {
    deleteSnapshot(storage, id);
    setSnapshots(listSnapshots(storage));
    setMessage('已删除该快照');
  };

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
          <ConfigForm onGenerate={handleGenerate} />
        ) : current === 'history' ? (
          <HistoryPanel
            entries={snapshots}
            onView={handleView}
            onDownload={(entry) => {
              void handleDownload(entry);
            }}
            onDelete={handleDelete}
          />
        ) : (
          <p className="mt-4 text-xs text-slate-400">该步骤的界面将在后续功能点逐步接入。</p>
        )}
        {message.length > 0 ? (
          <p className="mt-4 rounded bg-slate-50 p-3 text-xs text-slate-600" role="status">
            {message}
          </p>
        ) : null}
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
