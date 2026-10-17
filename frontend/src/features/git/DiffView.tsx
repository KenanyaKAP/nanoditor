import type { ReactNode } from 'react'
import type { FileDiff, Hunk } from '../../api/types'
import { cx } from '../../lib/util'

export function HunkView({ hunk, actions }: { hunk: Hunk; actions?: ReactNode }) {
  const section = hunk.header.replace(/^@@[^@]*@@\s?/, '')
  return (
    <div className="border-b border-line">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-raised/95 px-3 py-1.5 backdrop-blur">
        <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
          {section && <span className="ml-2 text-fg/70">{section}</span>}
        </div>
        {actions}
      </div>
      <div className="font-mono text-[12px] leading-[1.45]">
        {hunk.lines.map((l, i) =>
          l.t === '\\' ? (
            <div key={i} className="px-3 text-[11px] italic text-muted">
              {l.s}
            </div>
          ) : (
            <div
              key={i}
              className={cx(
                'flex',
                l.t === '+' && 'bg-[rgb(var(--add-bg)/0.12)]',
                l.t === '-' && 'bg-[rgb(var(--del-bg)/0.12)]',
              )}
            >
              <span className="w-9 shrink-0 select-none pr-1 text-right text-[10px] leading-[1.75] text-muted/70">
                {l.o ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none pr-1 text-right text-[10px] leading-[1.75] text-muted/70">
                {l.n ?? ''}
              </span>
              <span
                className={cx(
                  'w-4 shrink-0 select-none text-center',
                  l.t === '+' && 'text-add',
                  l.t === '-' && 'text-del',
                )}
              >
                {l.t === ' ' ? '' : l.t}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{l.s || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function DiffBody({ diff, hunkActions }: { diff: FileDiff; hunkActions?: (h: Hunk) => ReactNode }) {
  if (diff.tooLarge) return <div className="px-4 py-10 text-center text-sm text-muted">Diff is too large to show.</div>
  if (diff.binary) return <div className="px-4 py-10 text-center text-sm text-muted">Binary file changed.</div>
  if (diff.hunks.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted">
        {diff.status === 'renamed' ? 'Renamed without content changes.' : 'No content changes (mode or whitespace only).'}
      </div>
    )
  }
  return (
    <div>
      {diff.hunks.map((h) => (
        <HunkView key={h.id} hunk={h} actions={hunkActions?.(h)} />
      ))}
    </div>
  )
}
