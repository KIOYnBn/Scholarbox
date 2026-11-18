import type { ReactNode, RefObject } from 'react'
import { BookMarked, Grid2x2, LayoutList, Search, X } from 'lucide-react'
import { VaultSwitcher } from '@/components/vaults/VaultSwitcher'
import { cn } from '@/lib/utils'

export type HomeSection = 'papers' | 'notes'

export interface LibraryTopBarProps {
  /** 左上角图标（文献书库用书籍图标，笔记书架用笔记本图标） */
  icon: ReactNode
  /** 副标题右侧的计数说明，如「书库 · 8 篇」 */
  subtitle: string
  search: string
  onSearch: (value: string) => void
  searchPlaceholder: string
  searchRef?: RefObject<HTMLInputElement | null>
  mode: 'shelf' | 'list'
  onMode: (mode: 'shelf' | 'list') => void
  /** 文献书库 / 笔记书架 全局切换；记忆在 settings 里 */
  section: HomeSection
  onSection: (section: HomeSection) => void
  /** 右侧额外按钮：添加文献、新建笔记、设置… */
  actions?: ReactNode
}

/**
 * 书库与笔记书架共用的顶栏。
 *
 * 抽出来的理由很实际：两个主界面的顶栏是**同一个东西**——仓库切换、全局搜索、
 * 书架/列表切换、页面级动作。复制一份的话，以后改搜索快捷键或加一个按钮要改两处。
 */
export function LibraryTopBar({
  icon,
  subtitle,
  search,
  onSearch,
  searchPlaceholder,
  searchRef,
  mode,
  onMode,
  section,
  onSection,
  actions,
}: LibraryTopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-white shadow-sm">
        {icon}
      </div>
      <div className="min-w-0">
        <VaultSwitcher />
        <div className="text-[10px] leading-tight text-ink-3">{subtitle}</div>
      </div>

      <div className="relative mx-auto w-full max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-8 text-[12px] text-ink placeholder:text-ink-3/80 focus:border-accent/40 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
            aria-label="清空搜索"
          >
            <X className="size-3" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-surface px-1 text-[9px] text-ink-3">
            /
          </kbd>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
          {(
            [
              { value: 'papers', label: '文献书库', icon: BookMarked },
              { value: 'notes', label: '笔记书架', icon: Grid2x2 },
            ] as const
          ).map((option) => {
            const Icon = option.icon
            const active = section === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSection(option.value)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[5px] px-2 py-[4px] text-[11px] transition-colors',
                  active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon className="size-3" />
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
          {(
            [
              { value: 'shelf', label: '书架', icon: Grid2x2 },
              { value: 'list', label: '列表', icon: LayoutList },
            ] as const
          ).map((option) => {
            const Icon = option.icon
            const active = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onMode(option.value)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[5px] px-2 py-[4px] text-[11px] transition-colors',
                  active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon className="size-3" />
                {option.label}
              </button>
            )
          })}
        </div>

        {actions}
      </div>
    </header>
  )
}
