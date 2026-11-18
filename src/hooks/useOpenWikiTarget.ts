import { useCallback } from 'react'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * `[[...]]` 的目标可能是笔记（`.md`）也可能是 PDF：笔记直接进全屏编辑，
 * PDF 回到三栏阅读器并把对应文献选中。
 */
export function useOpenWikiTarget() {
  return useCallback((path: string) => {
    const clean = path.replace(/^\.\//, '')
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
