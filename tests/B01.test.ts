import { describe, expect, it } from 'vitest';
import {
  auditCapability,
  auditModuleImports,
  CAPABILITY_ALLOWED_IMPORTS,
} from './capability';

/**
 * B-01 负向自测：只构造「假脚本」验证判据本身，
 * 绝不在 scripts/check.mjs 中写入任何真实绕过代码。
 */
describe('B-01 判据能力面负向自测', () => {
  it('拼接式动态 import 等绕过形态全部被拦截，合法静态导入放行', () => {
    const allowed = [...CAPABILITY_ALLOWED_IMPORTS];
    const attacks: readonly string[] = [
      "const m = await import('node:' + 'child_' + 'process');",
      "const m = await import('node:' + 'worker_' + 'threads');",
      'const m = await import(prefix + "vm");',
      'const m = await import(`node:${name}`);',
      'const m = await import(moduleName);',
    ];
    for (const attack of attacks) {
      const importAudit = auditModuleImports(attack, allowed);
      expect(importAudit.ok).toBe(false);
      expect(importAudit.violations.some((line) => line.includes('动态 import'))).toBe(true);
      expect(auditCapability(attack, allowed).ok).toBe(false);
    }

    const legal: readonly string[] = [
      "import ts from 'typescript';",
      "const registry = await import('../.tscache/registry.mjs');",
    ];
    for (const source of legal) {
      expect(auditModuleImports(source, allowed).ok).toBe(true);
    }
    expect(auditCapability(legal.join('\n'), allowed).ok).toBe(true);
  });

  it('禁用词元扫描覆盖网络 / VM / 动态求值能力', () => {
    const allowed = [...CAPABILITY_ALLOWED_IMPORTS];
    const samples: readonly string[] = [
      "import vm from 'node:vm';",
      "const r = await fetch('http://example.invalid');",
      'const worker = new Worker(task);',
      'const fn = new Function(code);',
    ];
    for (const sample of samples) {
      const audit = auditCapability(sample, allowed);
      expect(audit.ok).toBe(false);
    }
  });
});
