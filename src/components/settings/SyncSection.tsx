import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  GitCommitHorizontal,
  History,
  Loader2,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { isDesktop, useVaultStore } from '@/stores/vault'
import { useVaultsStore } from '@/stores/vaults'
import { Button } from '@/components/ui/Button'
import { SyncDiagnostics, SyncErrorCard } from './SyncDiagnostics'
import { BranchSection } from './BranchSection'
import { DEFAULT_CORS_PROXY } from '@/lib/vault/registry'
import { Field, TextInput } from '@/components/ui/Field'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * 同步面板。所有操作走 `useSyncStore`，组件只负责画状态 —— 这样自动提交
 * 定时器、状态栏角标和这里看到的是同一份真相。
 */
export function SyncSection() {
  const github = useSettingsStore((s) => s.github)
  const setGithub = useSettingsStore((s) => s.setGithub)
  const entry = useVaultStore((s) => s.entry)
  const updateVault = useVaultsStore((s) => s.updateVault)

  const connected = useSyncStore((s) => s.connected)
  const branch = useSyncStore((s) => s.branch)
  const remote = useSyncStore((s) => s.remote)
  const changes = useSyncStore((s) => s.changes)
  const history = useSyncStore((s) => s.history)
  const busy = useSyncStore((s) => s.busy)
  const notice = useSyncStore((s) => s.notice)
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt)
  const connect = useSyncStore((s) => s.connect)
  const commit = useSyncStore((s) => s.commit)
  const pushNow = useSyncStore((s) => s.pushNow)
  const pullNow = useSyncStore((s) => s.pullNow)
  const syncNow = useSyncStore((s) => s.syncNow)
  const refresh = useSyncStore((s) => s.refresh)
  const loadHistory = useSyncStore((s) => s.loadHistory)
  const revertToCommit = useSyncStore((s) => s.revertToCommit)
  /** 正在确认回退的那条提交（两步确认，防误点） */
  const [confirmingOid, setConfirmingOid] = useState<string | null>(null)

  const vaultReady = useVaultStore((s) => s.status === 'ready')

  useEffect(() => {
    if (!vaultReady) return
    void refresh()
    void loadHistory()
  }, [vaultReady, refresh, loadHistory])

  const dirty = changes.added + changes.modified + changes.deleted
  const disabled = Boolean(busy) || !vaultReady

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">GitHub 同步</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
          每个仓库有自己的一份配置与历史：isomorphic-git 直接在 WebView 里读写该仓库根目录的
          <code className="font-mono">.git</code>，不需要系统装 git。提交的是
          <code className="font-mono">papers/</code> 下的 markdown 与 meta.json，PDF 与截图也会一起进去
          （想省流量可以自己加 <code className="font-mono">.gitattributes</code>）。下方配置只作用于
          当前仓库「{entry?.name ?? '未打开'}」。
        </p>
      </div>

      {!isDesktop() ? (
        <Field
          label="CORS 代理"
          hint="浏览器直连 GitHub 会被拦，必须经过代理；可换自己的地址"
        >
          <TextInput
            key={`${entry?.id}-cors`}
            defaultValue={entry?.corsProxy ?? DEFAULT_CORS_PROXY}
            placeholder={DEFAULT_CORS_PROXY}
            onBlur={(event) => {
              if (!entry) return
              const value = event.target.value.trim() || DEFAULT_CORS_PROXY
              if (value !== entry.corsProxy) void updateVault(entry.id, { corsProxy: value })
            }}
          />
        </Field>
      ) : null}

      <Field label="远端地址" hint="https://github.com/owner/repo.git">
        <TextInput
          key={`${entry?.id}-remote`}
          defaultValue={entry?.remoteUrl ?? ''}
          placeholder="https://github.com/owner/repo.git"
          onBlur={(event) => {
            if (!entry) return
            const value = event.target.value.trim()
            if (value !== entry.remoteUrl) void updateVault(entry.id, { remoteUrl: value })
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="分支">
          <TextInput
            key={`${entry?.id}-branch`}
            defaultValue={entry?.branch ?? 'main'}
            onBlur={(event) => {
              if (!entry) return
              const value = event.target.value.trim() || 'main'
              if (value !== entry.branch) void updateVault(entry.id, { branch: value })
            }}
            placeholder="main"
          />
        </Field>
        <Field label="自动提交" hint="分钟，0 关闭">
          <TextInput
            key={`${entry?.id}-auto`}
            defaultValue={entry?.autoCommitMinutes ?? 0}
            inputMode="numeric"
            onBlur={(event) => {
              if (!entry) return
              const value = Number.parseInt(event.target.value, 10)
              const minutes = Number.isFinite(value) ? Math.max(0, value) : 0
              if (minutes !== entry.autoCommitMinutes) {
                void updateVault(entry.id, { autoCommitMinutes: minutes })
              }
            }}
          />
        </Field>
      </div>

      <Field
        label="访问令牌 (PAT)"
        hint="只存本机注册表，不会写进任何仓库"
      >
        <TextInput
          key={`${entry?.id}-pat`}
          type="password"
          defaultValue={entry?.pat ?? ''}
          onBlur={(event) => {
            if (!entry) return
            const value = event.target.value
            if (value !== entry.pat) void updateVault(entry.id, { pat: value })
          }}
          placeholder="github_pat_..."
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="提交作者">
          <TextInput
            defaultValue={github.authorName}
            onBlur={(event) => setGithub({ authorName: event.target.value.trim() })}
          />
        </Field>
        <Field label="提交邮箱">
          <TextInput
            defaultValue={github.authorEmail}
            onBlur={(event) => setGithub({ authorEmail: event.target.value.trim() })}
          />
        </Field>
      </div>

      {/* ── 状态 ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
        <div className="flex items-center gap-2">
          {connected ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
          ) : (
            <CloudOff className="size-3.5 shrink-0 text-ink-3" />
          )}
          <span className="text-[11px] font-medium text-ink">
            {connected ? `已连接 · ${branch ?? 'main'}` : '尚未连接仓库'}
          </span>
          <span className="ml-auto text-[10px] text-ink-3">
            {lastSyncAt ? `最近同步 ${formatRelative(new Date(lastSyncAt).toISOString())}` : '还没有同步过'}
          </span>
        </div>

        {remote ? (
          <div className="mt-1 truncate font-mono text-[10px] text-ink-3" title={remote}>
            {remote}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-2">
          <span className={cn(dirty > 0 ? 'text-warn' : 'text-ink-3')}>
            {dirty > 0 ? `${dirty} 个文件待提交` : '工作区干净'}
          </span>
          {changes.added > 0 ? <span className="text-ink-3">新增 {changes.added}</span> : null}
          {changes.modified > 0 ? <span className="text-ink-3">修改 {changes.modified}</span> : null}
          {changes.deleted > 0 ? <span className="text-ink-3">删除 {changes.deleted}</span> : null}
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink"
            disabled={disabled}
          >
            <RefreshCw className={cn('size-2.5', busy === 'refresh' && 'animate-spin')} />
            刷新
          </button>
        </div>

        {changes.files.length > 0 ? (
          <ul className="mt-1.5 max-h-[4.6rem] overflow-y-auto border-t border-line/60 pt-1.5 text-[10px] leading-[1.15rem] text-ink-3 sb-scroll">
            {changes.files.slice(0, 12).map((file) => (
              <li key={file} className="truncate font-mono" title={file}>
                {file}
              </li>
            ))}
            {changes.files.length > 12 ? <li className="opacity-60">…另有 {changes.files.length - 12} 个文件</li> : null}
          </ul>
        ) : null}
      </div>

      {/* ── 操作 ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" size="sm" disabled={disabled} onClick={() => void connect()}>
          {busy === 'connect' ? <Loader2 className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
          {connected ? '重新连接' : '连接仓库'}
        </Button>
        <Button size="sm" disabled={disabled || !connected} onClick={() => void commit()}>
          {busy === 'commit' ? <Loader2 className="size-3 animate-spin" /> : <GitCommitHorizontal className="size-3" />}
          提交
        </Button>
        <Button size="sm" disabled={disabled || !connected} onClick={() => void syncNow()}>
          <Cloud className="size-3" />
          提交并推送
        </Button>
        <Button size="sm" disabled={disabled || !connected} onClick={() => void pushNow()}>
          {busy === 'push' ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
          推送
        </Button>
        <Button size="sm" disabled={disabled || !connected} onClick={() => void pullNow()}>
          {busy === 'pull' ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3 -scale-y-100" />}
          拉取
        </Button>
      </div>

      <SyncErrorCard />

      <BranchSection />

      <SyncDiagnostics />

      {notice ? (
        <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft/60 px-2.5 py-2 text-[10.5px] text-accent">
          <CheckCircle2 className="size-3.5 shrink-0" />
          {notice}
        </div>
      ) : null}

      {/* ── 历史 ─────────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
            <History className="size-3" />
            历史记录
          </span>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="text-[10px] text-ink-3 hover:text-ink"
            disabled={disabled}
          >
            刷新
          </button>
        </div>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-2.5 py-3 text-center text-[10.5px] text-ink-3">
            {connected ? '还没有提交记录' : '连接仓库后，每次提交都会出现在这里'}
          </div>
        ) : (
          <ul className="sb-scroll max-h-44 overflow-y-auto rounded-lg border border-line">
            {history.map((entry, index) => {
              const confirming = confirmingOid === entry.oid
              return (
                <li
                  key={entry.oid}
                  className={cn(
                    'flex items-start gap-2 px-2.5 py-1.5',
                    index > 0 && 'border-t border-line/60',
                  )}
                >
                  <span className="mt-0.5 font-mono text-[10px] text-accent">{entry.short}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-ink" title={entry.message}>
                      {entry.message}
                    </p>
                    <p className="text-[10px] text-ink-3">
                      {entry.author} · {formatRelative(new Date(entry.timestamp).toISOString())}
                    </p>
                    {confirming ? (
                      <div className="mt-1 rounded-md border border-warn/30 bg-warn/5 px-2 py-1.5">
                        <p className="text-[10px] leading-relaxed text-ink-2">
                          将生成一个新提交，把 <b>所有文件</b> 恢复到这条提交时的状态；
                          当前未提交的改动会先自动提交。<b>历史不会被抹掉</b>，之后随时可以再回回来。
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              setConfirmingOid(null)
                              void revertToCommit(
                                entry.oid,
                                `回退到 ${entry.short}：${entry.message.slice(0, 40)}`,
                              )
                            }}
                            className="inline-flex items-center gap-0.5 rounded border border-warn bg-warn/10 px-1.5 py-0.5 text-[10px] text-ink hover:bg-warn/20 disabled:opacity-40"
                          >
                            {busy === 'revert' ? <Loader2 className="size-2.5 animate-spin" /> : <RotateCcw className="size-2.5" />}
                            确认回退
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingOid(null)}
                            className="text-[10px] text-ink-3 hover:text-ink"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {index > 0 ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setConfirmingOid(confirming ? null : entry.oid)}
                      title="回退到此版本（生成新提交，不重写历史）"
                      className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-accent/60 hover:text-accent disabled:opacity-40"
                    >
                      <RotateCcw className="size-2.5" />
                      回退
                    </button>
                  ) : (
                    <span className="mt-0.5 shrink-0 text-[9.5px] text-ink-3">最新</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-3">
        桌面端走 Rust 侧 HTTP，没有跨域限制；浏览器模式下所有请求经过
        <code className="mx-1 font-mono">cors.isomorphic-git.org</code>
        公共代理，国内网络可能连不上 —— 真正同步请用桌面或平板上的 Tauri 版本。
      </p>
    </div>
  )
}
