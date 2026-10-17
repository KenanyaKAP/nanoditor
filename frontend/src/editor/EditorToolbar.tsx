import { useState, type ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineUp,
  indentLess,
  indentMore,
  redo,
  selectCharLeft,
  selectCharRight,
  selectLineDown,
  selectLineUp,
  undo,
} from '@codemirror/commands'
import { openSearchPanel, selectNextOccurrence } from '@codemirror/search'
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Save,
  TextSelect,
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
import { keyClass, pressProps, RepeatButton } from '../components/press'
import { cx } from '../lib/util'
import { insertSpec, linePrefixSpec, linkSpec, wrapSpec } from './mdCommands'

type Action = { key: string; label: string; content: ReactNode; run: (v: EditorView) => void }

const dispatch = (v: EditorView, spec: Parameters<EditorView['dispatch']>[0]) => {
  v.dispatch(spec)
  v.focus()
}

const common: Action[] = [
  {
    key: 'next',
    label: 'Select next match (Cmd+D)',
    content: <TextSelect className="h-[18px] w-[18px]" />,
    run: (v) => selectNextOccurrence(v),
  },
  { key: 'find', label: 'Find and replace', content: <Search className="h-[18px] w-[18px]" />, run: (v) => openSearchPanel(v) },
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
  ...chars.map((c) => ({
    key: 'c' + c,
    label: c,
    content: <span className="font-mono text-[15px]">{c}</span>,
    run: (v: EditorView) => dispatch(v, insertSpec(v.state, c)),
  })),
]

// Arrow keys: move the cursor, or extend the selection while Shift is on.
const arrows = [
  { key: 'left', label: 'Left', Icon: ArrowLeft, move: cursorCharLeft, select: selectCharLeft },
  { key: 'up', label: 'Up', Icon: ArrowUp, move: cursorLineUp, select: selectLineUp },
  { key: 'down', label: 'Down', Icon: ArrowDown, move: cursorLineDown, select: selectLineDown },
  { key: 'right', label: 'Right', Icon: ArrowRight, move: cursorCharRight, select: selectCharRight },
]

/**
 * A row of editing shortcuts that sits at the bottom of the editor, i.e. just
 * above the iOS keyboard (the shell shrinks to the visual viewport).
 */
export function EditorToolbar({
  view,
  mode,
  onDone,
  onSave,
  dirty,
}: {
  view: EditorView | null
  mode: 'markdown' | 'code'
  onDone?: () => void
  /** Shows a Save button first in the row, under the thumb (manual saving). */
  onSave?: () => void
  dirty?: boolean
}) {
  const [shift, setShift] = useState(false)
  const actions = [...common, ...(mode === 'markdown' ? mdActions : codeActions)]
  return (
    <div className="flex shrink-0 items-center border-t border-line bg-raised px-safe">
      {onSave && (
        <button
          aria-label="Save"
          disabled={!dirty}
          className="flex h-11 shrink-0 select-none items-center gap-1.5 border-r border-line px-3 text-sm font-semibold text-accent active:bg-line disabled:text-muted"
          {...pressProps(() => dirty && onSave())}
        >
          <Save className="h-[18px] w-[18px]" />
          Save
        </button>
      )}
      <div className="no-scrollbar flex min-w-0 flex-1 touch-pan-x overflow-x-auto">
        <button
          aria-label="Shift: arrows select"
          aria-pressed={shift}
          className={cx(keyClass, shift && 'bg-accent text-accent-fg active:bg-accent')}
          {...pressProps(() => setShift(!shift))}
        >
          <ArrowBigUp className="h-[18px] w-[18px]" />
        </button>
        {arrows.map((a) => (
          <RepeatButton key={a.key} label={a.label} onFire={() => view && (shift ? a.select : a.move)(view)}>
            <a.Icon className="h-[18px] w-[18px]" />
          </RepeatButton>
        ))}
        {actions.map((a) => (
          <button key={a.key} aria-label={a.label} className={keyClass} {...pressProps(() => view && a.run(view))}>
            {a.content}
          </button>
        ))}
      </div>
      {onDone && (
        <button
          aria-label="Hide keyboard"
          className="flex h-11 w-11 shrink-0 select-none items-center justify-center border-l border-line text-muted active:bg-line"
          {...pressProps(() => {
            view?.contentDOM.blur()
            onDone()
          })}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
