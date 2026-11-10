import { describe, expect, it } from 'vitest';
import { normalize } from '../src/project';
import { recommendFeatures } from '../src/features';
import { generate, hashTextFiles } from '../src/generate';
import {
  buildSnapshot,
  createMemoryStorage,
  deleteSnapshot,
  formatSnapshotLabel,
  listSnapshots,
  nextVersion,
  restore,
  saveSnapshot,
  shortTitle,
  verifySnapshot,
  STORAGE_KEY,
} from '../src/history';
import type { Snapshot } from '../src/types';
import { F09_EXPECTED } from './invariants';

/** 构造带原始空白的题目，用于验证独立锚点 A。 */
const RAW_TITLE = '  基于 Java 的  图书馆 管理系统  ';

/** 构造一份真实快照。 */
function makeSnapshot(
  existing: readonly Snapshot[] = [],
  createdAt = '2026-11-10T00:00:00.000Z',
) {
  const config = normalize({ title: RAW_TITLE }).config;
  const features = recommendFeatures(RAW_TITLE).features;
  const result = generate({ config, features });
  return buildSnapshot(config, features, result.files, existing, createdAt);
}

/** F09 断言测试：调用真实历史模块，期望值来自硬编码字面常量断言集。 */
describe('F09 快照与历史记录', () => {
  it('期望值均为硬编码字面常量且存储键一致', () => {
    expect(F09_EXPECTED.declaredChecks).toBe(6);
    expect(F09_EXPECTED.firstVersion).toBe('v_1');
    expect(F09_EXPECTED.secondVersion).toBe('v_2');
    expect(STORAGE_KEY).toBe(F09_EXPECTED.storageKey);
  });

  it('快照版本自动 v_1、v_2 递增', () => {
    expect(nextVersion([])).toBe(F09_EXPECTED.firstVersion);
    const first = makeSnapshot();
    expect(first.version).toBe(F09_EXPECTED.firstVersion);
    expect(nextVersion([first])).toBe(F09_EXPECTED.secondVersion);
    expect(makeSnapshot([first]).version).toBe(F09_EXPECTED.secondVersion);
  });

  it('localStorage 写入 / 读取往返一致', () => {
    const storage = createMemoryStorage();
    const snapshot = makeSnapshot();
    saveSnapshot(storage, snapshot);
    const loaded = listSnapshots(storage);
    expect(loaded).toHaveLength(1);
    expect(JSON.stringify(loaded[0])).toBe(JSON.stringify(snapshot));
  });

  it('restore(snapshot) 重新生成的文件树 hash == manifestSummary.hash', () => {
    const snapshot = makeSnapshot();
    const rebuilt = restore(snapshot);
    expect(hashTextFiles(rebuilt.files)).toBe(snapshot.manifestSummary.hash);
    expect(verifySnapshot(snapshot)).toBe(true);
  });

  it('历史条目名称自动生成（短名 + 版本 + 时间），且原始题目原样出现在 note', () => {
    const snapshot = makeSnapshot();
    const label = formatSnapshotLabel(RAW_TITLE, snapshot.version, snapshot.createdAt);
    expect(label).toContain(shortTitle(RAW_TITLE));
    expect(label).toContain(snapshot.version);
    expect(label).toContain(snapshot.createdAt);
    expect(snapshot.note).toContain(label);
    expect(snapshot.note).toContain(RAW_TITLE);
    expect(snapshot.config.rawInput.title).toBe(RAW_TITLE);
  });

  it('删除按 id 生效，且存储不保存大文件内容', () => {
    const storage = createMemoryStorage();
    const first = makeSnapshot();
    const second = makeSnapshot([first]);
    saveSnapshot(storage, first);
    saveSnapshot(storage, second);
    expect(listSnapshots(storage)).toHaveLength(2);
    deleteSnapshot(storage, first.id);
    expect(listSnapshots(storage).map((entry) => entry.version)).toEqual(['v_2']);
    const serialized = storage.getItem(STORAGE_KEY) ?? '';
    expect(serialized).toContain('manifestSummary');
    expect(serialized).not.toContain('# 技术文档');
    expect(serialized).not.toContain('CREATE TABLE');
  });
});
