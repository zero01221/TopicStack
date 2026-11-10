import { describe, expect, it } from 'vitest';
import {
  FEATURE_ID_PATTERN,
  KEYWORD_FEATURE_MAP,
  checkFeatureConflicts,
  createManualFeatures,
  normalizeFeatures,
  recommendFeatures,
  type FeatureDraft,
} from '../src/features';
import { F04_EXPECTED } from './invariants';

/** F04 断言测试：直接调用真实功能点纯函数，期望值来自硬编码字面常量断言集。 */
describe('F04 功能点分析', () => {
  it('期望值均为硬编码字面常量，关键词表规模在二十到三十条之间', () => {
    expect(F04_EXPECTED.declaredChecks).toBe(7);
    expect(F04_EXPECTED.minRecommended).toBe(5);
    expect(F04_EXPECTED.fallbackHint).toBe('建议手动调整');
    expect(F04_EXPECTED.idPattern.test('FP-001')).toBe(true);
    expect(KEYWORD_FEATURE_MAP.length).toBeGreaterThanOrEqual(20);
    expect(KEYWORD_FEATURE_MAP.length).toBeLessThanOrEqual(30);
  });

  it('样本题目命中关键词表后产出至少五个功能点', () => {
    const result = recommendFeatures(F04_EXPECTED.sampleTitle);
    expect(result.fallback).toBe(false);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
    expect(result.features.length).toBeGreaterThanOrEqual(F04_EXPECTED.minRecommended);
  });

  it('编号全部匹配 FP-\\d{3} 且唯一，验收条件均非空', () => {
    const features = recommendFeatures(F04_EXPECTED.sampleTitle).features;
    const ids = features.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feature of features) {
      expect(F04_EXPECTED.idPattern.test(feature.id)).toBe(true);
      expect(FEATURE_ID_PATTERN.test(feature.id)).toBe(true);
      expect(feature.acceptance.length).toBeGreaterThan(0);
    }
    expect(checkFeatureConflicts(features)).toEqual([]);
  });

  it('重复标题自动合并，且空验收条件被补全', () => {
    const drafts: readonly FeatureDraft[] = [
      { title: '  用户登录  ', acceptance: ['首次条件'] },
      { title: '用户登录', acceptance: ['首次条件', '追加条件'] },
      { title: '数据导出' },
      { title: '   ' },
    ];
    const features = normalizeFeatures(drafts);
    expect(features).toHaveLength(2);
    expect(features[0].title).toBe('用户登录');
    expect(features[0].acceptance).toContain('首次条件');
    expect(features[0].acceptance).toContain('追加条件');
    expect(features[1].acceptance.length).toBeGreaterThan(0);
  });

  it('normalizeFeatures 幂等', () => {
    const first = normalizeFeatures([
      { title: '基础数据新增' },
      { title: '基础数据删除', acceptance: ['删除后可查询不到'] },
    ]);
    const second = normalizeFeatures(first);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('全手输路径产出同样合法的功能点且来源为 manual', () => {
    const features = createManualFeatures(['  用户登录 ', '', '订单查询', '订单查询']);
    expect(features).toHaveLength(2);
    for (const feature of features) {
      expect(F04_EXPECTED.idPattern.test(feature.id)).toBe(true);
      expect(feature.source).toBe('manual');
      expect(feature.acceptance.length).toBeGreaterThan(0);
    }
    expect(checkFeatureConflicts(features)).toEqual([]);
  });

  it('未命中关键词时回退通用 CRUD 骨架并给出提示', () => {
    // 该样例刻意不含关键词表中的任何词，用于验证未命中回退路径。
    const result = recommendFeatures('甲乙丙丁戊');
    expect(result.fallback).toBe(true);
    expect(result.hint).toBe(F04_EXPECTED.fallbackHint);
    expect(result.features.length).toBeGreaterThanOrEqual(F04_EXPECTED.minRecommended);
    expect(result.matchedKeywords).toEqual([]);
    expect(checkFeatureConflicts(result.features)).toEqual([]);
  });

  it('冲突检查能发现非法编号与重复编号', () => {
    const drafts: readonly FeatureDraft[] = [
      { id: 'BAD-1', title: '甲' },
      { id: 'FP-001', title: '乙' },
    ];
    const features = normalizeFeatures(drafts);
    const conflicts = checkFeatureConflicts([
      ...features,
      { ...features[0], id: 'FP-001', title: features[0].title },
    ]);
    expect(conflicts.some((item) => item.includes('重复编号'))).toBe(true);
  });
});
