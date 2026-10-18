import { memo, useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { rawUrl } from '../api/client'
import { dirname, resolveFrom } from '../lib/path'
import { splitFrontmatter, wikilinksToMarkdown } from '../lib/markdown'

export interface MarkdownViewProps {
  content: string
  /** Absolute path of the file, for resolving relative links and images. */
  filePath: string
  onOpenPath?: (path: string) => void
  onWikiLink?: (name: string) => void
}

const WIKI = 'wikilink:'

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  position?: { start: { line: number }; end: { line: number } }
  children?: HastNode[]
}

const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'tr', 'hr'])

/**
 * Marks each block with the file lines it came from (data-line, data-end), so
 * switching to the editor can keep your place (editor/sourceLine.ts).
 * `offset` is the front matter's lines, which are cut off before parsing.
 */
function rehypeSourceLines({ offset }: { offset: number }) {
  const walk = (n: HastNode) => {
    if (n.type === 'element' && n.position && n.properties && blocks.has(n.tagName ?? '')) {
      n.properties.dataLine = n.position.start.line + offset
      n.properties.dataEnd = n.position.end.line + offset
    }
    n.children?.forEach(walk)
  }
  return walk
}

export const MarkdownView = memo(function MarkdownView({ content, filePath, onOpenPath, onWikiLink }: MarkdownViewProps) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content])
  const source = useMemo(() => wikilinksToMarkdown(body), [body])
  const offset = content.slice(0, content.length - body.length).split('\n').length - 1
  const dir = dirname(filePath)

  return (
    <div className="md px-4 py-3">
      {frontmatter && (
        <details className="mb-3 rounded-lg bg-raised px-3 py-2 text-sm" data-line={1} data-end={offset}>
          <summary className="cursor-pointer select-none text-muted">Properties</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{frontmatter}</pre>
        </details>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeSourceLines, { offset }],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        urlTransform={(url) => (url.startsWith(WIKI) ? url : defaultUrlTransform(url))}
        components={{
          a({ href = '', children, ...rest }) {
            if (href.startsWith(WIKI)) {
              const name = decodeURIComponent(href.slice(WIKI.length))
              return (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    onWikiLink?.(name)
                  }}
                >
                  {children}
                </a>
              )
            }
            const external = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
            if (external || href.startsWith('#')) {
              return (
                <a href={href} target={external ? '_blank' : undefined} rel="noreferrer" {...rest}>
                  {children}
                </a>
              )
            }
            const target = resolveFrom(dir, decodeURIComponent(href.split('#')[0]))
            return (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onOpenPath?.(target)
                }}
              >
                {children}
              </a>
            )
          },
          img({ src = '', alt }) {
            const external = /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')
            const url = external ? src : rawUrl(resolveFrom(dir, decodeURIComponent(src)))
            return <img src={url} alt={alt ?? ''} loading="lazy" />
          },
          input(props) {
            // Task list checkboxes are display-only here.
            return <input {...props} disabled />
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
})
