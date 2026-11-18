import { describe, expect, it } from 'vitest'
import {
  continuationEdit,
  embedKindOf,
  linkEdit,
  rankCandidates,
  wikiContext,
  wrapSelection,
  type WikiCandidate,
} from '../completion'

describe('回车续写', () => {
  it('无序列表续同样的符号', () => {
    const text = '- 一'
    expect(continuationEdit(text, text.length)?.insert).toBe('\n- ')
  })

  it('有序列表自动加一', () => {
    const text = '1. 一'
    expect(continuationEdit(text, text.length)?.insert).toBe('\n2. ')
  })

  it('任务项续写新的空任务', () => {
    const text = '- [x] 做完'
    expect(continuationEdit(text, text.length)?.insert).toBe('\n- [ ] ')
  })

  it('空列表项再回车就退出列表', () => {
    const text = '- '
    expect(continuationEdit(text, text.length)).toEqual({ from: 0, to: 2, insert: '' })
  })

  it('普通段落不接管回车', () => {
    const text = '就是一句话'
    expect(continuationEdit(text, text.length)).toBeNull()
  })
})

describe('包裹与链接', () => {
  it('包裹选区', () => {
    expect(wrapSelection('abc', 1, 2, '**')).toMatchObject({ from: 1, to: 2, insert: '**b**' })
  })

  it('空选区用占位词', () => {
    expect(wrapSelection('abc', 1, 1, '`', '`', 'code').insert).toBe('`code`')
  })

  it('链接把选区当文字', () => {
    expect(linkEdit('see this', 4, 8).insert).toBe('[this]()')
  })
})

describe('wiki 补全', () => {
  const candidates: WikiCandidate[] = [
    { path: 'papers/Halvorsen_2025_Hybrid_Index_Demo/note.md', label: 'note.md', kind: 'note' },
    { path: 'notes/实验记录.md', label: '实验记录.md', kind: 'note' },
    { path: 'papers/Halvorsen_2025_Hybrid_Index_Demo/assets/p1.png', label: 'p1.png', kind: 'asset' },
  ]

  it('识别 [[ 上下文与查询串', () => {
    const text = '看 [[实验'
    const ctx = wikiContext(text, text.length)!
    expect(ctx.embed).toBe(false)
    expect(ctx.query).toBe('实验')
  })

  it('![[ 标记为嵌入', () => {
    const text = '![[p1'
    expect(wikiContext(text, text.length)!.embed).toBe(true)
  })

  it('中文子串能命中', () => {
    expect(rankCandidates(candidates, '实验')[0]?.path).toBe('notes/实验记录.md')
  })

  it('路径片段能命中，且限制返回数量', () => {
    expect(rankCandidates(candidates, 'Halvorsen')[0]?.kind).toBe('note')
    expect(rankCandidates(candidates, '', 2)).toHaveLength(2)
  })

  it('按扩展名判断嵌入类型', () => {
    expect(embedKindOf('a/b/p1.png')).toBe('image')
    expect(embedKindOf('a/origin.pdf')).toBe('pdf')
    expect(embedKindOf('notes/x.md')).toBe('note')
  })
})
