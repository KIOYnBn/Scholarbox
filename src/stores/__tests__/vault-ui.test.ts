import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_UI, useSettingsStore, vaultUiPrefs } from '../settings'

describe('三栏布局按仓库记忆', () => {
  beforeEach(() => {
    useSettingsStore.setState({ vaultUi: {} })
  })

  it('没有记录时返回默认值', () => {
    expect(vaultUiPrefs('v-1')).toEqual(DEFAULT_VAULT_UI)
    expect(vaultUiPrefs(null)).toEqual(DEFAULT_VAULT_UI)
  })

  it('写入后能读回，且只影响该仓库', () => {
    useSettingsStore.getState().setVaultUi('v-1', { notesOpen: false, sidebarWidth: 380 })
    expect(vaultUiPrefs('v-1').notesOpen).toBe(false)
    expect(vaultUiPrefs('v-1').sidebarWidth).toBe(380)
    // 另一个仓库不受影响
    expect(vaultUiPrefs('v-2')).toEqual(DEFAULT_VAULT_UI)
    expect(vaultUiPrefs('v-2').notesOpen).toBe(true)
  })

  it('部分写入是合并而不是覆盖', () => {
    useSettingsStore.getState().setVaultUi('v-1', { sidebarOpen: false })
    useSettingsStore.getState().setVaultUi('v-1', { notesWidth: 500 })
    const prefs = vaultUiPrefs('v-1')
    expect(prefs.sidebarOpen).toBe(false)
    expect(prefs.notesWidth).toBe(500)
    expect(prefs.notesOpen).toBe(DEFAULT_VAULT_UI.notesOpen)
  })

  it('切仓库再切回来，各自的折叠状态都还在', () => {
    useSettingsStore.getState().setVaultUi('a', { sidebarOpen: false, notesOpen: false })
    useSettingsStore.getState().setVaultUi('b', { sidebarWidth: 288 })
    expect(vaultUiPrefs('a')).toMatchObject({ sidebarOpen: false, notesOpen: false })
    expect(vaultUiPrefs('b')).toMatchObject({ sidebarWidth: 288, sidebarOpen: true })
  })
})

describe('缩放边界', () => {
  it('setZoom 夹在 50%–400%，且切到 custom', async () => {
    const { useReaderStore } = await import('../reader')
    useReaderStore.getState().setZoom(0.1)
    expect(useReaderStore.getState().zoom).toBe(0.5)
    useReaderStore.getState().setZoom(9)
    expect(useReaderStore.getState().zoom).toBe(4)
    expect(useReaderStore.getState().fit).toBe('custom')
  })

  it('zoomOut 到 50% 就停住，zoomIn 到 400% 就停住', async () => {
    const { useReaderStore } = await import('../reader')
    useReaderStore.getState().setZoom(0.5)
    useReaderStore.getState().zoomOut()
    expect(useReaderStore.getState().zoom).toBe(0.5)
    useReaderStore.getState().setZoom(4)
    useReaderStore.getState().zoomIn()
    expect(useReaderStore.getState().zoom).toBe(4)
  })
})
