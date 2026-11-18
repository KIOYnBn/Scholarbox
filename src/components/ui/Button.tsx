import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'default' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'icon'

const variants: Record<Variant, string> = {
  primary: 'sb-btn sb-btn-primary',
  default: 'sb-btn border border-line',
  ghost: 'sb-btn',
  danger: 'sb-btn text-danger hover:bg-danger/10 hover:text-danger',
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-[12px]',
  md: '',
  icon: 'h-7 w-7 px-0',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(variants[variant], sizes[size], className)} {...props} />
})
