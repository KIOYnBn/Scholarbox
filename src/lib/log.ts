import { isTauriRuntime } from '@/lib/http'

/**
 * 同步 / 分支操作的持久化日志。
 *
 * 为什么需要：桌面端 GUI 没有控制台，同步失败只能靠界面上的错误卡；用户一关窗口，
 * 线索就没了（这次排查推送问题就卡在这里 —— 只能看到「不行」，看不到到底哪一步失败）。
 * 所以每一步都写一行到 `%LOCALAPPDATA%\ScholarBox\sync.log`，Rust 侧的 HTTP 请求
 * 写 `git.log`。用户只要把这两个文件发过来就能定位。
 *
 * 浏览器模式没有文件系统，退化到 console。
 */

function stringify(detail: unknown): string {
  if (detail === undefined) return ''
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

export function logSync(event: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${event}${detail === undefined ? '' : ` ${stringify(detail)}`}`
  if (!isTauriRuntime()) {
    console.info('[sync]', line)
    return
  }
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('log_append', { scope: 'sync', line }))
    // 日志失败绝不能影响同步本身
    .catch(() => undefined)
}
