/**
 * The polylines a sparkline draws, in a 0 to 100 box: one per run of consecutive values, so a
 * missing day leaves a gap instead of a dip to zero. Each value keeps its own slot on the x axis.
 * A run of one point is written twice so a round line cap still draws it as a dot.
 */
export function sparkRuns(values: readonly (number | null)[]): string[] {
  const real = values.filter((value): value is number => value !== null)
  if (real.length < 2) return []

  const min = Math.min(...real)
  const span = Math.max(...real) - min || 1
  const last = values.length - 1
  const runs: string[] = []
  let run: string[] = []

  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(closeRun(run))
      run = []
      return
    }
    run.push(`${(index / last) * 100},${100 - ((value - min) / span) * 100}`)
  })
  if (run.length) runs.push(closeRun(run))
  return runs
}

function closeRun(run: string[]): string {
  return (run.length === 1 ? [run[0], run[0]] : run).join(" ")
}
