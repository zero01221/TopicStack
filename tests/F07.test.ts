import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { normalize } from '../src/project';
import { recommendFeatures } from '../src/features';
import { findFile, generate, renderTemplate, type GenerateInput } from '../src/generate';
import { F07_EXPECTED } from './invariants';

/** 按指定技术栈构造生成输入。 */
function makeInput(stackChoice: string, title = '基于 Java 的图书馆管理系统'): GenerateInput {
  return {
    config: normalize({ title, stackChoice }).config,
    features: recommendFeatures(title).features,
  };
}

/** 源码结构标记计数：类、公开方法与条件分支。 */
function countStructureMarkers(content: string): number {
  const patterns = [/public\s+class\b/g, /public\s+\w+\s+\w+\s*\(/g, /\bif\s*\(/g, /^\s*def\s+\w+\s*\(/gm];
  return patterns.reduce((sum, pattern) => sum + (content.match(pattern) ?? []).length, 0);
}

/** F07 断言测试：调用真实生成器，期望值来自硬编码字面常量断言集。 */
describe('F07 源码注释与讲解材料', () => {
  it('期望值均为硬编码字面常量', () => {
    expect(F07_EXPECTED.declaredChecks).toBe(7);
    expect(F07_EXPECTED.commentKeywords).toEqual(['做什么', '为什么']);
    expect(F07_EXPECTED.explainerPath).toBe('docs/讲解材料.md');
  });

  it('文件映射含 frontend/** 与 backend/**', () => {
    const files = generate(makeInput('java')).files.map((file) => file.path);
    expect(files.some((path) => path.startsWith('frontend/'))).toBe(true);
    expect(files.some((path) => path.startsWith('backend/'))).toBe(true);
    expect(files).toContain(F07_EXPECTED.explainerPath);
  });

  it('每个源码文件的中文注释数量覆盖类 / 方法 / 分支标记', () => {
    const result = generate(makeInput('java'));
    const sources = result.files.filter((file) => /\.(java|py|ts|tsx|js)$/.test(file.path));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const markers = countStructureMarkers(source.content);
      for (const keyword of F07_EXPECTED.commentKeywords) {
        const count = (source.content.match(new RegExp(keyword, 'g')) ?? []).length;
        expect(count).toBeGreaterThanOrEqual(Math.max(markers, F07_EXPECTED.minCommentPerMarker));
      }
    }
  });

  it('讲解材料每个锚点的 file 与 symbol 都存在于同次输出', () => {
    const result = generate(makeInput('python'));
    const doc = findFile(result.files, F07_EXPECTED.explainerPath) ?? '';
    expect(doc).toContain(F07_EXPECTED.followUpHeading);
    expect(result.explainerAnchors.length).toBeGreaterThan(0);
    for (const anchor of result.explainerAnchors) {
      const target = findFile(result.files, anchor.file);
      expect(target).toBeDefined();
      expect(target).toContain(anchor.symbol);
      expect(doc).toContain(anchor.file);
      expect(doc).toContain(anchor.symbol);
    }
  });

  it('切换 java / python 产出不同的后端文件与依赖配置', () => {
    const java = generate(makeInput('java'));
    const python = generate(makeInput('python'));
    expect(java.files.map((file) => file.path)).toContain('backend/pom.xml');
    expect(python.files.map((file) => file.path)).toContain('backend/requirements.txt');
    expect(java.files.some((file) => file.path.endsWith('.java'))).toBe(true);
    expect(python.files.some((file) => file.path.endsWith('.py'))).toBe(true);
    const javaBackend = java.files.filter((file) => file.path.startsWith('backend/'))
      .map((file) => file.content).join('\n');
    const pythonBackend = python.files.filter((file) => file.path.startsWith('backend/'))
      .map((file) => file.content).join('\n');
    expect(javaBackend).not.toBe(pythonBackend);
  });

  it('生成产物 TS / TSX 经 TypeScript compiler API 语法解析无诊断', () => {
    const result = generate(makeInput('java'));
    const tsFiles = result.files.filter((file) => /\.(ts|tsx)$/.test(file.path));
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const file of tsFiles) {
      const output = ts.transpileModule(file.content, {
        fileName: file.path,
        reportDiagnostics: true,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      });
      expect(output.diagnostics ?? []).toEqual([]);
    }
  });

  it('渲染后无占位符残留，且渲染器仍拒绝未知占位符', () => {
    const result = generate(makeInput('java'));
    for (const file of result.files) {
      expect(file.content).not.toContain('{{');
    }
    expect(() => renderTemplate('{{missing}}', {}, 'F07')).toThrow();
  });
});
