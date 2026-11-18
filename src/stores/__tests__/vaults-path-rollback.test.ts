import { beforeEach, describe, expect, it, vi } from 'vitest'

// 探针/磁盘都换成可控桩：这一组测试只关心「改路径失败之后注册表是什么样」
vi.mock('@/lib/vault/path-check', () => ({
  probeVaultPath: vi.fn(async ({ path }: { path: string }) => ({ ok: true, resolved: path })),
  appConfigBaseDir: vi.fn(async () => 'C:/AppData/scholarbox'),
}))

vi.mock('@/lib/vault/registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vault/registry')>('@/lib/vault/registry')
  return {
    ...actual,
    loadRegistry: vi.fn(async () => actual.emptyRegistry()),
    saveRegistry: vi.fn(async () => undefined),
  }
})

import { probeVaultPath } from '@/lib/vault/path-check'
import { createVaultEntry, emptyRegistry, type VaultRegistry } from '@/lib/vault/registry'
import { useLibraryStore } from '@/stores/library'
import { useSyncStore } from '@/stores/sync'
import { useVaultStore } from '@/stores/vault'
import { useVaultsStore } from '@/stores/vaults'

const entry = createVaultEntry({ name: '主库', rootType: 'opfs', rootPath: 'MyVault' })

function seedRegistry(reg: VaultRegistry) {
  useVaultsStore.setState({ registry: reg, ready: true, busy: false, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  seedRegistry({ version: 1, activeId: entry.id, vaults: [entry] })
  useSyncStore.setState({ connected: true, history: [], lastSyncAt: Date.now() })
  useLibraryStore.setState({ papers: [] })
})

describe('updateVaultPath 回滚（REVIEW P0-1）', () => {
  it('新路径打不开时，注册表回到旧路径', async () => {
    const openEntry = vi
      .spyOn(useVaultStore.getState(), 'openEntry')
      .mockResolvedValueOnce(false) // 新路径失败
      .mockResolvedValueOnce(true) // 回滚到旧路径成功

    const ok = await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')

    expect(ok).toBe(false)
    expect(useVaultsStore.getState().registry.vaults[0]?.rootPath).toBe('MyVault')
    expect(useVaultsStore.getState().registry.activeId).toBe(entry.id)
    expect(openEntry).toHaveBeenCalledTimes(2)
    expect(openEntry.mock.calls[1]?.[0].rootPath).toBe('MyVault')
    expect(useVaultsStore.getState().error).toContain('已回滚')

    openEntry.mockRestore()
  })

  it('回滚也失败时，注册表仍然停在旧路径，错误提示更严重', async () => {
    const openEntry = vi.spyOn(useVaultStore.getState(), 'openEntry').mockResolvedValue(false)

    const ok = await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')

    expect(ok).toBe(false)
    expect(useVaultsStore.getState().registry.vaults[0]?.rootPath).toBe('MyVault')
    expect(useVaultsStore.getState().error).toContain('回滚也失败')

    openEntry.mockRestore()
  })

  it('成功时写入新路径并重开', async () => {
    const openEntry = vi.spyOn(useVaultStore.getState(), 'openEntry').mockResolvedValue(true)

    const ok = await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')

    expect(ok).toBe(true)
    expect(useVaultsStore.getState().registry.vaults[0]?.rootPath).toBe('MyVault-2026')
    expect(openEntry).toHaveBeenCalledTimes(1)

    openEntry.mockRestore()
  })
})

describe('改路径后的 Git 状态（REVIEW P1-4）', () => {
  it('成功改路径会清空上一个仓库的连接与历史', async () => {
    useSyncStore.setState({
      connected: true,
      branch: 'main',
      history: [{ oid: 'x', short: 'x', message: 'old', author: 'a', email: 'e', timestamp: 1, files: 0 }],
    })
    const openEntry = vi.spyOn(useVaultStore.getState(), 'openEntry').mockResolvedValue(true)
    await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')

    expect(useSyncStore.getState().connected).toBe(false)
    expect(useSyncStore.getState().history).toHaveLength(0)
    expect(useSyncStore.getState().lastSyncAt).toBeNull()

    openEntry.mockRestore()
  })

  it('失败回滚时也不保留上一个仓库的历史', async () => {
    useSyncStore.setState({ connected: true, branch: 'main' })
    const openEntry = vi.spyOn(useVaultStore.getState(), 'openEntry').mockResolvedValue(false)
    await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')

    expect(useSyncStore.getState().connected).toBe(false)
    openEntry.mockRestore()
  })
})

describe('并发保护（REVIEW P1-5）', () => {
  it('busy 时第二次调用直接返回 false，不写注册表', async () => {
    useVaultsStore.setState({ busy: true })
    const ok = await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')
    expect(ok).toBe(false)
    expect(probeVaultPath).not.toHaveBeenCalled()
    expect(useVaultsStore.getState().registry.vaults[0]?.rootPath).toBe('MyVault')
  })
})

describe('探针失败时不改注册表', () => {
  it('probe 返回不可用时保持旧路径并给出原因', async () => {
    vi.mocked(probeVaultPath).mockResolvedValueOnce({ ok: false, resolved: '', reason: '目录不可写' })
    const ok = await useVaultsStore.getState().updateVaultPath(entry.id, 'MyVault-2026')
    expect(ok).toBe(false)
    expect(useVaultsStore.getState().registry.vaults[0]?.rootPath).toBe('MyVault')
    expect(useVaultsStore.getState().error).toBe('目录不可写')
  })
})

describe('空注册表也安全', () => {
  it('未知 id 返回 false', async () => {
    expect(await useVaultsStore.getState().updateVaultPath('nope', 'x')).toBe(false)
    expect(useVaultsStore.getState().registry.vaults).toHaveLength(1)
  })
})

describe('init 不受影响（回归）', () => {
  it('注册表已经有记录时不会重复迁移', async () => {
    seedRegistry(emptyRegistry())
    useVaultsStore.setState({ ready: false })
    const openEntry = vi.spyOn(useVaultStore.getState(), 'openEntry').mockResolvedValue(true)
    await useVaultsStore.getState().init()
    expect(useVaultsStore.getState().registry.vaults.length).toBeGreaterThanOrEqual(1)
    openEntry.mockRestore()
  })
})
