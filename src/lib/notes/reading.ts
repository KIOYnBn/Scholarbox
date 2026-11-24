import { renderMarkdown } from '@/lib/markdown'
import { expandWiki, decodeEmbedToken, EMBED_TOKEN_PATTERN } from './wiki'
import { maskMath } from './math'

export interface ReadingOptions {
  /** 关掉 HTML 时把标签转义成文字，而不是渲染 */
  allowHtml: boolean
}

/**
 * 阅读视图的 HTML 生成：先展开 `[[ ]]`，再按 HTML 开关决定是否转义标签，
 * 然后把 `$公式$` 换成占位符，交给 renderMarkdown（marked + DOMPurify，白名单在内），
 * 最后把占位符换成 KaTeX 的 HTML。
 *
 * 公式必须在 marked 之前挡掉：`x_i^2` 里的 `_` `*` 会被当成强调语法，
 * 渲染出来就是一堆 `<em>`。
 */
export function renderReadingHtml(markdown: string, options: ReadingOptions): { html: string; targets: Map<string, string> } {
  const { markdown: expanded, targets } = expandWiki(markdown)
  // 先挡掉公式再转义 HTML：否则 `$a < b$` 里的 `<` 会被转义成 &lt; 塞给 KaTeX
  const math = maskMath(expanded)
  const highlighted = renderHighlights(math.masked)
  const source = options.allowHtml ? highlighted : escapeHtmlOutsideCode(highlighted)
  let html = math.restore(renderMarkdown(source))
  // 笔记嵌入（![[笔记]]）：占位符换成带 data 属性的空段落，DOM 后处理再内联渲染。
  // 放在 sanitize 之后手工注入，绕开 HTML 开关对占位符的转义。
  // data-sb-embed 统一存 base64（token 的原样负载），段落级与行内两条路都走它。
  html = html.replace(/<p>\s*(%%SBEMBED:[A-Za-z0-9+/=]+%%)\s*<\/p>/g, (_raw, token: string) => {
    const path = decodeEmbedToken(token)
    const b64 = token.slice('%%SBEMBED:'.length, -2)
    return path ? `<p data-sb-embed="${b64}"></p>` : ''
  })
  html = html.replace(EMBED_TOKEN_PATTERN, (_raw, b64: string) => `<span data-sb-embed="${b64}"></span>`)
  return { html, targets }
}

/**
 * `==高亮==` → `<mark>高亮</mark>`（Obsidian 语法）。
 * 跳过 frontmatter、代码围栏与行内代码 —— 那些地方的 `==` 是比较运算符不是标记。
 * DOMPurify 默认白名单允许 <mark>，不需要额外配置。
 */
export function renderHighlights(markdown: string): string {
  const frontmatter = /^---[\s\S]*?\n---[ \t]*\r?\n?/.exec(markdown)
  const highlightSegment = (text: string) =>
    text
      .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
      .map((segment, index) => (index % 2 === 1 ? segment : segment.replace(/==([^=\n]+)==/g, '<mark>$1</mark>')))
      .join('')
  if (!frontmatter) return highlightSegment(markdown)
  // frontmatter 段原样保留
  return markdown.slice(0, frontmatter[0].length) + highlightSegment(markdown.slice(frontmatter[0].length))
}

/**
 * 关掉 HTML 时只转义正文里的标签，代码块与行内代码保持不变 ——
 * 否则示例代码里的 `<div>` 会被转义成 `&lt;div&gt;`，反而看不懂。
 */
export function escapeHtmlOutsideCode(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    })
    .join('')
}
