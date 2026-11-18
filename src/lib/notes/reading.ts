import { renderMarkdown } from '@/lib/markdown'
import { expandWiki } from './wiki'
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
  const source = options.allowHtml ? math.masked : escapeHtmlOutsideCode(math.masked)
  return { html: math.restore(renderMarkdown(source)), targets }
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
