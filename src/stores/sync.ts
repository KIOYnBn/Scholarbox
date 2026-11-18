import { create } from 'zustand'
import { useVaultStore } from './vault'
import { useVaultsStore } from './vaults'
import { useSettingsStore } from './settings'
import { useLibraryStore } from './library'
import { isTauriRuntime } from '@/lib/http'
import { logSync } from '@/lib/log'
import {
  branches as branchInfo,
  createBranch as createBranchFn,
  deleteLocalGit,
  diagnoseRemote,
  GitError,
  changeSummary,
  commitAll,
  currentBranch,
  initRepo,
  isRepo,
  log,
  mergeBranch as mergeBranchFn,
  pull,
  push,
  rebuildLocalGit,
  remoteUrl,
  switchBranch as switchBranchFn,
  verifyRemote,
  type BranchInfo,
  type CommitSummary,
  type GitChangeSummary,
  type PullOutcome,
  type RemoteCheck,
} from '@/lib/git/repo'
import {
  classifyGitError,
  formatErrorReport,
  type GitAction,
  type GitErrorInfo,
} from '@/lib/git/errors'

/**
 * 同步状态机。
 *
 * 设计上只有一个「忙」位：Git 写 `.git` 不是并发安全的，所以所有操作串行，
 * 重复点击直接把请求丢掉而不是排队（排队只会让用户以为卡住了）。
 */

export type SyncAction =
  | 'connect'
  | 'commit'
  | 'push'
  | 'pull'
  | 'refresh'
  | 'history'
  | 'branch'
  | 'reset'

interface SyncState {
  /** 是否是 Git 仓库（且已绑定远端） */
  connected: boolean
  branch: string | null
  remote: string | null
  changes: GitChangeSummary
  history: CommitSummary[]
  /** 本地 / 远端分支列表 */
  branches: BranchInfo
  busy: SyncAction | null
  error: string | null
  hint: string | null
  /** 分类后的错误详情（脱敏后展示；`error`/`hint` 保留给旧调用点） */
  errorInfo: GitErrorInfo | null
  /** 「连接诊断」的逐条结果 */
  checks: RemoteCheck[]
  /** 「复制报告」用的纯文本（不含 PAT） */
  report: string | null
  lastSyncAt: number | null
  /** 上一次操作的结果提示（成功态，几秒后自动消失） */
  notice: string | null

  refresh: () => Promise<void>
  connect: () => Promise<boolean>
  commit: (message?: string) => Promise<CommitSummary | null>
  pushNow: () => Promise<void>
  pullNow: () => Promise<void>
  syncNow: () => Promise<void>
  loadHistory: () => Promise<void>
  /** 重新读本地 / 远端分支列表 */
  loadBranches: () => Promise<void>
  /** 新建分支并切过去 */
  createBranch: (name: string) => Promise<boolean>
  /** 切换分支（工作区有改动会先自动提交，避免丢笔记） */
  switchBranch: (name: string) => Promise<boolean>
  /** 把某个分支合进当前分支 */
  mergeBranch: (name: string) => Promise<boolean>
  /** 删掉本地 .git 再重建；keepRemote 时把远端历史接回来 */
  resetGit: (keepRemote: boolean) => Promise<boolean>
  /** 只删本地 .git（不再接远端），等于断开同步 */
  disconnectGit: () => Promise<boolean>
  clearMessages: () => void
  /** 跑一遍连接诊断（不做写操作） */
  diagnose: () => Promise<RemoteCheck[]>
  /** 生成可复制的错误报告（已脱敏） */
  buildReport: () => string | null
  /** 定时器调用：到点且有改动就自动 commit（不 push） */
  autoCommitTick: () => Promise<void>
}

const EMPTY_CHANGES: GitChangeSummary = { added: 0, modified: 0, deleted: 0, files: [] }

/** 拉取结果的固定文案（三种成功结果要能一眼区分） */
const PULL_NOTICE: Record<PullOutcome, string> = {
  'up-to-date': '已经是最新的',
  'fast-forward': '已拉取到最新提交',
  merged: '已合并远端改动',
  adopted: '远端历史已接到本地（本地没有的文件已补回）',
}

function identity() {
  const github = useSettingsStore.getState().github
  return {
    name: github.authorName.trim() || 'ScholarBox',
    email: github.authorEmail.trim() || 'scholarbox@localhost',
  }
}

/** 每个仓库有自己的 remoteUrl / branch / PAT —— 全都来自注册表里的那条记录 */
function activeVaultEntry() {
  const state = useVaultsStore.getState()
  const entry = state.registry.vaults.find((vault) => vault.id === state.registry.activeId)
  if (!entry) throw new GitError('没有打开的仓库', '先在仓库管理里选一个仓库')
  return entry
}

function remoteConfig() {
  const entry = activeVaultEntry()
  return {
    url: entry.remoteUrl,
    branch: entry.branch.trim() || 'main',
    token: entry.pat.trim(),
    corsProxy: entry.corsProxy,
  }
}

function vaultFs() {
  const fs = useVaultStore.getState().fs
  if (!fs) throw new GitError('文献库还没打开')
  return fs
}

function fail(err: unknown, action: GitAction) {
  let entry: { url?: string; branch?: string; token?: string; corsProxy?: string } = {}
  try {
    const current = activeVaultEntry()
    entry = {
      url: current.remoteUrl,
      branch: current.branch,
      token: current.pat,
      corsProxy: current.corsProxy,
    }
  } catch {
    // 没有 active 仓库时也要能显示错误
  }
  // App 自己抛的 `GitError` 已经是给人看的中文（「分支不存在」「工作区有改动」…），
  // 再过一遍网络错误分类只会被压成「同步失败」，把真正的原因盖掉。
  const info: GitErrorInfo =
    err instanceof GitError
      ? {
          kind: 'local',
          title: err.message,
          message: err.message,
          hint: err.hint ?? '这是本地仓库/设置的问题，不需要重试网络。',
          retryable: false,
        }
      : classifyGitError(err, {
          action,
          url: entry.url,
          branch: entry.branch,
          token: entry.token,
          corsProxy: entry.corsProxy ?? null,
          runtime: isTauriRuntime() ? 'tauri' : 'browser',
        })
  const report = formatErrorReport(info, {
    app: 'ScholarBox',
    runtime: isTauriRuntime() ? 'tauri' : 'browser',
    vault: useVaultStore.getState().entry?.rootPath ?? null,
    branch: entry.branch ?? null,
    remote: entry.url ?? null,
  })
  // 落盘一份：用户一关窗口，界面上的错误卡就没了
  logSync(`error.${action}`, { kind: info.kind, title: info.title, message: info.message, status: info.status ?? null })
  logSync(`error.${action}.report`, report.replace(/\n/g, ' | '))
  return {
    error: info.title,
    hint: info.hint,
    errorInfo: info,
    report,
  }
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  connected: false,
  branch: null,
  remote: null,
  changes: EMPTY_CHANGES,
  history: [],
  branches: { current: null, local: [], remote: [] },
  busy: null,
  error: null,
  hint: null,
  errorInfo: null,
  checks: [],
  report: null,
  lastSyncAt: null,
  notice: null,

  async refresh() {
    try {
      const fs = vaultFs()
      const repo = await isRepo(fs)
      if (!repo) {
        set({
          connected: false,
          branch: null,
          remote: null,
          changes: EMPTY_CHANGES,
          history: [],
          branches: { current: null, local: [], remote: [] },
        })
        return
      }
      const [branch, remote, changes, branchList] = await Promise.all([
        currentBranch(fs),
        remoteUrl(fs),
        changeSummary(fs),
        branchInfo(fs),
      ])
      set({ connected: Boolean(remote), branch, remote, changes, branches: branchList })
    } catch (err) {
      set({ ...fail(err, 'refresh'), connected: false })
    }
  },

  async connect() {
    if (get().busy) return false
    set({ busy: 'connect', error: null, hint: null, notice: null })
    try {
      const fs = vaultFs()
      const remote = remoteConfig()
      if (!remote.url) throw new GitError('这个仓库还没有填远端地址', '形如 https://github.com/owner/repo.git')
      if (!remote.token) throw new GitError('还没有填 GitHub Token', '需要一个有 repo 内容读写权限的 Personal Access Token')
      await initRepo(fs, remote)
      // 真的问一次远端：错 Token / 仓库不存在 / 网络/代理问题都在这一步暴露
      const checks = await verifyRemote(fs, remote)
      set({ checks })
      const failed = checks.find((check) => !check.ok)
      if (failed) {
        throw new GitError(`${failed.label}：${failed.detail}`, '点「连接诊断」看逐条结果，或复制报告排查')
      }
      await get().refresh()
      await get().loadHistory()
      set({ notice: '仓库已连接（远端可访问）', lastSyncAt: Date.now(), busy: null })
      return true
    } catch (err) {
      set({ ...fail(err, 'connect'), busy: null })
      return false
    }
  },

  async commit(message) {
    if (get().busy) return null
    set({ busy: 'commit', error: null, hint: null, notice: null })
    try {
      const fs = vaultFs()
      const result = await commitAll(fs, message?.trim() || `笔记更新 · ${stamp()}`, identity())
      await get().refresh()
      if (!result) {
        set({ busy: null, notice: '没有需要提交的改动' })
        return null
      }
      set({ busy: null, notice: `已提交 ${result.files} 个文件`, lastSyncAt: Date.now() })
      await get().loadHistory()
      const entry = get().history[0]
      return entry ?? null
    } catch (err) {
      set({ ...fail(err, 'commit'), busy: null })
      return null
    }
  },

  async pushNow() {
    if (get().busy) return
    set({ busy: 'push', error: null, hint: null, notice: null })
    try {
      const result = await push(vaultFs(), remoteConfig(), identity())
      if (result.repaired) {
        // 推送前把远端历史接进来了：库里可能多出几个远端才有的文件，要让图书馆重读
        await useLibraryStore.getState().load()
        await get().refresh()
        await get().loadHistory()
      }
      const extra = result.adopt?.materialized.length
        ? `，补回远端 ${result.adopt.materialized.length} 个文件`
        : ''
      set({
        busy: null,
        notice: result.repaired ? `已接上远端历史${extra}，并推送成功` : '已推送到 GitHub',
        lastSyncAt: Date.now(),
      })
    } catch (err) {
      set({ ...fail(err, 'push'), busy: null })
    }
  },

  async pullNow() {
    if (get().busy) return
    set({ busy: 'pull', error: null, hint: null, notice: null })
    try {
      const outcome = await pull(vaultFs(), remoteConfig(), identity())
      await useLibraryStore.getState().load()
      await get().refresh()
      await get().loadHistory()
      set({
        busy: null,
        notice: PULL_NOTICE[outcome],
        lastSyncAt: Date.now(),
      })
    } catch (err) {
      set({ ...fail(err, 'pull'), busy: null })
    }
  },

  async syncNow() {
    if (get().busy) return
    const committed = await get().commit()
    if (get().error) return
    if (!committed && get().changes.added + get().changes.modified + get().changes.deleted === 0) {
      // 没东西可提交，但仍然推一次，把之前未推送的提交送上去
    }
    await get().pushNow()
  },

  async loadHistory() {
    try {
      const fs = vaultFs()
      const entries = await log(fs, 30)
      set({ history: entries })
    } catch {
      set({ history: [] })
    }
  },

  clearMessages() {
    set({ error: null, hint: null, errorInfo: null, report: null, notice: null })
  },

  async loadBranches() {
    try {
      set({ branches: await branchInfo(vaultFs()) })
    } catch {
      set({ branches: { current: null, local: [], remote: [] } })
    }
  },

  async createBranch(name) {
    if (get().busy) return false
    set({ busy: 'branch', error: null, hint: null, notice: null })
    try {
      const branch = await createBranchFn(vaultFs(), name)
      await get().refresh()
      set({ busy: null, notice: `已新建并切到分支「${branch}」` })
      return true
    } catch (err) {
      set({ ...fail(err, 'refresh'), busy: null })
      return false
    }
  },

  async switchBranch(name) {
    if (get().busy) return false
    set({ busy: 'branch', error: null, hint: null, notice: null })
    try {
      const fs = vaultFs()
      // 切分支前先把工作区的改动提交掉：否则未提交内容会跟着工作区「跑到」新分支上，
      // 看起来像是凭空多出改动。提交是本地的、可回退的，比丢内容好。
      const summary = await changeSummary(fs)
      const dirty = summary.added + summary.modified + summary.deleted
      if (dirty > 0) {
        await commitAll(fs, `切换分支前自动提交 · ${stamp()}`, identity())
      }
      const branch = await switchBranchFn(fs, name)
      await get().refresh()
      await get().loadHistory()
      set({
        busy: null,
        notice: dirty > 0 ? `已提交 ${dirty} 个改动，切到分支「${branch}」` : `已切到分支「${branch}」`,
        lastSyncAt: Date.now(),
      })
      return true
    } catch (err) {
      set({ ...fail(err, 'refresh'), busy: null })
      return false
    }
  },

  async mergeBranch(name) {
    if (get().busy) return false
    set({ busy: 'branch', error: null, hint: null, notice: null })
    try {
      const result = await mergeBranchFn(vaultFs(), name, identity())
      await useLibraryStore.getState().load()
      await get().refresh()
      await get().loadHistory()
      set({
        busy: null,
        notice: result.fastForward
          ? `「${result.source}」已快进合并到「${result.branch}」`
          : `已把「${result.source}」合并到「${result.branch}」`,
        lastSyncAt: Date.now(),
      })
      return true
    } catch (err) {
      set({ ...fail(err, 'refresh'), busy: null })
      return false
    }
  },

  async resetGit(keepRemote) {
    if (get().busy) return false
    set({ busy: 'reset', error: null, hint: null, notice: null })
    try {
      const result = await rebuildLocalGit(vaultFs(), remoteConfig(), identity(), { keepRemote })
      await useLibraryStore.getState().load()
      await get().refresh()
      await get().loadHistory()
      const tail = keepRemote
        ? result.adopted === 'adopted'
          ? `已接上远端历史，补回 ${result.materialized} 个文件`
          : result.adopted === 'up-to-date'
            ? '和远端已经一致'
            : '已按远端最新提交重建'
        : '从空仓库重新开始'
      set({ busy: null, notice: `本地 Git 已重建（分支 ${result.branch}）：${tail}`, lastSyncAt: Date.now() })
      return true
    } catch (err) {
      set({ ...fail(err, 'refresh'), busy: null })
      return false
    }
  },

  async disconnectGit() {
    if (get().busy) return false
    set({ busy: 'reset', error: null, hint: null, notice: null })
    try {
      await deleteLocalGit(vaultFs())
      await get().refresh()
      await get().loadHistory()
      set({ busy: null, notice: '本地 .git 已删除，文献文件一个没动' })
      return true
    } catch (err) {
      set({ ...fail(err, 'refresh'), busy: null })
      return false
    }
  },

  async diagnose() {
    const remote = remoteConfig()
    const checks = await diagnoseRemote(remote)
    set({ checks })
    return checks
  },

  buildReport() {
    return get().report
  },

  async autoCommitTick() {
    const entry = useVaultsStore.getState().registry.vaults.find(
      (vault) => vault.id === useVaultsStore.getState().registry.activeId,
    )
    const autoCommitMinutes = entry?.autoCommitMinutes ?? 0
    if (!autoCommitMinutes || autoCommitMinutes <= 0) return
    if (get().busy) return
    const fs = useVaultStore.getState().fs
    if (!fs) return
    if (!(await isRepo(fs))) return
    const summary = await changeSummary(fs)
    if (summary.added + summary.modified + summary.deleted === 0) return
    await get().commit(`自动同步 · ${stamp()}`)
  },
}))
