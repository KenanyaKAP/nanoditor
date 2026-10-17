export function basename(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i >= 0 ? t.slice(i + 1) : t
}

export function dirname(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  if (i <= 0) return '/'
  return t.slice(0, i)
}

export function join(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/')
  return normalize(joined)
}

export function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/')
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}

/** Path of p relative to base, or null if p is not inside base. */
export function relative(base: string, p: string): string | null {
  const b = base.replace(/\/+$/, '')
  if (p === b) return ''
  if (p.startsWith(b + '/')) return p.slice(b.length + 1)
  return null
}

/** Replace the home directory prefix with ~ for display. */
export function tildify(p: string, home?: string): string {
  if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length)
  return p
}

export function isMarkdown(p: string): boolean {
  const e = extname(p)
  return e === 'md' || e === 'markdown' || e === 'mdx'
}

/** Resolve a link target (relative or absolute) found inside a file. */
export function resolveFrom(fileDir: string, target: string): string {
  if (target.startsWith('/')) return normalize(target)
  return join(fileDir, target)
}
