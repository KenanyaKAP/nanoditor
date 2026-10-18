import { EditorView } from '@codemirror/view'

// Your place in a Markdown file as a source line plus a fraction (12.5 is
// halfway through line 12). The rendered view and the editor lay the text out
// differently, so this is what carries over when switching between them.
// Rendered blocks carry their lines as data-line and data-end (MarkdownView).
// 0 means the very top.

/** The line at the top of the rendered view. */
export function renderedLine(root: HTMLElement, scroller: HTMLElement): number {
  if (scroller.scrollTop <= 0) return 0
  const top = scroller.getBoundingClientRect().top
  let line = 0
  for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const r = el.getBoundingClientRect()
    // A pixel of slack, as layout positions are fractional.
    if (r.top > top + 1) break
    const start = Number(el.dataset.line)
    const lines = Number(el.dataset.end) - start + 1
    line = start + Math.max(0, Math.min(1, (top - r.top) / Math.max(r.height, 1))) * lines
  }
  return line
}

/** Scroll the rendered view so the line is at the top. */
export function scrollRenderedTo(root: HTMLElement, scroller: HTMLElement, line: number) {
  const top = scroller.getBoundingClientRect().top
  let y: number | null = null
  // Blocks come in source order; the last one starting at or before the line holds it.
  for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const start = Number(el.dataset.line)
    if (start > line) break
    const r = el.getBoundingClientRect()
    const lines = Number(el.dataset.end) - start + 1
    y = r.top + Math.min(1, (line - start) / lines) * r.height
  }
  scroller.scrollTop = line < 1 || y === null ? 0 : scroller.scrollTop + y - top
}

/** The line at the top of the editor. */
export function editorLine(view: EditorView): number {
  if (view.scrollDOM.scrollTop <= 0) return 0
  const h = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  const block = view.lineBlockAtHeight(h)
  const frac = Math.max(0, Math.min(1, (h - block.top) / Math.max(block.height, 1)))
  return view.state.doc.lineAt(block.from).number + frac
}

/** Scroll the editor so the line is at the top. A long wrapped line is entered part way. */
export function scrollEditorTo(view: EditorView, line: number) {
  const doc = view.state.doc
  const n = Math.floor(line)
  if (n < 1) {
    view.scrollDOM.scrollTop = 0
    return
  }
  const pos = n > doc.lines ? doc.length : doc.line(n).from + Math.round((line - n) * doc.line(n).length)
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 0 }) })
}
