import { CloudOff, Cloudy, HardDrive, MonitorSmartphone, Moon, Sun } from 'lucide-react'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useSyncStore } from '@/stores/sync'
import { formatFileSize } from '@/lib/format'
import { cn } from '@/lib/utils'

function remoteShort(url: string): string {
  if (!url) return ''
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i)
  if (match) return `${match[1]}/${match[2]}`
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

export function StatusBar() {
  const kind = useVaultStore((s) => s.kind)
  const root = useVaultStore((s) => s.fs?.root)
  const vaultEntry = useVaultStore((s) => s.entry)
  const papers = useLibraryStore((s) => s.papers)

  const theme = useSettingsStore((s) => s.theme)
  const setSettings = useSettingsStore((s) => s.set)
  const openSettings = useUiStore((s) => s.openSettings)

  const reading = papers.filter((paper) => paper.meta.status === 'reading').length
  const totalBytes = papers.reduce((sum, paper) => sum + (paper.pdfSize ?? 0), 0)
  const remoteLabel = remoteShort(vaultEntry?.remoteUrl ?? '')
  const syncReady = Boolean(remoteLabel)
  const connected = useSyncStore((s) => s.connected)
  const changes = useSyncStore((s) => s.changes)
  const busy = useSyncStore((s) => s.busy)
  const dirty = changes.added + changes.modified + changes.deleted

  const cycleTheme = () => {
    setSettings({ theme: theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light' })
  }

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-surface-2/60 px-2.5 text-[10px] text-ink-3">
      <span className="flex shrink-0 items-center gap-1">
        <HardDrive className="size-3" />
        {kind === 'tauri' ? '本地文件夹' : kind === 'browser' ? '浏览器存储' : '未连接'}
      </span>
      <span className="hidden max-w-[40%] truncate font-mono text-[9.5px] opacity-70 sm:inline">
        {root || vaultEntry?.rootPath || '—'}
      </span>

      <div className="flex-1" />

      <span className="tabular-nums">
        {papers.length} 篇 · {reading} 在读 · {formatFileSize(totalBytes)}
      </span>

      <button
        type="button"
        onClick={() => openSettings('sync')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-surface-2',
          !syncReady && 'text-ink-3 hover:text-ink',
          syncReady && 'text-accent',
          busy && 'opacity-70',
        )}
        title={
          !syncReady
            ? '这个仓库还没有配置远端地址'
            : connected
              ? `${remoteLabel} · ${dirty > 0 ? `${dirty} 个文件待提交` : '工作区干净'}`
              : `${remoteLabel} · 还没有初始化仓库`
        }
      >
        {syncReady ? <Cloudy className={cn('size-3', busy && 'animate-pulse')} /> : <CloudOff className="size-3" />}
        {syncReady ? remoteLabel : '未开启同步'}
        {connected && dirty > 0 ? (
          <span className="rounded-full bg-warn/15 px-1 text-[9px] tabular-nums text-warn">{dirty}</span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={cycleTheme}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-surface-2 hover:text-ink"
        title="切换主题"
      >
        {theme === 'dark' ? (
          <Moon className="size-3" />
        ) : theme === 'light' ? (
          <Sun className="size-3" />
        ) : (
          <MonitorSmartphone className="size-3" />
        )}
        {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '自动'}
      </button>
    </footer>
  )
}
