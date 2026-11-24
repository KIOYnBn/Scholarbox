import { join } from '@/lib/path'
import type { VaultFS } from '@/lib/fs/types'

/**
 * 笔记附件（图片等）的统一存储目录 —— 仓库根下的 `attachments/`。
 *
 * 与 Obsidian 的 attachment folder 对齐：所有笔记（独立笔记 + 文献笔记）
 * 新插入的图片都落到这里，正文里写全路径 `attachments/<名字>`，无论笔记
 * 搬到哪、文献文件夹改名，图片链接都不会断。老的文献截图仍存在
 * `papers/<dir>/assets/` 里，读取兼容不变。
 */
export const ATTACHMENTS_DIR = 'attachments'

/** Windows 禁用字符 + 路径分隔符 + 控制符，统一替换成下划线 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

/** 清理文件名：去掉路径部分与非法字符，保证能安全落盘 */
export function sanitizeImageName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').trim().replace(ILLEGAL, '_')
  return base || 'image.png'
}

/** 取扩展名（含点，小写）；没有扩展名返回 null */
function extOf(name: string): string | null {
  const match = /\.(?<ext>[a-z0-9]+)$/i.exec(name)
  if (!match) return null
  return `.${match[1].toLowerCase()}`
}

/**
 * 撞名自动加序号：`p.png` 存在 → `p-2.png` → `p-3.png` …
 * 返回不冲突的文件名（不含目录）。没有扩展名按 .png 处理。
 */
export async function uniqueImageName(fs: VaultFS, name: string): Promise<string> {
  const ext = extOf(name) ?? '.png'
  const stem = extOf(name) ? name.slice(0, name.length - ext.length) : name
  const base = stem.trim() || 'image'
  let candidate = `${base}${ext}`
  for (let index = 2; index < 1000; index += 1) {
    if (!(await fs.exists(join(ATTACHMENTS_DIR, candidate)))) return candidate
    candidate = `${base}-${index}${ext}`
  }
  // 兜底：时间戳名字，基本不可能再撞
  return `${base}-${Date.now()}${ext}`
}

/**
 * 保存一张图片到 `attachments/`，返回「仓库相对路径」（正文里直接引用这个）。
 * 撞名自动加序号，绝不覆盖已有文件。
 */
export async function saveNoteImage(fs: VaultFS, bytes: Uint8Array, filename: string): Promise<string> {
  const dir = ATTACHMENTS_DIR
  if (!(await fs.exists(dir))) await fs.mkdir(dir)
  const unique = await uniqueImageName(fs, sanitizeImageName(filename))
  const rel = join(dir, unique)
  await fs.writeBytes(rel, bytes)
  return rel
}

/** 文件选择器：选一张或多张图片（桌面 / 浏览器通用，不依赖 Tauri 对话框） */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const done = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    // 用户点取消：窗口重新获得焦点且没有文件就算取消
    window.addEventListener(
      'focus',
      () => window.setTimeout(() => done([]), 300),
      { once: true },
    )
    input.click()
  })
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

/** 这个文件是不是可插入笔记的图片 */
export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}
