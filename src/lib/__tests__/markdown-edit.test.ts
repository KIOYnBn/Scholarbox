// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { domToMarkdown } from '@/lib/markdown-edit'

/**
 * 这里刻意用 marked 而不是 `renderMarkdown`：后者过 DOMPurify，而 DOMPurify 在
 * happy-dom 下会把 fragment 的第一个元素直接摊平（浏览器里不会），
 * 拿它测序列化等于在测环境 bug。应用里真正的清洗仍然走 renderMarkdown。
 */
const render = (markdown: string) => marked.parse(markdown, { async: false }) as string

const md = (html: string) => domToMarkdown(html)

describe('domToMarkdown', () => {
  it('keeps headings at their level', () => {
    expect(md('<h1>标题</h1><h2>方法</h2><h3>细节</h3>')).toBe('# 标题\n\n## 方法\n\n### 细节\n')
  })

  it('serialises inline emphasis', () => {
    expect(md('<p>这是 <strong>加粗</strong> 和 <em>斜体</em> 与 <code>x = 1</code></p>')).toBe(
      '这是 **加粗** 和 *斜体* 与 `x = 1`\n',
    )
  })

  it('does not double-wrap already-marked text', () => {
    expect(md('<p><strong>**已经是粗体**</strong></p>')).toBe('**已经是粗体**\n')
  })

  it('serialises links and images, preferring data-path over the display src', () => {
    const html =
      '<p><a href="https://example.com">站点</a></p>' +
      '<p><img src="blob:http://localhost/abc" data-path="assets/p2-shot.png" alt="截图"></p>'
    expect(md(html)).toBe('[站点](https://example.com)\n\n![截图](assets/p2-shot.png)\n')
  })

  it('serialises nested lists with indentation and ordered numbering', () => {
    const html =
      '<ul><li>第一<ul><li>嵌套</li></ul></li><li>第二</li></ul>' +
      '<ol start="3"><li>三</li><li>四</li></ol>'
    expect(md(html)).toBe('- 第一\n  - 嵌套\n- 第二\n\n3. 三\n4. 四\n')
  })

  it('serialises blockquotes line by line', () => {
    expect(md('<blockquote><p>引用一</p><p>引用二</p></blockquote>')).toBe('> 引用一\n>\n> 引用二\n')
  })

  it('preserves code block content exactly', () => {
    const html = '<pre><code class="language-ts">const a = 1\nif (a) {\n  run()\n}</code></pre>'
    expect(md(html)).toBe('```ts\nconst a = 1\nif (a) {\n  run()\n}\n```\n')
  })

  it('serialises tables with a padded header separator', () => {
    const html =
      '<table><thead><tr><th>指标</th><th>值</th></tr></thead>' +
      '<tbody><tr><td>recall</td><td>0.71</td></tr></tbody></table>'
    const out = md(html)
    expect(out).toContain('| 指标')
    expect(out).toContain('| recall')
    expect(out.split('\n')[1]).toMatch(/^\| -+ \| -+ \|$/)
  })

  it('drops unknown wrappers but keeps their text', () => {
    expect(md('<section><p>正文<span>仍在</span></p></section>')).toBe('正文仍在\n')
  })

  it('never emits more than one blank line between blocks', () => {
    expect(md('<h2>一</h2><p></p><p></p><h2>二</h2>')).toBe('## 一\n\n## 二\n')
  })

  it('round-trips a realistic note without losing content', () => {
    const source = [
      '# 阅读笔记',
      '',
      '一句话总结：**混合索引**把词法与语义分开存。',
      '',
      '## 方法',
      '',
      '- 倒排索引保留长尾术语',
      '- 冻结编码器补充语义召回',
      '',
      '> 增量更新不需要重建整个索引',
      '',
      '```ts',
      'const index = build(corpus)',
      '```',
      '',
      '![image](assets/p2-20261116-1304.png)',
      '',
      '| 指标 | BM25 | HX |',
      '| --- | --- | --- |',
      '| recall@10 | 0.61 | 0.72 |',
    ].join('\n')

    const once = domToMarkdown(render(source))
    const twice = domToMarkdown(render(once))

    expect(once).toBe(twice) // 序列化必须收敛，否则每次失焦都会改一次文件
    for (const fragment of ['# 阅读笔记', '**混合索引**', '## 方法', '- 倒排索引保留长尾术语', '> 增量更新', '```ts', '![image](assets/p2-20261116-1304.png)', '| recall@10 |']) {
      expect(twice).toContain(fragment)
    }
  })
})
