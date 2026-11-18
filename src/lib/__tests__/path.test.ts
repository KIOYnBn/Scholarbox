import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, join, normalize, sanitizeSegment } from '@/lib/path'

describe('path helpers', () => {
  it('normalises separators and stray slashes', () => {
    expect(normalize('/a//b/')).toBe('a/b')
    expect(normalize('papers\\x_2024_t').replace(/\\/g, '/')).toBe('papers/x_2024_t')
    expect(normalize('')).toBe('')
  })

  it('joins without doubling slashes', () => {
    expect(join('papers', 'a', 'note.md')).toBe('papers/a/note.md')
    expect(join('papers/', '/a/', 'note.md')).toBe('papers/a/note.md')
  })

  it('splits dirname / basename / extname', () => {
    expect(dirname('papers/a/note.md')).toBe('papers/a')
    expect(dirname('note.md')).toBe('')
    expect(basename('papers/a/note.md')).toBe('note.md')
    expect(extname('papers/a/origin.pdf')).toBe('.pdf')
    expect(extname('noext')).toBe('')
  })
})

describe('sanitizeSegment', () => {
  it('replaces characters Windows and Android reject', () => {
    expect(sanitizeSegment('A/B:C*D?E"F<G>H|I')).toBe('A B C D E F G H I')
    expect(sanitizeSegment('  trailing.  ')).toBe('trailing')
  })

  it('keeps CJK, spaces and dashes intact', () => {
    expect(sanitizeSegment('张三_2023_注意力机制 综述')).toBe('张三_2023_注意力机制 综述')
  })

  it('falls back when nothing usable remains', () => {
    expect(sanitizeSegment('///')).toBe('untitled')
    expect(sanitizeSegment('', 'paper')).toBe('paper')
  })
})
