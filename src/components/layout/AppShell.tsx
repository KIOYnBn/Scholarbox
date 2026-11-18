import { useEffect, useRef, useState } from 'react'
import { FileUp, PanelLeftOpen } from 'lucide-react'
import { LibraryPanel } from '@/components/library/LibraryPanel'
import { NotesPane } from '@/components/notes/NotesPane'
import { ReaderPane } from '@/components/reader/ReaderPane'
import { PanelResizer } from './PanelResizer'
import { layoutShortcutFor } from '@/lib/shortcuts'
import { NotebookPen } from 'lucide-react'
import { StatusBar } from './StatusBar'
import { useLibraryStore } from '@/stores/library'
import { useReaderStore } from '@/stores/reader'
import { useSettingsStore, vaultUiPrefs } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { guessMetadataFromFilename, isPdfFile } from '@/lib/pdf'
import { useMediaQuery } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

const SIDEBAR_MIN = 264
const SIDEBAR_MAX = 460
const NOTES_MIN = 300
const NOTES_MAX = 640

export function AppShell() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth)
  const notesWidth = useSettingsStore((s) => s.notesWidth)
  const setSettings = useSettingsStore((s) => s.set)

  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const notesOpen = useUiStore((s) => s.notesOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleNotes = useUiStore((s) => s.toggleNotes)
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  const settingsOpen = useUiStore((s) => s.settingsOpen)

  const notice = useVaultStore((s) => s.notice)
  const clearNotice = useVaultStore((s) => s.clearNotice)

  const vaultEntry = useVaultStore((s) => s.entry)
  const vaultId = vaultEntry?.id ?? null

  const selectedDir = useLibraryStore((s) => s.selectedDir)
  const createPaper = useLibraryStore((s) => s.createPaper)

  const dragging = useRef(0)
  const [dropping, setDropping] = useState(false)


  /* ── 三栏布局按 activeVault 记忆 ────────────────────────────────────── */
  // 先按仓库把「折叠状态 + 栏宽」灌进 ui/settings，再在它们变化时写回。
  // 用 hydratedRef 挡一层：灌入本身会触发写回，不挡就是一次无意义的回写。
  const hydratedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!vaultId || hydratedRef.current === vaultId) return
    hydratedRef.current = vaultId
    const prefs = vaultUiPrefs(vaultId)
    // 平板竖屏默认收起右栏：屏幕宽度不够三栏并排
    const portrait = !isDesktop && window.innerHeight > window.innerWidth
    toggleSidebar(prefs.sidebarOpen)
    toggleNotes(portrait ? false : prefs.notesOpen)
    setSettings({ sidebarWidth: prefs.sidebarWidth, notesWidth: prefs.notesWidth })
  }, [vaultId, isDesktop, toggleSidebar, toggleNotes, setSettings])

  useEffect(() => {
    if (!vaultId || hydratedRef.current !== vaultId) return
    useSettingsStore.getState().setVaultUi(vaultId, {
      sidebarOpen,
      notesOpen,
      sidebarWidth,
      notesWidth,
    })
  }, [vaultId, sidebarOpen, notesOpen, sidebarWidth, notesWidth])

  /* ── keep the viewer in sync with the selection ────────────────────── */
  useEffect(() => {
    if (!selectedDir) {
      useReaderStore.getState().close()
      return
    }
    if (useReaderStore.getState().dir !== selectedDir) {
      useReaderStore.getState().open(selectedDir)
    }
    if (!isDesktop) {
      // On a tablet the two drawers must start closed, otherwise the reader is
      // covered by a panel the user never asked for.
      toggleSidebar(false)
      toggleNotes(false)
    }
  }, [selectedDir, isDesktop, toggleSidebar, toggleNotes])

  /* ── auto-dismiss the vault notice ─────────────────────────────────── */
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(clearNotice, 6000)
    return () => clearTimeout(timer)
  }, [notice, clearNotice])

  /* ── drag & drop PDFs anywhere on the window ───────────────────────── */
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragging.current += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragging.current = Math.max(0, dragging.current - 1)
      if (dragging.current === 0) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragging.current = 0
      setDropping(false)
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => isPdfFile(file.name))
      void (async () => {
        let first: string | null = null
        for (const file of files) {
          const guess = guessMetadataFromFilename(file.name)
          const record = await createPaper({
            title: guess.title,
            year: guess.year,
            pdf: new Uint8Array(await file.arrayBuffer()),
          })
          first ??= record?.dir ?? null
        }
        if (first) useLibraryStore.getState().select(first)
      })()
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [createPaper])

  /* ── keyboard shortcuts (ignored while typing) ─────────────────────── */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true

      if (event.key === 'Escape') {
        if (settingsOpen) useUiStore.getState().closeSettings()
        if (!isDesktop) {
          toggleSidebar(false)
          toggleNotes(false)
        }
        return
      }

      // Shift+X：框选截图。它必须排在「正在输入就不响应」之前 —— 用户最典型的
      // 用法就是光标停在笔记里的时候按 Shift+X，编辑区不能把快捷键吞掉。
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'x') {
        const state = useReaderStore.getState()
        if (state.dir) {
          event.preventDefault()
          state.setCaptureMode(!state.captureMode)
        }
        return
      }

      if (typing) return

      // 三栏折叠：Ctrl+B 左栏、Ctrl+Alt+B 右栏（与 Obsidian 一致）
      const layoutShortcut = layoutShortcutFor(event)
      if (layoutShortcut) {
        event.preventDefault()
        if (layoutShortcut === 'notes') toggleNotes()
        else toggleSidebar()
        return
      }

      const reader = useReaderStore.getState()
      if (!reader.dir) return

      if ((event.metaKey || event.ctrlKey) && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        reader.zoomIn()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault()
        reader.zoomOut()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        reader.setPage(reader.currentPage - 1)
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        reader.setPage(reader.currentPage + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isDesktop, settingsOpen, toggleNotes, toggleSidebar])

  /* 笔记面板的截图按钮通过事件触发，不直接依赖 reader store */
  useEffect(() => {
    const onCapture = () => {
      const reader = useReaderStore.getState()
      if (!reader.dir) return
      reader.setCaptureMode(true)
    }
    window.addEventListener('scholarbox:capture', onCapture)
    return () => window.removeEventListener('scholarbox:capture', onCapture)
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-ink">
      <div className="relative flex min-h-0 flex-1">
        {/* ── left: library ─────────────────────────────────────────── */}
        {isDesktop ? (
          <>
            {/* 收起时只做 display:none —— 组件保持挂载，滚动位置和筛选状态都不丢 */}
            <div
              style={{ width: sidebarWidth }}
              className={cn('shrink-0', !sidebarOpen && 'hidden')}
              aria-hidden={!sidebarOpen}
            >
              <LibraryPanel />
            </div>
            {sidebarOpen ? (
              <PanelResizer
                label="文献库宽度"
                value={sidebarWidth}
                min={SIDEBAR_MIN}
                max={SIDEBAR_MAX}
                onChange={(width) => setSettings({ sidebarWidth: width })}
              />
            ) : null}
          </>
        ) : (
          <>
            {sidebarOpen ? (
              <div
                className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[1px]"
                onClick={() => toggleSidebar(false)}
              />
            ) : null}
            <div
              className={cn(
                'fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[340px] border-r border-line bg-surface transition-transform duration-200 ease-out',
                sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
              )}
            >
              <LibraryPanel />
            </div>
          </>
        )}

        {/* ── center: reader ────────────────────────────────────────── */}
        <ReaderPane />

        {/* ── right: notes ──────────────────────────────────────────── */}
        {isDesktop ? (
          <>
            {notesOpen ? (
              <PanelResizer
                label="笔记宽度"
                value={notesWidth}
                min={NOTES_MIN}
                max={NOTES_MAX}
                invert
                onChange={(width) => setSettings({ notesWidth: width })}
              />
            ) : null}
            {/* 保持挂载：收起右栏时编辑器实例还在，未保存的草稿不会因为 unmount 丢失 */}
            <div
              style={{ width: notesWidth }}
              className={cn('shrink-0', !notesOpen && 'hidden')}
              aria-hidden={!notesOpen}
            >
              <NotesPane />
            </div>
          </>
        ) : (
          <>
            {notesOpen ? (
              <div
                className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[1px]"
                onClick={() => toggleNotes(false)}
              />
            ) : null}
            <div
              className={cn(
                'fixed inset-y-0 right-0 z-40 w-[92vw] max-w-[440px] border-l border-line bg-surface transition-transform duration-200 ease-out',
                notesOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full',
              )}
            >
              <NotesPane />
            </div>
          </>
        )}
      </div>

      {/* 左栏收起时的入口：以前只能按 Ctrl+B 才能找回目录栏，鼠标用户等于走丢了 */}
      {isDesktop && !sidebarOpen ? (
        <button
          type="button"
          onClick={() => toggleSidebar(true)}
          title="展开目录栏（Ctrl+B）"
          aria-label="展开目录栏"
          className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-2 text-[11.5px] font-medium text-ink shadow-lg backdrop-blur transition hover:border-accent/50 hover:text-accent"
        >
          <PanelLeftOpen className="size-4" />
          目录
        </button>
      ) : null}

      {/* 右栏收起时的入口：不打断阅读，但一点就能把笔记拉回来 */}
      {!notesOpen && selectedDir ? (
        <button
          type="button"
          onClick={() => {
            toggleNotes(true)
            setSidebarTab('notes')
          }}
          title="快速打开笔记（Ctrl+Alt+B）"
          className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-2 text-[11.5px] font-medium text-ink shadow-lg backdrop-blur transition hover:border-accent/50 hover:text-accent"
        >
          <NotebookPen className="size-4" />
          笔记
        </button>
      ) : null}

      <StatusBar />


      {dropping ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent/60 bg-surface/95 px-10 py-8 shadow-xl">
            <FileUp className="size-7 text-accent" />
            <div className="text-[13px] font-medium text-ink">松开以导入 PDF</div>
            <div className="text-[11px] text-ink-3">会自动建立 papers/ 文件夹与 meta.json</div>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed bottom-9 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[11.5px] text-ink-2 shadow-lg">
            <span>{notice}</span>
            <button
              type="button"
              onClick={clearNotice}
              className="text-[11px] text-ink-3 transition-colors hover:text-ink"
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
