import { useEffect, useRef } from 'react'
import { seedDemoVault } from '@/lib/vault/demo'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { useVaultStore } from '@/stores/vault'

/**
 * 文献库启动流程：准备示例数据 → 扫描 `papers/` → 恢复上次打开的文献，
 * 再挂一个每分钟跑一次的 Git 定时器（自动提交 + 状态刷新）。
 *
 * 放在 App 层而不是 AppShell 里，是因为「书库」是启动默认页 ——
 * 如果把这段逻辑绑在三栏工作区上，首页就会是一个空书架。
 */
export function useVaultBoot(): void {
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      try {
        await seedDemoVault()
      } catch (err) {
        console.warn('[boot] demo seed failed', err)
      }
      await useLibraryStore.getState().load()
      await useStandaloneNotesStore.getState().load()

      const last = useSettingsStore.getState().lastPaperDir
      const papers = useLibraryStore.getState().papers
      if (last && papers.some((paper) => paper.dir === last)) {
        useLibraryStore.getState().select(last)
      }

      void useSyncStore.getState().refresh()
    })()
  }, [])

  /* ── Git 定时器：自动提交 + 状态刷新 ────────────────────────────── */
  useEffect(() => {
    const tick = () => {
      const entry = useVaultStore.getState().entry
      if (!entry?.remoteUrl.trim()) return
      const sync = useSyncStore.getState()
      void sync.autoCommitTick()
      if (!sync.busy) void sync.refresh()
    }
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [])
}
