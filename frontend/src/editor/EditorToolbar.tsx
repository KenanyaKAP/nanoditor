import type { ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { redo, undo, indentMore, indentLess } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import {
  Bold,
  Code,
  Heading,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  Quote,
  Redo2,
  Search,
  Undo2,
  Brackets,
  ChevronDown,
} from 'lucide-react'
import { insertSpec, linePrefixSpec, linkSpec, wrapSpec } from './mdCommands'

type Action = { key: string; label: string; content: ReactNode; run: (v: EditorView) => void }

const dispatch = (v: EditorView, spec: Parameters<EditorView['dispatch']>[0]) => {
  v.dispatch(spec)
  v.focus()
}

const common: Action[] = [
  { key: 'undo', label: 'Undo', content: <Undo2 className="h-[18px] w-[18px]" />, run: (v) => undo(v) },
  { key: 'redo', label: 'Redo', content: <Redo2 className="h-[18px] w-[18px]" />, run: (v) => redo(v) },
]

const mdActions: Action[] = [
  { key: 'h', label: 'Heading', content: <Heading className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, linePrefixSpec(v.state, '## ')) },
  { key: 'b', label: 'Bold', content: <Bold className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, wrapSpec(v.state, '**', '**', 'bold')) },
  { key: 'i', label: 'Italic', content: <Italic className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, wrapSpec(v.state, '_', '_', 'italic')) },
  { key: 'ul', label: 'List', content: <List className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, linePrefixSpec(v.state, '- ')) },
  { key: 'task', label: 'Checkbox', content: <ListChecks className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, linePrefixSpec(v.state, '- [ ] ')) },
  { key: 'link', label: 'Link', content: <Link className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, linkSpec(v.state)) },
  { key: 'wiki', label: 'Wikilink', content: <Brackets className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, wrapSpec(v.state, '[[', ']]', 'Note')) },
  { key: 'code', label: 'Code', content: <Code className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, wrapSpec(v.state, '`', '`', 'code')) },
  { key: 'quote', label: 'Quote', content: <Quote className="h-[18px] w-[18px]" />, run: (v) => dispatch(v, linePrefixSpec(v.state, '> ')) },
  { key: 'out', label: 'Outdent', content: <IndentDecrease className="h-[18px] w-[18px]" />, run: (v) => indentLess(v) },
  { key: 'in', label: 'Indent', content: <IndentIncrease className="h-[18px] w-[18px]" />, run: (v) => indentMore(v) },
]

const chars = ['{', '}', '[', ']', '(', ')', '<', '>', '"', "'", '`', ';', ':', '=', '/', '\\', '|', '&', '!', '-', '_', '#', '$', '*']

const codeActions: Action[] = [
  { key: 'tab', label: 'Tab', content: <span className="text-xs font-semibold">TAB</span>, run: (v) => indentMore(v) },
  { key: 'untab', label: 'Outdent', content: <IndentDecrease className="h-[18px] w-[18px]" />, run: (v) => indentLess(v) },
  { key: 'find', label: 'Find', content: <Search className="h-[18px] w-[18px]" />, run: (v) => openSearchPanel(v) },
  ...chars.map((c) => ({
    key: 'c' + c,
    label: c,
    content: <span className="font-mono text-[15px]">{c}</span>,
    run: (v: EditorView) => dispatch(v, insertSpec(v.state, c)),
  })),
]

/**
 * A row of editing shortcuts that sits at the bottom of the editor, i.e. just
 * above the iOS keyboard (the shell shrinks to the visual viewport).
 * Buttons use onPointerDown + preventDefault so the editor keeps focus.
 */
export function EditorToolbar({
  view,
  mode,
  onDone,
}: {
  view: EditorView | null
  mode: 'markdown' | 'code'
  onDone?: () => void
}) {
  const actions = [...common, ...(mode === 'markdown' ? mdActions : codeActions)]
  return (
    <div className="flex shrink-0 items-center border-t border-line bg-raised px-safe">
      <div className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
        {actions.map((a) => (
          <button
            key={a.key}
            aria-label={a.label}
            className="flex h-11 min-w-[42px] shrink-0 items-center justify-center px-2 text-fg active:bg-line"
            onPointerDown={(e) => {
              e.preventDefault()
              if (view) a.run(view)
            }}
          >
            {a.content}
          </button>
        ))}
      </div>
      {onDone && (
        <button
          aria-label="Hide keyboard"
          className="flex h-11 w-11 shrink-0 items-center justify-center border-l border-line text-muted active:bg-line"
          onPointerDown={(e) => {
            e.preventDefault()
            view?.contentDOM.blur()
            onDone()
          }}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
