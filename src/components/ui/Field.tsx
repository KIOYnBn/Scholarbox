import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('sb-input', className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn('sb-input h-auto min-h-20 resize-y py-1.5 leading-relaxed', className)}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('sb-input cursor-pointer pr-6', className)} {...props}>
      {children}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-medium transition-colors',
            value === option.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
