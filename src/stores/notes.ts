import { create } from 'zustand'

export interface NoteInsert {
  /** 目标文献目录：只插到当前打开的那篇笔记里 */
  dir: string
  /** `![image](assets/p2-xxx.png)`，源码模式插这段 */
  markdown: string
  /** 已是 vault 相对路径（`papers/<dir>/assets/…`），所见即所得模式直接显示 */
  path: string
  /** 解析好的显示 URL（asset / blob），可能还没准备好 */
  url: string | null
  /** 自增，用来区分「同一段文字插入两次」 */
  nonce: number
}

interface NotesState {
  insert: NoteInsert | null
  requestImage: (payload: Omit<NoteInsert, 'nonce'>) => void
  consumeInsert: () => void
}

/**
 * 截图 -> 笔记 的接力棒。
 *
 * 截图发生在 PDF 面板，插入发生在笔记面板，两边不在同一棵子树里；
 * 用一个极小的全局信箱传递，笔记组件拿到后立刻消费掉，避免重复插入。
 */
export const useNotesStore = create<NotesState>()((set) => ({
  insert: null,
  requestImage: (payload) => set({ insert: { ...payload, nonce: Date.now() } }),
  consumeInsert: () => set({ insert: null }),
}))
