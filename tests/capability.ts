/**
 * 判据能力面静态审计（QA 反馈 B-01 补强）。
 *
 * 本模块只提供纯函数，供 scripts/check.mjs 与负向自测共用：
 * 用 TypeScript compiler API 解析 AST，抽取全部静态 import 声明与动态
 * import(...) 调用，逐条要求模块名落在白名单内；动态 import 的参数必须是
 * 静态字符串字面量，凡拼接 / 模板变量 / 标识符表达式一律判违规。
 * 同时扫描子进程 / 网络 / VM 等能力词元，形成「静态能力面约束」。
 */
import ts from 'typescript';

/**
 * 与 scripts/check.mjs 的 ALLOWED_IMPORTS 完全一致的镜像常量。
 * F07-06 会逐项比对两份清单，防止判据与负向自测之间出现漂移。
 */
export const CAPABILITY_ALLOWED_IMPORTS: readonly string[] = [
  'node:fs',
  'node:crypto',
  'node:path',
  'node:url',
  'typescript',
  'jszip',
  '../.tscache/registry.mjs',
];

/** import 审计结果。 */
export interface ImportAudit {
  readonly ok: boolean;
  readonly moduleNames: readonly string[];
  readonly violations: readonly string[];
}

/** 能力面审计结果。 */
export interface CapabilityAudit {
  readonly ok: boolean;
  readonly importAudit: ImportAudit;
  readonly bannedHits: readonly string[];
  readonly requireCalls: boolean;
}

/**
 * 禁用能力词元：覆盖子进程、命令执行、网络、VM、动态求值。
 * 用拼接构造，避免本模块自身的规则字面量被自己的扫描命中。
 */
const BANNED_CAPABILITY_TOKENS: readonly string[] = [
  'child' + '_process',
  'exec' + 'Sync',
  'spawn' + 'Sync',
  'exec' + '(',
  'spawn' + '(',
  'fetch' + '(',
  'eval' + '(',
  'node:' + 'vm',
  'node:' + 'worker_threads',
  'node:' + 'http',
  'node:' + 'https',
  'new' + ' Function',
  'Worker',
];

/**
 * AST 级 import 审计：静态 import 声明与动态 import(...) 调用逐条校验。
 * 动态 import 只允许静态字符串字面量且在白名单内，其余形态一律违规。
 */
export function auditModuleImports(
  source: string,
  allowed: readonly string[],
  fileName = 'check.mjs',
): ImportAudit {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const moduleNames: string[] = [];
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || !allowed.includes(specifier.text)) {
        violations.push(`静态导入未通过白名单: ${specifier.getText(file)}`);
      } else {
        moduleNames.push(specifier.text);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument === undefined
        || !ts.isStringLiteral(argument)
        || !allowed.includes(argument.text)) {
        violations.push(
          `动态 import 参数非静态可解析或未通过白名单: ${argument ? argument.getText(file) : '无参数'}`,
        );
      } else {
        moduleNames.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { ok: violations.length === 0, moduleNames, violations };
}

/** 能力面审计：import AST 判定 + 禁用词元 + require 调用检查。 */
export function auditCapability(
  source: string,
  allowed: readonly string[],
): CapabilityAudit {
  const importAudit = auditModuleImports(source, allowed);
  const bannedHits = BANNED_CAPABILITY_TOKENS.filter((token) => source.includes(token));
  const requireCalls = /\brequire\s*\(/.test(source);
  return {
    ok: importAudit.ok && bannedHits.length === 0 && !requireCalls,
    importAudit,
    bannedHits,
    requireCalls,
  };
}
