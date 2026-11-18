import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, HardDrive, Loader2, Settings2, Unplug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useVaultsStore } from '@/stores/vaults'

/**
 * 左上角的仓库切换器（对标 Obsidian 的 vault 切换）。
 * 切换本身由 `useVaultsStore.switchTo` 负责：先自动提交、再重建 FS/git、再重载数据。
 */
export function VaultSwitcher({ compact = false }: { compact?: boolean }) {
  const registry = useVaultsStore((s) => s.registry)
  const busy = useVaultsStore((s) => s.busy)
  const switchTo = useVaultsStore((s) => s.switchTo)
  const openVaultManager = useUiStore((s) => s.openVaultManager)
  const entry = useVaultStore((s) => s.entry)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeId = registry.activeId
  const name = entry?.name ?? '未打开仓库'

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="切换仓库"
        className={cn(
          'group flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-2',
          compact && 'max-w-[9rem]',
        )}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            <span className="truncate text-[13px] font-semibold leading-tight tracking-tight text-ink">
              {name}
            </span>
            {busy ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-ink-3" />
            ) : (
              <ChevronDown className="size-3 shrink-0 text-ink-3" />
            )}
          </span>
          {!compact ? (
            <span className="block text-[10px] leading-tight text-ink-3">
              {registry.vaults.length} 个仓库
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-12px_rgba(20,18,14,0.35)]"
        >
          <div className="max-h-72 overflow-y-auto py-1 sb-scroll">
            {registry.vaults.map((vault) => {
              const isActive = vault.id === activeId
              return (
                <button
                  key={vault.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={async () => {
                    setOpen(false)
                    if (!isActive) await switchTo(vault.id)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60',
                    isActive && 'bg-accent-soft/50',
                  )}
                >
                  <span className="mt-0.5 text-ink-3">
                    {vault.rootType === 'opfs' ? <Unplug className="size-3.5" /> : <HardDrive className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[12px] text-ink">{vault.name}</span>
                      {isActive ? <Check className="size-3 shrink-0 text-accent" /> : null}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-ink-3" title={vault.rootPath}>
                      {vault.rootType === 'opfs' ? `OPFS://${vault.rootPath}` : vault.rootPath}
                    </span>
                  </span>
                </button>
              )
            })}
            {registry.vaults.length === 0 ? (
              <p className="px-2.5 py-3 text-[11.5px] text-ink-3">还没有仓库</p>
            ) : null}
          </div>
          <div className="border-t border-line/80">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                openVaultManager()
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Settings2 className="size-3.5" />
              仓库管理…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
