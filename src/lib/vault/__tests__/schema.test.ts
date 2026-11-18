import { describe, expect, it } from 'vitest'
import {
  folderNameFor,
  metaFromFolder,
  normalizeMeta,
  parseMeta,
  serializeMeta,
  type PaperMeta,
} from '@/lib/vault/schema'

describe('normalizeMeta', () => {
  it('repairs a sparse meta.json written by hand', () => {
    const meta = normalizeMeta(
      { title: '  Attention Is All You Need ' },
      metaFromFolder('vaswani_2017_attention'),
    )
    expect(meta.title).toBe('Attention Is All You Need')
    expect(meta.tags).toEqual([])
    expect(meta.importance).toBe(3)
    expect(meta.progress).toBe(0)
    expect(meta.status).toBe('todo')
    // missing fields are filled from the folder-derived fallback
    expect(meta.year).toBe(2017)
    expect(meta.authors).toEqual(['vaswani'])
  })

  it('clamps out-of-range values instead of trusting them', () => {
    const meta = normalizeMeta({ title: 'T', importance: 9, progress: 240, year: 1200, impactFactor: -4 })
    expect(meta.importance).toBe(5)
    expect(meta.progress).toBe(100)
    expect(meta.year).toBeNull() // 1200 is not a plausible publication year
    expect(meta.impactFactor).toBeNull()
  })

  it('splits author strings without breaking "Lastname, I."', () => {
    expect(normalizeMeta({ authors: 'Vaswani, A.; Shazeer, N.; 张三' }).authors).toEqual([
      'Vaswani, A.',
      'Shazeer, N.',
      '张三',
    ])
    expect(normalizeMeta({ authors: 'Mira Halvorsen, Daniel Okonkwo' }).authors).toEqual([
      'Mira Halvorsen',
      'Daniel Okonkwo',
    ])
    expect(normalizeMeta({ authors: '张三、李四' }).authors).toEqual(['张三', '李四'])
  })

  it('dedupes tags and trims them', () => {
    const meta = normalizeMeta({ tags: ['nlp', 'nlp', ' transformer '] })
    expect(meta.tags).toEqual(['nlp', 'transformer'])
  })

  it('never leaves the title empty', () => {
    expect(normalizeMeta({}).title).toBe('未命名文献')
  })
})

describe('serialize / parse round-trip', () => {
  const meta: PaperMeta = normalizeMeta(
    {
      title: 'A Hybrid Index',
      authors: ['Mira Halvorsen'],
      year: 2025,
      venue: 'arXiv',
      impactFactor: 4.25,
      field: '信息检索',
      tags: ['hybrid', 'index'],
      importance: 4,
      progress: 42,
      status: 'reading',
      doi: '10.0000/xyz',
    },
    metaFromFolder('halvorsen_2025_hybrid'),
  )

  it('writes stable, diff-friendly JSON with a trailing newline', () => {
    const text = serializeMeta(meta)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('"progress": 42')
    // key order must not depend on the object identity
    expect(text.indexOf('"title"')).toBeLessThan(text.indexOf('"importance"'))
  })

  it('reads back what it wrote', () => {
    const back = parseMeta(serializeMeta(meta), metaFromFolder('halvorsen_2025_hybrid'))
    expect(back.title).toBe(meta.title)
    expect(back.authors).toEqual(meta.authors)
    expect(back.tags).toEqual(meta.tags)
    expect(back.impactFactor).toBe(4.25)
    expect(back.status).toBe('reading')
    expect(back.progress).toBe(42)
  })

  it('survives corrupt JSON by falling back to the folder name', () => {
    const back = parseMeta('{ not json', metaFromFolder('halvorsen_2025_hybrid_index'))
    expect(back.title).toBe('hybrid index')
    expect(back.year).toBe(2025)
  })
})

describe('folderNameFor', () => {
  it('builds Author_Year_Title the way the vault spec asks', () => {
    const name = folderNameFor({
      title: 'A Hybrid Lexical-Dense Index',
      authors: ['Mira Halvorsen', 'Daniel Okonkwo'],
      year: 2025,
    })
    expect(name).toBe('Halvorsen_2025_A Hybrid Lexical-Dense Index')
  })

  it('handles Chinese names', () => {
    expect(folderNameFor({ title: '注意力机制', authors: ['张三'], year: 2023 })).toBe(
      '张三_2023_注意力机制',
    )
  })

  it('uses YYYY as a placeholder so the pattern still round-trips', () => {
    expect(folderNameFor({ title: '未署名的论文', authors: [], year: null })).toBe(
      'Unknown_YYYY_未署名的论文',
    )
  })

  it('strips characters that break Windows paths', () => {
    const name = folderNameFor({ title: 'A/B test: 50% faster?', authors: ['X'], year: 2024 })
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
  })
})

describe('metaFromFolder', () => {
  it('rebuilds metadata from a folder that lost meta.json', () => {
    const meta = metaFromFolder('Vaswani_2017_Attention Is All You Need')
    expect(meta.authors).toEqual(['Vaswani'])
    expect(meta.year).toBe(2017)
    expect(meta.title).toBe('Attention Is All You Need')
  })

  it('keeps the whole name when the pattern does not match', () => {
    const meta = metaFromFolder('misc')
    expect(meta.title).toBe('misc')
    expect(meta.year).toBeNull()
  })
})
