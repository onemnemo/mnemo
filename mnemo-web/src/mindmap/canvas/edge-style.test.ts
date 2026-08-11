import { describe, expect, it } from 'vitest'

import type { SceneEdge } from '../model/scene'

import { dashAttribute, strokeStyleFor } from './edge-style'

const edge = (over: Partial<SceneEdge> = {}): SceneEdge => ({
  id: 'e',
  fromId: 'a',
  toId: 'b',
  kind: 'link',
  ...over,
})

describe('a hierarchy edge', () => {
  it('takes the shared default when it names nothing', () => {
    const a = strokeStyleFor(edge({ kind: 'hierarchy' }))
    const b = strokeStyleFor(edge({ id: 'e2', kind: 'hierarchy' }))

    // Same object, not merely equal: branches are the bulk of a document and this is what keeps a
    // frame from allocating one style record per visible branch.
    expect(a).toBe(b)
  })

  it('keeps the colour the cascade resolved for it', () => {
    // Branch colour is the mindmap's signature. Returning the shared default here would paint every
    // branch the same grey however the cascade resolved, which no coloured map survives.
    expect(strokeStyleFor(edge({ kind: 'hierarchy', color: '#aa5533' })).color).toBe('#aa5533')
  })

  it('keeps a thickness or line style it names, and defaults the rest', () => {
    const style = strokeStyleFor(edge({ kind: 'hierarchy', thickness: 4 }))

    expect(style.width).toBe(4)
    expect(style.color).toBe(strokeStyleFor(edge({ kind: 'hierarchy' })).color)
  })
})

describe('a link edge', () => {
  it('is a different material from a branch by default', () => {
    // Structure and commentary should never need a second look to tell apart.
    expect(strokeStyleFor(edge()).color).not.toBe(strokeStyleFor(edge({ kind: 'hierarchy' })).color)
  })

  it('takes its own colour and thickness', () => {
    const style = strokeStyleFor(edge({ color: '#123456', thickness: 3 }))

    expect(style).toMatchObject({ color: '#123456', width: 3 })
  })
})

describe('line styles', () => {
  it('give solid no dash at all', () => {
    expect(strokeStyleFor(edge({ lineStyle: 'solid' })).dash).toBeNull()
  })

  it('give dashed and dotted visibly different patterns', () => {
    const dashed = strokeStyleFor(edge({ lineStyle: 'dashed' })).dash
    const dotted = strokeStyleFor(edge({ lineStyle: 'dotted' })).dash

    expect(dashed).not.toBeNull()
    expect(dotted).not.toBeNull()
    expect(dashed).not.toEqual(dotted)
  })

  it('share one array per pattern, so a renderer can compare by identity', () => {
    expect(strokeStyleFor(edge({ lineStyle: 'dashed' })).dash).toBe(
      strokeStyleFor(edge({ id: 'e2', lineStyle: 'dashed' })).dash,
    )
  })

  it('give a double line no dash, because it is two continuous strokes and not a pattern', () => {
    // Where the second stroke comes from is strokeFor's business, not this table's.
    expect(strokeStyleFor(edge({ lineStyle: 'double' })).dash).toBeNull()
  })
})

describe('dashAttribute', () => {
  it('is undefined for a continuous line, so no attribute is written at all', () => {
    expect(dashAttribute(null)).toBeUndefined()
  })

  it('joins a pattern the way an SVG stroke-dasharray wants it', () => {
    expect(dashAttribute([6, 4])).toBe('6 4')
  })
})
