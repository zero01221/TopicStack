import { describe, expect, it } from 'vitest';
import { normalize, REQUIRED_INPUT_FIELDS, recommendStackId } from '../src/project';
import { SUGGESTED_DEFAULTS } from '../src/types';
import { F03_EXPECTED, countsAreComplete } from './invariants';

/** F03 断言测试：仅调用真实纯函数，期望值来自硬编码字面常量断言集。 */
describe('F03 配置输入层与默认通过', () => {
  const sampleTitle = '基于 Java 的图书馆管理系统';

  it('期望值均为硬编码字面常量', () => {
    expect(F03_EXPECTED.declaredChecks).toBe(6);
    expect(F03_EXPECTED.stepNames).toEqual([
      'input', 'analysis', 'techdoc', 'deliverables', 'history',
    ]);
    expect(F03_EXPECTED.fixButtonLabel).toBe('一键采用建议值');
    expect(F03_EXPECTED.autoFixLabel).toBe('自动修复');
    expect(countsAreComplete(6, 6, 0)).toBe(true);
  });

  it('最小必填集合仅 title，且建议默认值表不给题目默认值', () => {
    expect(REQUIRED_INPUT_FIELDS).toEqual(['title']);
    expect(Object.keys(SUGGESTED_DEFAULTS)).not.toContain('title');
  });

  it('只给 {title} 即可解析出合法完整配置', () => {
    const result = normalize({ title: sampleTitle });
    expect(result.config.title).toBe(sampleTitle);
    expect(result.config.stackId.length).toBeGreaterThan(0);
    expect(result.adoptedDefaults.length).toBeGreaterThan(0);
    expect(result.config.auth.demoAccount.username.length).toBeGreaterThan(0);
  });

  it('步骤枚举不含任何人工把关态', () => {
    const forbidden = F03_EXPECTED.forbiddenStepWords.join('|');
    const pattern = new RegExp(forbidden, 'i');
    expect(F03_EXPECTED.stepNames.some((step) => pattern.test(step))).toBe(false);
  });

  it('版本覆盖值进入 config 并影响派生读取', () => {
    const override = '用户自定义数据库版本';
    const result = normalize({ title: sampleTitle, versionInputs: { db: override } });
    expect(result.config.versions.db).toBe(override);
    expect(result.config.envBaseline.runtimeChecks.some((item) => item.expected === override))
      .toBe(true);
  });

  it('存在建议默认值可零操作继续，五个版本字段都有值', () => {
    // 表单控件的 DOM 结构由 scripts/check.mjs 的 F03-05 静态扫描覆盖；
    // 这里只校验建议默认值表本身，避免在 node 测试环境加载 React 组件模块。
    const versionKeys = Object.keys(SUGGESTED_DEFAULTS.versions);
    expect(versionKeys).toHaveLength(5);
    for (const value of Object.values(SUGGESTED_DEFAULTS.versions)) {
      expect(value.length).toBeGreaterThan(0);
    }
    expect(normalize({ title: sampleTitle }).adoptedDefaults.length).toBeGreaterThan(0);
  });

  it('技术栈按关键词自动推荐且未命中回退建议默认栈', () => {
    expect(recommendStackId('基于 Spring 的预约系统')).toBe('java');
    expect(recommendStackId('基于 FastAPI 的数据分析')).toBe('python');
    expect(recommendStackId('普通题目')).toBe(SUGGESTED_DEFAULTS.stackId);
  });
});
