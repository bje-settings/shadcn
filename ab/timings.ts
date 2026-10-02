// Summarizes where a `pnpm ab` run spent its time, from the JSON report and
// each case's `timing` annotation, as Markdown (CI appends it to the job
// summary). A step both sides run at once counts the slower side. Reads the
// AB_STYLE run's report unless given a path.

import { readFileSync } from 'node:fs'
import { short } from './style.ts'

type Annotation = { type: string; description?: string }
type Result = { status: string; duration: number; annotations?: Annotation[] }
type Spec = { title: string; tests: { annotations: Annotation[]; results: Result[] }[] }
type Suite = { specs?: Spec[]; suites?: Suite[] }
type Report = {
  config: { metadata?: { actualWorkers?: number }; workers?: number }
  stats: { duration: number; expected: number; skipped: number; unexpected: number; flaky: number }
  suites: Suite[]
}
type Timing = {
  overlay: boolean
  interactive: boolean
  compared: string[]
  shows: number
  upstream: Record<string, number>
  ours: Record<string, number>
  test: Record<string, number>
}

type Row = { title: string; status: string; duration: number; unsettled: boolean; timing?: Timing }

const report: Report = JSON.parse(
  readFileSync(process.argv[2] ?? `ab/results/${short}/report.json`, 'utf8'),
)

function* specs(suites: Suite[]): Generator<Spec> {
  for (const suite of suites) {
    yield* suite.specs ?? []
    yield* specs(suite.suites ?? [])
  }
}

const rows: Row[] = []
for (const spec of specs(report.suites)) {
  for (const test of spec.tests) {
    const result = test.results.at(-1)
    if (!result) continue
    const annotations = [...test.annotations, ...(result.annotations ?? [])]
    const timing = annotations.find((annotation) => annotation.type === 'timing')?.description
    rows.push({
      title: spec.title,
      status: result.status,
      duration: result.duration,
      unsettled: annotations.some((annotation) => annotation.type === 'unsettled'),
      timing: timing === undefined ? undefined : JSON.parse(timing),
    })
  }
}

// Per step: show steps take the slower side, test steps as they are.
function steps(timing: Timing): Record<string, number> {
  const out: Record<string, number> = {}
  for (const side of ['upstream', 'ours'] as const) {
    for (const [step, ms] of Object.entries(timing[side])) {
      out[step] = Math.max(out[step] ?? 0, ms)
    }
  }
  return { ...out, ...timing.test }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function table(head: string[], body: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

const lines: string[] = ['## A/B timings', '']
// Comparisons made, by state: each is one upstream and ours screenshot diffed.
const comparisons = new Map<string, number>()
for (const row of rows) {
  for (const state of row.timing?.compared ?? []) {
    comparisons.set(state, (comparisons.get(state) ?? 0) + 1)
  }
}
const shows = sum(rows.map((row) => row.timing?.shows ?? 0))
const workers = report.config.metadata?.actualWorkers ?? report.config.workers
const testTime = sum(rows.map((row) => row.duration))
lines.push(
  `Wall ${seconds(report.stats.duration)} with ${workers} worker(s); tests total ${seconds(testTime)}.`,
  `${report.stats.expected} passed, ${report.stats.skipped} skipped, ${report.stats.unexpected} failed, ${report.stats.flaky} flaky.`,
  `${sum([...comparisons.values()])} comparisons (${[...comparisons].map(([state, count]) => `${count} ${state}`).join(', ')}) from ${shows} renders.`,
  '',
)

// By outcome and kind of case.
const groups = new Map<string, number[]>()
for (const row of rows) {
  const kind = row.timing
    ? `${row.timing.overlay ? 'overlay' : 'inline'} ${row.timing.interactive ? 'fixture' : 'example'}`
    : '?'
  for (const key of [`${row.status}`, `${row.status}: ${kind}`]) {
    groups.set(key, [...(groups.get(key) ?? []), row.duration])
  }
}
lines.push(
  table(
    ['Group', 'Tests', 'Total', 'Share', 'Mean', 'p95'],
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b)
        return [
          group,
          durations.length,
          seconds(sum(durations)),
          `${((100 * sum(durations)) / testTime).toFixed(0)}%`,
          `${Math.round(sum(durations) / durations.length)}ms`,
          `${percentile(sorted, 95)}ms`,
        ]
      }),
  ),
  '',
)

// By step, across every case that reached it.
const byStep = new Map<string, number[]>()
for (const row of rows) {
  if (!row.timing) continue
  for (const [step, ms] of Object.entries(steps(row.timing))) {
    byStep.set(step, [...(byStep.get(step) ?? []), ms])
  }
}
lines.push(
  table(
    ['Step', 'Cases', 'Total', 'Share of tests', 'Mean', 'p50', 'p95', 'Max'],
    [...byStep].map(([step, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return [
        step,
        values.length,
        seconds(sum(values)),
        `${((100 * sum(values)) / testTime).toFixed(0)}%`,
        `${Math.round(sum(values) / values.length)}ms`,
        `${percentile(sorted, 50)}ms`,
        `${percentile(sorted, 95)}ms`,
        `${sorted.at(-1)}ms`,
      ]
    }),
  ),
  '',
)

const unsettled = rows.filter((row) => row.unsettled)
lines.push(`${unsettled.length} case(s) hit the 3s quiet cap.`, '')

lines.push(
  '### Slowest cases',
  '',
  table(
    ['Case', 'Status', 'Duration'],
    [...rows]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 15)
      .map((row) => [row.title, row.status, `${row.duration}ms`]),
  ),
)

console.log(lines.join('\n'))
