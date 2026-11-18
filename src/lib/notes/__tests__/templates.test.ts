import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTE_TEMPLATE, DEFAULT_PAPER_TEMPLATE, renderTemplate, templatePathFor, varsFromPaper } from '../templates'

const meta = {
  title: 'A Hybrid Index',
  authors: ['Mira Halvorsen', 'Lin Wei'],
  year: 2025,
  venue: 'arXiv preprint',
  field: '信息检索',
  tags: ['retrieval', 'index'],
  importance: 4 as const,
  status: 'reading' as const,
}

describe('笔记模板', () => {
  it('模板路径落在 .scholarbox/templates 下', () => {
    expect(templatePathFor('paper-note')).toBe('.scholarbox/templates/paper-note.md')
    expect(templatePathFor('note')).toBe('.scholarbox/templates/note.md')
  })

  it('默认模板包含标题与 PDF 链接变量', () => {
    expect(DEFAULT_PAPER_TEMPLATE).toContain('{{title}}')
    expect(DEFAULT_PAPER_TEMPLATE).toContain('{{pdfLink}}')
    expect(DEFAULT_NOTE_TEMPLATE).toContain('{{createdAt}}')
  })

  it('变量替换覆盖 meta.json 的字段', () => {
    const vars = varsFromPaper(meta, new Date('2026-01-02T03:04:05Z'))
    const out = renderTemplate(DEFAULT_PAPER_TEMPLATE, vars)
    expect(out).toContain('# A Hybrid Index')
    expect(out).toContain('Mira Halvorsen, Lin Wei')
    expect(out).toContain('arXiv preprint')
    expect(out).toContain('2025')
    expect(out).toContain('[打开 PDF](origin.pdf)')
    expect(out).not.toContain('{{')
  })

  it('独立笔记模板带创建日期', () => {
    const vars = varsFromPaper(meta, new Date('2026-01-02T00:00:00Z'))
    expect(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars)).toContain('2026-01-02')
  })

  it('缺字段给空串而不是 undefined', () => {
    const vars = varsFromPaper({}, new Date('2026-01-02T00:00:00Z'))
    expect(vars.year).toBe('')
    expect(vars.journal).toBe('')
    expect(renderTemplate('[{{year}}]', vars)).toBe('[]')
  })

  it('未知变量原样保留（用户能看出拼错）', () => {
    expect(renderTemplate('{{title}} / {{tiitle}}', { title: 'x' })).toBe('x / {{tiitle}}')
  })

  it('旧模板（没有新变量）仍能渲染', () => {
    const legacy = '# {{title}}\n\n> {{authors}}\n'
    expect(renderTemplate(legacy, varsFromPaper(meta))).toContain('# A Hybrid Index')
  })
})
