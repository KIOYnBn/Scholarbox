import { extractWikiLinks, splitWikiRef } from './wiki'
import type { VaultFS } from '@/lib/fs/types'

/**
 * 反向链接：扫全库笔记，找出谁用 `[[ ]]` 链到了当前笔记。
 * 匹配规则与 `useOpenWikiTarget` 的解析一致——完整路径、纯名字、文献夹名都认。
 */

export interface NoteDoc {
  /** 仓库内路径：`notes/x.md` 或 `papers/<dir>/<标题>.md` */
  file: string
  title: string
  /** 正文；反链扫描用它，改写场景可以不带 */
  body?: string
  kind: 'paper' | 'standalone'
  /** 文献笔记的目录（papers/<dir>） */
  dir?: string
}

export interface BacklinkEntry {
  source: NoteDoc
  /** 链接所在行号（1 起） */
  line: number
  /** 该行原文（截断，去掉引用前缀） */
  excerpt: string
}

/** 解析一个引用路径 → 指向的笔记文档；匹配规则与链接跳转一致（大小写不敏感） */
export function resolveWikiTarget(pathPart: string, docs: NoteDoc[]): NoteDoc | null {
  const clean = pathPart.replace(/^\.\//, '').trim().toLowerCase()
  if (!clean) return null
  for (const doc of docs) {
    if (doc.dir) {
      if (clean === doc.dir.toLowerCase()) return doc
      if (clean === `papers/${doc.dir}/${(doc.file.split('/').pop() ?? '').toLowerCase()}`) return doc
    }
    if (clean === doc.file.toLowerCase()) return doc
    if (clean === doc.file.replace(/\.md$/i, '').toLowerCase()) return doc
    // 只写了文件名（不含目录）：`[[目标]]` / `[[目标.md]]`
    const base = (doc.file.split('/').pop() ?? '').toLowerCase()
    if (base && clean === base) return doc
    if (base && clean === base.replace(/\.md$/i, '')) return doc
    if (clean === doc.title.toLowerCase()) return doc
  }
  return null
}

/** 一个 wiki 引用是否指向 target（块引用 `笔记#^id` 只看路径部分） */
function refMatchesTarget(ref: string, target: NoteDoc): boolean {
  const { path: pathPart } = splitWikiRef(ref)
  return resolveWikiTarget(pathPart, [target]) === target
}

function isFenceToggle(raw: string): boolean {
  return /^\s*(```|~~~)/.test(raw)
}

export function findBacklinks(target: NoteDoc, docs: NoteDoc[]): BacklinkEntry[] {
  const out: BacklinkEntry[] = []
  for (const doc of docs) {
    if (doc.file === target.file) continue
    let inFence = false;
    (doc.body ?? '').split(/\r?\n/).forEach((raw, index) => {
      if (isFenceToggle(raw)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      // 嵌入（![[...]]）也算一条反链 —— 与 Obsidian 一致
      const linked = extractWikiLinks(raw).some((ref) => refMatchesTarget(ref.path, target))
      if (linked) {
        out.push({
          source: doc,
          line: index + 1,
          excerpt: raw.replace(/^>\s?/, '').trim().slice(0, 100),
        })
      }
    })
  }
  return out
}

/**
 * 重命名笔记后更新全库引用：把指向 old 的 `[[链接]]` 改写为新名字 / 新路径，
 * 保持原有写法（纯名字 → 新标题，路径 → 新路径）与别名不动。
 * 返回改动后的文本与是否有变化。
 */
export function rewriteLinksForRename(
  markdown: string,
  old: NoteDoc,
  newTitle: string,
  newPath: string,
): { text: string; changed: boolean } {
  const parts = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
  let changed = false
  const text = parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(/(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (raw, bang: string, refRaw: string, alias?: string) => {
        const ref = refRaw.trim()
        if (!refMatchesTarget(ref, old)) return raw
        changed = true
        const isPath = ref.includes('/')
        const newRef = isPath ? newPath : newTitle
        return alias !== undefined ? `${bang}[[${newRef}|${alias}]]` : `${bang}[[${newRef}]]`
      })
    })
    .join('')
  return { text, changed }
}

/** 全库扫一遍：把指向 old 的引用改写为新名字。返回被改动的文件数。 */
export async function updateLinksAfterRename(
  vault: VaultFS,
  old: NoteDoc,
  newTitle: string,
  newPath: string,
): Promise<number> {
  const targets: string[] = []
  // 文献笔记现在以标题命名（meta.noteName），扫每个文献目录下的全部 .md
  const papers = await vault.list('papers').catch(() => [])
  for (const entry of papers) {
    if (entry.kind !== 'dir') continue
    const children = await vault.list(`papers/${entry.name}`).catch(() => [])
    for (const child of children) {
      if (child.kind === 'file' && /\.md$/i.test(child.name)) {
        targets.push(`papers/${entry.name}/${child.name}`)
      }
    }
  }
  const notes = await vault.list('notes').catch(() => [])
  for (const entry of notes) {
    if (entry.kind === 'file' && /\.md$/i.test(entry.name)) targets.push(`notes/${entry.name}`)
  }

  let updated = 0
  for (const path of targets) {
    if (path.toLowerCase() === old.file.toLowerCase()) continue
    const text = await vault.readText(path).catch(() => null)
    if (!text) continue
    const { text: next, changed } = rewriteLinksForRename(text, old, newTitle, newPath)
    if (changed) {
      await vault.writeText(path, next)
      updated += 1
    }
  }
  return updated
}
