/**
 * 两个宿主下的 HTTP 适配层。
 *
 * 关键约定（上一轮踩过的坑，别再走回头路）：
 * - **桌面端失败不再静默回退到 `window.fetch`**。Tauri 的 webview origin 是 `localhost`，
 *   回退后直连 GitHub 必被 CORS 拦，抛出的 `TypeError: Failed to fetch` 会被误判成「网络不通」，
 *   真正的根因（插件调用失败 / capability 没放行 / 代理没生效）就再也查不到了。
 * - 失败统一抛 `HttpAdaptorError`，带 `stage`（plugin / browser / timeout / status）与 `url`，
 *   由 `classifyGitError()` 归类。
 */
import { HttpAdaptorError } from '@/lib/git/errors'

export const DEFAULT_TIMEOUT_MS = 30_000

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

export interface HttpFetchOptions extends RequestInit {
  /** 毫秒；0 表示不超时 */
  timeoutMs?: number
}

function withTimeout(init: RequestInit | undefined, timeoutMs: number): { init: RequestInit; cancel: () => void } {
  if (!timeoutMs) return { init: init ?? {}, cancel: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    init: { ...(init ?? {}), signal: controller.signal },
    cancel: () => clearTimeout(timer),
  }
}

/**
 * 发一次请求。桌面端走 Rust reqwest（没有 CORS、受 capability 白名单约束）；
 * 浏览器端走 `window.fetch`（受服务端 CORS 约束，Git 场景需要 corsProxy）。
 */

function headerObject(headers: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value
    return out
  }
  return { ...(headers as Record<string, string>) }
}

function bodyToBase64(body: RequestInit['body']): string | null {
  if (body == null) return null
  if (typeof body === 'string') return btoa(unescape(encodeURIComponent(body)))
  if (body instanceof Uint8Array) return bytesToBase64(body)
  if (body instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) return bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  throw new HttpAdaptorError('plugin', '不支持的请求体类型（仅支持 string / 二进制）', '', undefined, body)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out.buffer
}

/** 直接走 Rust 侧 `git_http` 命令（reqwest 通道），不经过 tauri-plugin-http。 */
async function nativeGitHttp(input: string, init: RequestInit): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core')
  const out = await invoke<{ status: number; headers: Record<string, string>; body: string }>('git_http', {
    url: input,
    method: init.method ?? 'GET',
    headers: headerObject(init.headers),
    bodyB64: bodyToBase64(init.body),
  })
  return new Response(base64ToBytes(out.body), { status: out.status, headers: out.headers })
}

export async function httpFetch(input: string, init?: HttpFetchOptions): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const { timeoutMs: _ignored, ...rest } = init ?? {}
  const { init: requestInit, cancel } = withTimeout(rest, timeoutMs)

  if (isTauriRuntime()) {
    // 桌面端两条通道，按「插件优先、自建通道兜底」的顺序尝试：
    //  - `tauri-plugin-http`：历史上能推送成功的那条路，先别动。
    //  - `git_http`：自建 reqwest 通道（钉 IPv4 + HTTP/1.1 + native-tls），只在插件失败时兜底。
    // 两条都失败时抛带两条原因的 HttpAdaptorError，方便一眼看出是哪一层的问题。
    const errors: string[] = []
    let mod: typeof import('@tauri-apps/plugin-http') | null = null
    try {
      mod = await import('@tauri-apps/plugin-http')
    } catch (err) {
      errors.push(`插件加载失败：${messageOf(err)}`)
    }
    if (mod) {
      try {
        const response = await mod.fetch(input, requestInit)
        cancel()
        return response
      } catch (err) {
        errors.push(`插件请求失败：${messageOf(err)}`)
      }
    }
    try {
      const response = await nativeGitHttp(input, requestInit)
      cancel()
      return response
    } catch (err) {
      errors.push(`自建通道失败：${messageOf(err)}`)
    }
    cancel()
    throw new HttpAdaptorError('plugin', errors.join('；'), input, undefined, errors)
  }

  try {
    const response = await fetch(input, requestInit)
    cancel()
    return response
  } catch (err) {
    cancel()
    if (isAbortError(err)) {
      throw new HttpAdaptorError('timeout', `请求超过 ${timeoutMs}ms 未完成`, input, undefined, err)
    }
    throw new HttpAdaptorError('browser', `浏览器 fetch 失败：${messageOf(err)}`, input, undefined, err)
  }
}

/**
 * git 专用通道：直接走 Rust 侧的 `git_http`（reqwest）命令，跳过 tauri-plugin-http。
 *
 * 为什么单独一条路：插件不读系统代理，而本机直连 github.com（IPv4/IPv6 都试过）必超时，
 * 只有 Rust 侧 `git_http` 命令会读 Windows 系统代理（Clash 等）把请求送到 GitHub。
 * 若还走 `httpFetch` 的「插件优先」顺序，每次 git 请求都要先等插件超时（30s）才落到
 * 自建通道，push/pull 有几十上百个请求，会卡成不可用。
 *
 * git 传输（push/pull/fetch）和 GitHub 诊断都走这里；翻译等其他请求仍走 `httpFetch`，
 * 避免影响它们的 AbortSignal 超时语义。
 */
export async function gitHttpFetch(input: string, init?: HttpFetchOptions): Promise<Response> {
  const { timeoutMs: _ignored, signal: _signal, ...rest } = init ?? {}
  return nativeGitHttp(input, rest)
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  return (err as { name?: string }).name === 'AbortError'
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}
