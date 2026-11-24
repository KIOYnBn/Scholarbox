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
    const fullRef = rawPath.trim()
    // 块引用：[[笔记#^block-id]] —— 链接目标带着块 id，标签显示成「名 > ^id」
    const { path: refPath, blockId } = splitWikiRef(fullRef)
    const path = refPath.trim()
    const label = (alias ?? (blockId ? `${baseName(path)} > ^${blockId}` : baseName(path))).trim()
    const href = encodeTarget(fullRef)
    targets.set(href, fullRef)

    if (bang === '!') {
      const lower = path.toLowerCase()
      // 图片走图片语法；笔记（.md 或纯名字）走嵌入占位符，渲染时内联正文；
      // PDF 等二进制保持「卡片链接」，避免把二进制塞进 img
      if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return `![${label}](${href})`
      if (isNoteEmbedPath(path)) return embedTokenFor(fullRef)
      return `[📄 ${label}](${href})`
    }
    return `[${label}](${href})`
  })

  return { markdown, targets }
}

/** 把 `笔记#^块id` 拆成路径与块 id；没有块引用时 blockId 为 null */
export function splitWikiRef(ref: string): { path: string; blockId: string | null } {
  const idx = ref.indexOf('#^')
  if (idx < 0) return { path: ref, blockId: null }
  return { path: ref.slice(0, idx), blockId: ref.slice(idx + 2) || null }
}

/* ── 笔记嵌入（transclusion）的占位符 ────────────────────────────────── */

const EMBED_TOKEN_PREFIX = '%%SBEMBED:'
const EMBED_TOKEN_SUFFIX = '%%'
/** 渲染后 HTML 里识别占位段落/占位行内元素用的形状 */
export const EMBED_TOKEN_PATTERN = /%%SBEMBED:([A-Za-z0-9+/=]+)%%/g

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** `![[笔记]]` 的占位符：base64 编码路径，整条管线里不会被转义或改写 */
export function embedTokenFor(path: string): string {
  return `${EMBED_TOKEN_PREFIX}${encodeBase64Utf8(path.trim())}${EMBED_TOKEN_SUFFIX}`
}

export function decodeEmbedToken(token: string): string | null {
  if (!token.startsWith(EMBED_TOKEN_PREFIX) || !token.endsWith(EMBED_TOKEN_SUFFIX)) return null
  return decodeEmbedB64(token.slice(EMBED_TOKEN_PREFIX.length, -EMBED_TOKEN_SUFFIX.length))
}

/** 只解 base64 负载（data-sb-embed 属性里存的就是它）；解不出来返回 null */
export function decodeEmbedB64(b64: string): string | null {
  try {
    return decodeBase64Utf8(b64)
  } catch {
    return null
  }
}

/** 这个嵌入目标是不是可内联的笔记：.md / .markdown / 无扩展名（纯名字）。
 * 传入前先把块引用拆掉（用 splitWikiRef），本函数只看路径部分。 */
export function isNoteEmbedPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (/\.(md|markdown)$/.test(lower)) return true
  if (/\.[a-z0-9]+$/.test(lower)) return false
  return true
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

export interface WikiLinkRef {
  /** 原文，如 `![[a.png]]` */
  raw: string
  /** 链接目标（去掉括号与别名） */
  path: string
  /** 显示文本：别名或目标名 */
  label: string
  embed: boolean
}

/** 抽出一篇笔记里的全部 wiki 引用；跳过代码围栏与行内代码。反链 / 重命名联动用。 */
export function extractWikiLinks(markdown: string): WikiLinkRef[] {
  const refs: WikiLinkRef[] = []
  const parts = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
  parts.forEach((part, index) => {
    if (index % 2 === 1) return
    WIKI.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WIKI.exec(part))) {
      const path = match[2]!.trim()
      refs.push({
        raw: match[0],
        path,
        label: (match[3] ?? baseName(path)).trim(),
        embed: match[1] === '!',
      })
    }
  })
  return refs
}
