import { describe, expect, it } from 'vitest'
import { generateFixture } from './generate'

/**
 * Timing, not correctness. A watchdog timeout during a 5,000-element run has two very different
 * explanations, and they lead to opposite conclusions: fixture generation being slow is a
 * harness problem, while the renderer being slow to mount is the answer the spike exists to
 * find. Generation is pure and runs outside a browser, so it can be separated from the mount
 * cheaply and the ambiguity does not have to be argued about.
 */
describe('fixture generation cost', () => {
  it('builds the full 5,000-element fixture fast enough that it cannot explain a run timeout', () => {
    const started = performance.now()
    const fixture = generateFixture({ layout: 'forest', elementCount: 5000, seed: 20260725 })
    const elapsed = performance.now() - started

    expect(fixture.elements).toHaveLength(5000)
    console.log(
      `forest 5000: ${elapsed.toFixed(0)}ms, ${fixture.elements.length} elements, ` +
        `${fixture.edges.length} edges, digest ${fixture.digest}`,
    )
    expect(elapsed).toBeLessThan(10_000)
  })

  it('builds the dense-grid layout in the same budget', () => {
    const started = performance.now()
    const fixture = generateFixture({ layout: 'dense-grid', elementCount: 5000, seed: 20260725 })
    const elapsed = performance.now() - started

    console.log(`dense-grid 5000: ${elapsed.toFixed(0)}ms, digest ${fixture.digest}`)
    expect(elapsed).toBeLessThan(10_000)
  })
})
