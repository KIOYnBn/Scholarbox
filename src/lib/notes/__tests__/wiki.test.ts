// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { decodeEmbedToken, embedTokenFor, expandWiki, isWikiHref, WIKI_SCHEME } from '../wiki'
import { escapeHtmlOutsideCode, renderReadingHtml } from '../reading'

describe('wiki 语法展开', () => {
  it('[[note]] 变成带协议的链接，标签取文件名', () => {
    const { markdown, targets } = expandWiki('看 [[papers/x/note.md]]')
    expect(markdown).toContain('[note.md](')
    const href = [...targets.keys()][0]!
    expect(href.startsWith(WIKI_SCHEME)).toBe(true)
    expect(targets.get(href)).toBe('papers/x/note.md')
  })

  it('[[path|别名]] 用别名显示', () => {
    expect(expandWiki('[[notes/a.md|第一篇]]').markdown).toContain('[第一篇](')
  })

  it('![[图片]] 用图片语法，![[笔记]] 变嵌入占位符，![[pdf]] 保持卡片链接', () => {
    expect(expandWiki('![[assets/p1.png]]').markdown).toMatch(/!\[p1\.png\]/)
    const noteEmbed = expandWiki('![[notes/会议记录.md]]').markdown
    expect(noteEmbed).toMatch(/%%SBEMBED:[A-Za-z0-9+/=]+%%/)
    expect(expandWiki('![[papers/x/origin.pdf]]').markdown).toContain('[📄 origin.pdf](')
  })

  it('嵌入占位符可无损反解（中文路径）', () => {
    const token = embedTokenFor('notes/实验 记录.md')
    expect(decodeEmbedToken(token)).toBe('notes/实验 记录.md')
  })

  it('嵌入占位符渲染成 data-sb-embed 占位元素', () => {
    const { html } = renderReadingHtml('![[notes/a.md]]', { allowHtml: false })
    expect(html).toContain('data-sb-embed=')
    expect(html).not.toContain('%%SBEMBED')
  })

  it('普通链接不受影响', () => {
    expect(expandWiki('[x](https://a.com)').markdown).toBe('[x](https://a.com)')
  })

  it('协议可反解回仓库路径（含中文）', () => {
    const href = `${WIKI_SCHEME}${encodeURIComponent('notes/实验 记录.md')}`
    expect(isWikiHref(href)).toBe('notes/实验 记录.md')
    expect(isWikiHref('https://x')).toBeNull()
  })
})

describe('阅读视图渲染', () => {
  it('HTML 开关关闭时标签被转义，但代码块保持原样', () => {
    const escaped = escapeHtmlOutsideCode('<b>粗</b>\n```\n<div>x</div>\n```')
    expect(escaped).toContain('&lt;b&gt;粗&lt;/b&gt;')
    expect(escaped).toContain('<div>x</div>')
  })

  it('HTML 开关打开时保留标签', () => {
    // 注意：DOMPurify 在 happy-dom 下不会真的剥 <script>（实测把 <b> 也一起丢了），
    // 脚本清洗只能在真浏览器里验证 —— 这里只断言「标签被保留」这条我们的策略。
    const { html } = renderReadingHtml('<b>粗</b>', { allowHtml: true })
    expect(html).toContain('<b>粗</b>')
  })

  it('wiki 链接在渲染后仍然可拦截', () => {
    const { html, targets } = renderReadingHtml('[[notes/a.md]]', { allowHtml: false })
    expect(html).toContain(WIKI_SCHEME)
    expect(targets.size).toBe(1)
  })
})
