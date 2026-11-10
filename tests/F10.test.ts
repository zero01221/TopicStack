import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { normalize } from '../src/project';
import { recommendFeatures } from '../src/features';
import { findFile, generate } from '../src/generate';
import { buildSnapshot, restore } from '../src/history';
import { buildZipBuffer, isSafeDeliverablePath, makeZipFileName } from '../src/zip';
import { F10_EXPECTED } from './invariants';

/** 端到端输入：只给一个题目。 */
function makeChain() {
  const title = '基于 Java 的图书馆管理系统';
  const config = normalize({ title }).config;
  const features = recommendFeatures(title).features;
  const result = generate({ config, features });
  const snapshot = buildSnapshot(config, features, result.files);
  return { title, config, features, result, snapshot };
}

/** F10 断言测试：真实 ZIP 解包、全链路与回归收口，期望值来自硬编码字面常量断言集。 */
describe('F10 ZIP 导出与全链路联调', () => {
  it('期望值均为硬编码字面常量', () => {
    expect(F10_EXPECTED.declaredChecks).toBe(6);
    expect(F10_EXPECTED.totalRecords).toBe(10);
    expect(F10_EXPECTED.regressionItems).toBe(9);
  });

  it('JSZip 解包后文件树与 generate() 映射一致、每条目非空', async () => {
    const chain = makeChain();
    const buffer = await buildZipBuffer(chain.result.files);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    const expected = chain.result.files.map((file) => file.path).sort();
    expect(names).toEqual(expected);
    for (const name of names) {
      const content = await zip.files[name].async('string');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('条目集合 == MANIFEST 声明集合，且无绝对路径或路径穿越', async () => {
    const chain = makeChain();
    const buffer = await buildZipBuffer(chain.result.files);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    const manifest = findFile(chain.result.files, 'MANIFEST.md') ?? '';
    const declared = [...manifest.matchAll(/`([^`]+)`/g)].map((entry) => entry[1]).sort();
    expect(names).toEqual(declared);
    expect(names.every(isSafeDeliverablePath)).toBe(true);
    expect(makeZipFileName('v_1')).toBe('TopicStack-v_1.zip');
  });

  it('非法路径被明确拒绝，不静默产出压缩包', async () => {
    expect(isSafeDeliverablePath('../../etc/passwd')).toBe(false);
    expect(isSafeDeliverablePath('/absolute/path')).toBe(false);
    expect(isSafeDeliverablePath('frontend\\src\\a.ts')).toBe(false);
    await expect(buildZipBuffer([
      { path: '../escape.txt', content: 'x', kind: 'doc', derivedFrom: [], required: true, status: 'generated', note: '' },
    ])).rejects.toThrow(/非法交付物路径/);
  });

  it('端到端 {title} → 生成 → 快照 → ZIP 全链路无异常', async () => {
    const chain = makeChain();
    const rebuilt = restore(chain.snapshot);
    expect(rebuilt.files.length).toBe(chain.result.files.length);
    const buffer = await buildZipBuffer(rebuilt.files);
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir).length)
      .toBe(chain.result.files.length);
    expect(chain.snapshot.note).toContain(chain.title);
  });

  it('两栈都能完成全链路打包', async () => {
    for (const stackChoice of ['java', 'python']) {
      const config = normalize({ title: '基于 Java 的图书馆管理系统', stackChoice }).config;
      const result = generate({ config, features: [] });
      const buffer = await buildZipBuffer(result.files);
      const zip = await JSZip.loadAsync(buffer);
      expect(Object.keys(zip.files).length).toBeGreaterThan(0);
    }
  });
});
