import { describe, expect, it } from 'vitest';
import { normalize } from '../src/project';
import { recommendFeatures } from '../src/features';
import { findFile, generate, type GenerateInput } from '../src/generate';
import { getStack } from '../src/stacks/index';
import { SQL_DISABLED_SYNTAXES } from '../src/types';
import { F08_EXPECTED } from './invariants';

/** 构造生成输入，可开启 A11 三份文档。 */
function makeInput(a11 = false, stackChoice = 'java'): GenerateInput {
  const title = '基于 Java 的图书馆管理系统';
  return {
    config: normalize({
      title,
      stackChoice,
      a11Docs: a11 ? { opening: true, midterm: true, defense: true } : undefined,
    }).config,
    features: recommendFeatures(title).features,
  };
}

/** 极简 SQL 词法检查：引号、反引号与括号配对，语句以分号结束。 */
function sqlLexOk(sql: string): boolean {
  let quote = '';
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote.length > 0) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return quote.length === 0 && depth === 0 && sql.includes(';');
}

/** F08 断言测试：调用真实生成器，期望值来自硬编码字面常量断言集。 */
describe('F08 SQL / README / 清单 / 环境自检 / A11', () => {
  it('期望值均为硬编码字面常量', () => {
    expect(F08_EXPECTED.declaredChecks).toBe(10);
    expect(F08_EXPECTED.boundaryStatement).toBe(
      '本系统不验证你的本机环境；按基准环境准备即可按上述步骤运行',
    );
    expect(F08_EXPECTED.emptyFields).toEqual(['进度', '实验数据', '参考文献', '结论']);
    expect(F08_EXPECTED.a11Paths).toHaveLength(3);
  });

  it('schema / seed 词法无异常，CREATE TABLE 数 >=1、字段含 COMMENT、无禁用语法', () => {
    const result = generate(makeInput());
    const schema = findFile(result.files, 'sql/schema.sql') ?? '';
    const seed = findFile(result.files, 'sql/seed.sql') ?? '';
    expect(sqlLexOk(schema)).toBe(true);
    expect(sqlLexOk(seed)).toBe(true);
    expect((schema.match(/CREATE TABLE/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(schema).toContain('COMMENT');
    for (const syntax of SQL_DISABLED_SYNTAXES) {
      expect(schema).not.toContain(syntax);
      expect(seed).not.toContain(syntax);
    }
  });

  it('schema 表名与字段与 dataModel.entities 一致', () => {
    const input = makeInput();
    const schema = findFile(generate(input).files, 'sql/schema.sql') ?? '';
    for (const entity of input.config.dataModel.entities) {
      expect(schema).toContain(`CREATE TABLE \`${entity.name}\``);
      for (const field of entity.fields) {
        expect(schema).toContain(`\`${field.name}\``);
      }
    }
  });

  it('seed 账号字段与 auth、前端登录表单静态一致', () => {
    const input = makeInput();
    const result = generate(input);
    const seed = findFile(result.files, 'sql/seed.sql') ?? '';
    const form = findFile(result.files, 'frontend/src/LoginForm.tsx') ?? '';
    const authSource = result.files.find((file) => file.path.includes('AuthService'))?.content ?? '';
    const auth = input.config.auth;
    expect(seed).toContain(auth.demoAccount.username);
    expect(seed).toContain(auth.demoAccount.password);
    expect(seed).toContain(auth.demoAccount.role);
    expect(seed).toContain(auth.passwordField);
    expect(seed).toContain(auth.roleField);
    expect(authSource).toContain(auth.passwordField);
    expect(authSource).toContain(auth.roleField);
    for (const field of auth.loginFormFields) {
      expect(form).toContain(`name="${field}"`);
    }
  });

  it('生成产物 README 版本、命令与目录段同源', () => {
    const input = makeInput();
    const result = generate(input);
    const readme = findFile(result.files, 'README.md') ?? '';
    const template = getStack(input.config.stackId)!;
    for (const value of Object.values(input.config.versions)) {
      expect(readme).toContain(value);
    }
    for (const command of template.readmeBaseline.commands) {
      expect(readme).toContain(command.command);
    }
    for (const file of result.files) {
      expect(readme).toContain(`\`${file.path}\``);
    }
    expect(readme).toContain(F08_EXPECTED.boundaryStatement);
    expect(readme).toContain(F08_EXPECTED.demoNote);
  });

  it('JSON.parse 对生成产物 package.json 与本系统锁文件均通过', () => {
    const result = generate(makeInput());
    const pkg = findFile(result.files, 'frontend/package.json') ?? '';
    expect(() => JSON.parse(pkg)).not.toThrow();
    expect(JSON.parse(pkg)).toHaveProperty('name');
  });

  it('MANIFEST 覆盖全部产物且 A12 标待做、无产物文件', () => {
    const result = generate(makeInput());
    const manifest = findFile(result.files, 'MANIFEST.md') ?? '';
    expect(manifest).toContain(F08_EXPECTED.a12Note);
    for (const file of result.files) {
      expect(manifest).toContain(`\`${file.path}\``);
    }
    expect(result.files.some((file) => /\.(jar|exe)$|Dockerfile/.test(file.path))).toBe(false);
  });

  it('env-check.md 只含只读检查命令、不含安装动作与回填交互', () => {
    const result = generate(makeInput());
    const env = findFile(result.files, 'env-check.md') ?? '';
    expect(env).toContain('只读检查命令');
    expect(env).toContain('java -version');
    for (const forbidden of ['install', 'apt-get', 'yum', 'pip', '请核对', '请填写', '请确认', '回填']) {
      expect(env).not.toContain(forbidden);
    }
  });

  it('A11 未勾选不生成三文档，勾选时生成且事实字段全为空占位', () => {
    const off = generate(makeInput(false)).files.map((file) => file.path);
    for (const path of F08_EXPECTED.a11Paths) {
      expect(off).not.toContain(path);
    }
    const on = generate(makeInput(true)).files;
    const onPaths = on.map((file) => file.path);
    for (const path of F08_EXPECTED.a11Paths) {
      expect(onPaths).toContain(path);
      const doc = findFile(on, path) ?? '';
      for (const field of F08_EXPECTED.emptyFields) {
        expect(doc).toContain(`- ${field}：${F08_EXPECTED.emptyPlaceholder}`);
      }
    }
  });

  it('python 栈同样产出完整 SQL / README / 清单', () => {
    const result = generate(makeInput(false, 'python'));
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain('sql/schema.sql');
    expect(paths).toContain('sql/seed.sql');
    expect(paths).toContain('README.md');
    expect(paths).toContain('MANIFEST.md');
    expect(findFile(result.files, 'env-check.md')).toContain('python --version');
  });
});
