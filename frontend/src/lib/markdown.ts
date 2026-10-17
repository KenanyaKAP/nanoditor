/** Split a leading YAML front-matter block off a markdown document. */
export function splitFrontmatter(src: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { frontmatter: null, body: src }
  return { frontmatter: m[1], body: src.slice(m[0].length) }
}

/**
 * Turn Obsidian [[wikilinks]] into markdown links with a wikilink: scheme,
 * leaving fenced code blocks and inline code untouched. Embeds (![[x]]) render
 * as plain links too.
 */
export function wikilinksToMarkdown(src: string): string {
  const lines = src.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence !== null || !line.includes('[[')) continue
    lines[i] = line
      .split(/(`[^`]*`)/)
      .map((part) =>
        part.startsWith('`')
          ? part
          : part.replace(/!?\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
              const label = (alias ?? target).replace(/[[\]]/g, '')
              return `[${label}](wikilink:${encodeURIComponent(target.trim())})`
            }),
      )
      .join('')
  }
  return lines.join('\n')
}
