import { describe, expect, it } from 'vitest'
import {
  emptyFrontmatter,
  noteTitle,
  parseNote,
  parseTags,
  stringifyNote,
  withFrontmatter,
} from '../frontmatter'

describe('parseTags', () => {
  it('解析 JSON 风数组', () => {
    expect(parseTags('[retrieval, rag]')).toEqual(['retrieval', 'rag'])
  })

  it('解析逗号与顿号分隔', () => {
    expect(parseTags('a, b、c')).toEqual(['a', 'b', 'c'])
  })

  it('忽略大小写去重并丢掉空项', () => {
    expect(parseTags('[RAG, rag, , rag ]')).toEqual(['RAG'])
  })

  it('空值返回空数组', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags(null)).toEqual([])
  })
})

describe('parseNote', () => {
  it('没有 frontmatter 时整段都是正文', () => {
    const parsed = parseNote('# 标题\n\n正文')
    expect(parsed.body).toBe('# 标题\n\n正文')
    expect(parsed.data.createdAt).toBeNull()
    expect(parsed.data.tags).toEqual([])
  })

  it('解析 created / updated / tags', () => {
    const text = [
      '---',
      'createdAt: 2026-11-16T10:00:00.000Z',
      'updatedAt: 2026-11-16T11:00:00.000Z',
      'tags: [retrieval, rag]',
      '---',
      '',
      '# 我的笔记',
      '',
      '正文',
    ].join('\n')
    const parsed = parseNote(text)
    expect(parsed.data.createdAt).toBe('2026-11-16T10:00:00.000Z')
    expect(parsed.data.updatedAt).toBe('2026-11-16T11:00:00.000Z')
    expect(parsed.data.tags).toEqual(['retrieval', 'rag'])
    expect(parsed.body.trim()).toBe('# 我的笔记\n\n正文')
  })

  it('支持块状 tags 列表', () => {
    const parsed = parseNote(['---', 'tags:', '  - a', '  - b', '---', 'body'].join('\n'))
    expect(parsed.data.tags).toEqual(['a', 'b'])
  })

  it('未知键进 extra', () => {
    const parsed = parseNote(['---', 'createdAt: 2026-01-01', 'author: lk', '---', 'x'].join('\n'))
    expect(parsed.data.extra.author).toBe('lk')
  })

  it('frontmatter 未闭合时按正文处理', () => {
    const text = '---\ncreatedAt: 2026-01-01\n\n正文没有闭合'
    const parsed = parseNote(text)
    expect(parsed.data.createdAt).toBeNull()
    expect(parsed.body).toBe(text)
  })

  it('容忍 Windows 换行', () => {
    const parsed = parseNote('---\r\ncreatedAt: 2026-01-01\r\n---\r\nbody\r\n')
    expect(parsed.data.createdAt).toBe('2026-01-01')
    expect(parsed.body.trim()).toBe('body')
  })
})

describe('stringifyNote', () => {
  it('固定 createdAt / updatedAt / tags 的顺序', () => {
    const text = stringifyNote(
      { ...emptyFrontmatter(), createdAt: 'c', updatedAt: 'u', tags: ['a', 'b'] },
      '# t\n',
    )
    expect(text.startsWith('---\ncreatedAt: c\nupdatedAt: u\ntags: [a, b]\n---\n')).toBe(true)
  })

  it('空值不写空行噪音', () => {
    const text = stringifyNote(emptyFrontmatter(), 'body')
    expect(text).toBe('body')
  })

  it('保留 extra 键', () => {
    const text = stringifyNote({ ...emptyFrontmatter(), extra: { author: 'lk' } }, 'body')
    expect(text).toContain('author: lk')
  })

  it('往返一致', () => {
    const data = { ...emptyFrontmatter(), createdAt: 'c', updatedAt: 'u', tags: ['x'] }
    const parsed = parseNote(stringifyNote(data, '# 标题\n\n正文'))
    expect(parsed.data.createdAt).toBe('c')
    expect(parsed.data.tags).toEqual(['x'])
    expect(parsed.body).toBe('# 标题\n\n正文')
  })
})

describe('withFrontmatter', () => {
  it('只改指定的键，其余保留', () => {
    const text = stringifyNote({ ...emptyFrontmatter(), createdAt: 'c', updatedAt: 'u', tags: ['a'] }, 'body')
    const next = withFrontmatter(text, { updatedAt: 'u2', tags: ['a', 'b'] })
    const parsed = parseNote(next)
    expect(parsed.data.createdAt).toBe('c')
    expect(parsed.data.updatedAt).toBe('u2')
    expect(parsed.data.tags).toEqual(['a', 'b'])
    expect(parsed.body).toBe('body')
  })
})

describe('noteTitle', () => {
  it('取正文第一个一级标题', () => {
    expect(noteTitle('\n\n# 标题\n正文', 'fallback')).toBe('标题')
  })

  it('正文先出现普通段落时放弃', () => {
    expect(noteTitle('先写了一句\n\n# 标题', 'fallback')).toBe('fallback')
  })

  it('跳过 frontmatter 后仍是标题则采用', () => {
    const text = stringifyNote(emptyFrontmatter(), '# 真标题\n\n正文')
    expect(noteTitle(parseNote(text).body, 'fallback')).toBe('真标题')
  })

  it('没有标题时用兜底文案', () => {
    expect(noteTitle('只有正文', 'fallback')).toBe('fallback')
  })
})

describe('frontmatter 迁移与补默认值', () => {
  it('旧的 created / updated 键被读成 createdAt / updatedAt', () => {
    const text = '---\ncreated: 2026-01-01\ntags: [a]\n---\n正文\n'
    const parsed = parseNote(text)
    expect(parsed.data.createdAt).toBe('2026-01-01')
    expect(parsed.data.updatedAt).toBeNull()
    expect(parsed.data.tags).toEqual(['a'])
  })

  it('保存时把旧键迁移成新键，正文不动', () => {
    const text = '---\ncreated: 2026-01-01\nupdated: 2026-02-02\ntags: [a]\n---\n正文\n'
    const next = withFrontmatter(text, { field: '信息检索' })
    expect(next).toContain('createdAt: 2026-01-01')
    expect(next).toContain('updatedAt: 2026-02-02')
    expect(next).not.toContain('created: 2026')
    expect(next).toContain('field: 信息检索')
    expect(next).toContain('正文')
  })

  it('缺字段的旧笔记拿到合法默认值', () => {
    const parsed = parseNote('---\ntags: [x]\n---\n正文\n')
    expect(parsed.data.importance).toBe(3)
    expect(parsed.data.status).toBe('active')
    expect(parsed.data.pinned).toBe(false)
    expect(parsed.data.field).toBe('')
    expect(parsed.data.lastViewedAt).toBeNull()
  })

  it('越界的 importance 夹回 1–5，旧阅读状态映射到笔记状态', () => {
    expect(parseNote('---\nimportance: 9\n---\n').data.importance).toBe(5)
    expect(parseNote('---\nimportance: 0\n---\n').data.importance).toBe(1)
    expect(parseNote('---\nimportance: abc\n---\n').data.importance).toBe(3)
    expect(parseNote('---\nstatus: reading\n---\n').data.status).toBe('active')
    expect(parseNote('---\nstatus: done\n---\n').data.status).toBe('archived')
  })

  it('pinned 只认 true/yes/1/on', () => {
    expect(parseNote('---\npinned: true\n---\n').data.pinned).toBe(true)
    expect(parseNote('---\npinned: yes\n---\n').data.pinned).toBe(true)
    expect(parseNote('---\npinned: false\n---\n').data.pinned).toBe(false)
    expect(parseNote('---\npinned: nope\n---\n').data.pinned).toBe(false)
  })

  it('默认值不写进文件（保持文件干净）', () => {
    const text = stringifyNote(emptyFrontmatter(), '# 标题\n\n正文\n')
    expect(text).toBe('# 标题\n\n正文\n')
  })
})
