import { describe, expect, it } from 'vitest'
import { decorationsForLines, dedupeRanges, scanMarkdown } from '../markdown-syntax'

describe('scanMarkdown', () => {
  it('识别标题级别并给出要隐藏的 # 前缀', () => {
    const [line] = scanMarkdown('## 方法')
    expect(line!.block).toBe('heading')
    expect(line!.level).toBe(2)
    expect(line!.hidden).toEqual([[0, 3]])
  })

  it('列表、任务、引用各自隐藏自己的标记', () => {
    const lines = scanMarkdown('- 一\n- [ ] 二\n> 三')
    expect(lines[0]!.block).toBe('list')
    expect(lines[0]!.hidden).toEqual([[0, 2]])
    expect(lines[1]!.block).toBe('task')
    // 偏移是整篇文档的绝对位置：第二行从第 4 个字符开始，`- [ ] ` 占 6 个
    expect(lines[1]!.hidden).toEqual([[4, 10]])
    expect(lines[2]!.block).toBe('quote')
  })

  it('围栏代码块内部不再解析行内语法', () => {
    const lines = scanMarkdown('```\n**不该变粗**\n```')
    expect(lines.every((line) => line.block === 'code')).toBe(true)
    expect(lines[1]!.inlines).toEqual([])
  })

  it('行内粗体 / 斜体 / 行内代码 / 链接给出区间', () => {
    const [line] = scanMarkdown('a **b** c `d` [e](http://x)')
    const kinds = line!.inlines.map((span) => span.kind)
    expect(kinds).toContain('bold')
    expect(kinds).toContain('code')
    expect(kinds).toContain('link')
    const bold = line!.inlines.find((span) => span.kind === 'bold')!
    expect('a **b** c `d` [e](http://x)'.slice(bold.from, bold.to)).toBe('b')
  })

  it('光标所在行不隐藏标记（实时预览保留源码）', () => {
    const lines = scanMarkdown('## 标题\n正文')
    const hidden = decorationsForLines(lines, new Set([0]))
    expect(hidden.hidden).toEqual([])
    expect(decorationsForLines(lines, new Set()).hidden).toEqual([[0, 3]])
  })
})

describe('列表与行内标记（实时预览要还原预览样式）', () => {
  it('有序列表带出序号，缩进与标记一起隐藏（悬挂缩进交给行级 CSS）', () => {
    const [first, second] = scanMarkdown('1. 第一步\n  2) 第二步')
    expect(first!.list).toEqual({ ordered: true, marker: '1.' })
    // 标记从行首开始，藏掉 `1. ` 三个字符
    expect(first!.hidden[0]).toEqual([0, 3])
    expect(first!.indent).toBe(0)
    expect(second!.list).toEqual({ ordered: true, marker: '2)' })
    // 缩进（2 个空格）和 `2) ` 一起藏：换行后的文字要对齐首行，靠 padding + text-indent
    expect(second!.hidden[0]).toEqual([7, 12])
    expect(second!.indent).toBe(2)
  })

  it('无序列表标记不是序号', () => {
    const [line] = scanMarkdown('- 一个条目')
    expect(line!.list).toEqual({ ordered: false, marker: '-' })
  })

  it('粗体 / 行内代码的标记也要藏起来', () => {
    const raw = 'a **b** c `d`'
    const [line] = scanMarkdown(raw)
    const hidden = line!.hidden.map(([a, b]) => raw.slice(a, b))
    expect(hidden).toContain('**')
    expect(hidden).toContain('`')
    // 正文区间仍然指向真实内容
    const bold = line!.inlines.find((span) => span.kind === 'bold')!
    expect(raw.slice(bold.from, bold.to)).toBe('b')
  })

  it('链接只留下文字，括号与地址都藏', () => {
    const raw = '见 [官网](https://example.com) 说明'
    const [line] = scanMarkdown(raw)
    const hidden = line!.hidden.map(([a, b]) => raw.slice(a, b))
    expect(hidden).toContain('[')
    expect(hidden).toContain('](https://example.com)')
    const link = line!.inlines.find((span) => span.kind === 'link')!
    expect(raw.slice(link.from, link.to)).toBe('官网')
  })

  it('行首斜体不再错位（以前会多算一个字符）', () => {
    const raw = '*强调* 后面'
    const [line] = scanMarkdown(raw)
    const italic = line!.inlines.find((span) => span.kind === 'italic')!
    expect(raw.slice(italic.from, italic.to)).toBe('强调')
  })

  it('嵌套标记产生的重叠区间会被去掉，交给 CM 不会炸', () => {
    const [line] = scanMarkdown('***又粗又斜***')
    const deduped = dedupeRanges(line!.hidden)
    for (let i = 1; i < deduped.length; i += 1) {
      expect(deduped[i]![0]).toBeGreaterThanOrEqual(deduped[i - 1]![1])
    }
  })
})
