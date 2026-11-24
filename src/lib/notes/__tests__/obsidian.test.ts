// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractOutline } from '../outline'
import { applyCallouts, parseCalloutMarker } from '../callout'
import { extractWikiLinks } from '../wiki'
import { findBacklinks, rewriteLinksForRename, type NoteDoc } from '../links'
import { renderHighlights } from '../reading'
import { resolveEmbedContent } from '../embed'
import { extractBlock, extractBlockIds, blockIdOnLine } from '../blocks'

describe('大纲抽取', () => {
  it('抽标题、跳过 frontmatter 与代码围栏', () => {
    const doc = [
      '---',
      'tags: [x]',
      '---',
      '# 一级',
      '```js',
      '# 这不是标题',
      '```',
      '## 二级',
      '正文 # 也不是',
    ].join('\n')
    const outline = extractOutline(doc)
    expect(outline).toEqual([
      { level: 1, text: '一级', line: 4 },
      { level: 2, text: '二级', line: 8 },
    ])
  })

  it('空文档返回空数组', () => {
    expect(extractOutline('')).toEqual([])
  })
})

describe('==高亮== 渲染', () => {
  it('行内替换成 <mark>，代码与 frontmatter 不动', () => {
    const doc = ['---', 'tags: [a==b]', '---', '重点 ==这里== 和 `a==b==c`'].join('\n')
    const out = renderHighlights(doc)
    expect(out).toContain('<mark>这里</mark>')
    expect(out).toContain('`a==b==c`')
    expect(out).toContain('tags: [a==b]')
  })
})

describe('callout 标记解析', () => {
  it('识别类型与标题', () => {
    expect(parseCalloutMarker('> [!warning] 小心')).toEqual({
      type: 'warning',
      family: 'warning',
      title: '小心',
    })
  })

  it('无标题用默认标题，未知类型归入 note', () => {
    expect(parseCalloutMarker('> [!tip]')).toMatchObject({ family: 'tip', title: 'Tip' })
    expect(parseCalloutMarker('> [!foobar]')?.family).toBe('note')
  })

  it('普通引用返回 null', () => {
    expect(parseCalloutMarker('> 普通引用')).toBeNull()
  })

  it('DOM 后处理：blockquote 变色块', () => {
    document.body.innerHTML = '<blockquote><p>[!tip] 提示</p><p>内容</p></blockquote>'
    const root = document.querySelector('blockquote')!.parentElement!
    const count = applyCallouts(root)
    expect(count).toBe(1)
    const callout = root.querySelector('blockquote')!
    expect(callout.classList.contains('md-callout-tip')).toBe(true)
    expect(callout.querySelector('.md-callout-title')?.textContent).toBe('提示')
    expect(callout.textContent).toContain('内容')
    expect(callout.textContent).not.toContain('[!tip]')
  })
})

describe('内容嵌入（transclusion）', () => {
  const resolverMap: Record<string, string> = {
    'notes/会议记录.md': '# 会议记录\n\n内容 A',
    'papers/p1/文献.md': '文献正文 B',
    'notes/自环.md': '自环内容',
  }
  const resolve = (path: string) => resolverMap[path] ?? null

  it('路径写法：notes/ 与 papers/ 都能解析', () => {
    expect(resolveEmbedContent('notes/会议记录.md', resolve, new Set())).toContain('内容 A')
    expect(resolveEmbedContent('papers/p1/文献.md', resolve, new Set())).toContain('文献正文 B')
  })

  it('嵌入环： visited 里的路径直接判失败', () => {
    expect(resolveEmbedContent('notes/自环.md', resolve, new Set(['notes/自环.md']))).toBeNull()
  })

  it('找不到返回 null', () => {
    expect(resolveEmbedContent('notes/不存在.md', resolve, new Set())).toBeNull()
  })
})

describe('块引用 ^block-id', () => {
  const body = [
    '---',
    'tags: [x]',
    '---',
    '# 标题',
    '第一段内容 ^abc123',
    '```',
    'code ^fake-id',
    '```',
    '- 列表项 ^list-1',
  ].join('\n')

  it('识别行尾块 id，跳过围栏', () => {
    const ids = extractBlockIds(body).map((entry) => entry.id)
    expect(ids).toEqual(['abc123', 'list-1'])
  })

  it('取块内容时剥掉 ^id', () => {
    expect(extractBlock(body, 'abc123')).toBe('第一段内容')
    expect(extractBlock(body, 'list-1')).toBe('- 列表项')
    expect(extractBlock(body, '不存在')).toBeNull()
  })

  it('blockIdOnLine 直接判行', () => {
    expect(blockIdOnLine('文字 ^id-1')).toBe('id-1')
    expect(blockIdOnLine('没有 id')).toBeNull()
  })

  it('嵌入块引用：![[笔记#^id]] 只取那一块', () => {
    const resolveMap: Record<string, string> = { 'notes/目标.md': body }
    const resolve = (path: string) => resolveMap[path] ?? null
    expect(resolveEmbedContent('notes/目标.md#^abc123', resolve, new Set())).toBe('第一段内容')
    expect(resolveEmbedContent('notes/目标.md#^list-1', resolve, new Set())).toBe('- 列表项')
  })
})

describe('反链与重命名联动', () => {
  const target: NoteDoc = { kind: 'standalone', file: 'notes/目标.md', title: '目标', body: '' }
  const docs: NoteDoc[] = [
    target,
    { kind: 'standalone', file: 'notes/甲.md', title: '甲', body: '见 [[目标]] 与 [[别的]]' },
    { kind: 'paper', file: 'papers/p1/note.md', dir: 'p1', title: '文献一', body: '引用 [[目标|别名]]\n```\n[[目标]] 围栏里不算\n```' },
    { kind: 'standalone', file: 'notes/乙.md', title: '乙', body: '只链 [[甲]]' },
    { kind: 'standalone', file: 'notes/丙.md', title: '丙', body: '嵌入 ![[目标]] 也算' },
    { kind: 'standalone', file: 'notes/丁.md', title: '丁', body: '块引用 [[目标#^x1]]' },
  ]

  it('找出谁链到了目标（跳过围栏、跳过自己）', () => {
    const links = findBacklinks(target, docs)
    expect(links.map((entry) => entry.source.title)).toEqual(['甲', '文献一', '丙', '丁'])
    expect(links[1]!.line).toBe(1)
  })

  it('纯名字与路径、大小写不敏感都能对上', () => {
    const docs2: NoteDoc[] = [
      target,
      { kind: 'standalone', file: 'notes/x.md', title: 'X', body: '[[notes/目标.md]]' },
      { kind: 'standalone', file: 'notes/y.md', title: 'Y', body: '[[目标.MD]]' },
    ]
    expect(findBacklinks(target, docs2)).toHaveLength(2)
  })

  it('重命名改写引用：纯名字写法改标题，路径写法改路径，别名保留', () => {
    const body = '看 [[目标]] 与 [[目标|旧别名]] 和 [[notes/目标.md]]，[[别的]] 不动'
    const { text, changed } = rewriteLinksForRename(body, target, '新目标', 'notes/新目标')
    expect(changed).toBe(true)
    expect(text).toBe('看 [[新目标]] 与 [[新目标|旧别名]] 和 [[notes/新目标]]，[[别的]] 不动')
  })

  it('extractWikiLinks 抽引用并跳过代码', () => {
    const refs = extractWikiLinks('`[[not a link]]` 与 [[a]] 和 ![[b.png]]')
    expect(refs.map((ref) => `${ref.embed ? '!' : ''}${ref.path}`)).toEqual(['a', '!b.png'])
  })
})
