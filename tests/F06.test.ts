import { describe, expect, it } from 'vitest';
import { normalize } from '../src/project';
import { recommendFeatures } from '../src/features';
import {
  buildTechDoc,
  buildValues,
  findFile,
  generate,
  hashTextFiles,
  renderTemplate,
  type GenerateInput,
} from '../src/generate';
import { getStack } from '../src/stacks/index';
import { F06_EXPECTED } from './invariants';

/** 构造标准生成输入。 */
function makeInput(): GenerateInput {
  const title = F06_EXPECTED.sampleTitle;
  return {
    config: normalize({ title }).config,
    features: recommendFeatures(title).features,
  };
}

/** F06 断言测试：调用真实渲染引擎与生成器，期望值来自硬编码字面常量断言集。 */
describe('F06 渲染引擎与技术文档', () => {
  it('期望值均为硬编码字面常量', () => {
    expect(F06_EXPECTED.declaredChecks).toBe(6);
    expect(F06_EXPECTED.sections).toEqual([
      '技术栈分析', '开发流程', '目录结构', '环境说明',
    ]);
    expect(F06_EXPECTED.techDocPath).toBe('docs/技术文档.md');
  });

  it('同一输入连续两次 generate() 输出全等', () => {
    const input = makeInput();
    const first = generate(input);
    const second = generate(input);
    expect(JSON.stringify(second.files)).toBe(JSON.stringify(first.files));
    expect(hashTextFiles(second.files)).toBe(hashTextFiles(first.files));
  });

  it('技术文档四节齐全，栈名与版本取自 config', () => {
    const input = makeInput();
    const result = generate(input);
    const doc = findFile(result.files, F06_EXPECTED.techDocPath);
    expect(doc).toBeDefined();
    for (const section of F06_EXPECTED.sections) {
      expect(doc).toContain(`## ${section}`);
    }
    expect(doc).toContain(input.config.title);
    for (const value of Object.values(input.config.versions)) {
      expect(doc).toContain(value);
    }
    expect(doc).toContain(result.config.rawInput.title);
  });

  it('renderTemplate 遇未替换占位符明确抛错', () => {
    expect(() => renderTemplate('前缀 {{missing.key}} 后缀', {}, '单元测试'))
      .toThrow(/未替换占位符/);
    expect(() => renderTemplate('前缀 {{known}}', { known: '值' }, '单元测试'))
      .not.toThrow();
  });

  it('渲染结果不含占位符残留', () => {
    expect(renderTemplate('{{known}}', { known: '值' }, '单元测试')).toBe('值');
    const result = generate(makeInput());
    for (const file of result.files) {
      expect(file.content).not.toContain(F06_EXPECTED.placeholderLeftover);
    }
  });

  it('未注册技术栈明确拒绝，不静默产出半成品', () => {
    const config = normalize({ title: F06_EXPECTED.sampleTitle, stackChoice: 'unknown-stack' }).config;
    expect(() => generate({ config, features: [] })).toThrow(/未注册的技术栈/);
  });

  it('buildValues 与 buildTechDoc 可独立调用且同源', () => {
    const config = normalize({ title: F06_EXPECTED.sampleTitle }).config;
    const template = getStack(config.stackId);
    expect(template).toBeDefined();
    const values = buildValues(config, template!);
    expect(values['versions.db']).toBe(config.versions.db);
    expect(values['project.rawTitle']).toBe(config.rawInput.title);
    const doc = buildTechDoc({ config, features: [], template: template!, values });
    expect(doc.path).toBe(F06_EXPECTED.techDocPath);
  });
});
