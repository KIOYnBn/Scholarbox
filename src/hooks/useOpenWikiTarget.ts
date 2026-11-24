import { useCallback } from 'react'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { splitWikiRef } from '@/lib/notes/wiki'
import { useUiStore, type NoteTarget } from '@/stores/ui'

/**
 * `[[...]]` 的目标可能是笔记（`.md`）也可能是 PDF：笔记直接进全屏编辑，
 * PDF 回到三栏阅读器并把对应文献选中。
 * 块引用 `[[笔记#^id]]`：打开笔记并滚动定位到该块（target.blockId）。
 *
 * 没写路径、只写了名字的 `[[笔记名]]`（Obsidian 用户的习惯写法）按标题模糊解析：
 * 先独立笔记、再文献标题、最后文献文件夹名，大小写不敏感。
 */
export function useOpenWikiTarget() {
  return useCallback((path: string) => {
    // 块引用拆开：路径部分照常解析，块 id 跟着 target 带下去
    const fullRef = path.replace(/^\.\//, '').trim()
    const { path: refPath, blockId } = splitWikiRef(fullRef)
    const withBlock = (target: NoteTarget): NoteTarget =>
      blockId ? { ...target, blockId } : target
    const clean = refPath.trim()

    // 纯名字：Obsidian 式的「按标题找笔记」，不要求写完整路径
    if (!clean.includes('/') && !/\.[a-z0-9]+$/i.test(clean)) {
      const lower = clean.toLowerCase()
      const standalone = useStandaloneNotesStore
        .getState()
        .notes.find((n) => n.title.toLowerCase() === lower)
      if (standalone) {
        useUiStore
          .getState()
          .openNote(withBlock({ kind: 'standalone', file: standalone.file }))
        return
      }
      const papers = useLibraryStore.getState().papers
      const paper =
        papers.find((p) => p.meta.title.toLowerCase() === lower) ??
        papers.find((p) => p.dir.toLowerCase() === lower)
      if (paper) {
        useUiStore.getState().openNote(withBlock({ kind: 'paper', dir: paper.dir }))
        return
      }
      // 没解析到：落入下面的路径解析，行为与从前一致（大多数情况是补全写的完整路径）
    }

    if (/\.md$/i.test(clean)) {
      if (clean.toLowerCase().startsWith('notes/')) {
        useUiStore
          .getState()
          .openNote(withBlock({ kind: 'standalone', file: clean.slice('notes/'.length) }))
        return
      }
      const match = /^papers\/([^/]+)\/[^/]+\.md$/i.exec(clean)
      if (match) {
        useUiStore.getState().openNote(withBlock({ kind: 'paper', dir: match[1]! }))
        return
      }
      useUiStore.getState().openNote(withBlock({ kind: 'standalone', file: clean }))
      return
    }
    const dir = /^papers\/(.+?)\/[^/]+\.pdf$/i.exec(clean)?.[1]
    if (dir) {
      useLibraryStore.getState().select(dir)
      useUiStore.getState().setMainView('workspace')
      return
    }

    // 都没解析到：纯名字的未解析链接 —— Obsidian 的行为是点击即创建同名笔记
    if (!clean.includes('/') && !/\.[a-z0-9]+$/i.test(clean)) {
      void useStandaloneNotesStore
        .getState()
        .create(clean)
        .then((note) => {
          if (note) useUiStore.getState().openNote(withBlock({ kind: 'standalone', file: note.file }))
        })
    }
  }, [])
}
