import { join, normalize } from '@/lib/path'
import { useVaultStore } from '@/stores/vault'
import { TauriVaultFS } from '@/lib/fs/tauri'

const cache = new Map<string, { url: string; bytes: Uint8Array }>()

/**
 * Turns a vault-relative path (e.g. `papers/.../assets/figure-1.png`) into a URL
 * usable by <img src>. Desktop uses the asset protocol (streams from disk, no copy),
 * browser mode falls back to an object URL.
 */
export function assetUrlFor(rel: string): string | null {
  const fs = useVaultStore.getState().fs
  if (!fs) return null
  const key = normalize(rel)
  const hit = cache.get(key)
  if (hit) return hit.url
  if (fs instanceof TauriVaultFS) {
    const url = fs.assetUrl(key)
    cache.set(key, { url, bytes: new Uint8Array() })
    return url
  }
  return null
}

/** Async variant for browser/OPFS mode: reads bytes once and memoizes the blob URL. */
export async function resolveAssetUrl(rel: string): Promise<string | null> {
  const fs = useVaultStore.getState().fs
  if (!fs) return null
  const key = normalize(rel)

  if (fs instanceof TauriVaultFS) return fs.assetUrl(key)

  const hit = cache.get(key)
  if (hit) return hit.url

  try {
    const bytes = await fs.readBytes(key)
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
    cache.set(key, { url, bytes })
    return url
  } catch (err) {
    console.warn('[assets] cannot resolve', key, err)
    return null
  }
}

export function clearAssetCache() {
  for (const { url } of cache.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  cache.clear()
}

/**
 * 把笔记里写的相对图片路径解析成「文献库相对路径」。
 *
 * 笔记里写的是 `assets/p3-1.png`（相对笔记文件自己），
 * 文献笔记在 `papers/<dir>/`，独立笔记在 `notes/`。三条渲染路径
 * （阅读视图 / 实时预览 / 老的内容编辑器）以前各写一份，容易飘。
 */
export function resolveNoteImagePath(raw: string, paperDir: string): string {
  const clean = raw.replace(/^\.\//, '')
  if (clean.startsWith('papers/') || clean.startsWith('notes/')) return clean
  return paperDir ? join('papers', paperDir, clean) : join('notes', clean)
}

/**
 * 把笔记正文里的相对图片路径换成可显示的 URL。
 *
 * note.md 里写的是 `![image](assets/p3-1.png)` —— 相对笔记文件本身。
 * 显示时才知道真实路径（Tauri 的 asset 协议 / 浏览器的 blob），
 * 所以原路径留在 data-path 上，src 只负责渲染，序列化回 markdown 时用 data-path。
 */
export async function hydrateImages(root: HTMLElement, paperDir: string): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const raw = img.getAttribute('data-path') ?? img.getAttribute('src') ?? ''
      if (!raw) return
      if (/^(https?:|data:|blob:|asset:)/i.test(raw)) return
      img.setAttribute('data-path', raw)
      const rel = resolveNoteImagePath(raw, paperDir)
      const url = await resolveAssetUrl(rel)
      if (url) {
        img.src = url
        img.removeAttribute('data-missing')
      } else {
        img.setAttribute('data-missing', '1')
      }
    }),
  )
}
