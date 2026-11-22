import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The caller supplies an already built and verified checkout of the merge SHA.
export function release({
  env = process.env,
  run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }),
  manifest = JSON.parse(readFileSync('package.json', 'utf8')),
} = {}) {
  assert.equal(env.GITHUB_EVENT_NAME, 'push')
  assert.equal(env.GITHUB_REF, 'refs/heads/main')
  const repo = env.GITHUB_REPOSITORY
  const sha = env.GITHUB_SHA
  assert.equal(repo, 'Wor-chain-dle/engine')
  assert.match(sha, /^[a-f0-9]{40}$/)
  assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), sha)
  assert.equal(manifest.name, '@wor-chain-dle/engine')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const tag = `v${manifest.version}`
  const gh = (...args) => run('gh', args)
  const api = (...args) => JSON.parse(gh('api', ...args))
  const prs = api(`repos/${repo}/commits/${sha}/pulls`)
  const pr = prs.find(
    (candidate) =>
      candidate.merged_at &&
      candidate.merge_commit_sha === sha &&
      candidate.base.ref === 'main' &&
      candidate.head.repo?.full_name === repo &&
      candidate.head.ref === `release/${tag}` &&
      candidate.title === `Release ${tag}`,
  )
  assert(
    pr?.body?.trim(),
    `Expected merged Release ${tag} PR with release notes`,
  )

  // Check all releases, including drafts, so a failed upload can be resumed.
  const existing = api('--paginate', '--slurp', `repos/${repo}/releases`)
    .flat()
    .find((item) => item.tag_name === tag)
  const tags = run('git', ['tag', '--list', tag]).trim()
  if (tags) {
    assert.equal(run('git', ['rev-parse', `${tag}^{}`]).trim(), sha)
  }
  if (existing && !existing.draft) {
    assert(tags, 'Published release must have a tag at this commit')
    console.log(`${tag} is already published; leaving it unchanged`)
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'wor-chain-dle-release-'))
  try {
    const [packed] = JSON.parse(
      run('npm', [
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ]),
    )
    assert.equal(packed.name, manifest.name)
    assert.equal(packed.version, manifest.version)
    assert.equal(
      packed.filename,
      `wor-chain-dle-engine-${manifest.version}.tgz`,
    )
    const artifact = join(directory, packed.filename)
    const checksum = `${artifact}.sha256`
    const digest = createHash('sha256')
      .update(readFileSync(artifact))
      .digest('hex')
    writeFileSync(checksum, `${digest}  ${packed.filename}\n`)
    if (!tags) {
      // Never let the Release API choose a newer main commit implicitly.
      gh(
        'api',
        '--method',
        'POST',
        `repos/${repo}/git/refs`,
        '-f',
        `ref=refs/tags/${tag}`,
        '-f',
        `sha=${sha}`,
      )
    }
    if (!existing) {
      gh(
        'release',
        'create',
        tag,
        '--repo',
        repo,
        '--verify-tag',
        '--draft',
        '--title',
        tag,
        '--notes',
        pr.body,
      )
    } else {
      gh(
        'release',
        'edit',
        tag,
        '--repo',
        repo,
        '--title',
        tag,
        '--notes',
        pr.body,
      )
    }
    gh(
      'release',
      'upload',
      tag,
      artifact,
      checksum,
      '--repo',
      repo,
      '--clobber',
    )
    gh('release', 'edit', tag, '--repo', repo, '--draft=false')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  release()
}
