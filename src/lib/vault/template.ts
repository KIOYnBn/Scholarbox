import type { PaperMeta } from './schema'

/** Starter note written for every new paper — a light academic reading scaffold. */
export function buildTemplateNote(meta: PaperMeta): string {
  const authors = meta.authors.join(', ') || '未知作者'
  const line = [authors, meta.venue, meta.year].filter(Boolean).join(' · ')
  const tags = meta.tags.length ? meta.tags.map((t) => `#${t}`).join(' ') : ''

  return `---
title: ${meta.title}
authors: [${meta.authors.join(', ')}]
year: ${meta.year ?? ''}
venue: ${meta.venue}
field: ${meta.field}
importance: ${meta.importance}
---

# ${meta.title}

> ${line}

${tags}

## 一句话总结

## 研究问题

## 方法

## 关键结论

## 我的批注

## 相关文献
`
}
