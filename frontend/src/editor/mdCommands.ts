import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

/** Wrap each selection in before/after, or unwrap if already wrapped. */
export function wrapSpec(state: EditorState, before: string, after = before, placeholder = ''): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const outerFrom = range.from - before.length
    const outerTo = range.to + after.length
    if (
      outerFrom >= 0 &&
      state.sliceDoc(outerFrom, range.from) === before &&
      state.sliceDoc(range.to, outerTo) === after
    ) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: '' },
          { from: range.to, to: outerTo, insert: '' },
        ],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      }
    }
    const inner = text || placeholder
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    }
  })
}

/**
 * Toggle a line prefix ("# ", "- ", "- [ ] ", "> ") on every line touched by
 * the selection. Any existing list/heading/quote marker is replaced.
 */
export function linePrefixSpec(state: EditorState, prefix: string): TransactionSpec {
  const marker = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+\. |> )?/
  const changes: { from: number; to: number; insert: string }[] = []
  const seen = new Set<number>()
  let allHave = true
  const lines = []
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        lines.push(line)
        const m = marker.exec(line.text)!
        if ((m[2] ?? '') !== prefix) allHave = false
      }
      pos = line.to + 1
    }
  }
  for (const line of lines) {
    const m = marker.exec(line.text)!
    const indent = m[1] ?? ''
    const existing = m[2] ?? ''
    changes.push({
      from: line.from + indent.length,
      to: line.from + indent.length + existing.length,
      insert: allHave ? '' : prefix,
    })
  }
  return { changes }
}

export function insertSpec(state: EditorState, text: string, cursorOffset = text.length): TransactionSpec {
  return state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + cursorOffset),
  }))
}

/** Insert a markdown link around the selection; cursor lands in the URL. */
export function linkSpec(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || 'link'
    const insert = `[${text}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })
}
