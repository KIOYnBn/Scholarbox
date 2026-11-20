import { beforeEach, describe, expect, it } from 'vitest'
import git from 'isomorphic-git'
import '@/lib/git/polyfill'
import { MemoryVaultFS } from '@/lib/fs/memory'
import {
  adoptRemoteHistory,
  branchNameError,
  branches,
  changeSummary,
  commitAll,
  createBranch,
  currentBranch,
  isRepo,
  log,
  mergeBranch,
  needsRemoteHistoryMerge,
  rebuildLocalGit,
  remoteUrl,
  repoUrl,
  initRepo,
  revertToCommit,
  switchBranch,
} from '@/lib/git/repo'
import { classifyGitError, GitOperationError } from '@/lib/git/errors'
import { createGitFs, toVaultPath } from '@/lib/git/fs'

const author = { name: 'ScholarBox', email: 'scholarbox@localhost' }

/**
 * 造一条「远端」历史：不经过网络，直接在对象库里写 blob / tree / 无父提交。
 * 这样可以精确模拟「GitHub 上建仓库时勾了 README，本地却是新建仓库」这种无关历史。
 */
async function fakeRemoteCommit(
  vault: MemoryVaultFS,
  files: Record<string, string>,
  message = 'remote init',
): Promise<string> {
  const fs = createGitFs(vault)

  // git 的 tree 是分层的，扁平路径要按目录逐层展开
  const writeTree = async (group: Record<string, string | Record<string, string>>): Promise<string> => {
    const entries: { mode: string; path: string; oid: string; type: 'blob' | 'tree' }[] = []
    for (const [name, value] of Object.entries(group)) {
      if (typeof value === 'string') {
        const oid = await git.writeBlob({ fs, dir: '', blob: new TextEncoder().encode(value) })
        entries.push({ mode: '100644', path: name, oid, type: 'blob' })
      } else {
        entries.push({ mode: '040000', path: name, oid: await writeTree(value), type: 'tree' })
      }
    }
    return git.writeTree({ fs, dir: '', tree: entries })
  }

  const root: Record<string, string | Record<string, string>> = {}
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/')
    let cursor = root
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part]
      if (typeof next === 'string' || next === undefined) cursor[part] = {}
      cursor = cursor[part] as Record<string, string>
    }
    cursor[parts[parts.length - 1]] = text
  }

  const tree = await writeTree(root)
  // noUpdateBranch：只是往对象库里塞一个「远端提交」，别动本地的 refs/heads/main
  return git.commit({ fs, dir: '', message, author, tree, parent: [], noUpdateBranch: true })
}

async function seed(vault: MemoryVaultFS) {
  await vault.mkdir('papers')
  await vault.mkdir('papers/Vaswani_2017_Attention')
  await vault.writeText(
    'papers/Vaswani_2017_Attention/note.md',
    '# Attention\n\n## 一句话总结\nTransformer 全靠注意力。\n',
  )
  await vault.writeText('papers/Vaswani_2017_Attention/meta.json', '{"title":"Attention Is All You Need"}\n')
  await vault.writeText('vault.json', '{"name":"MyVault"}\n')
}

describe('git 文件系统适配', () => {
  it('把 git 传进来的路径规范成文献库相对路径', () => {
    expect(toVaultPath('./.git/HEAD')).toBe('.git/HEAD')
    expect(toVaultPath('/papers/a/note.md')).toBe('papers/a/note.md')
    expect(toVaultPath('papers//a/')).toBe('papers/a')
    expect(toVaultPath('')).toBe('')
  })
})

describe('git 仓库操作（内存文件系统）', () => {
  let vault: MemoryVaultFS

  beforeEach(async () => {
    vault = new MemoryVaultFS()
    await seed(vault)
  })

  it('初始化后存在 .git 与 origin，且带上 .gitignore', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    expect(await isRepo(vault)).toBe(true)
    expect(await currentBranch(vault)).toBe('main')
    expect(await remoteUrl(vault)).toBe('https://github.com/me/MyVault.git')
    expect(await vault.exists('.gitignore')).toBe(true)
  })

  it('重复初始化不报错，也不会丢历史', async () => {
    const remote = { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' }
    await initRepo(vault, remote)
    await commitAll(vault, 'first', author)
    await initRepo(vault, remote)
    expect((await log(vault, 10)).length).toBe(1)
  })

  it('统计未提交改动：新增 / 修改 / 删除各算各的', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    const first = await changeSummary(vault)
    expect(first.added).toBeGreaterThanOrEqual(4) // 3 个文件 + .gitignore

    await commitAll(vault, 'init', author)
    expect((await changeSummary(vault)).added + (await changeSummary(vault)).modified).toBe(0)

    await vault.writeText('papers/Vaswani_2017_Attention/note.md', '# 改过\n')
    await vault.writeText('papers/new.md', '新文件\n')
    await vault.remove('vault.json')
    const summary = await changeSummary(vault)
    expect(summary.modified).toBe(1)
    expect(summary.added).toBe(1) // 只有 papers/new.md
    expect(summary.deleted).toBe(1)
    expect(summary.files).toContain('papers/Vaswani_2017_Attention/note.md')
  })

  it('没有改动时 commitAll 返回 null，不产生空提交', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    expect(await commitAll(vault, 'init', author)).not.toBeNull()
    expect(await commitAll(vault, 'again', author)).toBeNull()
  })

  it('revertToCommit：回退到旧提交生成新提交，历史完整', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    await vault.writeText('papers/keep.md', '# v1')
    const first = await commitAll(vault, 'first', author)
    expect(first).not.toBeNull()

    await vault.writeText('papers/keep.md', '# v2 改过')
    await vault.writeText('papers/added.md', '新增的文件')
    const second = await commitAll(vault, 'second', author)
    expect(second).not.toBeNull()

    const result = await revertToCommit(vault, first!.oid, `回退到 ${first!.oid.slice(0, 7)}`, author)
    expect(result.oid).toBeTruthy()
    // 工作区回到 first 时的状态：改动被还原、新文件被删掉
    expect(await vault.readText('papers/keep.md')).toBe('# v1')
    expect(await vault.exists('papers/added.md')).toBe(false)
    // 历史完整：first、second、回退提交都在
    const entries = await log(vault, 10)
    expect(entries.length).toBe(3)
    expect(entries[0]!.message).toContain('回退到')
    // 回退之后没有未提交改动
    const summary = await changeSummary(vault)
    expect(summary.added + summary.modified + summary.deleted).toBe(0)
  })

  it('revertToCommit：回退到最新提交会报「已经在这个版本上」', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    await commitAll(vault, 'only', author)
    const entries = await log(vault, 5)
    await expect(revertToCommit(vault, entries[0]!.oid, 'noop', author)).rejects.toThrow('已经在这个版本上')
  })

  it('提交历史按时间倒序，带作者与短 hash', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    await commitAll(vault, '第一条', author)
    await vault.writeText('papers/Vaswani_2017_Attention/note.md', '# 第二次\n')
    await commitAll(vault, '第二条', author)

    const history = await log(vault, 10)
    expect(history.map((entry) => entry.message)).toEqual(['第二条', '第一条'])
    expect(history[0].short).toHaveLength(7)
    expect(history[0].author).toBe('ScholarBox')
    expect(history[0].timestamp).toBeGreaterThan(0)
  })

  it('删除的文件会被真正从提交里移除', async () => {
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    await commitAll(vault, 'init', author)
    await vault.remove('vault.json')
    await commitAll(vault, '删掉 vault.json', author)
    const history = await log(vault, 10)
    expect(history[0].message).toBe('删掉 vault.json')
    expect(await vault.exists('vault.json')).toBe(false)
  })

  it('空仓库的 log 返回空数组而不是抛异常', async () => {
    const empty = new MemoryVaultFS()
    expect(await log(empty, 10)).toEqual([])
    expect(await isRepo(empty)).toBe(false)
  })
})

describe('推送被拒的判定（决定要不要自动修复）', () => {
  const raw = Object.assign(
    new Error('Push rejected because it was not a simple fast-forward. Use "force: true" to override.'),
    { name: 'PushRejectedError', code: 'PushRejectedError' },
  )
  const ctx = { action: 'push' as const, runtime: 'tauri' as const, url: 'https://github.com/me/x.git' }

  it('原始错误与已包装的错误都要认', () => {
    expect(needsRemoteHistoryMerge(raw)).toBe(true)
    // pushOnce 抛的是包装后的 GitOperationError：只看 name 会漏掉这一层
    expect(needsRemoteHistoryMerge(new GitOperationError(classifyGitError(raw, ctx)))).toBe(true)
  })

  it('别的错误不触发修复', () => {
    expect(needsRemoteHistoryMerge(new Error('boom'))).toBe(false)
    expect(
      needsRemoteHistoryMerge(new GitOperationError(classifyGitError(Object.assign(new Error('x'), { name: 'HttpError', data: { statusCode: 403 } }), ctx))),
    ).toBe(false)
  })
})

describe('无关历史（远端有 README、本地是新建仓库）', () => {
  let vault: MemoryVaultFS
  let tip: string

  beforeEach(async () => {
    vault = new MemoryVaultFS()
    await seed(vault)
    await initRepo(vault, { url: repoUrl('me', 'MyVault'), branch: 'main', token: 'x' })
    await commitAll(vault, '本地第一条', author)
    // 远端那条历史与本地没有任何共同祖先
    tip = await fakeRemoteCommit(vault, {
      'README.md': '# MyVault\n',
      'papers/Old_2020_Legacy/note.md': '远端才有的旧文献\n',
      'vault.json': '{"name":"RemoteName"}\n',
    })
  })

  it('接管远端历史后，远端 tip 成为本地 HEAD 的祖先（推送就能快进）', async () => {
    const head = await git.resolveRef({ fs: createGitFs(vault), dir: '', ref: 'refs/heads/main' })
    const result = await adoptRemoteHistory(vault, tip, author, '接上远端历史')

    const fs = createGitFs(vault)
    const newHead = await git.resolveRef({ fs, dir: '', ref: 'refs/heads/main' })
    expect(newHead).not.toBe(head)
    expect(result.oid).toBe(newHead)
    await expect(
      git.isDescendent({ fs, dir: '', oid: newHead, ancestor: tip, depth: -1 }),
    ).resolves.toBe(true)
  })

  it('只补本地缺的文件，本地内容不被覆盖', async () => {
    const before = await vault.readText('vault.json')
    const result = await adoptRemoteHistory(vault, tip, author)

    expect(result.materialized).toContain('papers/Old_2020_Legacy/note.md')
    expect(await vault.exists('papers/Old_2020_Legacy/note.md')).toBe(true)
    expect(await vault.readText('papers/Old_2020_Legacy/note.md')).toBe('远端才有的旧文献\n')
    // 两边都有的文件保留本地版本
    expect(await vault.readText('vault.json')).toBe(before)
    // 本地自己的文件一个没少
    expect(await vault.readText('papers/Vaswani_2017_Attention/note.md')).toContain('Transformer')
  })

  it('旧提交被备份到 refs/scholarbox/backup/，历史可找回', async () => {
    const fs = createGitFs(vault)
    const before = await git.resolveRef({ fs, dir: '', ref: 'refs/heads/main' })
    const result = await adoptRemoteHistory(vault, tip, author)
    expect(result.backupRef).toMatch(/^refs\/scholarbox\/backup\//)
    const backedUp = await git.resolveRef({ fs, dir: '', ref: result.backupRef! })
    expect(backedUp).toBe(before)
  })

  it('接管后工作区是干净的（提交内容 == 磁盘内容）', async () => {
    await adoptRemoteHistory(vault, tip, author)
    const summary = await changeSummary(vault)
    expect(summary.added + summary.modified + summary.deleted).toBe(0)
  })

  it('重复接管不会造空提交', async () => {
    await adoptRemoteHistory(vault, tip, author)
    const second = await adoptRemoteHistory(vault, tip, author)
    expect(second.oid).toBeNull()
  })

  it('接管后历史里同时有远端与本地提交', async () => {
    await adoptRemoteHistory(vault, tip, author)
    const messages = (await log(vault, 10)).map((entry) => entry.message)
    expect(messages).toContain('remote init')
    expect(messages).toContain('本地第一条')
    expect(await currentBranch(vault)).toBe('main')
  })
})

describe('分支：新建 / 切换 / 合并', () => {
  let vault: MemoryVaultFS
  const remote = { url: 'https://github.com/me/MyVault.git', branch: 'main', token: 'x' }

  beforeEach(async () => {
    vault = new MemoryVaultFS()
    await seed(vault)
    await initRepo(vault, remote)
    await commitAll(vault, '第一条', author)
  })

  it('新建并切过去，新分支上的文件不会跟回 main', async () => {
    await createBranch(vault, 'notes-v2')
    expect(await currentBranch(vault)).toBe('notes-v2')
    await vault.writeText('papers/only-v2.md', '只在 v2 分支\n')
    await commitAll(vault, 'v2 独有', author)

    await switchBranch(vault, 'main')
    expect(await currentBranch(vault)).toBe('main')
    expect(await vault.exists('papers/only-v2.md')).toBe(false)

    await switchBranch(vault, 'notes-v2')
    expect(await vault.exists('papers/only-v2.md')).toBe(true)
  })

  it('分支列表能读到本地分支与当前分支', async () => {
    await createBranch(vault, 'notes-v2')
    const info = await branches(vault)
    expect(info.current).toBe('notes-v2')
    expect(info.local.sort()).toEqual(['main', 'notes-v2'])
  })

  it('重名与非法名字都拒绝，并说明原因', async () => {
    await expect(createBranch(vault, 'main')).rejects.toThrow(/已.*存在/)
    await expect(createBranch(vault, 'bad name')).rejects.toThrow(/空格|字符/)
    expect(branchNameError('notes-v2')).toBeNull()
    expect(branchNameError('a..b')).toBeTruthy()
    expect(branchNameError('')).toBeTruthy()
    expect(branchNameError('-x')).toBeTruthy()
  })

  it('切到不存在的分支给出明确错误', async () => {
    await expect(switchBranch(vault, 'nope')).rejects.toThrow(/没有分支/)
  })

  it('合并分支后当前分支拿到对方的改动，且仍停在当前分支', async () => {
    await createBranch(vault, 'notes-v2')
    await vault.writeText('papers/from-v2.md', 'v2 的改动\n')
    await commitAll(vault, 'v2 改动', author)

    const result = await mergeBranch(vault, 'main', author)
    // 此刻在 notes-v2 上，把 main 合进来（fast-forward 场景）
    expect(result.branch).toBe('notes-v2')
    expect(await currentBranch(vault)).toBe('notes-v2')

    await switchBranch(vault, 'main')
    const merged = await mergeBranch(vault, 'notes-v2', author)
    expect(merged.fastForward).toBe(true)
    expect(await vault.exists('papers/from-v2.md')).toBe(true)
    expect(await currentBranch(vault)).toBe('main')
  })

  it('合并自己会被拒绝', async () => {
    await expect(mergeBranch(vault, 'main', author)).rejects.toThrow(/自己/)
  })
})

describe('删除 / 重建本地 Git', () => {
  it('重建只换 .git，文献文件与内容都不动', async () => {
    const vault = new MemoryVaultFS()
    await seed(vault)
    await initRepo(vault, { url: 'https://github.com/me/MyVault.git', branch: 'main', token: 'x' })
    await commitAll(vault, '旧历史', author)
    await commitAll(vault, '再来一条', author)
    const before = await vault.readText('vault.json')

    const result = await rebuildLocalGit(
      vault,
      { url: 'https://github.com/me/MyVault.git', branch: 'main', token: 'x' },
      author,
      { keepRemote: false },
    )

    expect(result.branch).toBe('main')
    expect(await isRepo(vault)).toBe(true)
    expect(await vault.readText('vault.json')).toBe(before)
    // 旧的两条历史没了，只剩重建时自动提交的那一条
    expect((await log(vault, 10)).length).toBe(1)
    expect(await remoteUrl(vault)).toBe('https://github.com/me/MyVault.git')
  })
})
