import { describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { commitAll, initRepo, log, remoteUrl } from '@/lib/git/repo'
import {
  activeVault,
  createVaultEntry,
  emptyRegistry,
  findVaultByPath,
  migrateLegacyRegistry,
  normalizeRegistry,
  parseRegistry,
  removeVault,
  serializeRegistry,
  setActiveVault,
  upsertVault,
  vaultNameFromPath,
  type VaultEntry,
} from '@/lib/vault/registry'

const author = { name: 'ScholarBox', email: 'scholarbox@localhost' }

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    ...createVaultEntry({ rootType: 'fs', rootPath: 'D:/papers/Alpha' }),
    ...overrides,
  }
}

describe('仓库记录的构造', () => {
  it('从路径推名字，分支默认 main，自动提交默认关闭', () => {
    const created = createVaultEntry({ rootType: 'fs', rootPath: 'D:\\papers\\MyVault\\' })
    expect(created.name).toBe('MyVault')
    expect(created.branch).toBe('main')
    expect(created.autoCommitMinutes).toBe(0)
    expect(created.pat).toBe('')
    expect(created.id).toMatch(/^v-/)
    expect(created.createdAt).toBeGreaterThan(0)
  })

  it('显式名字优先，PAT 与远端原样保留', () => {
    const created = createVaultEntry({
      name: '  实验室文献  ',
      rootType: 'fs',
      rootPath: '/data/lab',
      remoteUrl: 'https://github.com/me/lab.git',
      branch: 'trunk',
      pat: 'ghp_x',
      autoCommitMinutes: 30,
    })
    expect(created.name).toBe('实验室文献')
    expect(created.remoteUrl).toBe('https://github.com/me/lab.git')
    expect(created.branch).toBe('trunk')
    expect(created.pat).toBe('ghp_x')
    expect(created.autoCommitMinutes).toBe(30)
  })

  it('自动提交间隔被夹在 0..1440 之间', () => {
    expect(
      createVaultEntry({ rootType: 'opfs', rootPath: 'A', autoCommitMinutes: -5 }).autoCommitMinutes,
    ).toBe(0)
    expect(
      createVaultEntry({ rootType: 'opfs', rootPath: 'A', autoCommitMinutes: 99999 }).autoCommitMinutes,
    ).toBe(1440)
  })

  it('vaultNameFromPath 能处理 OPFS 前缀与尾斜杠', () => {
    expect(vaultNameFromPath('OPFS://MyVault')).toBe('MyVault')
    expect(vaultNameFromPath('/a/b/c/')).toBe('c')
    expect(vaultNameFromPath('C:\\x\\y')).toBe('y')
  })
})

describe('注册表容错解析', () => {
  it('坏 JSON 与空文件都回落到空注册表', () => {
    expect(parseRegistry('{ not json')).toEqual(emptyRegistry())
    expect(parseRegistry('')).toEqual(emptyRegistry())
    expect(parseRegistry(null)).toEqual(emptyRegistry())
  })

  it('丢掉没有 rootPath 的记录，缺字段用默认值补齐', () => {
    const registry = normalizeRegistry({
      activeId: 'b',
      vaults: [
        { id: 'a', rootPath: '/x/y', name: 'Y' },
        { id: 'bad' },
        { id: 'b', rootPath: '/z', branch: '', autoCommitMinutes: 'abc' },
      ],
    })
    expect(registry.vaults).toHaveLength(2)
    expect(registry.vaults.map((vault) => vault.id)).toEqual(['a', 'b'])
    expect(registry.vaults[0]!.branch).toBe('main')
    expect(registry.vaults[1]!.branch).toBe('main')
    expect(registry.vaults[1]!.autoCommitMinutes).toBe(0)
    expect(registry.activeId).toBe('b')
  })

  it('activeId 指向不存在的仓库时回落到第一条', () => {
    const registry = normalizeRegistry({ activeId: 'nope', vaults: [{ id: 'a', rootPath: '/x' }] })
    expect(registry.activeId).toBe('a')
  })

  it('重复 id 会被拆开，不静默丢记录', () => {
    const registry = normalizeRegistry({
      vaults: [
        { id: 'same', rootPath: '/a' },
        { id: 'same', rootPath: '/b' },
      ],
    })
    expect(registry.vaults).toHaveLength(2)
    expect(new Set(registry.vaults.map((vault) => vault.id)).size).toBe(2)
  })

  it('序列化后能原样解析回来', () => {
    const created = entry({ name: 'Alpha', pat: 'ghp_secret' })
    const round = parseRegistry(serializeRegistry({ version: 1, activeId: created.id, vaults: [created] }))
    expect(round.vaults).toHaveLength(1)
    expect(round.vaults[0]).toEqual(created)
  })
})

describe('注册表增删改', () => {
  it('upsert 新增追加、更新保持位置', () => {
    const a = entry({ id: 'a', name: 'A' })
    const b = entry({ id: 'b', name: 'B' })
    let registry = upsertVault(upsertVault(emptyRegistry(), a), b)
    expect(registry.vaults.map((vault) => vault.id)).toEqual(['a', 'b'])

    registry = upsertVault(registry, { ...a, name: 'A2' })
    expect(registry.vaults.map((vault) => vault.name)).toEqual(['A2', 'B'])
  })

  it('移除当前仓库时把 activeId 让给下一条，其余记录不动', () => {
    const a = entry({ id: 'a' })
    const b = entry({ id: 'b' })
    let registry = upsertVault(upsertVault(emptyRegistry(), a), b)
    registry = setActiveVault(registry, 'a')

    const afterRemove = removeVault(registry, 'a')
    expect(afterRemove.vaults.map((vault) => vault.id)).toEqual(['b'])
    expect(afterRemove.activeId).toBe('b')

    const afterRemoveInactive = removeVault(registry, 'b')
    expect(afterRemoveInactive.vaults.map((vault) => vault.id)).toEqual(['a'])
    expect(afterRemoveInactive.activeId).toBe('a')
  })

  it('setActiveVault 拒绝不存在的 id', () => {
    const registry = upsertVault(emptyRegistry(), entry({ id: 'a' }))
    expect(setActiveVault(registry, 'ghost')).toBe(registry)
    expect(activeVault(setActiveVault(registry, 'a'))?.id).toBe('a')
  })

  it('同路径不能注册两次（大小写与尾斜杠不敏感）', () => {
    const registry = upsertVault(emptyRegistry(), entry({ id: 'a', rootPath: 'D:/Papers/Beta/' }))
    expect(findVaultByPath(registry, 'd:/papers/beta')?.id).toBe('a')
    expect(findVaultByPath(registry, 'D:/papers/gamma')).toBeNull()
  })
})

describe('首次启动迁移', () => {
  it('桌面端把旧路径与全局 GitHub 配置折成一条记录', () => {
    const { registry, migrated } = migrateLegacyRegistry(
      emptyRegistry(),
      {
        vaultPath: 'D:/Documents/ScholarBox/MyVault',
        github: { owner: 'me', repo: 'papers', branch: 'dev', token: 'ghp_legacy', autoCommitMinutes: 15 },
      },
      { desktop: true },
    )
    expect(migrated).toBe(true)
    expect(registry.vaults).toHaveLength(1)
    const only = registry.vaults[0]!
    expect(only.rootType).toBe('fs')
    expect(only.rootPath).toBe('D:/Documents/ScholarBox/MyVault')
    expect(only.name).toBe('MyVault')
    expect(only.remoteUrl).toBe('https://github.com/me/papers.git')
    expect(only.branch).toBe('dev')
    expect(only.pat).toBe('ghp_legacy')
    expect(only.autoCommitMinutes).toBe(15)
    expect(registry.activeId).toBe(only.id)
  })

  it('浏览器端迁移成 OPFS 记录，并剥掉 OPFS:// 前缀', () => {
    const { registry } = migrateLegacyRegistry(emptyRegistry(), { vaultPath: 'OPFS://MyVault' }, { desktop: false })
    expect(registry.vaults[0]!.rootType).toBe('opfs')
    expect(registry.vaults[0]!.rootPath).toBe('MyVault')
  })

  it('没有旧配置时也能给出一个默认仓库', () => {
    const { registry, migrated } = migrateLegacyRegistry(emptyRegistry(), {}, { desktop: true })
    expect(migrated).toBe(true)
    expect(registry.vaults[0]!.rootPath).toBe('ScholarBox/MyVault')
  })

  it('全新安装优先用调用方给的真实目录，而不是 appConfigDir 里的相对路径', () => {
    const { registry } = migrateLegacyRegistry(emptyRegistry(), {}, {
      desktop: true,
      defaultPath: 'C:\\Users\\me\\Documents\\ScholarBox\\MyVault',
    })
    expect(registry.vaults[0]!.rootPath).toBe('C:\\Users\\me\\Documents\\ScholarBox\\MyVault')
  })

  it('有旧 vaultPath 时仍然以旧路径为准', () => {
    const { registry } = migrateLegacyRegistry(
      emptyRegistry(),
      { vaultPath: 'D:\\papers\\vault' },
      { desktop: true, defaultPath: 'C:\\Users\\me\\Documents\\ScholarBox\\MyVault' },
    )
    expect(registry.vaults[0]!.rootPath).toBe('D:\\papers\\vault')
  })

  it('已经有多条记录就不再迁移', () => {
    const existing = upsertVault(emptyRegistry(), entry({ id: 'a' }))
    const { registry, migrated } = migrateLegacyRegistry(existing, { vaultPath: '/other' }, { desktop: true })
    expect(migrated).toBe(false)
    expect(registry).toBe(existing)
  })
})

describe('两个仓库互相隔离', () => {
  it('各自的 .git、历史与远端互不串扰', async () => {
    const alpha = new MemoryVaultFS('/alpha')
    const beta = new MemoryVaultFS('/beta')
    for (const vault of [alpha, beta]) {
      await vault.mkdir('papers')
      await vault.writeText('papers/note.md', '# hi\n')
    }

    await initRepo(alpha, { url: 'https://github.com/me/alpha.git', branch: 'main', token: 'x' })
    await initRepo(beta, { url: 'https://github.com/me/beta.git', branch: 'main', token: 'x' })

    expect(await remoteUrl(alpha)).toBe('https://github.com/me/alpha.git')
    expect(await remoteUrl(beta)).toBe('https://github.com/me/beta.git')

    await commitAll(alpha, 'alpha 第一次提交', author)
    // beta 此时还没有任何提交
    expect(await log(beta)).toHaveLength(0)

    await beta.writeText('papers/other.md', '# beta\n')
    await commitAll(beta, 'beta 第一次提交', author)

    const alphaLog = await log(alpha)
    const betaLog = await log(beta)
    expect(alphaLog).toHaveLength(1)
    expect(betaLog).toHaveLength(1)
    expect(alphaLog[0]!.message).toBe('alpha 第一次提交')
    expect(betaLog[0]!.message).toBe('beta 第一次提交')

    // 在 alpha 里改文件不会影响 beta 的变更计数
    await alpha.writeText('papers/note.md', '# changed\n')
    await beta.writeText('papers/other.md', '# changed\n')
    const { changeSummary } = await import('@/lib/git/repo')
    expect((await changeSummary(alpha)).modified).toBe(1)
    expect((await changeSummary(beta)).modified).toBe(1)
  })
})
