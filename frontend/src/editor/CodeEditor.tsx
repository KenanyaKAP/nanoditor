import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  LanguageDescription,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { basename } from '../lib/path'

export interface CodeEditorProps {
  value: string
  filename: string
  onChange?: (value: string) => void
  readOnly?: boolean
  wrap?: boolean
  showLineNumbers?: boolean
  onView?: (view: EditorView | null) => void
  /** Bump to replace the document with `value` (e.g. after reload). */
  resetKey?: unknown
}

function isDark() {
  return document.documentElement.classList.contains('dark')
}

const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--fg))' },
  '.cm-content': { padding: '10px 0 40vh' },
  '.cm-line': { padding: '0 12px' },
  '.cm-activeLine': { backgroundColor: 'rgb(var(--raised) / 0.6)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgb(var(--raised) / 0.6)' },
})

function findLanguage(filename: string): LanguageDescription | null {
  const name = basename(filename)
  const byName = LanguageDescription.matchFilename(languages, name)
  if (byName) return byName
  if (/^dockerfile/i.test(name)) return LanguageDescription.matchLanguageName(languages, 'dockerfile')
  if (/^\.?env(\..*)?$/i.test(name)) return LanguageDescription.matchLanguageName(languages, 'shell')
  if (/^makefile$/i.test(name)) return LanguageDescription.matchLanguageName(languages, 'shell')
  return null
}

export function CodeEditor({
  value,
  filename,
  onChange,
  readOnly,
  wrap = true,
  showLineNumbers = true,
  onView,
  resetKey,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const comps = useRef({
    lang: new Compartment(),
    wrap: new Compartment(),
    gutter: new Compartment(),
    theme: new Compartment(),
    readOnly: new Compartment(),
  })

  // Create the view once.
  useEffect(() => {
    const c = comps.current
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      baseTheme,
      c.lang.of([]),
      c.wrap.of(wrap ? EditorView.lineWrapping : []),
      c.gutter.of(showLineNumbers ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : []),
      c.theme.of(isDark() ? oneDark : []),
      c.readOnly.of(readOnlyExt(!!readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
      }),
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
    ]
    const v = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current!,
    })
    view.current = v
    onView?.(v)

    // Follow theme changes (the html.dark class).
    const obs = new MutationObserver(() => {
      v.dispatch({ effects: c.theme.reconfigure(isDark() ? oneDark : []) })
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      obs.disconnect()
      onView?.(null)
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Replace the document on reset.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  useEffect(() => {
    view.current?.dispatch({
      effects: comps.current.gutter.reconfigure(
        showLineNumbers ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : [],
      ),
    })
  }, [showLineNumbers])

  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.readOnly.reconfigure(readOnlyExt(!!readOnly)) })
  }, [readOnly])

  useEffect(() => {
    let cancelled = false
    const desc = findLanguage(filename)
    if (!desc) {
      view.current?.dispatch({ effects: comps.current.lang.reconfigure([]) })
      return
    }
    desc.load().then((support) => {
      if (!cancelled) view.current?.dispatch({ effects: comps.current.lang.reconfigure(support) })
    })
    return () => {
      cancelled = true
    }
  }, [filename])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}

function readOnlyExt(ro: boolean): Extension {
  // Non-editable views don't summon the iOS keyboard.
  return ro ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [highlightActiveLine()]
}
