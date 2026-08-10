import { describe, expect, it } from 'vitest'

import type { Point } from '../model/scene'
import { planDrag, positionAt } from './drag-plan'

interface World {
  readonly positions: Record<string, Point>
  readonly members: Record<string, readonly string[]>
}

function plannerFor(world: World) {
  return (pressedId: string, selection: readonly string[] = []) =>
    planDrag({
      pressedId,
      selection: new Set(selection),
      membersOf: (id) => world.members[id],
      positionOf: (id) => world.positions[id],
    })
}

const WORLD: World = {
  positions: {
    frame: { x: 0, y: 0 },
    a: { x: 10, y: 10 },
    b: { x: 20, y: 20 },
    loner: { x: 99, y: 99 },
    other: { x: 50, y: 50 },
  },
  members: { frame: ['a', 'b'] },
}

describe('planDrag', () => {
  it('drags only the pressed element when it is not selected', () => {
    // Pressing outside the selection is how a user says "just this one". Consulting the
    // selection anyway would turn every single-node drag into whatever the last gesture left
    // behind.
    expect(plannerFor(WORLD)('loner', ['other']).ids).toEqual(['loner'])
  })

  it('carries a frame\'s members', () => {
    expect(plannerFor(WORLD)('frame').ids).toEqual(['frame', 'a', 'b'])
  })

  it('drags the whole selection when the pressed element is part of it', () => {
    const plan = plannerFor(WORLD)('frame', ['frame', 'other'])
    expect(new Set(plan.ids)).toEqual(new Set(['frame', 'a', 'b', 'other']))
  })

  it('writes an element that is both a member and independently selected exactly once', () => {
    // The positions would agree either way. What must not happen is one element appearing
    // twice in the operation list, because that list is what a server receives.
    const plan = plannerFor(WORLD)('frame', ['frame', 'a'])
    expect(plan.ids.filter((id) => id === 'a')).toHaveLength(1)
    expect(new Set(plan.ids).size).toBe(plan.ids.length)
  })

  it('puts the pressed element first', () => {
    expect(plannerFor(WORLD)('frame', ['other', 'frame']).ids[0]).toBe('frame')
  })

  it('skips a member the map no longer holds rather than failing the gesture', () => {
    const stale: World = {
      positions: { frame: { x: 0, y: 0 }, a: { x: 1, y: 1 } },
      members: { frame: ['a', 'deleted'] },
    }
    const plan = plannerFor(stale)('frame')
    expect(plan.ids).toEqual(['frame', 'a'])
    expect(plan.origins.has('deleted')).toBe(false)
  })

  it('snapshots origins, so a plan is immune to later position writes', () => {
    const mutable: World = { positions: { n: { x: 5, y: 5 } }, members: {} }
    const plan = plannerFor(mutable)('n')
    mutable.positions.n = { x: 500, y: 500 }
    // Origin plus TOTAL delta, every frame, from a snapshot taken once. Re-reading the live
    // position and adding a per-event delta is what drifts a member away from its frame over a
    // long gesture.
    expect(positionAt(plan, 'n', 3, 4)).toEqual({ x: 8, y: 9 })
  })
})

describe('positionAt', () => {
  it('moves every element in the plan by the identical delta', () => {
    const plan = plannerFor(WORLD)('frame')
    const delta = { x: 17.5, y: -3.25 }
    for (const id of plan.ids) {
      const origin = plan.origins.get(id)
      expect(positionAt(plan, id, delta.x, delta.y)).toEqual({
        x: (origin as Point).x + delta.x,
        y: (origin as Point).y + delta.y,
      })
    }
  })

  it('is undefined for an element the plan never captured', () => {
    expect(positionAt(plannerFor(WORLD)('loner'), 'other', 1, 1)).toBeUndefined()
  })
})
