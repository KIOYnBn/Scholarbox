import { useCallback } from 'react'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import type { EmbedResolver } from '@/lib/notes/embed'

/**
 * 嵌入解析器：`![[笔记]]` 的目标 → 笔记正文。
 * 匹配规则与 useOpenWikiTarget 一致：`notes/x.md`、`papers/<dir>/<名>.md`、
 * 纯名字（先独立笔记标题再文献标题 / 目录名）。找不到返回 null。
 */
export function useEmbedResolver(): EmbedResolver {
  return useCallback((path: string) => {
    const clean = path.replace(/^\.\//, '').trim()
    const lower = clean.toLowerCase()
    if (!lower) return null
    const papers = useLibraryStore.getState().papers
    const notes = useStandaloneNotesStore.getState().notes

    if (lower.startsWith('notes/')) {
      const file = clean.slice('notes/'.length).replace(/\.md$/i, '').toLowerCase()
      const note = notes.find((n) => n.file.replace(/\.md$/i, '').toLowerCase() === file)
      return note?.body ?? null
    }

    const paperMatch = /^papers\/([^/]+)\//i.exec(clean)
    if (paperMatch) {
      const paper = papers.find((p) => p.dir.toLowerCase() === paperMatch[1]!.toLowerCase())
      return paper?.note ?? null
    }

    if (/\.[a-z0-9]+$/i.test(clean)) return null

    const note = notes.find((n) => n.title.toLowerCase() === lower)
    if (note) return note.body
    const paper =
      papers.find((p) => p.meta.title.toLowerCase() === lower) ??
      papers.find((p) => p.dir.toLowerCase() === lower)
    return paper?.note ?? null
  }, [])
}
