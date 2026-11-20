import { useCallback } from 'react'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useUiStore } from '@/stores/ui'

/**
 * `[[...]]` 的目标可能是笔记（`.md`）也可能是 PDF：笔记直接进全屏编辑，
 * PDF 回到三栏阅读器并把对应文献选中。
 *
 * 没写路径、只写了名字的 `[[笔记名]]`（Obsidian 用户的习惯写法）按标题模糊解析：
 * 先独立笔记、再文献标题、最后文献文件夹名，大小写不敏感。
 */
export function useOpenWikiTarget() {
  return useCallback((path: string) => {
    const clean = path.replace(/^\.\//, '').trim()

    // 纯名字：Obsidian 式的「按标题找笔记」，不要求写完整路径
    if (!clean.includes('/') && !/\.[a-z0-9]+$/i.test(clean)) {
      const lower = clean.toLowerCase()
      const standalone = useStandaloneNotesStore
        .getState()
        .notes.find((n) => n.title.toLowerCase() === lower)
      if (standalone) {
        useUiStore.getState().openNote({ kind: 'standalone', file: standalone.file })
        return
      }
      const papers = useLibraryStore.getState().papers
      const paper =
        papers.find((p) => p.meta.title.toLowerCase() === lower) ??
        papers.find((p) => p.dir.toLowerCase() === lower)
      if (paper) {
        useUiStore.getState().openNote({ kind: 'paper', dir: paper.dir })
        return
      }
      // 没解析到：落入下面的路径解析，行为与从前一致（大多数情况是补全写的完整路径）
    }

    if (/\.md$/i.test(clean)) {
      if (clean.startsWith('notes/')) {
        useUiStore.getState().openNote({ kind: 'standalone', file: clean.slice('notes/'.length) })
        return
      }
      const match = /^papers\/(.+)\/note\.md$/i.exec(clean)
      if (match) {
        useUiStore.getState().openNote({ kind: 'paper', dir: match[1]! })
        return
      }
      useUiStore.getState().openNote({ kind: 'standalone', file: clean })
      return
    }
    const dir = /^papers\/(.+?)\/[^/]+\.pdf$/i.exec(clean)?.[1]
    if (dir) {
      useLibraryStore.getState().select(dir)
      useUiStore.getState().setMainView('workspace')
    }
  }, [])
}
