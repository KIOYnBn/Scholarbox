import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, GitBranch, GitMerge, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { cn } from '@/lib/utils'
import { branchNameError } from '@/lib/git/repo'
import { useSyncStore } from '@/stores/sync'

/**
 * 分支面板。
 *
 * 个人文献库不需要分支策略，但「试一套新的整理方式，不满意就切回去」很常见。
 * 这里只暴露三件事：新建并切换、切换、合并到当前分支 —— 不做 rebase / 强推 / 删分支，
 * 那些在单人仓库里只有误操作价值。
 *
 * 危险区单独放：删 `.git` / 重建 `.git` 都不会动文献文件，但会动历史，
 * 所以要两次确认，并且把「会发生什么」写在按钮旁边。
 */
export function BranchSection() {
  const branches = useSyncStore((state) => state.branches)
  const connected = useSyncStore((state) => state.connected)
  const busy = useSyncStore((state) => state.busy)
  const createBranch = useSyncStore((state) => state.createBranch)
  const switchBranch = useSyncStore((state) => state.switchBranch)
  const mergeBranch = useSyncStore((state) => state.mergeBranch)
  const resetGit = useSyncStore((state) => state.resetGit)
  const disconnectGit = useSyncStore((state) => state.disconnectGit)

  const [name, setName] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [confirming, setConfirming] = useState<null | 'rebuild' | 'delete'>(null)

  const working = busy === 'branch' || busy === 'reset'
  const disabled = Boolean(busy) || !connected
  const invalid = name.trim() ? branchNameError(name) : null
  const duplicate = Boolean(name.trim()) && branches.local.includes(name.trim())

  // 切走工作区后把输入框清掉，避免误点第二次
  useEffect(() => {
    setName('')
  }, [branches.current])

  const submit = async () => {
    if (!name.trim() || invalid || duplicate) return
    const ok = await createBranch(name)
    if (ok) setName('')
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
            <GitBranch className="size-3" />
            分支
          </span>
          <span className="text-[10px] text-ink-3">
            当前：<span className="font-mono text-ink-2">{branches.current ?? '—'}</span>
          </span>
        </div>

        {branches.local.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[10.5px] text-ink-3">
            {connected ? '还没有分支' : '连接仓库后这里会列出本地分支'}
          </div>
        ) : (
          <ul className="divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
            {branches.local.map((branch) => {
              const isCurrent = branch === branches.current
              return (
                <li key={branch} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                  {isCurrent ? (
                    <CheckCircle2 className="size-3 shrink-0 text-accent" />
                  ) : (
                    <span className="size-3 shrink-0 rounded-full border border-line" />
                  )}
                  <span className={cn('min-w-0 flex-1 truncate font-mono', isCurrent ? 'text-ink' : 'text-ink-2')}>
                    {branch}
                  </span>
                  {isCurrent ? (
                    <span className="text-[9.5px] text-ink-3">当前</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void switchBranch(branch)}
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink disabled:opacity-40"
                      >
                        切换
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void mergeBranch(branch)}
                        className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink disabled:opacity-40"
                      >
                        <GitMerge className="size-2.5" />
                        合并进来
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-1.5 flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              placeholder="新分支名，例如 notes-v2"
              disabled={disabled}
            />
          </div>
          <Button
            size="sm"
            disabled={disabled || !name.trim() || Boolean(invalid) || duplicate || working}
            onClick={() => void submit()}
          >
            {busy === 'branch' ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            新建并切换
          </Button>
        </div>
        {invalid ? <p className="mt-1 text-[10px] text-danger">{invalid}</p> : null}
        {duplicate ? <p className="mt-1 text-[10px] text-warn">已经有重名分支，直接在上面「切换」即可</p> : null}
        <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
          切换分支前会自动提交当前改动（消息带「切换分支前自动提交」），不会把手上的笔记留在旧分支。
        </p>
      </div>

      {/* ── 危险区 ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-line">
        <button
          type="button"
          onClick={() => {
            setDangerOpen((open) => !open)
            setConfirming(null)
          }}
          className="flex w-full items-center gap-1 px-2.5 py-1.5 text-[10.5px] text-ink-3 hover:text-ink"
        >
          <AlertTriangle className="size-3" />
          本地 Git 维护（重建 / 删除）
          <span className="ml-auto text-[9.5px]">{dangerOpen ? '收起' : '展开'}</span>
        </button>

        {dangerOpen ? (
          <div className="space-y-2 border-t border-line/60 px-2.5 py-2 text-[10.5px] leading-relaxed">
            <p className="text-ink-3">
              两种操作都只动 <code className="font-mono">.git</code> 目录，<b className="text-ink-2">文献文件一个都不会删</b>；
              但本地提交历史会消失（想留一手，先点上面的「推送」）。
            </p>

            {confirming === null ? (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" disabled={working} onClick={() => setConfirming('rebuild')}>
                  <RotateCcw className="size-3" />
                  重建并接上远端
                </Button>
                <Button size="sm" variant="ghost" disabled={working} onClick={() => setConfirming('delete')}>
                  <Trash2 className="size-3" />
                  只删除本地 Git
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-2">
                <p className="text-[10.5px] text-ink-2">
                  {confirming === 'rebuild'
                    ? '将删除 .git → 重新 init → 把远端历史接回来。远端已有的文件会被补到本地，本地文件不会被删。'
                    : '将直接删除 .git，这个库不再是 Git 仓库。之后可以再点「连接仓库」重新开始。'}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={working}
                    onClick={async () => {
                      const ok =
                        confirming === 'rebuild' ? await resetGit(true) : await disconnectGit()
                      if (ok) setConfirming(null)
                    }}
                  >
                    {busy === 'reset' ? <Loader2 className="size-3 animate-spin" /> : null}
                    {confirming === 'rebuild' ? '确认重建' : '确认删除'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-[10px] text-ink-3 hover:text-ink"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
