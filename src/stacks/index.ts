/**
 * 技术栈模板注册表（F05）：stackId → StackTemplate 的表驱动查表。
 *
 * 扩展点：新增第三套技术栈只需新增一个模板文件并在默认种子里登记一行；
 * 查表逻辑完全通用，生成器、UI、ZIP、历史与 README 渲染器均无需改动。
 */
import type { StackTemplate } from '../types';
import { javaTemplate } from './java';
import { pythonTemplate } from './python';

/** 注册表接口：注册、按标识取值、列出模板与标识、计数。 */
export interface StackRegistry {
  readonly register: (template: StackTemplate) => void;
  readonly get: (stackId: string) => StackTemplate | undefined;
  readonly list: () => readonly StackTemplate[];
  readonly listIds: () => readonly string[];
  readonly size: () => number;
}

/** 默认种子：两份内置模板，顺序稳定便于判定。 */
export const BUILTIN_TEMPLATES: readonly StackTemplate[] = [javaTemplate, pythonTemplate];

/**
 * 创建独立注册表实例。判据可用它模拟注册第三套技术栈，
 * 不会影响应用运行期使用的全局实例。
 */
export function createStackRegistry(
  seed: readonly StackTemplate[] = BUILTIN_TEMPLATES,
): StackRegistry {
  const entries = new Map<string, StackTemplate>();
  for (const template of seed) {
    entries.set(template.stackId, template);
  }
  return {
    register: (template: StackTemplate): void => {
      entries.set(template.stackId, template);
    },
    get: (stackId: string): StackTemplate | undefined => entries.get(stackId),
    list: (): readonly StackTemplate[] => [...entries.values()],
    listIds: (): readonly string[] => [...entries.keys()],
    size: (): number => entries.size,
  };
}

/** 应用运行期使用的全局注册表。 */
export const stackRegistry: StackRegistry = createStackRegistry();

/** 按技术栈标识取模板；未注册时返回 undefined，由调用方明确处理。 */
export function getStack(stackId: string): StackTemplate | undefined {
  return stackRegistry.get(stackId);
}

/** 列出全部已注册技术栈标识。 */
export function listStackIds(): readonly string[] {
  return stackRegistry.listIds();
}

/** 注册新模板，供扩展第三套及后续技术栈使用。 */
export function registerStack(template: StackTemplate): void {
  stackRegistry.register(template);
}
