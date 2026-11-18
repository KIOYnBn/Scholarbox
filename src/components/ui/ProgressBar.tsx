import { cn } from '@/lib/utils'

export function ProgressBar({
  value,
  className,
  thin = false,
  tone = 'accent',
}: {
  value: number
  className?: string
  thin?: boolean
  tone?: 'accent' | 'muted' | 'warn'
}) {
  const pct = Math.min(100, Math.max(0, value))
  const color =
    tone === 'warn' ? 'bg-warn' : tone === 'muted' ? 'bg-ink-3/60' : 'bg-accent'
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-3',
        thin ? 'h-[3px]' : 'h-1.5',
        className,
      )}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
