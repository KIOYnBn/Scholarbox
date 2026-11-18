import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarsProps {
  value: number
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void
  size?: number
  className?: string
  showEmpty?: boolean
}

/** 重要性 1–5 星. Interactive when `onChange` is provided. */
export function Stars({ value, onChange, size = 12, className, showEmpty = true }: StarsProps) {
  const interactive = Boolean(onChange)
  return (
    <div
      className={cn('inline-flex items-center gap-[2px]', className)}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={`重要性 ${value} / 5`}
    >
      {[1, 2, 3, 4, 5].map((index) => {
        const filled = index <= value
        if (!filled && !showEmpty) return null
        return (
          <button
            key={index}
            type="button"
            disabled={!interactive}
            onClick={(event) => {
              event.stopPropagation()
              onChange?.(index as 1 | 2 | 3 | 4 | 5)
            }}
            className={cn(
              'transition-colors',
              interactive ? 'cursor-pointer hover:scale-110' : 'cursor-default',
            )}
            aria-label={`${index} 星`}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(
                filled ? 'fill-warn text-warn' : 'fill-transparent text-ink-3/45',
                'stroke-[1.5]',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
