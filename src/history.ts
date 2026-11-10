/**
 * 快照 v_n 与历史记录（F09）。
 *
 * 只保存 config + features + 栈标识 + 清单摘要，不保存任何大文件内容；
 * 生成器的确定性保证可以从快照完整重建文件树，重建哈希与摘要哈希比对即可。
 * 版本与条目名称全部自动生成，不存在用户手填命名步骤。
 */
import type { Deliverable, FeaturePoint, ProjectConfig, Snapshot } from './types';
import { generate, hashTextFiles, type GenerateResult } from './generate';

/** localStorage 键名。 */
export const STORAGE_KEY = 'topicstack.snapshots';

/** 存储适配器：浏览器用 localStorage，判据用内存实现做往返测试。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 内存存储实现：供纯函数判据使用，不依赖浏览器 API。 */
export function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
  };
}

/** 由已有快照推导下一个版本：v_1、v_2……递增。 */
export function nextVersion(existing: readonly Snapshot[]): string {
  const numbers = existing.map((snapshot) => {
    const matched = snapshot.version.match(/^v_(\d+)$/);
    return matched ? Number(matched[1]) : 0;
  });
  const maximum = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `v_${maximum + 1}`;
}

/** 题目短名：用于自动生成历史条目名称。 */
export function shortTitle(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length <= 12 ? cleaned : `${cleaned.slice(0, 12)}…`;
}

/** 自动命名的历史条目名称：题目短名 + 版本 + 时间。 */
export function formatSnapshotLabel(
  raw: string,
  version: string,
  createdAt: string,
): string {
  return `${shortTitle(raw)} · ${version} · ${createdAt}`;
}

/** 由真实生成结果构造快照；清单摘要只记录路径与纯文本哈希。 */
export function buildSnapshot(
  config: ProjectConfig,
  features: readonly FeaturePoint[],
  files: readonly Deliverable[],
  existing: readonly Snapshot[] = [],
  createdAt: string = new Date().toISOString(),
): Snapshot {
  const version = nextVersion(existing);
  const manifestSummary = {
    fileCount: files.length,
    paths: files.map((file) => file.path).sort(),
    hash: hashTextFiles(files),
  };
  const label = formatSnapshotLabel(config.rawInput.title, version, createdAt);
  return {
    id: `${version}-${manifestSummary.hash}`,
    version,
    createdAt,
    config,
    features,
    stackId: config.stackId,
    manifestSummary,
    note: `${label} ｜ 原始题目：${config.rawInput.title}`,
  };
}

/** 读取全部快照；存储内容损坏时返回空列表而不抛错。 */
export function listSnapshots(storage: StorageLike): Snapshot[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Snapshot[] : [];
  } catch {
    return [];
  }
}

/** 追加保存一份快照。 */
export function saveSnapshot(storage: StorageLike, snapshot: Snapshot): void {
  const entries = listSnapshots(storage).filter((entry) => entry.id !== snapshot.id);
  entries.push(snapshot);
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** 按 id 删除快照。 */
export function deleteSnapshot(storage: StorageLike, id: string): void {
  const entries = listSnapshots(storage).filter((entry) => entry.id !== id);
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** 从快照确定性重建文件树：只重新渲染文本，不执行任何生成代码。 */
export function restore(snapshot: Snapshot): GenerateResult {
  return generate({ config: snapshot.config, features: snapshot.features });
}

/** 校验重建结果与清单摘要哈希一致（纯文本哈希）。 */
export function verifySnapshot(snapshot: Snapshot): boolean {
  return hashTextFiles(restore(snapshot).files) === snapshot.manifestSummary.hash;
}
