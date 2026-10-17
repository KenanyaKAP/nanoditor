import { describe, expect, it } from 'vitest'
import { splitFrontmatter, wikilinksToMarkdown } from './markdown'
import { join, relative, resolveFrom, tildify } from './path'
import { EditorState, EditorSelection } from '@codemirror/state'
import { linePrefixSpec, wrapSpec } from '../editor/mdCommands'

describe('wikilinks', () => {
  it('converts links with and without aliases', () => {
    expect(wikilinksToMarkdown('see [[My Note]] and [[a/b|B]]')).toBe(
      'see [My Note](wikilink:My%20Note) and [B](wikilink:a%2Fb)',
    )
  })
  it('leaves code untouched', () => {
    const src = '`[[x]]` [[y]]\n```\n[[z]]\n```'
    expect(wikilinksToMarkdown(src)).toBe('`[[x]]` [y](wikilink:y)\n```\n[[z]]\n```')
  })
})

describe('frontmatter', () => {
  it('splits a yaml block', () => {
    expect(splitFrontmatter('---\ntags: [a]\n---\n# Hi')).toEqual({ frontmatter: 'tags: [a]', body: '# Hi' })
    expect(splitFrontmatter('# Hi').frontmatter).toBeNull()
  })
})

describe('paths', () => {
  it('joins and relativises', () => {
    expect(join('/a/b', '../c', 'd.md')).toBe('/a/c/d.md')
    expect(relative('/a/b', '/a/b/c/d')).toBe('c/d')
    expect(relative('/a/b', '/a/bc')).toBeNull()
    expect(resolveFrom('/v/notes', './img/x.png')).toBe('/v/notes/img/x.png')
    expect(tildify('/home/ken/x', '/home/ken')).toBe('~/x')
  })
})

describe('markdown commands', () => {
  const apply = (doc: string, from: number, to: number, f: (s: EditorState) => any) => {
    const s = EditorState.create({ doc, selection: EditorSelection.single(from, to) })
    return s.update(f(s)).state.doc.toString()
  }
  it('wraps and unwraps', () => {
    expect(apply('hello', 0, 5, (s) => wrapSpec(s, '**'))).toBe('**hello**')
    expect(apply('**hello**', 2, 7, (s) => wrapSpec(s, '**'))).toBe('hello')
  })
  it('toggles line prefixes', () => {
    expect(apply('a\nb', 0, 3, (s) => linePrefixSpec(s, '- '))).toBe('- a\n- b')
    expect(apply('- a\n- b', 0, 7, (s) => linePrefixSpec(s, '- '))).toBe('a\nb')
    expect(apply('- a', 0, 0, (s) => linePrefixSpec(s, '- [ ] '))).toBe('- [ ] a')
  })
})
