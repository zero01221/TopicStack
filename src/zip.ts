/**
 * ZIP 导出（F10）：把确定性生成器输出的虚拟文件树打包为单个压缩包。
 *
 * 只做文本打包，不编译、不执行任何生成产物，也不发起网络请求。
 * buildZipBuffer 返回字节数组，既供浏览器下载，也供判据用 JSZip 解包回读。
 */
import JSZip from 'jszip';
import type { Deliverable } from './types';

/** 由快照版本派生文件名，避免用户手填命名。 */
export function makeZipFileName(version: string): string {
  return `TopicStack-${version}.zip`;
}

/** 校验交付物路径：必须相对、不含路径穿越、统一使用正斜杠。 */
export function isSafeDeliverablePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').includes('..')
    && !/^[A-Za-z]:/.test(path);
}

/**
 * 生成 ZIP 字节数组。任何非法路径都会明确抛错阻断，
 * 不会静默产出含路径穿越条目的压缩包。
 */
export async function buildZipBuffer(files: readonly Deliverable[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of files) {
    if (!isSafeDeliverablePath(file.path)) {
      throw new Error(`[ZIP] 非法交付物路径: ${file.path}`);
    }
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** 浏览器触发下载：生成 Blob、创建临时链接后立即释放 URL。 */
export async function downloadZip(
  filename: string,
  files: readonly Deliverable[],
): Promise<void> {
  const buffer = await buildZipBuffer(files);
  // 复制为确定的 ArrayBuffer，避免 Uint8Array<ArrayBufferLike> 与 BlobPart 的类型不兼容。
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  const blob = new Blob([arrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
