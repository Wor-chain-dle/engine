import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { release } from '../scripts/release.mjs'

const sha = 'a'.repeat(40)
const repo = 'Wor-chain-dle/engine'

function fixture({ tagged = false, existing, wrongTag = false, pr = {} } = {}) {
  const calls = []
  const env = {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha,
    GITHUB_REPOSITORY: repo,
  }
  const manifest = { name: '@wor-chain-dle/engine', version: '0.1.0' }
  const run = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') {
      if (args[0] === 'tag') return tagged ? 'v0.1.0' : ''
      return args[1] === 'HEAD' || !wrongTag ? sha : 'b'.repeat(40)
    }
    if (command === 'npm') {
      const filename = 'wor-chain-dle-engine-0.1.0.tgz'
      writeFileSync(join(args.at(-1), filename), 'test package bytes')
      return JSON.stringify([{ ...manifest, filename }])
    }
    if (args[0] === 'api' && args[1]?.endsWith('/pulls')) {
      return JSON.stringify([
        {
          merged_at: '2026-11-22',
          merge_commit_sha: sha,
          base: { ref: 'main' },
          head: { ref: 'release/v0.1.0', repo: { full_name: repo } },
          title: 'Release v0.1.0',
          body: 'Release notes\nCloses #2',
          ...pr,
        },
      ])
    }
    if (args.includes('--slurp'))
      return JSON.stringify([existing ? [existing] : []])
    if (args[0] === 'release' && args[1] === 'upload') {
      assert.match(
        readFileSync(args[4], 'utf8'),
        /^[a-f0-9]{64}  wor-chain-dle-engine-0\.1\.0\.tgz\n$/,
      )
    }
    return '{}'
  }
  return { env, manifest, run, calls }
}

test('release tags the exact merge and uploads package/checksum before publishing', () => {
  const f = fixture()
  release(f)
  const writes = f.calls.filter(
    (call) =>
      call[0] === 'gh' &&
      !call.includes('--slurp') &&
      !call.some((arg) => arg.endsWith('/pulls')),
  )
  assert(writes[0].includes(`sha=${sha}`))
  assert(writes[1].includes('--draft'))
  assert(writes[1].includes('Release notes\nCloses #2'))
  assert.equal(writes[2][2], 'upload')
  assert(writes[3].includes('--draft=false'))
})

test('release rejects unrelated PR, wrong version and wrong tag before writing', () => {
  for (const options of [
    { pr: { merge_commit_sha: 'b'.repeat(40) } },
    { pr: { title: 'Release v1.0.0' } },
    { pr: { head: { ref: 'feature/other' } } },
    { tagged: true, wrongTag: true },
  ]) {
    const f = fixture(options)
    assert.throws(() => release(f))
    assert(
      !f.calls.some(
        (call) =>
          call[0] === 'npm' ||
          call.includes('--method') ||
          call[1] === 'release',
      ),
    )
  }
})

test('release resumes a draft but never rewrites a published release', () => {
  for (const draft of [true, false]) {
    const f = fixture({ tagged: true, existing: { tag_name: 'v0.1.0', draft } })
    release(f)
    assert.equal(
      f.calls.some((call) => call.includes('upload')),
      draft,
    )
    assert(
      !f.calls.some(
        (call) => call.includes('--method') || call.includes('create'),
      ),
    )
  }
})

test('release refuses PR events and release-branch pushes', () => {
  for (const env of [
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/release/v0.1.0' },
  ]) {
    const f = fixture()
    Object.assign(f.env, env)
    assert.throws(() => release(f))
    assert.equal(f.calls.length, 0)
  }
})
