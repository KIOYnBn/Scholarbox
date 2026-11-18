import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Copy, Loader2, ShieldAlert, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useSyncStore } from '@/stores/sync'
import type { GitErrorKind } from '@/lib/git/errors'

/**
 * 同步错误卡 + 连接诊断面板。
 *
 * 为什么单独开一个组件：错误信息是这个模块最容易「糊弄用户」的地方 ——
 * 上半年的版本把任何失败都写成「网络不通，可能被墙」，用户实际是 Token 过期。
 * 这里强制把「分类 + 原始状态码 + 地址 + 下一步」摆出来，并提供一键复制。
 */

const KIND_LABELS: Record<GitErrorKind, string> = {
  auth: '认证失败',
  forbidden: '没有权限',
  'rate-limit': '触发限流',
  'not-found': '远端不存在',
  branch: '分支有问题',
  network: '网络失败',
  'network-dns': 'DNS 解析失败',
  'network-timeout': '请求超时',
  'network-tls': 'TLS 握手失败',
  'network-proxy': '代理/证书问题',
  'cors-proxy': 'CORS 代理失败',
  adaptor: 'HTTP 适配层失败',
  'push-rejected': '推送被拒绝（非快进）',
  'history-unrelated': '本地与远端无共同历史',
  conflict: '提交冲突',
  local: '本地仓库状态异常',
  unknown: '未知错误',
}

const KIND_TONE: Partial<Record<GitErrorKind, string>> = {
  auth: 'bg-danger/10 text-danger',
  forbidden: 'bg-danger/10 text-danger',
  'rate-limit': 'bg-warn/15 text-warn',
  'not-found': 'bg-warn/15 text-warn',
  'cors-proxy': 'bg-warn/15 text-warn',
  adaptor: 'bg-warn/15 text-warn',
  conflict: 'bg-warn/15 text-warn',
}

function kindLabel(kind: GitErrorKind): string {
  return KIND_LABELS[kind] ?? KIND_LABELS.unknown
}

export function SyncErrorCard() {
  const error = useSyncStore((state) => state.error)
  const hint = useSyncStore((state) => state.hint)
  const info = useSyncStore((state) => state.errorInfo)
  const report = useSyncStore((state) => state.report)
  const clearMessages = useSyncStore((state) => state.clearMessages)
  const [copied, setCopied] = useState(false)

  if (!error) return null

  const copy = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // 剪贴板被拒时退回选中文本：至少让用户能手动复制
      window.prompt('复制下面的诊断报告（不含令牌）：', report)
    }
  }

  const meta: string[] = []
  if (info?.status) meta.push(`HTTP ${info.status}`)
  if (info?.code) meta.push(`code=${info.code}`)
  if (info?.url) meta.push(info.url)

  return (
    <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-2.5 text-[10.5px] leading-relaxed">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {info ? (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9.5px] font-medium',
                KIND_TONE[info.kind] ?? 'bg-danger/10 text-danger',
              )}
            >
              {kindLabel(info.kind)}
            </span>
          ) : null}
          <p className="break-words font-medium text-danger">{error}</p>
        </div>
        {info?.message && info.message !== error ? (
          <p className="mt-1 break-words text-ink-2">{info.message}</p>
        ) : null}
        {meta.length > 0 ? (
          <p className="mt-1 break-all font-mono text-[9.5px] text-ink-3">{meta.join(' · ')}</p>
        ) : null}
        {hint ? <p className="mt-1 text-ink-2">{hint}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink"
          >
            <Copy className="size-3" />
            {copied ? '已复制（不含令牌）' : '复制报告'}
          </button>
          {info?.retryable ? (
            <span className="text-[10px] text-ink-3">这类错误通常重试即可</span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={clearMessages}
        className="ml-auto self-start text-[10px] text-ink-3 hover:text-ink"
      >
        关闭
      </button>
    </div>
  )
}

export function SyncDiagnostics() {
  const checks = useSyncStore((state) => state.checks)
  const diagnose = useSyncStore((state) => state.diagnose)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    try {
      await diagnose()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
          <ClipboardCheck className="size-3" />
          连接诊断
        </span>
        <Button size="sm" variant="ghost" disabled={running} onClick={() => void run()}>
          {running ? <Loader2 className="size-3 animate-spin" /> : null}
          {running ? '检测中…' : '开始检测'}
        </Button>
      </div>
      {checks.length === 0 ? (
        <p className="px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-3">
          逐项检查远端地址、分支、令牌、GitHub API 鉴权与远端分支列表。检查结果不含完整令牌。
        </p>
      ) : (
        <ul className="divide-y divide-line/60">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 px-2.5 py-1.5 text-[10.5px]">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-accent" />
              ) : (
                <XCircle className="mt-0.5 size-3 shrink-0 text-danger" />
              )}
              <div className="min-w-0">
                <p className="text-ink">{check.label}</p>
                <p className="break-words font-mono text-[9.5px] text-ink-3">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SyncErrorHint() {
  const info = useSyncStore((state) => state.errorInfo)
  if (!info) return null
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-warn/30 bg-warn/5 px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-2">
      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn" />
      <span>{info.hint}</span>
    </div>
  )
}
