import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []

vi.mock('@/lib/fs/tauri', () => ({
  isTauriRuntime: () => true,
  grantFsScope: vi.fn(async (path: string) => {
    calls.push(`scope:${path}`)
  }),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn(async () => 'C:/Users/me/AppData/scholarbox'),
  documentDir: vi.fn(async () => 'C:/Users/me/Documents'),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(async (path: string) => {
    calls.push(`mkdir:${path}`)
  }),
  writeTextFile: vi.fn(async (path: string) => {
    calls.push(`write:${path}`)
  }),
  readTextFile: vi.fn(async () => 'ok'),
  remove: vi.fn(async (path: string) => {
    calls.push(`remove:${path}`)
  }),
}))

import { mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { grantFsScope } from '@/lib/fs/tauri'
import { appConfigBaseDir, probeVaultPath } from '@/lib/vault/path-check'

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
})

describe('probeDesktop 的调用顺序（REVIEW P0-2）', () => {
  it('先授权 scope，再 mkdir / 写探针', async () => {
    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })

    expect(result.ok).toBe(true)
    expect(grantFsScope).toHaveBeenCalledWith('D:/papers/MyVault')

    const scopeIndex = calls.findIndex((c) => c.startsWith('scope:'))
    const mkdirIndex = calls.findIndex((c) => c.startsWith('mkdir:'))
    expect(scopeIndex).toBeGreaterThanOrEqual(0)
    expect(mkdirIndex).toBeGreaterThan(scopeIndex)
  })

  it('相对路径按 appConfigDir/vaults/ 解析，且授权的是解析后的绝对路径', async () => {
    await probeVaultPath({ rootType: 'fs', path: 'papers/2026' })
    await expect(appConfigBaseDir()).resolves.toBe('C:/Users/me/AppData/scholarbox')
    expect(grantFsScope).toHaveBeenCalledWith('C:/Users/me/AppData/scholarbox/vaults/papers/2026')
  })

  it('mkdir 失败时不写探针，并报「无法创建目录」', async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error('forbidden path'))

    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('无法创建目录')
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('写失败时报「目录不可写」', async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('forbidden path'))

    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('目录不可写')
  })
})

describe('探针文件不留残留（REVIEW P2）', () => {
  it('成功路径删掉探针', async () => {
    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })
    expect(result.ok).toBe(true)
    expect(remove).toHaveBeenCalledWith('D:/papers/MyVault/.scholarbox-path-probe')
  })

  it('读失败时也会删掉探针（finally 里清理）', async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error('denied'))

    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('目录不可读')
    expect(remove).toHaveBeenCalledWith('D:/papers/MyVault/.scholarbox-path-probe')
  })

  it('删除本身失败不影响结论，也不会把失败当成「目录不可用」', async () => {
    vi.mocked(remove).mockRejectedValueOnce(new Error('locked'))

    const result = await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })

    expect(result.ok).toBe(true)
  })

  it('写都没成功时不去删（没建过就不动别人的目录）', async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('forbidden path'))

    await probeVaultPath({ rootType: 'fs', path: 'D:/papers/MyVault' })
    expect(remove).not.toHaveBeenCalled()
  })
})
