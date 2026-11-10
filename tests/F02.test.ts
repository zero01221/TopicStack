import { describe, expect, it } from 'vitest';
import { normalize, REQUIRED_CONFIG_FIELDS, REQUIRED_INPUT_FIELDS, recommendStackId } from '../src/project';
import { SUGGESTED_DEFAULTS } from '../src/types';
import { F02_EXPECTED, countsAreComplete } from './invariants';

/** F02 断言测试：直接调用真实规范化函数，期望值来自硬编码字面常量断言集。 */
describe('F02 配置单一数据源', () => {
  const rawTitle = '  基于 Java 的  图书馆 管理系统  ';
  const cleanTitle = '基于 Java 的 图书馆 管理系统';

  it('期望值均为硬编码字面常量且计数助手完备', () => {
    expect(F02_EXPECTED.declaredChecks).toBe(7);
    expect(F02_EXPECTED.requiredInputFields).toEqual(['title']);
    expect(F02_EXPECTED.requiredConfigFields).toHaveLength(12);
    expect(F02_EXPECTED.versionFieldCount).toBe(5);
    expect(countsAreComplete(7, 7, 0)).toBe(true);
    expect(countsAreComplete(7, 6, 1)).toBe(false);
  });

  it('最小必填集合仅 title 且建议默认值表不给题目默认值', () => {
    expect(REQUIRED_INPUT_FIELDS).toEqual(['title']);
    expect(Object.keys(SUGGESTED_DEFAULTS)).not.toContain('title');
  });

  it('normalize({title}) 产出全部必填字段且自动采用的默认值非空', () => {
    const result = normalize({ title: rawTitle });
    for (const field of REQUIRED_CONFIG_FIELDS) {
      expect(result.config[field as keyof typeof result.config]).toBeDefined();
    }
    expect(F02_EXPECTED.requiredConfigFields.every(
      (field) => result.config[field as keyof typeof result.config] !== undefined,
    )).toBe(true);
    expect(result.adoptedDefaults.length).toBeGreaterThan(0);
  });

  it('normalize 幂等：再次传入结果得到完全相同的对象', () => {
    const first = normalize({ title: rawTitle });
    const second = normalize(first);
    expect(second).toBe(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('原始输入锚点原样留存、被冻结，且与规范化题目可分别读取', () => {
    const config = normalize({ title: rawTitle }).config;
    expect(config.rawInput.title).toBe(rawTitle);
    expect(config.title).toBe(cleanTitle);
    expect(config.title).not.toBe(config.rawInput.title);
    expect(Object.isFrozen(config.rawInput)).toBe(true);
    expect(Object.isFrozen(config.rawInput.versionInputs)).toBe(true);
  });

  it('必填缺失时明确拒绝，不静默产出半成品', () => {
    expect(() => normalize({})).toThrow(/title/);
  });

  it('版本覆盖进入 config 并影响派生读取', () => {
    const override = '用户自定义语言版本';
    const result = normalize({
      title: rawTitle,
      versionInputs: { language: override },
    });
    expect(result.config.versions.language).toBe(override);
    expect(result.config.envBaseline.runtimeChecks.some((item) => item.expected === override))
      .toBe(true);
    expect(result.config.rawInput.versionInputs.language).toBe(override);
  });

  it('派生字段均可从 config 读出', () => {
    const config = normalize({ title: rawTitle }).config;
    expect(config.dirTree.entries.length).toBeGreaterThan(0);
    expect(config.auth.demoAccount.username.length).toBeGreaterThan(0);
    expect(Object.keys(config.versions)).toHaveLength(F02_EXPECTED.versionFieldCount);
    expect(config.commentPolicy.requireWhatAndWhy).toBe(true);
  });

  it('技术栈按关键词自动推荐，未命中回退建议默认栈', () => {
    expect(recommendStackId('基于 Spring Boot 的宿舍管理系统')).toBe('java');
    expect(recommendStackId('基于 FastAPI 的数据分析平台')).toBe('python');
    expect(recommendStackId('一个没有关键词的题目')).toBe(SUGGESTED_DEFAULTS.stackId);
  });
});
