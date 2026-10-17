import { describe, expect, it } from 'vitest'
import type { LogCommit } from '../../api/types'
import { LANE_COLORS, REF_COLOR, REMOTE_COLOR, layoutGraph, laneX, rowShape } from './graph'

const commit = (hash: string, parents: string[], extra: Partial<LogCommit> = {}): LogCommit => ({
  hash,
  short: hash,
  author: 't',
  time: 0,
  subject: hash,
  parents,
  ...extra,
})

describe('layoutGraph', () => {
  // M merges B into A; both come from R. HEAD is on M.
  const rows = layoutGraph([
    commit('M', ['A', 'B'], { head: true, refs: [{ name: 'main', kind: 'branch', current: true }] }),
    commit('A', ['R']),
    commit('B', ['R']),
    commit('R', []),
  ])

  it('keeps the first parent in the commit lane and opens a lane for the merge parent', () => {
    expect(rows[0].outputs).toEqual([
      { id: 'A', color: REF_COLOR },
      { id: 'B', color: LANE_COLORS[0] },
    ])
    expect(rows[1].outputs.map((l) => l.id)).toEqual(['R', 'B'])
    expect(rows[2].outputs.map((l) => l.id)).toEqual(['R', 'R'])
    expect(rows[3].outputs).toEqual([])
  })

  it('draws the merge, the side lane ending, and the dot kinds', () => {
    const merge = rowShape(rows[0])
    expect(merge.dot).toEqual({ x: laneX(0), color: REF_COLOR, kind: 'head' })
    expect(merge.strokes.some((s) => s.color === LANE_COLORS[0] && s.d.startsWith(`M ${laneX(0)} 28 H`))).toBe(true)

    const side = rowShape(rows[2])
    expect(side.dot.x).toBe(laneX(1))

    const root = rowShape(rows[3])
    expect(root.dot).toMatchObject({ x: laneX(0), kind: 'commit' })
    // The side lane curves into the root from lane 1.
    expect(root.strokes.some((s) => s.d.startsWith(`M ${laneX(1)} 0`) && s.d.endsWith(`H ${laneX(0)}`))).toBe(true)
  })
})

describe('upstream colors', () => {
  const upstream = { name: 'origin/main', kind: 'remote' as const, upstream: true }

  it('keeps the current branch blue below its upstream when ahead', () => {
    const rows = layoutGraph([commit('H', ['U'], { head: true }), commit('U', ['R'], { refs: [upstream] }), commit('R', [])])
    expect(rows[1].outputs[0].color).toBe(REF_COLOR)
  })

  it('shows commits to pull in purple when behind', () => {
    const rows = layoutGraph([commit('U', ['H'], { refs: [upstream] }), commit('H', ['R'], { head: true }), commit('R', [])])
    expect(rows[0].outputs[0].color).toBe(REMOTE_COLOR)
    expect(rows[1].outputs[0].color).toBe(REF_COLOR)
  })
})
