import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, createStackRegistry, getStack, listStackIds } from '../src/stacks/index';
import { javaTemplate } from '../src/stacks/java';
import { pythonTemplate } from '../src/stacks/python';
import { MYSQL_CAPABILITY_TABLE, SUGGESTED_DEFAULTS } from '../src/types';
import type { StackTemplate } from '../src/types';
import { F05_EXPECTED } from './invariants';

/** 简易 XML 标签配对检查：忽略声明、注释与自闭合标签。 */
function xmlTagsBalanced(text: string): boolean {
  const cleaned = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  for (const entry of cleaned.matchAll(/<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?\/?>/g)) {
    const raw = entry[0];
    if (raw.startsWith('</')) {
      if (stack.pop() !== entry[1]) {
        return false;
      }
    } else if (!raw.endsWith('/>')) {
      stack.push(entry[1]);
    }
  }
  return stack.length === 0;
}

/** requirements.txt 行格式：名称==版本 / 注释 / 空行。 */
function requirementsLinesValid(text: string): boolean {
  let contentLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    contentLines += 1;
    if (!/^[A-Za-z0-9_.-]+==[^\s]+$/.test(trimmed)) {
      return false;
    }
  }
  return contentLines > 0;
}

/** F05 断言测试：调用真实注册表与模板表，期望值来自硬编码字面常量断言集。 */
describe('F05 双栈模板注册表', () => {
  it('期望值均为硬编码字面常量', () => {
    expect(F05_EXPECTED.declaredChecks).toBe(7);
    expect(F05_EXPECTED.stackIds).toEqual(['java', 'python']);
    expect(F05_EXPECTED.requiredTemplateFields).toHaveLength(12);
    expect(F05_EXPECTED.sqlDisabledKeywords).toEqual(['OVER (', 'WITH ... AS', 'JSON_TABLE']);
    expect(F05_EXPECTED.mysqlVersions).toEqual(['MySQL 5.7', 'MySQL 8.0']);
  });

  it('注册表标识恰含 java 与 python', () => {
    expect(listStackIds()).toEqual(['java', 'python']);
    expect(BUILTIN_TEMPLATES).toHaveLength(2);
    expect(getStack('java')?.stackId).toBe('java');
    expect(getStack('python')?.stackId).toBe('python');
    expect(getStack('unknown')).toBeUndefined();
  });

  it('每栈 StackTemplate 必填字段齐全且非空', () => {
    for (const template of [javaTemplate, pythonTemplate]) {
      for (const field of F05_EXPECTED.requiredTemplateFields) {
        expect(template[field as keyof StackTemplate]).toBeDefined();
      }
      expect(template.depsConfig.file.length).toBeGreaterThan(0);
      expect(template.depsConfig.template.length).toBeGreaterThan(0);
      expect(template.readmeBaseline.commands.length).toBeGreaterThan(0);
      expect(template.explainerAnchors.length).toBeGreaterThan(0);
    }
  });

  it('版本只能来自建议默认值表，模板表与单一数据源同引用', () => {
    expect(javaTemplate.suggestedVersions).toBe(SUGGESTED_DEFAULTS.versions);
    expect(pythonTemplate.suggestedVersions).toBe(SUGGESTED_DEFAULTS.versions);
    expect(javaTemplate.sqlDialect.selectedDbVersion).toBe(SUGGESTED_DEFAULTS.versions.db);
    expect(pythonTemplate.sqlDialect.selectedDbVersion).toBe(SUGGESTED_DEFAULTS.versions.db);
  });

  it('模拟注册第三套技术栈后可直接查表，注册表长度加一', () => {
    const registry = createStackRegistry();
    const before = registry.size();
    const mock: StackTemplate = {
      ...javaTemplate,
      stackId: F05_EXPECTED.mockStackId,
      label: '模拟第三栈',
    };
    registry.register(mock);
    expect(registry.size()).toBe(before + 1);
    expect(registry.get(F05_EXPECTED.mockStackId)?.label).toBe('模拟第三栈');
    expect(registry.listIds()).toContain(F05_EXPECTED.mockStackId);
    // 全局注册表不受模拟注册影响。
    expect(listStackIds()).toEqual(['java', 'python']);
  });

  it('两栈 SQL 方言覆盖禁用语法清单与各 MySQL 版本能力表', () => {
    for (const template of [javaTemplate, pythonTemplate]) {
      for (const keyword of F05_EXPECTED.sqlDisabledKeywords) {
        expect(template.sqlDialect.disabledSyntaxes).toContain(keyword);
      }
      for (const version of F05_EXPECTED.mysqlVersions) {
        expect(template.sqlDialect.capabilityTable[version]).toBeDefined();
      }
      const legacy = template.sqlDialect.capabilityTable['MySQL 5.7'];
      expect(legacy.windowFunctions).toBe(false);
      expect(legacy.cte).toBe(false);
      expect(legacy.jsonTable).toBe(false);
      expect(template.sqlDialect.capabilityTable).toBe(MYSQL_CAPABILITY_TABLE);
    }
  });

  it('pom.xml 标签配对通过，requirements.txt 每行格式合法', () => {
    expect(xmlTagsBalanced(javaTemplate.depsConfig.template)).toBe(true);
    expect(requirementsLinesValid(pythonTemplate.depsConfig.template)).toBe(true);
    expect(javaTemplate.depsConfig.file).toBe('pom.xml');
    expect(pythonTemplate.depsConfig.file).toBe('requirements.txt');
  });
});
