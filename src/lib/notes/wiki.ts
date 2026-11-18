/**
 * `[[wiki]]` / `![[embed]]` 的展开：把专有语法换成标准 Markdown + 可拦截的链接协议，
 * 这样阅读视图仍然只走 marked + DOMPurify 一条渲染路径。
 */

export const WIKI_SCHEME = 'scholarbox-wiki:'

export interface WikiExpansion {
  markdown: string
  /** 链接地址 -> 仓库内相对路径（点击时据此导航） */
  targets: Map<string, string>
}

const WIKI = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

function encodeTarget(path: string): string {
  return `${WIKI_SCHEME}${encodeURIComponent(path)}`
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

export function expandWiki(text: string): WikiExpansion {
  const targets = new Map<string, string>()

  const markdown = text.replace(WIKI, (_raw, bang: string, rawPath: string, alias?: string) => {
    const path = rawPath.trim()
    const label = (alias ?? baseName(path)).trim()
    const href = encodeTarget(path)
    targets.set(href, path)

    if (bang === '!') {
      const lower = path.toLowerCase()
      // 图片走图片语法，PDF / 笔记走「卡片链接」，避免把二进制塞进 img
      if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return `![${label}](${href})`
      return `[📄 ${label}](${href})`
    }
    return `[${label}](${href})`
  })

  return { markdown, targets }
}

/** 把渲染后的相对图片地址补全（asset 协议 / OPFS blob URL 由调用方注入）。 */
export function isWikiHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(WIKI_SCHEME)) return null
  const encoded = href.slice(WIKI_SCHEME.length)
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}
