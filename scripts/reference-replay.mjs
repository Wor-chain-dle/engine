// Independent direct-library reference for the Python transport validation.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const plans = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const engine = await import(
  process.argv[3] ? pathToFileURL(process.argv[3]).href : '../dist/index.js'
)
const started = performance.now()
const results = plans.map(({ solution, actions }) => {
  let session = engine.createInputSession(engine.createGame({ solution }))
  return actions.map((action) => {
    const result = engine.applyInput(session, action)
    session = result.state
    return {
      accepted: result.accepted,
      feedback: result.feedback,
      observation: result.observation,
      stats: session.stats,
    }
  })
})
const computeMs = performance.now() - started
process.stdout.write(JSON.stringify({ results, computeMs }) + '\n')
