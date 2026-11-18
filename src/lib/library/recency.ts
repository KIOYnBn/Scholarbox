/**
 * 「最近查看」的窗口判定与去重写盘。
 *
 * 两个看起来无关、其实要一起考虑的问题：
 * 1. 筛选器要按「今天 / 7 天 / 30 天」判断一个时间戳算不算新鲜；
 * 2. 打开一篇文献会连续触发好几个入口（阅读器挂载、详情面板挂载、切回窗口），
 *    如果每次都写 meta.json，翻十篇就是几十次写盘 —— 所以同一项 60 秒内只写一次。
 */

export type RecentWindow = 'all' | 'today' | 'week' | 'month'

export const RECENT_WINDOWS: { value: RecentWindow; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '7 天' },
  { value: 'month', label: '30 天' },
]

export const RECENT_WINDOW_LABELS: Record<RecentWindow, string> = {
  all: '全部',
  today: '今天',
  week: '7 天',
  month: '30 天',
}

const DAY = 24 * 60 * 60 * 1000

/** 窗口对应的毫秒数；`all` 返回 null 表示不限 */
export function windowMs(window: RecentWindow, now = Date.now()): number | null {
  switch (window) {
    case 'today': {
      // 「今天」按自然日算，而不是「最近 24 小时」—— 凌晨一点看到的论文
      // 早八点还想再打开时，它应该还在「今天」里。
      const at = new Date(now)
      const start = new Date(at.getFullYear(), at.getMonth(), at.getDate())
      // 只要「今天零点到现在」这段，不能加一天 —— 否则昨天 23:50 也会算进今天
      return at.getTime() - start.getTime()
    }
    case 'week':
      return 7 * DAY
    case 'month':
      return 30 * DAY
    default:
      return null
  }
}

/** 时间戳是否落在窗口内；空值永远不算 */
export function withinRecent(iso: string | null | undefined, window: RecentWindow, now = Date.now()): boolean {
  if (window === 'all') return true
  if (!iso) return false
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return false
  const span = windowMs(window, now)
  if (span === null) return true
  return now - at <= span
}

/**
 * 同一次会话内，同一项（paper:<dir> / note:<file>）60 秒内只允许写一次。
 *
 * 用模块级 Map 而不是 store：它是纯粹的副作用节流，和 UI 状态无关；
 * 切换仓库时必须清空，否则切回来会以为「刚写过」而漏掉一次真实的查看记录。
 */
const WRITE_INTERVAL_MS = 60_000
const lastWrite = new Map<string, number>()

export function shouldMarkViewed(key: string, now = Date.now()): boolean {
  const previous = lastWrite.get(key)
  if (previous !== undefined && now - previous < WRITE_INTERVAL_MS) return false
  lastWrite.set(key, now)
  return true
}

/** 测试与仓库切换用 */
export function resetViewedThrottle(): void {
  lastWrite.clear()
}

/** 节流写盘：只有通过节流才调用 writer，返回是否真的写了 */
export async function markViewed(key: string, writer: () => Promise<void> | void): Promise<boolean> {
  if (!shouldMarkViewed(key)) return false
  await writer()
  return true
}

export function lastViewedKey(item: { paper: unknown; file: string | null; id: string }): string {
  return item.file ? `note:${item.file}` : `paper:${item.id}`
}
