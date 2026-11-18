import { BookMarked, LayoutGrid, PanelLeftClose, Plus, Settings2 } from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { VaultSwitcher } from '@/components/vaults/VaultSwitcher'
import { useLibraryStore } from '@/stores/library'
import { cn } from '@/lib/utils'

export function SidebarHeader() {
  const openAddPaper = useUiStore((s) => s.openAddPaper)
  const openSettings = useUiStore((s) => s.openSettings)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setMainView = useUiStore((s) => s.setMainView)
  const papers = useLibraryStore((s) => s.papers)

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2.5">
      <button
        type="button"
        onClick={() => setMainView('home')}
        title="返回书库"
        aria-label="返回书库"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
      >
        <LayoutGrid className="size-3.5" />
      </button>
      <div className="flex size-6 items-center justify-center rounded-md bg-accent text-white shadow-sm">
        <BookMarked className="size-3.5" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <VaultSwitcher compact />
        <div className="truncate text-[10px] leading-tight text-ink-3">
          ScholarBox · {papers.length} 篇
        </div>
      </div>
      <button
        type="button"
        onClick={openAddPaper}
        title="添加文献"
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md bg-accent text-white',
          'transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => openSettings()}
        title="设置"
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
      >
        <Settings2 className="size-3.5" />
      </button>
      {/* 收起目录栏：以前只有平板宽度才显示，桌面端只能靠 Ctrl+B，鼠标用户找不到。
          收起后左边会浮出一个「目录」按钮，可以再点回来。 */}
      <button
        type="button"
        onClick={() => toggleSidebar(false)}
        title="收起目录栏 · Ctrl+B"
        aria-label="收起目录栏"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
      >
        <PanelLeftClose className="size-3.5" />
      </button>
    </div>
  )
}
