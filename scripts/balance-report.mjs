import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const runsArg = process.argv.find(arg => arg.startsWith('--runs='))
const outArg = process.argv.find(arg => arg.startsWith('--out='))
const runs = runsArg ? Number(runsArg.split('=')[1]) : 1000
const outFile = outArg ? outArg.split('=')[1] : 'reports/balance-report.md'

if (!Number.isFinite(runs) || runs <= 0) {
  throw new Error(`Invalid --runs value: ${runsArg}`)
}

const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom'
})

try {
  const simulator = await server.ssrLoadModule('/src/systems/combat/battleSimulator.ts')
  const report = simulator.simulateBalanceReport(undefined, runs)
  const markdown = simulator.formatBalanceReportMarkdown(report)
  const outputPath = path.resolve(process.cwd(), outFile)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, markdown, 'utf8')
  console.log(markdown)
  console.error(`Balance report written to ${outFile} (${report.points.length} rows, ${runs} runs/point)`)
} finally {
  await server.close()
}
