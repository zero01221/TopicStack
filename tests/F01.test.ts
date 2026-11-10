import { describe, expect, it } from 'vitest';
import {
  EXPECTED,
  countsAreComplete,
  evaluateInvariants,
  hasAll,
  isFailure,
  normalizeVerdict,
  verdictOf,
  type InvariantObservation,
} from './invariants';

/** F01 纯函数断言测试：不读取磁盘、不启动服务，全部为确定性二值判定。 */
describe('F01 固有属性断言集', () => {
  const healthy: InvariantObservation = {
    scripts: ['dev', 'build', 'test', 'lint', 'check'],
    rootContainerIds: ['root'],
    distScriptSources: ['/assets/index-abc123.js'],
    declaredChecks: 6,
    evaluatedChecks: 6,
    unknownCount: 0,
  };

  it('期望值必须是硬编码字面常量', () => {
    expect(EXPECTED.scripts).toEqual(['dev', 'build', 'test', 'lint', 'check']);
    expect(EXPECTED.rootContainerId).toBe('root');
    expect(EXPECTED.declaredChecks).toBe(6);
    expect(EXPECTED.nodeEngineMajor).toBe('20');
    expect(EXPECTED.forbiddenPlaceholder).toBe('{{');
  });

  it('健康观测的所有固有属性均为 PASS', () => {
    const items = evaluateInvariants(healthy);
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.verdict === 'PASS')).toBe(true);
  });

  it('缺少必需脚本时应判定为 FAIL', () => {
    const items = evaluateInvariants({ ...healthy, scripts: ['dev', 'build'] });
    expect(items[0].verdict).toBe('FAIL');
  });

  it('根容器缺失时应判定为 FAIL', () => {
    const items = evaluateInvariants({ ...healthy, rootContainerIds: ['app'] });
    expect(items[1].verdict).toBe('FAIL');
  });

  it('构建后 JS 资源不匹配时应判定为 FAIL', () => {
    const items = evaluateInvariants({ ...healthy, distScriptSources: ['/src/main.tsx'] });
    expect(items[2].verdict).toBe('FAIL');
  });

  it('未知即失败：非二值取值归一为 UNKNOWN，且 UNKNOWN 与 FAIL 均算未通过', () => {
    expect(normalizeVerdict('PASS')).toBe('PASS');
    expect(normalizeVerdict('FAIL')).toBe('FAIL');
    expect(normalizeVerdict(undefined)).toBe('UNKNOWN');
    expect(normalizeVerdict('未执行')).toBe('UNKNOWN');
    expect(isFailure(normalizeVerdict(undefined))).toBe(true);
    expect(isFailure('PASS')).toBe(false);
  });

  it('应校验项数必须等于已判定项数且未知项为 0', () => {
    expect(countsAreComplete(6, 6, 0)).toBe(true);
    expect(countsAreComplete(6, 5, 0)).toBe(false);
    expect(countsAreComplete(6, 6, 1)).toBe(false);
    expect(countsAreComplete(0, 0, 0)).toBe(false);
  });

  it('集合包含助手与二值助手行为正确', () => {
    expect(hasAll(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
    expect(hasAll(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(verdictOf(true)).toBe('PASS');
    expect(verdictOf(false)).toBe('FAIL');
  });
});
