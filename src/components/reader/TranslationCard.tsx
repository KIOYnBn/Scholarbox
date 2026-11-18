import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, Languages, Loader2, X } from 'lucide-react'
import { FloatingPopover } from './FloatingPopover'
import { translate, targetLangLabel, TranslationError } from '@/lib/translate'
import type { TranslationResult } from '@/lib/translate'
import { useSettingsStore } from '@/stores/settings'

interface TranslationCardProps {
  at: { x: number; y: number }
  text: string
  onClose: () => void
}

type Status = 'loading' | 'ready' | 'error'

export function TranslationCard({ at, text, onClose }: TranslationCardProps) {
  const translation = useSettingsStore((s) => s.translation)
  const [status, setStatus] = useState<Status>('loading')
  const [result, setResult] = useState<TranslationResult | null>(null)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const runIdRef = useRef(0)

  const run = useCallback(async () => {
    const runId = ++runIdRef.current
    setStatus('loading')
    setError(null)
    try {
      const next = await translate(text, translation)
      if (runIdRef.current !== runId) return
      setResult(next)
      setStatus('ready')
    } catch (err) {
      if (runIdRef.current !== runId) return
      const isAbort = (err as { name?: string })?.name === 'AbortError'
      setError({
        message: isAbort
          ? '翻译超时'
          : err instanceof TranslationError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        hint: err instanceof TranslationError ? err.hint : '检查网络，或换个翻译服务',
      })
      setStatus('error')
    }
  }, [text, translation])

  useEffect(() => {
    void run()
  }, [run])

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <FloatingPopover at={at} onClose={onClose} className="w-[340px] overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/60 px-3 py-1.5">
        <Languages className="size-3.5 text-accent" />
        <span className="text-[11px] font-medium text-ink-2">
          翻译 · {targetLangLabel(translation.targetLang)}
        </span>
        <span className="text-[10px] text-ink-3">
          {translation.provider === 'mymemory'
            ? 'MyMemory'
            : translation.provider === 'google-free'
            ? 'Google'
            : translation.provider === 'deepl'
              ? 'DeepL'
              : translation.provider === 'openai'
                ? 'OpenAI'
                : '未配置'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {result && (
            <button
              type="button"
              title="复制译文"
              aria-label="复制译文"
              onClick={copy}
              className="flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {copied ? <Check className="size-3 text-accent" /> : <Copy className="size-3" />}
            </button>
          )}
          <button
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto px-3 py-2.5">
        <p className="mb-2 line-clamp-2 border-l-2 border-line pl-2 text-[11px] leading-relaxed text-ink-3">
          {text}
        </p>

        {status === 'loading' && (
          <div className="flex items-center gap-2 py-2 text-[12px] text-ink-2">
            <Loader2 className="size-3.5 animate-spin text-accent" />
            正在翻译…
          </div>
        )}

        {status === 'error' && error && (
          <div className="flex items-start gap-2 py-1 text-[11.5px] leading-relaxed">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
            <div>
              <p className="text-ink">{error.message}</p>
              {error.hint && <p className="mt-0.5 text-ink-3">{error.hint}</p>}
              <button
                type="button"
                onClick={() => void run()}
                className="mt-1.5 text-accent hover:underline"
              >
                重试
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && result && (
          <p className="whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-ink">
            {result.text}
          </p>
        )}
      </div>
    </FloatingPopover>
  )
}
