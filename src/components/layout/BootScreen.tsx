import { AlertTriangle, BookOpenText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useVaultsStore } from '@/stores/vaults'

export function BootScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-bg text-ink">
      <div className="relative flex size-14 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/20">
        <BookOpenText className="size-7" strokeWidth={1.75} />
      </div>
      <div className="text-center">
        <h1 className="text-[15px] font-semibold tracking-tight">ScholarBox</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-ink-3">
          <Loader2 className="size-3 animate-spin" />
          正在打开文献库…
        </p>
      </div>
    </div>
  )
}

export function VaultErrorScreen({ message }: { message: string | null }) {
  const retry = useVaultsStore((s) => s.retry)
  const openVaultManager = useUiStore((s) => s.openVaultManager)
  const kind = useVaultStore((s) => s.kind)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg px-6 text-ink">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <AlertTriangle className="size-6" />
      </div>
      <div className="max-w-md text-center">
        <h1 className="text-[14px] font-semibold">无法打开文献库</h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{message ?? '未知错误'}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void retry()}>重试</Button>
        <Button variant={kind === 'tauri' ? 'primary' : 'default'} onClick={openVaultManager}>
          选择仓库文件夹
        </Button>
      </div>
    </div>
  )
}
