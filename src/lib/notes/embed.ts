import { renderReadingHtml } from './reading'
import { applyCallouts } from './callout'
import { extractBlock } from './blocks'
import { splitWikiRef, decodeEmbedB64 } from './wiki'
import { resolveAssetUrl, resolveNoteImagePath } from '@/lib/asset-url'

/**
 * 内容嵌入（transclusion）：`![[笔记]]` 把另一篇笔记的正文内联进来。
 *
 * 渲染管线把 `![[笔记]]` 换成 `data-sb-embed` 占位元素（见 reading.ts），
 * 这里负责解析目标正文、递归渲染（防环 + 深度限制）并替换占位元素。
 * 解析回调由调用方注入（组件里来自 zustand store，测试里可以随便喂），
 * HTML 开关也由调用方传入 —— 本模块保持纯函数、不碰 store。
 */

/** 嵌套嵌入的最大深度：![[A]] 里嵌 ![[B]] 里嵌 ![[A]] 这种环靠它兜底 */
export const MAX_EMBED_DEPTH = 3

export type EmbedResolver = (path: string) => string | null

export interface EmbedOptions {
  depth?: number
  visited?: Set<string>
  /** 源笔记嵌入的 HTML 开关（设置里关 HTML 时嵌入正文也按转义渲染） */
  allowHtml?: boolean
}

/**
 * 解析一个嵌入目标 → 笔记正文。防环靠 visited：A 嵌 B、B 又嵌 A 时，
 * 链路上已经出现过的目标直接判失败（渲染成「找不到」占位）。
 */
export function resolveEmbedContent(
  path: string,
  resolve: EmbedResolver,
  visited: Set<string>,
): string | null {
  const clean = path.replace(/^\.\//, '').trim()
  const key = clean.toLowerCase()
  if (!key) return null
  if (visited.has(key)) return null
  const next = new Set(visited)
  next.add(key)
  // 块引用：先按路径解析整篇，再抽出那一块
  const { path: pathPart, blockId } = splitWikiRef(clean)
  const body = resolve(pathPart.trim())
  if (body === null || body === undefined) return null
  if (blockId) return extractBlock(body, blockId)
  return body
}

/** 占位元素里的路径（data-sb-embed 存的是 base64 负载） */
function embedPathOf(el: HTMLElement): string | null {
  const raw = el.dataset.sbEmbed ?? ''
  if (!raw) return null
  return decodeEmbedB64(raw) ?? decodeURIComponent(raw)
}

/** 给实时预览 widget 用：token 直接换路径 */
export { decodeEmbedToken as embedPathFromToken } from './wiki'

/**
 * 扫一遍容器，把所有 `[data-sb-embed]` 占位换成渲染好的笔记内容。
 * 阅读模式与实时预览的嵌入 widget 共用。
 */
export function applyEmbeds(
  root: HTMLElement,
  paperDir: string,
  resolve: EmbedResolver,
  options: EmbedOptions = {},
): void {
  const depth = options.depth ?? 0
  const visited = options.visited ?? new Set<string>()
  const allowHtml = options.allowHtml ?? true
  if (depth > MAX_EMBED_DEPTH) return

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-sb-embed]'))) {
    const path = embedPathOf(el)
    if (!path) continue
    const body = resolveEmbedContent(path, resolve, visited)
    const wrap = document.createElement('div')
    wrap.className = 'md-embed'
    if (body === null) {
      wrap.classList.add('md-embed-missing')
      wrap.textContent = `找不到要嵌入的笔记：${path}`
    } else {
      wrap.innerHTML = renderEmbedHtml(body, paperDir, resolve, depth + 1, visited, allowHtml)
      void fixEmbedImages(wrap, paperDir)
    }
    el.replaceWith(wrap)
  }
}

/** 渲染嵌入正文：完整走阅读管线（wiki / 公式 / 高亮），再补 callout 与嵌套嵌入 */
function renderEmbedHtml(
  body: string,
  paperDir: string,
  resolve: EmbedResolver,
  depth: number,
  visited: Set<string>,
  allowHtml: boolean,
): string {
  const { html } = renderReadingHtml(body, { allowHtml })
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  applyCallouts(wrap)
  applyEmbeds(wrap, paperDir, resolve, { depth, visited, allowHtml })
  return wrap.innerHTML
}

/** 嵌入内容里的相对图片也要补真实地址（异步，fire-and-forget） */
async function fixEmbedImages(scope: HTMLElement, paperDir: string): Promise<void> {
  for (const img of Array.from(scope.querySelectorAll('img'))) {
    const raw = img.getAttribute('src') ?? ''
    if (!raw || /^(https?:|data:|blob:|file:)/i.test(raw)) continue
    const url = await resolveAssetUrl(resolveNoteImagePath(raw, paperDir)).catch(() => null)
    if (url) img.src = url
    else img.setAttribute('data-missing', 'true')
  }
}
