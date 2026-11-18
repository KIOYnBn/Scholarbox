import { ANNOTATION_COLORS } from '@/lib/vault/annotations'
import type { AnnotationKind, AnnotationStyleOverride } from '@/lib/vault/schema'
import { cn } from '@/lib/utils'

interface StyleControlsProps {
  kind: AnnotationKind
  value: AnnotationStyleOverride
  onChange: (patch: AnnotationStyleOverride) => void
  /** 紧凑模式：工具栏弹层里用，去掉大段说明 */
  compact?: boolean
}

const SLIDER =
  'h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--sb-accent)]'

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[10.5px] text-ink-3">
        <span>{label}</span>
        <span className="font-mono text-ink-2">
          {step < 1 ? value.toFixed(2) : Math.round(value)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={SLIDER}
      />
      {hint ? <span className="text-[10px] text-ink-3">{hint}</span> : null}
    </label>
  )
}

/**
 * 颜色 / 透明度 / 线宽或 padding —— 全局默认样式和单条覆盖共用这一份控件，
 * 改哪个走哪个回调，避免两处实现漂移。
 */
export function StyleControls({ kind, value, onChange, compact = false }: StyleControlsProps) {
  const isLine = kind === 'underline' || kind === 'strikethrough' || kind === 'note'
  const opacity = (value.opacity ?? 0.38) * 100
  const width = value.width ?? 2
  const offset = (value.offset ?? (kind === 'strikethrough' ? 0.5 : 0.9)) * 100
  const paddingY = (value.paddingY ?? 0.04) * 100

  return (
    <div className={cn('space-y-2.5', compact ? 'px-3 py-2.5' : '')}>
      <div className="flex items-center gap-1.5">
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            title={`${color.label}色`}
            aria-label={`${color.label}色`}
            onClick={() => onChange({ color: color.swatch })}
            className={cn(
              'size-4 rounded-full border transition',
              value.color === color.swatch
                ? 'border-ink/50 ring-2 ring-accent/40'
                : 'border-black/10 hover:scale-110',
            )}
            style={{ backgroundColor: color.swatch }}
          />
        ))}
        <input
          type="color"
          aria-label="自定义颜色"
          value={value.color ?? '#f2c94c'}
          onChange={(event) => onChange({ color: event.target.value })}
          className="ml-1 size-4 cursor-pointer rounded border border-line bg-transparent p-0"
        />
      </div>

      <SliderRow
        label="透明度"
        value={opacity}
        min={5}
        max={100}
        step={1}
        suffix="%"
        onChange={(next) => onChange({ opacity: next / 100 })}
      />

      {isLine ? (
        <>
          <SliderRow
            label="线宽"
            value={width}
            min={0.5}
            max={6}
            step={0.1}
            suffix="px"
            onChange={(next) => onChange({ width: next })}
          />
          <SliderRow
            label={kind === 'strikethrough' ? '中线位置' : '贴底位置'}
            value={offset}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(next) => onChange({ offset: next / 100 })}
          />
        </>
      ) : (
        <SliderRow
          label="上下外扩"
          hint="让高亮盖住行距，0% 表示紧贴字形"
          value={paddingY}
          min={0}
          max={15}
          step={0.5}
          suffix="%"
          onChange={(next) => onChange({ paddingY: next / 100 })}
        />
      )}
    </div>
  )
}
