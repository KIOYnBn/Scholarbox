import { describe, expect, it } from 'vitest'
import {
  GitOperationError,
  HttpAdaptorError,
  classifyGitError,
  describeGitError,
  formatErrorReport,
  redact,
  type GitErrorContext,
} from '../errors'

const ctx: GitErrorContext = {
  action: 'push',
  url: 'https://github.com/me/repo.git',
  runtime: 'tauri',
  token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  branch: 'main',
}

const named = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(name), { name }, extra)

describe('redact', () => {
  it('抹掉 PAT 与 Authorization 头', () => {
    const text = 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 Authorization: Bearer abc.def'
    const out = redact(text, 'ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('abc.def')
    expect(out).toMatch(/<PAT>|已隐|\*\*\*/)
  })

  it('抹掉 URL 里的 user:pass@', () => {
    expect(redact('https://user:secret@github.com/x/y.git')).not.toContain('secret')
  })

  it('抹掉 github_pat_ 与 x-access-token', () => {
    const out = redact('github_pat_11ABCDEFG0 x-access-token:ghp_zzzzzzzzzzzzzzzzz')
    expect(out).not.toContain('github_pat_11ABCDEFG0')
    expect(out).not.toContain('ghp_zzzzzzzzzzzzzzzzz')
  })
})

describe('classifyGitError', () => {
  it('401 → auth，并给出 token 建议', () => {
    const info = classifyGitError(named('HttpError', { data: { statusCode: 401 } }), ctx)
    expect(info.kind).toBe('auth')
    expect(info.status).toBe(401)
    expect(info.hint).toMatch(/Token/i)
    expect(info.title).not.toMatch(/网络不通/)
  })

  it('403 + rate limit → rate-limit', () => {
    const info = classifyGitError(
      named('HttpError', { data: { statusCode: 403, response: 'API rate limit exceeded' } }),
      ctx,
    )
    expect(info.kind).toBe('rate-limit')
  })

  it('404 → not-found，提示仓库名/权限', () => {
    const info = classifyGitError(named('HttpError', { data: { statusCode: 404 } }), ctx)
    expect(info.kind).toBe('not-found')
    expect(info.hint).toMatch(/仓库/)
  })

  it('MergeConflictError → conflict', () => {
    const info = classifyGitError(named('MergeConflictError'), ctx)
    expect(info.kind).toBe('conflict')
  })

  it('PushRejectedError → push-rejected（不是「未知错误」）', () => {
    const info = classifyGitError(
      Object.assign(new Error('Push rejected because it was not a simple fast-forward. Use "force: true" to override.'), {
        name: 'PushRejectedError',
        code: 'PushRejectedError',
        data: { reason: 'not-fast-forward' },
      }),
      ctx,
    )
    expect(info.kind).toBe('push-rejected')
    expect(info.kind).not.toBe('unknown')
  })

  it('MergeNotSupportedError（无关历史）→ history-unrelated', () => {
    const info = classifyGitError(named('MergeNotSupportedError'), ctx)
    expect(info.kind).toBe('history-unrelated')
    expect(info.hint).toMatch(/远端|历史/)
  })

  it('桌面端 TypeError: Failed to fetch → adaptor（不是 network）', () => {
    const info = classifyGitError(new TypeError('Failed to fetch'), ctx)
    expect(info.kind).toBe('adaptor')
  })

  it('浏览器端 CORS → cors-proxy', () => {
    const info = classifyGitError(
      new TypeError('Failed to fetch'),
      { ...ctx, runtime: 'browser', corsProxy: 'https://cors.isomorphic-git.org' },
    )
    expect(info.kind).toBe('cors-proxy')
    expect(info.hint).toMatch(/代理/)
  })

  it('ENOTFOUND → network-dns', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), {
      cause: { code: 'ENOTFOUND' },
    })
    expect(classifyGitError(err, ctx).kind).toBe('network-dns')
  })

  it('ETIMEDOUT → network-timeout', () => {
    const err = Object.assign(new Error('timeout'), { cause: { code: 'ETIMEDOUT' } })
    expect(classifyGitError(err, ctx).kind).toBe('network-timeout')
  })

  it('CERT_HAS_EXPIRED → network-tls', () => {
    const err = Object.assign(new Error('tls'), { cause: { code: 'CERT_HAS_EXPIRED' } })
    expect(classifyGitError(err, ctx).kind).toBe('network-tls')
  })

  it('HttpAdaptorError(stage=plugin) 原样归类为 adaptor', () => {
    const info = classifyGitError(new HttpAdaptorError('plugin', 'plugin failed', ctx.url ?? ''), ctx)
    expect(info.kind).toBe('adaptor')
    expect(info.url).toBe(ctx.url)
  })

  it('GitOperationError 直接复用其 info', () => {
    const info = classifyGitError(
      new GitOperationError({ kind: 'branch', title: '分支不存在', message: 'x', hint: 'y', retryable: false }),
      ctx,
    )
    expect(info.kind).toBe('branch')
  })
})

describe('describeGitError / formatErrorReport', () => {
  it('描述包含标题与建议', () => {
    const info = classifyGitError(named('HttpError', { data: { statusCode: 401 } }), ctx)
    const text = describeGitError(info)
    expect(text).toContain(info.title)
    expect(text).toContain(info.hint)
  })

  it('报告里不含 PAT，且标注已脱敏', () => {
    const info = classifyGitError(named('HttpError', { data: { statusCode: 401 } }), ctx)
    const report = formatErrorReport(info, {
      action: 'push',
      url: ctx.url ?? '',
      branch: 'main',
      token: ctx.token ?? '',
    })
    expect(report).not.toContain(ctx.token ?? '<none>')
    expect(report).toContain('已脱敏')
    expect(report).toContain('push')
  })
})
