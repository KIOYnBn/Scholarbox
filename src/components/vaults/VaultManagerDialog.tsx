import { useEffect, useState } from 'react'
import {
  Check,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  Unplug,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { useUiStore } from '@/stores/ui'
import { useVaultsStore } from '@/stores/vaults'
import { useVaultStore, isDesktop } from '@/stores/vault'
import { formatRelative } from '@/lib/format'
import type { VaultEntry } from '@/lib/vault/registry'
import type { FolderReport } from '@/lib/vault/delete'
import { defaultVaultName } from '@/lib/vault/paths'
import { cn } from '@/lib/utils'

/**
 * 仓库管理。注册表是应用级配置（桌面端 appConfigDir/vaults.json，
 * 浏览器 localStorage），**不在任何仓库文件夹里** —— 移除仓库只删记录，不动文件。
 */
export function VaultManagerDialog() {
  const open = useUiStore((s) => s.vaultManagerOpen)
  const close = useUiStore((s) => s.closeVaultManager)
  const registry = useVaultsStore((s) => s.registry)
  const busy = useVaultsStore((s) => s.busy)
  const error = useVaultsStore((s) => s.error)
  const createVault = useVaultsStore((s) => s.createVault)
  const updateVault = useVaultsStore((s) => s.updateVault)
  const updateVaultPath = useVaultsStore((s) => s.updateVaultPath)
  const removeVault = useVaultsStore((s) => s.removeVault)
  const switchTo = useVaultsStore((s) => s.switchTo)
  const openFolder = useVaultsStore((s) => s.openFolder)
  const clearError = useVaultsStore((s) => s.clearError)
  const kind = useVaultStore((s) => s.kind)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  /** 每个仓库的「根目录」草稿：改动不会立刻生效，要按「应用路径」 */
  const [pathDrafts, setPathDrafts] = useState<Record<string, string>>({})
  const [pathBusy, setPathBusy] = useState<string | null>(null)
  /** 新建仓库表单 */
  const [newPath, setNewPath] = useState('')
  const [newName, setNewName] = useState('')
  /** 删除确认：先体检再让用户二选一，删文件夹要输入仓库名 */
  const [removing, setRemoving] = useState<{
    entry: VaultEntry
    report: FolderReport | null
    loading: boolean
    typed: string
    mode: 'record' | 'folder'
    working: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) {
      setExpanded(null)
      setRemoving(null)
    }
  }, [open])

  const inspectVault = useVaultsStore((s) => s.inspectVault)

  const askRemove = (entry: VaultEntry) => {
    setRemoving({ entry, report: null, loading: true, typed: '', mode: 'record', working: false })
    void inspectVault(entry.id).then((report) => {
      setRemoving((cur) => (cur && cur.entry.id === entry.id ? { ...cur, report, loading: false } : cur))
    })
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoving({ ...removing, working: true })
    const ok = await removeVault(removing.entry.id, { deleteFolder: removing.mode === 'folder' })
    setRemoving((cur) => (cur ? { ...cur, working: false } : cur))
    if (ok) setRemoving(null)
  }

  const activeId = registry.activeId

  const onCreate = async () => {
    setCreating(true)
    try {
      const entry = await createVault({
        name: newName.trim() || undefined,
        rootPath: newPath.trim() || undefined,
      })
      if (entry) {
        setExpanded(entry.id)
        setNewPath('')
        setNewName('')
      }
    } finally {
      setCreating(false)
    }
  }

  const onPickNewFolder = async () => {
    const picked = await useVaultStore.getState().pickFolder()
    if (!picked) return
    setNewPath(picked)
    if (!newName.trim()) setNewName(defaultVaultName(picked))
  }

  const applyPath = async (entry: VaultEntry) => {
    const draft = pathDrafts[entry.id]
    if (!draft || draft === entry.rootPath) return
    setPathBusy(entry.id)
    try {
      const ok = await updateVaultPath(entry.id, draft)
      if (ok) {
        setPathDrafts((prev) => {
          const next = { ...prev }
          delete next[entry.id]
          return next
        })
      }
    } finally {
      setPathBusy(null)
    }
  }

  const onSwitch = async (entry: VaultEntry) => {
    if (entry.id === activeId) return
    const ok = await switchTo(entry.id)
    if (ok) close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="仓库管理"
      description="每个仓库 = 一个独立文件夹 + 独立的 Git 配置。注册表存在应用配置目录，不在任何仓库里。"
      className="max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] text-ink-3">
            {isDesktop() ? '桌面端：每个仓库是一个真实文件夹' : '浏览器端：每个仓库是 OPFS 下的一个子目录'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              关闭
            </Button>
            {isDesktop() ? (
              <Button size="sm" variant="ghost" onClick={() => void openFolder()}>
                <FolderOpen className="size-3.5" />
                打开已有文件夹
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void onCreate()} disabled={creating}>
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              创建仓库
            </Button>
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/8 px-2.5 py-2 text-[11.5px] text-danger">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void clearError()}>
            知道了
          </button>
        </div>
      ) : null}

      <div className="space-y-2">
        {registry.vaults.map((entry) => {
          const isActive = entry.id === activeId
          const isExpanded = expanded === entry.id
          return (
            <div
              key={entry.id}
              className={cn(
                'rounded-xl border transition-colors',
                isActive ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-surface',
              )}
            >
              <div className="flex items-start gap-2.5 p-2.5">
                <div
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                    isActive ? 'bg-accent text-white' : 'bg-surface-3 text-ink-2',
                  )}
                >
                  {entry.rootType === 'opfs' ? (
                    <Unplug className="size-3.5" />
                  ) : (
                    <HardDrive className="size-3.5" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ink">{entry.name}</span>
                    {isActive ? (
                      <span className="rounded bg-accent/15 px-1 py-px text-[9.5px] text-accent">
                        当前
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3" title={entry.rootPath}>
                    {entry.rootType === 'opfs' ? `OPFS://${entry.rootPath}` : entry.rootPath}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-tight text-ink-3">
                    <span>{entry.remoteUrl ? hostOf(entry.remoteUrl) : '未配置远端'}</span>
                    {entry.remoteUrl ? <span>· {entry.branch}</span> : null}
                    <span>· {entry.lastOpenedAt ? `上次打开 ${formatRelative(new Date(entry.lastOpenedAt).toISOString())}` : '从未打开'}</span>
                    {entry.autoCommitMinutes > 0 ? <span>· 自动提交 {entry.autoCommitMinutes} 分钟</span> : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent">
                      <Check className="size-3" />
                      已打开
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onSwitch(entry)}>
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
                      打开
                    </Button>
                  )}
                  <IconButton
                    label={isExpanded ? '收起设置' : '仓库设置'}
                    size="sm"
                    active={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : entry.id)}
                  >
                    <Settings2 className="size-3.5" />
                  </IconButton>
                  <IconButton label="移除或删除仓库" size="sm" onClick={() => askRemove(entry)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>

              {isExpanded ? (
                <div className="grid gap-2.5 border-t border-line/70 px-2.5 py-2.5 sm:grid-cols-2">
                  <Field label="名称">
                    <TextInput
                      key={`${entry.id}-name`}
                      defaultValue={entry.name}
                      onBlur={(event) => {
                        const value = event.target.value.trim()
                        if (value && value !== entry.name) void updateVault(entry.id, { name: value })
                      }}
                    />
                  </Field>
                  <Field label="远端地址" hint="https://github.com/owner/repo.git">
                    <TextInput
                      key={`${entry.id}-remote`}
                      defaultValue={entry.remoteUrl}
                      placeholder="https://github.com/owner/repo.git"
                      onBlur={(event) => {
                        const value = event.target.value.trim()
                        if (value !== entry.remoteUrl) void updateVault(entry.id, { remoteUrl: value })
                      }}
                    />
                  </Field>
                  <Field label="分支">
                    <TextInput
                      key={`${entry.id}-branch`}
                      defaultValue={entry.branch}
                      placeholder="main"
                      onBlur={(event) => {
                        const value = event.target.value.trim() || 'main'
                        if (value !== entry.branch) void updateVault(entry.id, { branch: value })
                      }}
                    />
                  </Field>
                  <Field label="访问令牌 (PAT)" hint="只存本机，不进仓库">
                    <TextInput
                      key={`${entry.id}-pat`}
                      type="password"
                      defaultValue={entry.pat}
                      placeholder="ghp_..."
                      onBlur={(event) => {
                        const value = event.target.value
                        if (value !== entry.pat) void updateVault(entry.id, { pat: value })
                      }}
                    />
                  </Field>
                  <Field label="自动提交" hint="分钟，0 关闭">
                    <TextInput
                      key={`${entry.id}-auto`}
                      type="number"
                      min={0}
                      defaultValue={entry.autoCommitMinutes}
                      onBlur={(event) => {
                        const value = Number(event.target.value) || 0
                        if (value !== entry.autoCommitMinutes) {
                          void updateVault(entry.id, { autoCommitMinutes: value })
                        }
                      }}
                    />
                  </Field>
                  <Field
                    label="根目录"
                    hint={entry.rootType === 'opfs' ? 'OPFS 子目录（相对）' : '绝对路径，或相对 appConfigDir'}
                  >
                    <div className="flex items-center gap-1.5">
                      <TextInput
                        key={`${entry.id}-root`}
                        defaultValue={entry.rootPath}
                        placeholder={entry.rootType === 'opfs' ? 'MyVault' : 'D:\\papers\\MyVault'}
                        onChange={(event) =>
                          setPathDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))
                        }
                      />
                      <Button
                        variant="default"
                        size="sm"
                        disabled={
                          pathBusy === entry.id ||
                          !(pathDrafts[entry.id] ?? '').trim() ||
                          pathDrafts[entry.id] === entry.rootPath
                        }
                        onClick={() => void applyPath(entry)}
                      >
                        {pathBusy === entry.id ? <Loader2 className="size-3 animate-spin" /> : null}
                        应用路径
                      </Button>
                    </div>
                  </Field>
                  {pathDrafts[entry.id] && pathDrafts[entry.id] !== entry.rootPath ? (
                    <p className="sm:col-span-2 -mt-1 text-[10.5px] leading-relaxed text-warn">
                      只改注册表指向，不会移动任何文件 —— 请先手动把文件夹移到新位置，再应用路径。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}

        <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3">
          <p className="mb-2 text-[11.5px] font-medium text-ink-2">新建仓库</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="名称" hint="留空则用路径末段">
              <TextInput
                value={newName}
                placeholder="我的文献库"
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
            <Field
              label="根目录"
              hint={isDesktop() ? '绝对路径，或相对 appConfigDir' : 'OPFS 相对目录'}
            >
              <div className="flex items-center gap-1.5">
                <TextInput
                  value={newPath}
                  placeholder={isDesktop() ? 'D:\\papers\\MyVault' : 'MyVault-2'}
                  onChange={(event) => setNewPath(event.target.value)}
                />
                {isDesktop() ? (
                  <Button size="sm" variant="ghost" onClick={() => void onPickNewFolder()}>
                    <FolderOpen className="size-3.5" />
                    选择
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
            {isDesktop()
              ? '目录不存在会自动创建。保存前会实际写一次探针文件，确认可读写。'
              : '浏览器模式只能填 OPFS 下的相对目录（如 Vault-2），不能填系统路径。'}
          </p>
        </div>

        {registry.vaults.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-[12px] text-ink-3">
            还没有仓库，点右下角「新建仓库」
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        切换仓库时，如果当前仓库有未提交改动会先自动提交一次；两个仓库的 Git 历史彼此独立
        （`.git` 在各自文件夹里）。移除只是删掉这里的记录，不会删除磁盘上的任何文件。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
        当前文献库：{kind === 'tauri' ? '桌面文件夹' : kind === 'browser' ? '浏览器存储' : '未打开'}
        {busy ? ' · 切换中…' : ''}
      </p>

      {removing ? (
        <RemoveVaultDialog
          entry={removing.entry}
          report={removing.report}
          loading={removing.loading}
          typed={removing.typed}
          mode={removing.mode}
          working={removing.working}
          onMode={(mode) => setRemoving({ ...removing, mode })}
          onTyped={(typed) => setRemoving({ ...removing, typed })}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        />
      ) : null}
    </Modal>
  )
}

/**
 * 删除确认。两种模式写得很清楚：只删记录 = 文件全留着；
 * 删文件夹 = 桌面端进回收站、浏览器端不可恢复，所以要求输入仓库名。
 */
function RemoveVaultDialog({
  entry,
  report,
  loading,
  typed,
  mode,
  working,
  onMode,
  onTyped,
  onCancel,
  onConfirm,
}: {
  entry: VaultEntry
  report: FolderReport | null
  loading: boolean
  typed: string
  mode: 'record' | 'folder'
  working: boolean
  onMode: (mode: 'record' | 'folder') => void
  onTyped: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const desktop = isDesktop()
  const dangerous = mode === 'folder'
  const confirmed = !dangerous || typed.trim() === entry.name
  const dirty = report?.dirty ?? 0

  return (
    <Modal open onClose={onCancel} title={`处理「${entry.name}」`} description="先看清会发生什么，再决定">
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 text-[11.5px] leading-relaxed">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <Loader2 className="size-3.5 animate-spin" /> 正在检查文件夹…
            </span>
          ) : (
            <dl className="grid gap-1">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-3">位置</dt>
                <dd className="min-w-0 break-all font-mono text-[11px] text-ink">{report?.resolved ?? entry.rootPath}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-3">内容</dt>
                <dd className="text-ink">
                  {report ? `${report.files} 个文件 · ${formatBytes(report.bytes)}` : '—'}
                  {report && report.isRepo === false ? ' · 还不是 Git 仓库' : ''}
                  {report?.lastCommitAt ? ` · 最近提交 ${formatRelative(new Date(report.lastCommitAt).toISOString())}` : ''}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-3">未提交</dt>
                <dd className={dirty > 0 ? 'text-warn' : 'text-ink'}>
                  {report ? (dirty > 0 ? `${dirty} 个文件` : '没有改动') : '—'}
                  {report?.pushed === 'no' ? ' · 没有推送过' : report?.pushed === 'yes' ? ' · 已推送' : ''}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="grid gap-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-[11.5px] hover:bg-surface-2/40">
            <input
              type="radio"
              checked={mode === 'record'}
              onChange={() => onMode('record')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink">仅移除记录</span>
              <span className="block text-ink-3">文件夹和里面的文件全部保留，之后还能重新「打开已有文件夹」。</span>
            </span>
          </label>
          <label
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-[11.5px]',
              dangerous ? 'border-danger/50 bg-danger/5' : 'border-line hover:bg-surface-2/40',
            )}
          >
            <input
              type="radio"
              checked={mode === 'folder'}
              onChange={() => onMode('folder')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-danger">移除记录并删除文件夹</span>
              <span className="block text-ink-3">
                {desktop
                  ? '文件夹会进系统回收站，可以从回收站还原。'
                  : '浏览器 OPFS 没有回收站，删除后不可恢复。'}
              </span>
            </span>
          </label>
        </div>

        {dangerous ? (
          <Field label={`输入仓库名「${entry.name}」确认`}>
            <TextInput value={typed} onChange={(e) => onTyped(e.target.value)} placeholder={entry.name} autoFocus />
          </Field>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={working}>
            取消
          </Button>
          <Button
            size="sm"
            variant={dangerous ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={working || loading || !confirmed}
          >
            {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {dangerous ? '删除文件夹' : '移除记录'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function hostOf(url: string): string {
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/i)
  if (match) return `github.com/${match[1]}`
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}
