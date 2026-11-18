import type { PaperMeta } from '@/lib/vault/schema'

export type TemplateKind = 'paper-note' | 'note'

export const TEMPLATE_DIR = '.scholarbox/templates'

export function templatePathFor(kind: TemplateKind): string {
  return `${TEMPLATE_DIR}/${kind}.md`
}

export const TEMPLATE_VARS = [
  'title',
  'authors',
  'year',
  'journal',
  'field',
  'tags',
  'importance',
  'status',
  'pdfLink',
  'createdAt',
] as const

export type TemplateVar = (typeof TEMPLATE_VARS)[number]
export type TemplateVars = Record<TemplateVar, string>

export const DEFAULT_PAPER_TEMPLATE = `# {{title}}

> {{authors}} · {{journal}} · {{year}}

{{pdfLink}}

## 一句话总结

## 研究问题

## 方法

## 关键结论

## 我的批注

## 待办

- [ ] 
`

export const DEFAULT_NOTE_TEMPLATE = `# {{title}}

创建于 {{createdAt}}

## 

`

export function defaultTemplate(kind: TemplateKind): string {
  return kind === 'paper-note' ? DEFAULT_PAPER_TEMPLATE : DEFAULT_NOTE_TEMPLATE
}

/** 变量替换：未知变量原样保留，方便用户看出自己拼错了名字。 */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (raw, name: string) => {
    const value = vars[name as TemplateVar]
    return value === undefined ? raw : value
  })
}

const STATUS_LABEL: Record<string, string> = {
  todo: '待读',
  reading: '在读',
  done: '已读',
  archived: '归档',
}

/** 把 meta.json 摊成模板变量。 */
export function varsFromPaper(meta: Partial<PaperMeta>, now = new Date()): TemplateVars {
  const authors = (meta.authors ?? []).join(', ')
  return {
    title: meta.title ?? '未命名文献',
    authors: authors || '未知作者',
    year: meta.year ? String(meta.year) : '',
    journal: meta.venue ?? '',
    field: meta.field ?? '',
    tags: (meta.tags ?? []).join(', '),
    importance: meta.importance ? '★'.repeat(meta.importance) : '',
    status: STATUS_LABEL[meta.status ?? ''] ?? '',
    pdfLink: meta.title ? `[打开 PDF](origin.pdf)` : '',
    createdAt: now.toISOString().slice(0, 10),
  }
}

export function varsForNote(title: string, now = new Date()): Partial<TemplateVars> {
  return { title, createdAt: now.toISOString().slice(0, 10) }
}
