/**
 * 固有属性断言集（F01 建立，F02~F10 复用）。
 *
 * 设计约束（与派生源无关的独立锚点）：
 * 1. 本文件所有期望值均为硬编码字面常量，不读取任何派生配置，也不调用渲染函数；
 * 2. 本文件不加载任何外部模块，保证断言集自身可独立审阅；
 * 3. 即使上游数据模型整体写错，本断言集仍能暴露结构层面的偏差。
 */

/** 判定结果只允许三种取值；UNKNOWN 由调用方一律按失败处理。 */
export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** 单条断言的观测输入：全部由调用方读取真实文件后传入。 */
export interface InvariantObservation {
  readonly scripts: readonly string[];
  readonly rootContainerIds: readonly string[];
  readonly distScriptSources: readonly string[];
  readonly declaredChecks: number;
  readonly evaluatedChecks: number;
  readonly unknownCount: number;
}

/** 单条断言结果。 */
export interface InvariantItem {
  readonly id: string;
  readonly anchor: 'rawInput' | 'parser' | 'invariant';
  readonly expected: string;
  readonly actual: string;
  readonly verdict: Verdict;
}

/**
 * 硬编码期望值区：只允许字面量。
 * 若新增期望值，必须同步写入 scripts/check.mjs 的独立期望值表；
 * 两处相互独立、互为交叉校验，不得互相读取。
 */
export const EXPECTED = {
  scripts: ['dev', 'build', 'test', 'lint', 'check'],
  rootContainerId: 'root',
  distAssetPattern: /\/assets\/[^"']+\.js/,
  declaredChecks: 6,
  nodeEngineMajor: '20',
  forbiddenPlaceholder: '{{',
} as const;

/** 未知即失败：任何非 PASS / FAIL 的取值都归一为 UNKNOWN，交由调用方计为失败。 */
export function normalizeVerdict(value: unknown): Verdict {
  if (value === 'PASS' || value === 'FAIL') {
    return value;
  }
  return 'UNKNOWN';
}

/** 二值判定助手：布尔条件直接映射为 PASS / FAIL，不产生 UNKNOWN。 */
export function verdictOf(condition: boolean): Verdict {
  return condition ? 'PASS' : 'FAIL';
}

/** 未知即失败的汇总口径：UNKNOWN 与 FAIL 都视为未通过。 */
export function isFailure(verdict: Verdict): boolean {
  return verdict !== 'PASS';
}

/** 集合包含助手：needles 必须全部出现在 haystack 中，顺序不限。 */
export function hasAll(haystack: readonly string[], needles: readonly string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

/** 应校验项数 == 已判定项数，且不存在任何未知项。 */
export function countsAreComplete(
  declaredChecks: number,
  evaluatedChecks: number,
  unknownCount: number,
): boolean {
  return declaredChecks > 0
    && declaredChecks === evaluatedChecks
    && unknownCount === 0;
}

/** 汇总固有属性断言：期望值全部取自本文件字面常量，不读取观测值作为期望。 */
export function evaluateInvariants(observed: InvariantObservation): readonly InvariantItem[] {
  const items: InvariantItem[] = [
    {
      id: 'INV-01',
      anchor: 'parser',
      expected: EXPECTED.scripts.join(','),
      actual: observed.scripts.join(','),
      verdict: verdictOf(hasAll(observed.scripts, EXPECTED.scripts)),
    },
    {
      id: 'INV-02',
      anchor: 'invariant',
      expected: EXPECTED.rootContainerId,
      actual: observed.rootContainerIds.join(','),
      verdict: verdictOf(observed.rootContainerIds.includes(EXPECTED.rootContainerId)),
    },
    {
      id: 'INV-03',
      anchor: 'parser',
      expected: String(EXPECTED.distAssetPattern),
      actual: observed.distScriptSources.join(','),
      verdict: verdictOf(
        observed.distScriptSources.some((source) => EXPECTED.distAssetPattern.test(source)),
      ),
    },
    {
      id: 'INV-04',
      anchor: 'invariant',
      expected: String(EXPECTED.declaredChecks),
      actual: String(observed.declaredChecks),
      verdict: verdictOf(observed.declaredChecks === EXPECTED.declaredChecks),
    },
    {
      id: 'INV-05',
      anchor: 'invariant',
      expected: 'declaredChecks == evaluatedChecks && unknownCount == 0',
      actual: `${observed.declaredChecks}/${observed.evaluatedChecks}/${observed.unknownCount}`,
      verdict: verdictOf(countsAreComplete(
        observed.declaredChecks,
        observed.evaluatedChecks,
        observed.unknownCount,
      )),
    },
  ];
  return items;
}
