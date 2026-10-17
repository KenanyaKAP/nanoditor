import type { LogCommit } from '../../api/types'

// VS Code's Source Control Graph colors.
export const REF_COLOR = '#59a4f9' // the checked-out branch
export const REMOTE_COLOR = '#b180d7' // its upstream
export const LANE_COLORS = ['#ffb000', '#dc267f', '#994f00', '#40b0a6', '#b66dff']

/** A vertical line in the graph, waiting for the commit `id` further down. */
export interface Lane {
  id: string
  color: string
}

/** One commit with the lanes entering its row from above and leaving below. */
export interface GraphRow {
  commit: LogCommit
  inputs: Lane[]
  outputs: Lane[]
}

/** The color a commit's own refs give its lane, if any. */
export function refColor(c: LogCommit): string | undefined {
  if (c.head || c.refs?.some((r) => r.current)) return REF_COLOR
  if (c.refs?.some((r) => r.upstream)) return REMOTE_COLOR
  return undefined
}

/**
 * Assign lanes to commits listed newest first in topological order. A commit
 * takes the lane that was waiting for it and hands it to its first parent;
 * other lanes waiting for it end there, and extra (merge) parents open new
 * lanes on the right.
 */
export function layoutGraph(commits: LogCommit[]): GraphRow[] {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  let rot = -1
  const nextColor = () => LANE_COLORS[(rot = (rot + 1) % LANE_COLORS.length)]
  const rows: GraphRow[] = []
  let lanes: Lane[] = []
  for (const c of commits) {
    const inputs = lanes
    const outputs: Lane[] = []
    let continued = false
    for (const lane of inputs) {
      if (lane.id !== c.hash) outputs.push(lane)
      else if (!continued && c.parents.length > 0) {
        // The current branch's line stays blue below its upstream.
        outputs.push({ id: c.parents[0], color: lane.color === REF_COLOR ? REF_COLOR : (refColor(c) ?? lane.color) })
        continued = true
      }
    }
    for (let i = continued ? 1 : 0; i < c.parents.length; i++) {
      const parent = byHash.get(c.parents[i])
      const color = (i === 0 ? refColor(c) : parent && refColor(parent)) || nextColor()
      outputs.push({ id: c.parents[i], color })
    }
    rows.push({ commit: c, inputs, outputs })
    lanes = outputs
  }
  return rows
}

export const ROW_H = 56
export const LANE_W = 12
const PAD = 14
const MID = ROW_H / 2
const R = 6

export const laneX = (i: number) => PAD + i * LANE_W

export interface RowShape {
  width: number
  strokes: { d: string; color: string }[]
  dot: { x: number; color: string; kind: 'head' | 'merge' | 'commit' }
}

/** SVG paths for one row: lanes passing through, merging in, and the commit dot. */
export function rowShape({ commit: c, inputs, outputs }: GraphRow): RowShape {
  const inputIndex = inputs.findIndex((l) => l.id === c.hash)
  const ci = inputIndex >= 0 ? inputIndex : inputs.length
  const cx = laneX(ci)
  const color = (c.parents.length ? outputs[ci]?.color : undefined) ?? inputs[ci]?.color ?? refColor(c) ?? REF_COLOR
  const strokes: RowShape['strokes'] = []

  let out = 0
  inputs.forEach((lane, i) => {
    const x = laneX(i)
    if (lane.id === c.hash) {
      if (i === ci) {
        if (c.parents.length) out++
        return
      }
      // Another lane ends at this commit: curve in from the right.
      strokes.push({
        color: lane.color,
        d: `M ${x} 0 V ${MID - LANE_W} A ${LANE_W} ${LANE_W} 0 0 1 ${x - LANE_W} ${MID} H ${cx}`,
      })
      return
    }
    const to = out++
    const tx = laneX(to)
    strokes.push({
      color: lane.color,
      d:
        to === i
          ? `M ${x} 0 V ${ROW_H}`
          : // A lane to its left ended: shift over.
            `M ${x} 0 V ${MID - R} A ${R} ${R} 0 0 1 ${x - R} ${MID} H ${tx + R} A ${R} ${R} 0 0 0 ${tx} ${MID + R} V ${ROW_H}`,
    })
  })

  // Merge parents branch off to the right.
  for (const parent of c.parents.slice(1)) {
    let k = -1
    for (let i = outputs.length - 1; i >= 0; i--) {
      if (outputs[i].id === parent) {
        k = i
        break
      }
    }
    if (k < 0) continue
    const kx = laneX(k)
    strokes.push({
      color: outputs[k].color,
      d: `M ${cx} ${MID} H ${kx - LANE_W} A ${LANE_W} ${LANE_W} 0 0 1 ${kx} ${MID + LANE_W} V ${ROW_H}`,
    })
  }

  if (inputIndex >= 0) strokes.push({ color: inputs[inputIndex].color, d: `M ${cx} 0 V ${MID}` })
  if (c.parents.length) strokes.push({ color, d: `M ${cx} ${MID} V ${ROW_H}` })

  return {
    width: laneX(Math.max(inputs.length, outputs.length, 1) - 1) + LANE_W,
    strokes,
    dot: { x: cx, color, kind: c.head ? 'head' : c.parents.length > 1 ? 'merge' : 'commit' },
  }
}
