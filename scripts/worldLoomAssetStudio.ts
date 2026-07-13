import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { inspectSculptSpec, renderSculptPreview } from '../src/worldLoomAssetStudio'
import type { SculptSpec } from '../src/worldLoomAssets'

const main = async () => {
  const args = process.argv.slice(2)
  const input = args[0]
  const outIndex = args.indexOf('--out')
  const output = outIndex === -1 ? undefined : args[outIndex + 1]
  if (!input) {
    console.error('Usage: pnpm asset-studio <sculpt-spec.json> [--out preview.svg]')
    process.exit(2)
  }

  const inputPath = path.resolve(input)
  const inputStats = await fs.stat(inputPath)
  if (inputStats.size > 1_048_576) throw new Error('SculptSpec input exceeds the 1 MiB local file limit')
  const source = await fs.readFile(inputPath, 'utf8')
  const spec = JSON.parse(source) as SculptSpec
  const report = inspectSculptSpec(spec)
  console.log(JSON.stringify(report, null, 2))
  if (!report.valid) process.exit(1)
  if (output) {
    await fs.writeFile(path.resolve(output), renderSculptPreview(spec), 'utf8')
  }
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
