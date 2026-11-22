#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import {
  createJsonlDispatcher,
  jsonlError,
  JSONL_LIMITS,
} from '../dist/jsonl.js'

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const dispatch = createJsonlDispatcher(version)
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0)
  process.stderr.write('JSONL output failed\n')
  process.exit(1)
})

async function respond(response) {
  if (!process.stdout.write(JSON.stringify(response) + '\n'))
    await once(process.stdout, 'drain')
}

// Bound request buffering even when a peer sends no newline. Oversized frames are
// discarded through the next newline, then normal framing resumes.
let parts = []
let size = 0
let oversized = false
async function finishLine() {
  let response
  if (oversized) response = jsonlError(null, 'line_too_long')
  else {
    let request
    try {
      request = JSON.parse(decoder.decode(Buffer.concat(parts, size)))
    } catch {
      response = jsonlError(null, 'invalid_json')
    }
    if (!response) response = dispatch(request)
  }
  parts = []
  size = 0
  oversized = false
  await respond(response)
}

try {
  for await (const chunk of process.stdin) {
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline === -1 ? chunk.length : newline
      const bytes = chunk.subarray(start, end)
      if (!oversized) {
        size += bytes.length
        if (size > JSONL_LIMITS.maxRequestBytes) {
          parts = []
          oversized = true
        } else parts.push(bytes)
      }
      if (newline === -1) break
      await finishLine()
      start = newline + 1
    }
  }
  if (size > 0 || oversized) await finishLine()
} catch {
  process.stderr.write('JSONL transport failed\n')
  process.exitCode = 1
}
