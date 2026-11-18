/**
 * Git 错误的统一分类。
 *
 * 背景：以前 `translateNetworkError()` 把所有 fetch 失败压成「网络不通」，还替用户下结论
 * 「可能被墙」。用户网络明明是通的 —— 这是误诊。诊断信息（状态码、URL、errno）其实都在
 * 错误对象里，只是没人读。
 *
 * 这里做三件事：
 * 1. 把 err 身上真正有信息量的字段（`name` / `data.statusCode` / `data.url` / `cause.code`）读出来；
 * 2. 归类成 `GitErrorKind`，给每种失败一句「人话 + 下一步」；
 * 3. 所有对外文本都过 `redact()`，保证 PAT 不会出现在错误框、日志或复制出来的报告里。
 */

export type GitErrorKind =
  | 'auth'
  | 'forbidden'
  | 'rate-limit'
  | 'not-found'
  | 'branch'
  | 'network'
  | 'network-dns'
  | 'network-timeout'
  | 'network-tls'
  | 'network-proxy'
  | 'cors-proxy'
  | 'adaptor'
  | 'push-rejected'
  | 'history-unrelated'
  | 'conflict'
  | 'local'
  | 'unknown'

export type GitAction =
  | 'connect'
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'history'
  | 'refresh'
  | 'diagnose'

export interface GitErrorContext {
  action: GitAction
  /** 远端地址（不含凭据） */
  url?: string | null
  corsProxy?: string | null
  runtime: 'tauri' | 'browser'
  /** 只用于脱敏，不会被写进任何输出 */
  token?: string | null
  branch?: string | null
}

export interface GitErrorInfo {
  kind: GitErrorKind
  /** 短标题，直接给用户看 */
  title: string
  /** 已脱敏的原始信息 */
  message: string
  /** 下一步建议 */
  hint: string
  status?: number
  url?: string
  code?: string
  cause?: string
  retryable: boolean
}

export class GitOperationError extends Error {
  readonly info: GitErrorInfo

  constructor(info: GitErrorInfo) {
    super(info.message)
    this.name = 'GitOperationError'
    this.info = info
  }
}

/** HTTP 适配层自己的失败 —— 与「网络不通」必须分开报 */
export class HttpAdaptorError extends Error {
  constructor(
    readonly stage: 'plugin' | 'browser' | 'timeout' | 'status',
    message: string,
    readonly url?: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'HttpAdaptorError'
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/g,
  /(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  /(x-access-token)\s*[:=]\s*[^\s,;]+/gi,
  /(password)\s*[:=]\s*[^\s,;]+/gi,
]

/** 抹掉 PAT / Authorization / URL 里的 basic-auth 段 */
export function redact(text: string, token?: string | null): string {
  let out = text
  if (token && token.length >= 8) out = out.split(token).join('<PAT>')
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '$1 <已隐藏>')
  // https://user:pass@host/... → https://<已隐藏>@host/...
  out = out.replace(/\/\/[^/@\s]+@/g, '//<已隐藏>@')
  return out
}

interface RawGitError {
  name?: string
  message?: string
  code?: string
  status?: number
  data?: { statusCode?: number; url?: string; body?: string }
  cause?: { code?: string; message?: string }
}

function asRaw(err: unknown): RawGitError {
  if (typeof err !== 'object' || err === null) return { message: String(err) }
  return err as RawGitError
}

function textOf(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

interface Rule {
  kind: GitErrorKind
  title: string
  hint: string
  retryable: boolean
}

const RULES: Record<GitErrorKind, Rule> = {
  auth: {
    kind: 'auth',
    title: '认证失败（401）',
    hint: 'Token 过期、被撤销或复制不完整。fine-grained token 要显式勾上目标仓库的 Contents 读写权限。',
    retryable: false,
  },
  forbidden: {
    kind: 'forbidden',
    title: '没有权限（403）',
    hint: 'Token 有效但这个仓库不允许写。检查 token 的仓库范围、分支保护规则，以及是否只有只读权限。',
    retryable: false,
  },
  'rate-limit': {
    kind: 'rate-limit',
    title: '触发 GitHub 频率限制（403）',
    hint: '请求太频繁，等几分钟再试；未认证请求每小时只有 60 次。',
    retryable: true,
  },
  'not-found': {
    kind: 'not-found',
    title: '仓库不存在（404）',
    hint: '检查 owner / repo 拼写；私有仓库还要求 token 拥有该仓库的访问权（否则 GitHub 也返回 404）。',
    retryable: false,
  },
  branch: {
    kind: 'branch',
    title: '分支不存在',
    hint: '远端没有这个分支。检查设置里的分支名，或先用默认的 main。',
    retryable: false,
  },
  network: {
    kind: 'network',
    title: '网络请求失败',
    hint: '请求没有拿到 HTTP 响应。看下面的原始错误码，再对照「连接诊断」里的 DNS / 代理结论。',
    retryable: true,
  },
  'network-dns': {
    kind: 'network-dns',
    title: '域名解析失败（DNS）',
    hint: '解析不了 github.com。检查系统 DNS、VPN 分流规则，或换个网络再试。',
    retryable: true,
  },
  'network-timeout': {
    kind: 'network-timeout',
    title: '连接超时',
    hint: 'TCP/TLS 握手在超时时间内没完成。检查代理是否可用、网络是否被限速；稍后重试。',
    retryable: true,
  },
  'network-tls': {
    kind: 'network-tls',
    title: 'TLS 证书校验失败',
    hint: '常见于公司/校园网中间人代理或杀软替换证书。安装其根证书，或换一个网络。',
    retryable: false,
  },
  'network-proxy': {
    kind: 'network-proxy',
    title: '系统代理不可用',
    hint: '连不上本机代理端口。打开代理软件，或把系统代理关掉再试。',
    retryable: true,
  },
  'cors-proxy': {
    kind: 'cors-proxy',
    title: 'CORS 代理失败',
    hint: '浏览器模式必须经代理转发请求。默认代理可能不可用，可在设置里换成备用地址；桌面端不经过代理。',
    retryable: true,
  },
  adaptor: {
    kind: 'adaptor',
    title: '桌面 HTTP 适配层异常',
    hint: '请求没有走到网络，而是在 Rust 侧 http 插件就被拒了（常见原因：URL 不在 capability 白名单）。这不是网络问题。',
    retryable: false,
  },
  'push-rejected': {
    kind: 'push-rejected',
    title: '推送被拒绝：本地与远端历史分叉',
    hint: '远端有本地没有的提交，Git 拒绝非快进推送。ScholarBox 会自动把远端历史接进来再推一次；如果仍然被拒，说明是分支保护规则或 Token 权限不足。',
    retryable: true,
  },
  'history-unrelated': {
    kind: 'history-unrelated',
    title: '本地与远端没有共同历史',
    hint: '两边是从各自的第一条提交开始的（常见于 GitHub 建仓库时勾了 README，而本机的 .git 是新建的）。点「拉取」或「推送」，ScholarBox 会把远端历史接成本地基底：只补本地没有的文件，不删本地内容，并把旧提交备份到 refs/scholarbox/backup/。',
    retryable: true,
  },
  conflict: {
    kind: 'conflict',
    title: '本地与远端冲突',
    hint: '两边改过同一处。先提交本地改动，再拉取并手动合并 —— ScholarBox 不会替你丢弃任何一边。',
    retryable: false,
  },
  local: {
    kind: 'local',
    title: '本地仓库状态异常',
    hint: '文献库的 .git 不完整或正被占用。先关闭占用它的程序，再试「重新连接」。',
    retryable: true,
  },
  unknown: {
    kind: 'unknown',
    title: '同步失败',
    hint: '把这份错误报告复制下来，里面有分类、状态码与原始信息。',
    retryable: true,
  },
}

function build(kind: GitErrorKind, ctx: GitErrorContext, err: unknown, extra: Partial<GitErrorInfo> = {}): GitErrorInfo {
  const rule = RULES[kind]
  const raw = asRaw(err)
  const status = extra.status ?? raw.data?.statusCode ?? raw.status
  const url = extra.url ?? raw.data?.url ?? ctx.url ?? undefined
  const code = extra.code ?? raw.code ?? raw.cause?.code
  const cause = extra.cause ?? (raw.cause?.message ? String(raw.cause.message) : undefined)
  const message = redact(extra.message ?? textOf(err), ctx.token)
  return {
    kind,
    title: rule.title,
    message,
    hint: rule.hint,
    retryable: rule.retryable,
    ...(status !== undefined ? { status } : {}),
    ...(url ? { url: redact(String(url), ctx.token) } : {}),
    ...(code ? { code } : {}),
    ...(cause ? { cause: redact(cause, ctx.token) } : {}),
  }
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text)
}

function statusKind(status: number): GitErrorKind {
  if (status === 401) return 'auth'
  if (status === 404) return 'not-found'
  if (status === 403) return 'forbidden'
  return 'network'
}

/**
 * 把任意错误归类。`ctx` 提供 action/url/runtime，用来区分「浏览器走代理」与「桌面走 Rust」。
 */
/** 服务端原文可能是字符串、对象或数组，统一摊平成一句话 */
function stringifyDetail(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

export function classifyGitError(err: unknown, ctx: GitErrorContext): GitErrorInfo {
  if (err instanceof GitOperationError) return err.info

  if (err instanceof HttpAdaptorError) {
    if (err.stage === 'plugin') return build('adaptor', ctx, err, { message: err.message, url: err.url, status: err.status })
    if (err.stage === 'timeout') return build('network-timeout', ctx, err, { message: err.message, url: err.url })
    if (err.stage === 'status' && err.status) {
      return build(statusKind(err.status), ctx, err, { message: err.message, url: err.url, status: err.status })
    }
    return build('network', ctx, err, { message: err.message, url: err.url })
  }

  const raw = asRaw(err)
  const message = textOf(err)
  // isomorphic-git 把服务端原文塞在 data.response 里，只看 message 会漏掉
  // 「API rate limit exceeded」这类关键线索
  const serverText = stringifyDetail((raw.data as { response?: unknown } | undefined)?.response)
  const detail = serverText ? `${message} ${serverText}` : message
  const status = raw.data?.statusCode ?? raw.status
  const code = (raw.code ?? raw.cause?.code ?? '').toUpperCase()

  // 1) HTTP 状态码最可靠
  if (typeof status === 'number' && status >= 400) {
    if (status === 403 && has(detail, /rate limit|secondary rate/i)) return build('rate-limit', ctx, err, { status })
    return build(statusKind(status), ctx, err, { status })
  }

  // 2) isomorphic-git 自己的错误名
  if (raw.name === 'PushRejectedError' || raw.code === 'PushRejectedError' || has(message, /not a simple fast-forward|non-fast-forward|PushRejected/i)) {
    return build('push-rejected', ctx, err)
  }
  if (raw.name === 'MergeNotSupportedError' || raw.code === 'MergeNotSupportedError') {
    // 没有共同祖先（isomorphic-git 不支持合并不相关历史）
    return build('history-unrelated', ctx, err)
  }
  if (raw.name === 'MergeConflictError' || raw.code === 'MergeConflictError' || has(message, /merge conflict|conflict/i)) {
    return build('conflict', ctx, err)
  }
  if (raw.name === 'NotFoundError') {
    return build(has(message, /refs\/heads|no ref|branch/i) ? 'branch' : 'not-found', ctx, err)
  }
  if (raw.name === 'HttpError' && typeof status === 'number') return build(statusKind(status), ctx, err, { status })

  // 3) 网络层 errno
  if (has(code, /^(ENOTFOUND|EAI_AGAIN|EAI_NODATA)$/)) return build('network-dns', ctx, err)
  if (has(code, /^(ECONNREFUSED)$/)) {
    return build(has(message, /127\.0\.0\.1|localhost/i) ? 'network-proxy' : 'network', ctx, err)
  }
  if (has(code, /^(ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/)) {
    return build('network-timeout', ctx, err)
  }
  if (has(code, /CERT|TLS|SSL|SELF_SIGNED/i)) return build('network-tls', ctx, err)

  // 4) 文本模式（浏览器只有 TypeError: Failed to fetch，信息量很低，所以放最后）
  if (has(message, /unable to verify|self signed|certificate|CERT_|ERR_TLS/i)) return build('network-tls', ctx, err)
  if (has(message, /getaddrinfo|ENOTFOUND|EAI_AGAIN/i)) return build('network-dns', ctx, err)
  if (has(message, /ECONNREFUSED|proxy|隧道|tunnel/i)) return build('network-proxy', ctx, err)
  if (has(message, /timeout|timed out|ETIMEDOUT/i)) return build('network-timeout', ctx, err)

  const isCors = has(detail, /CORS|Access-Control-Allow-Origin|cross-origin/i)
  const isFailedToFetch = has(detail, /Failed to fetch|NetworkError|Load failed/i)
  const isProxyFailure = has(detail, /cors\.isomorphic-git\.org|proxy/i)

  if (isCors) return build('cors-proxy', ctx, err)
  // 浏览器端所有请求都经过代理：裸的 Failed to fetch 只可能是代理挂了，
  // 不能报成「你的网络不通」
  if (isFailedToFetch) return build(ctx.runtime === 'tauri' ? 'adaptor' : 'cors-proxy', ctx, err)
  if (isProxyFailure && ctx.runtime === 'browser') return build('cors-proxy', ctx, err)
  if (isProxyFailure && ctx.corsProxy) return build('cors-proxy', ctx, err)

  return build('unknown', ctx, err)
}

/** 一行标题 + 一行说明，给窄条提示用 */
export function describeGitError(info: GitErrorInfo): string {
  const head = info.message && info.message !== info.title ? `${info.title}：${info.message}` : info.title
  return info.hint ? `${head}\n${info.hint}` : head
}

/** 复制给开发者/客服的报告：绝不包含 PAT */
export function formatErrorReport(info: GitErrorInfo, meta: Record<string, string | number | boolean | null> = {}): string {
  const token = typeof meta.token === 'string' ? meta.token : null
  // 敏感键直接不打印；其余键值也要过一遍脱敏，避免用户把 token 粘进 url
  const safeMeta = Object.entries(meta).filter(([key]) => !/token|pat|password|secret|credential/i.test(key))
  const lines = [
    `[ScholarBox 同步错误报告]`,
    `时间：${new Date().toISOString()}`,
    `分类：${info.kind}`,
    `标题：${info.title}`,
    info.status !== undefined ? `HTTP 状态：${info.status}` : null,
    info.url ? `URL：${redact(info.url, token)}` : null,
    info.code ? `错误码：${info.code}` : null,
    `信息：${redact(info.message, token)}`,
    info.cause ? `底层原因：${redact(info.cause, token)}` : null,
    `建议：${info.hint}`,
    ...safeMeta.map(([key, value]) => `${key}：${value ?? '（空）'}`),
    `凭据：已脱敏（不会包含 Token）`,
  ]
  return redact(lines.filter(Boolean).join('\n'), token)
}
