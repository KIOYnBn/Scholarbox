/**
 * Small, dependency-free POSIX-style path helpers.
 * Every path inside a vault is stored relative to the vault root with `/` separators,
 * and never starts with a slash.
 */

export function normalize(rel: string): string {
  const parts: string[] = []
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/')
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join('/'))
}

export function dirname(rel: string): string {
  const norm = normalize(rel)
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? '' : norm.slice(0, idx)
}

export function basename(rel: string): string {
  const norm = normalize(rel)
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? norm : norm.slice(idx + 1)
}

export function extname(rel: string): string {
  const base = basename(rel)
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx).toLowerCase()
}

export function stem(rel: string): string {
  const base = basename(rel)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

/** Strip characters that are illegal in Windows filenames (vaults must stay portable). */
export function sanitizeSegment(input: string, fallback = 'untitled'): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  const safe = cleaned.slice(0, 80).trim()
  return safe.length > 0 ? safe : fallback
}

export function uniqueName(existing: Set<string>, candidate: string): string {
  if (!existing.has(candidate)) return candidate
  let i = 2
  while (existing.has(`${candidate}-${i}`)) i += 1
  return `${candidate}-${i}`
}
