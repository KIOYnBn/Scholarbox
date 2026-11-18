import { useEffect, useRef } from 'react'
import { BootScreen, VaultErrorScreen } from '@/components/layout/BootScreen'
import { AppShell } from '@/components/layout/AppShell'
import { LibraryHome } from '@/components/shelf/LibraryHome'
import { NotesLibrary } from '@/components/notes/NotesLibrary'
import { useSettingsStore } from '@/stores/settings'
import { FullNoteView } from '@/components/notes/FullNoteView'
import { VaultManagerDialog } from '@/components/vaults/VaultManagerDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { NewPaperDialog } from '@/components/library/NewPaperDialog'
import { useUiStore } from '@/stores/ui'
import { useVaultBoot } from '@/hooks/useVaultBoot'
import { useThemeEffect } from '@/hooks/useTheme'
import { useVaultStore } from '@/stores/vault'
import { useVaultsStore } from '@/stores/vaults'

export default function App() {
  useThemeEffect()

  const status = useVaultStore((s) => s.status)
  const error = useVaultStore((s) => s.error)
  const init = useVaultsStore((s) => s.init)
  const started = useRef(false)

  /* 启动：读注册表（含首次迁移）→ 打开上次的仓库 */
  useEffect(() => {
    if (started.current) return
    started.current = true
    void init()
  }, [init])

  return (
    <>
      {status === 'error' ? (
        <VaultErrorScreen message={error} />
      ) : status !== 'ready' ? (
        <BootScreen />
      ) : (
        <ReadyApp />
      )}
      {/* 这几个对话框由 store 驱动，挂在 App 上：书库页与三栏工作区共用 */}
      <SettingsDialog />
      <NewPaperDialog />
      <VaultManagerDialog />
    </>
  )
}

function ReadyApp() {
  const mainView = useUiStore((s) => s.mainView)
  const homeSection = useSettingsStore((s) => s.homeSection)
  useVaultBoot()

  // 书库是启动默认页；点书脊 / 打开阅读才进入三栏工作区；
  // 全屏笔记是第三个视图（不显示 PDF，专心写）
  if (mainView === 'note') return <FullNoteView />
  if (mainView !== 'home') return <AppShell />
  return homeSection === 'notes' ? <NotesLibrary variant="page" /> : <LibraryHome />
}
