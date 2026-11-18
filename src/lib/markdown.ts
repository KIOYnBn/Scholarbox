import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

/** Markdown -> sanitized HTML. Raw HTML in notes is allowed but stripped of scripts. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'iframe', 'form'],
  })
}

/** Rough word count that behaves for CJK + latin text. */
export function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\u3040-\u30ff]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0
  return cjk + latin
}
