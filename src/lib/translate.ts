import { httpFetch } from './http'

export type TranslationProvider = 'mymemory' | 'google-free' | 'deepl' | 'openai' | 'none'

export interface TranslationConfig {
  provider: TranslationProvider
  targetLang: string
  apiKey: string
  endpoint: string
}

export interface TranslationResult {
  text: string
  /** what the provider thinks the source language is, when it tells us */
  detected: string
  provider: TranslationProvider
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'TranslationError'
  }
}

const TIMEOUT_MS = 12_000

/** google's free endpoint uses `zh-CN` / `ja` / `en`, DeepL wants `ZH` / `JA` / `EN`. */
function deeplLang(code: string): string {
  const map: Record<string, string> = {
    'zh-CN': 'ZH',
    'zh-TW': 'ZH',
    'zh': 'ZH',
    en: 'EN',
    ja: 'JA',
    ko: 'KO',
    de: 'DE',
    fr: 'FR',
    es: 'ES',
    ru: 'RU',
  }
  return map[code] ?? code.split('-')[0]!.toUpperCase()
}

const LANG_LABEL: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
}

export function targetLangLabel(code: string): string {
  return LANG_LABEL[code] ?? code
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 划词翻译。只把选中的那一小段文字发出去，不发整篇文献 ——
 * 本地优先的软件不该因为点了「翻译」就把 PDF 上传。
 */
export async function translate(
  raw: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) throw new TranslationError('没有选中任何文字')
  if (text.length > 2000) throw new TranslationError('选中的文字太长（上限 2000 字符）')

  switch (config.provider) {
    case 'mymemory':
      return translateMyMemory(text, config.targetLang)
    case 'google-free':
      return translateGoogle(text, config.targetLang)
    case 'deepl':
      return translateDeepl(text, config)
    case 'openai':
      return translateOpenAI(text, config)
    default:
      throw new TranslationError('还没有选择翻译服务', '在「设置 → 翻译」里选一个服务再试')
  }
}

/**
 * MyMemory 免费接口：不需要 Key、原生允许跨域，国内网络也能直连，
 * 因此是默认服务。缺点是单次请求上限 500 字符，长段落要切片。
 */
function looksChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const slice = rest.slice(0, limit)
    const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf(','))
    const at = cut > limit * 0.5 ? cut + 1 : limit
    chunks.push(rest.slice(0, at).trim())
    rest = rest.slice(at)
  }
  if (rest.trim()) chunks.push(rest.trim())
  return chunks
}

async function translateMyMemory(
  text: string,
  targetLang: string,
): Promise<TranslationResult> {
  const source = looksChinese(text) ? 'zh-CN' : 'en'
  const langpair = `${source}|${targetLang}`
  const parts = chunkText(text, 450)

  const results: string[] = []
  for (const part of parts) {
    const url =
      'https://api.mymemory.translated.net/get' +
      `?q=${encodeURIComponent(part)}&langpair=${encodeURIComponent(langpair)}`
    const response = await withTimeout((signal) => httpFetch(url, { signal }))
    if (!response.ok) {
      throw new TranslationError(`翻译服务返回 ${response.status}`, '免费额度用完了，稍后再试或换一个服务')
    }
    const payload = (await response.json()) as {
      responseData?: { translatedText?: string }
      responseStatus?: number | string
      responseDetails?: string
    }
    const status = Number(payload.responseStatus ?? 200)
    if (status !== 200) {
      throw new TranslationError(
        payload.responseDetails || `翻译服务返回 ${status}`,
        'MyMemory 免费额度按天计算，用尽后可在设置里换成 DeepL 或 OpenAI',
      )
    }
    const translated = payload.responseData?.translatedText?.trim() ?? ''
    if (!translated) throw new TranslationError('翻译结果为空')
    results.push(translated)
  }

  return { text: results.join(' '), detected: source, provider: 'mymemory' }
}

async function translateGoogle(text: string, targetLang: string): Promise<TranslationResult> {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`

  const response = await withTimeout((signal) => httpFetch(url, { signal }))
  if (!response.ok) {
    throw new TranslationError(`翻译服务返回 ${response.status}`, '免费接口偶尔会被限流，稍后再试')
  }
  const payload = (await response.json()) as unknown
  // shape: [[["译文","原文",null,null,10]], null, "en", ...]
  const chunks = Array.isArray(payload) ? (payload[0] as unknown[]) : []
  const translated = Array.isArray(chunks)
    ? chunks
        .map((chunk) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
        .join('')
        .trim()
    : ''
  if (!translated) throw new TranslationError('翻译结果为空')

  const detected = Array.isArray(payload) && typeof payload[2] === 'string' ? payload[2] : ''
  return { text: translated, detected, provider: 'google-free' }
}

async function translateDeepl(text: string, config: TranslationConfig): Promise<TranslationResult> {
  if (!config.apiKey) {
    throw new TranslationError('缺少 DeepL API Key', '在「设置 → 翻译」里填入 Key')
  }
  const endpoint = config.endpoint || 'https://api-free.deepl.com/v2/translate'
  const response = await withTimeout((signal) =>
    httpFetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${config.apiKey}`,
      },
      body: new URLSearchParams({
        text,
        target_lang: deeplLang(config.targetLang),
      }).toString(),
    }),
  )
  if (!response.ok) {
    throw new TranslationError(`DeepL 返回 ${response.status}`, '检查 Key 是否对应这个 endpoint')
  }
  const payload = (await response.json()) as {
    translations?: { text?: string; detected_source_language?: string }[]
  }
  const first = payload.translations?.[0]
  if (!first?.text) throw new TranslationError('DeepL 没有返回译文')
  return {
    text: first.text,
    detected: (first.detected_source_language ?? '').toLowerCase(),
    provider: 'deepl',
  }
}

async function translateOpenAI(
  text: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  if (!config.apiKey) {
    throw new TranslationError('缺少 API Key', '在「设置 → 翻译」里填入 Key')
  }
  const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions'
  const response = await withTimeout((signal) =>
    httpFetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              '你是学术文献翻译助手。把用户给出的英文片段翻译成简体中文，' +
              '保留专业术语的常见译法，术语后可加英文原词。只输出译文，不要解释。',
          },
          { role: 'user', content: text },
        ],
      }),
    }),
  )
  if (!response.ok) {
    throw new TranslationError(`接口返回 ${response.status}`, '检查 endpoint 与 Key')
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const translated = payload.choices?.[0]?.message?.content?.trim()
  if (!translated) throw new TranslationError('接口没有返回译文')
  return { text: translated, detected: '', provider: 'openai' }
}
