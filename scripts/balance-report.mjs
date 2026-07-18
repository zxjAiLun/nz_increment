import { createServer } from 'vite'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

const runsArg = process.argv.find(arg => arg.startsWith('--runs='))
const outArg = process.argv.find(arg => arg.startsWith('--out='))
const checkMode = process.argv.includes('--check')
const verifyMode = process.argv.includes('--verify')
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

  // --verify：用当前代码重新生成报告，与仓库中已提交的 reports/balance-report.md 逐字节对比。
  // 不一致（说明已提交报告过期或生成非确定性）则退出码 1，用于 CI / 提交前一致性校验。
  if (verifyMode) {
    const repoPath = path.resolve(process.cwd(), outFile)
    const tmpPath = path.resolve(process.cwd(), 'reports/.balance-report.verify.md')
    await mkdir(path.dirname(tmpPath), { recursive: true })
    await writeFile(tmpPath, markdown, 'utf8')
    let repoContent = ''
    try {
      repoContent = await readFile(repoPath, 'utf8')
    } catch {
      repoContent = ''
    }
    await unlink(tmpPath).catch(() => {})
    if (repoContent === markdown) {
      console.error(`Balance report VERIFY PASSED: 当前代码生成的报告与 ${outFile} 逐字节一致（${report.points.length} 行, ${runs} runs/点）。`)
      process.exitCode = 0
    } else {
      console.error(`Balance report VERIFY FAILED: 当前代码生成的报告与 ${outFile} 不一致（已提交报告过期或生成非确定性）。请运行 \`npm run balance-report\` 重新生成并提交。`)
      process.exitCode = 1
    }
    if (checkMode && report.failed) {
      console.error(`Balance guardrails failed: ${report.guardrails.failCount} fail(s), ${report.guardrails.warnCount} warning(s)`)
      process.exitCode = 1
    }
    process.exitCode = process.exitCode ?? 0
    if (report.guardrails) {
      console.error(`Guardrail status: ${report.guardrails.status} (fails=${report.guardrails.failCount}, warnings=${report.guardrails.warnCount})`)
    }
  } else {
    const outputPath = path.resolve(process.cwd(), outFile)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, markdown, 'utf8')
    console.log(markdown)
    console.error(`Balance report written to ${outFile} (${report.points.length} rows, ${runs} runs/point)`)
    if (checkMode) {
      const summary = report.guardrails
      if (report.failed) {
        console.error(`Balance guardrails failed: ${summary.failCount} fail(s), ${summary.warnCount} warning(s)`)
        process.exitCode = 1
      } else {
        console.error(`Balance guardrails passed: 0 fail(s), ${summary.warnCount} warning(s)`)
      }
    }
  }
} finally {
  await server.close()
}
