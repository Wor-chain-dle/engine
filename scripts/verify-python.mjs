import { spawnSync } from 'node:child_process'
import { delimiter, resolve } from 'node:path'

const python = process.env.PYTHON || 'python3'
const env = {
  ...process.env,
  PYTHONPATH: [resolve('python'), process.env.PYTHONPATH]
    .filter(Boolean)
    .join(delimiter),
  WCD_NODE_BINARY: process.execPath,
  WCD_ENGINE_SERVER: resolve('bin/wor-chain-dle-jsonl.mjs'),
  WCD_ENGINE_MODULE: resolve('dist/index.js'),
}
for (const args of [
  ['-m', 'unittest', 'discover', '-s', 'python/tests', '-v'],
  ['python/verify_bridge.py', '--games', '100'],
]) {
  const result = spawnSync(python, args, {
    env,
    stdio: 'inherit',
    timeout: 60000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
