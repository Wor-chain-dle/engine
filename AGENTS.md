# Wor-chain-dle Engine Agent Guide

This is the canonical, tool-neutral guide for agents working in `Wor-chain-dle/engine`.
Read it before non-trivial work. Tool-specific entrypoints such as `CLAUDE.md` should
import this file and contain only tool-specific notes.

## Purpose And Current Status

- This repository owns the shared game engine for the Wor-chain-dle web game and
  solving agents. The initial implementation is planned as a TypeScript package.
- The repository currently contains initialization documents and a CI workflow.
  There is no package manifest, engine implementation, test runner, or publishing
  workflow yet. The first target release is v1.0.0.
- Do not describe planned commands or automation as already available. Update this
  guide with actual commands and structure when the tooling is implemented.
- Engine, web, and solver versions are independent. Do not copy the web game's
  version into the engine or update sibling repositories as part of a version bump.

## Repository Boundaries

- Engine: standard game rules, word validation, tile feedback, chain constraints,
  game creation, state transitions, and observations for agents.
- Web: UI, keyboard input, localStorage, Daily date selection, records, achievements,
  cosmetics, and deployment of the game website.
- Solvers: LLM integrations, entropy strategies, training data generation, training,
  experiment orchestration, and evaluation reports.
- Seasonal Event rules are outside the initial extraction scope.
- Keep the engine usable without React, DOM APIs, browser storage, network access,
  or implicit access to the current time. Inject randomness or seeds when needed.
- The web source currently lives at `Ootzk/Wor-chain-dle`. Its Organization migration
  is separate work. Do not assume a local sibling checkout exists in CI or releases.

## Branching

- `main`: stable integration point for reviewed releases; keep it releasable once
  package tooling exists. Do not implement features directly on `main`.
- `release/v{version}`: release integration branch created from `main`, for example
  `release/v1.0.0`.
- Create feature branches from their target release branch and PR back into it.
- Use descriptive branches such as `feature/game-state`, `fix/duplicate-feedback`,
  `refactor/chain-rules`, `docs/agent-guide`, or `chore/package-setup`.
- A release branch PR targets `main` and is titled exactly `Release v{version}`.
- Before the first release branch exists, repository setup and documentation PRs
  may target `main`. Engine implementation follows the release-branch workflow.
- Determine the target release from the issue or existing release plan. Do not
  invent a release version or reuse the web release milestone by assumption.
- PR merges are always performed by the developer, never by agents.
- Feature PRs are squash-merged. Release PRs should preserve release ancestry with
  a merge commit so that subsequent release comparisons remain meaningful.
- After review starts, prefer follow-up commits over amending or rewriting history.
  Tiny, local-only fixes before review may be amended.

## Commits

- Use Conventional Commit-style subjects: `<type>: <summary>` or
  `<type>(<scope>): <summary>`.
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`,
  and `perf`. Use `style` for formatting without behavior changes.
- Keep subjects concise, preferably within 72 characters, and describe the result.
- Group one coherent change per commit. Keep unrelated cleanup separate.
- Explain compatibility changes in the body; use `!` and a `BREAKING CHANGE:` footer
  when a public contract changes incompatibly.
- Do not commit secrets, generated build output, local experiment artifacts, or
  unrelated working-tree changes. Review the staged diff before committing.
- Never force-push, reset away user work, or amend published commits without explicit
  authorization. Do not create commits or push merely because files were edited.

## Issues And Pull Requests

- Track planned work as GitHub issues when possible. Group ad hoc work into a
  focused PR and associate it with the intended release milestone when known.
- Use connected GitHub tooling where it works. For CLI commands that infer a repo,
  always pass `--repo Wor-chain-dle/engine`; do not use the web repository by mistake.
- Inspect the current branch, worktree, base branch, commits, and full diff before
  creating a PR. Do not create a PR whose head is `main`.
- Create feature PRs as drafts unless the developer requests ready-for-review.
- Feature PR titles use a conventional prefix and should fit within 70 characters.
- PR bodies explain the concrete problem, resulting behavior, compatibility impact,
  and verification. State checks actually run and any material limitations.
- Include related issues as `Closes #number`. For issues in another repository, use
  a fully qualified reference such as `Ootzk/Wor-chain-dle#249`.
- A feature PR into a release branch may not auto-close its issues until release.
  Add every completed issue to the release PR body with `Closes #number`.
- Assignee: `Ootzk`.
- Milestone: target engine version such as `v1.0.0`; create it if missing once the
  target version is established. Leave unscheduled backlog work without a milestone.
- Choose labels by change type from the taxonomy below. Create missing relevant
  labels when setting up repository metadata; they are not currently provisioned.
- Apply labels to new and ongoing work, not completed historical items.

| Label | Use |
| --- | --- |
| `development: enhancement` | New engine capabilities or public APIs |
| `development: refactor` | Internal restructuring without intended behavior changes |
| `development: content` | Dictionary or other engine data additions |
| `development: devops` | Tooling, CI, packaging, publishing, and agent workflows |
| `🐛 bug` | Incorrect behavior or regressions |
| `📝 documentation` | Documentation changes |
| `💥 breaking change` | Incompatible public contracts |
| `🔖 versioning` | Required on release-to-main PRs |

## Versions And Releases

- Use full semantic versions. Branches use `release/v1.0.0`; milestones, tags,
  release titles, and prose use `v1.0.0`; manifests use bare `1.0.0`.
- Public contracts include exported types and functions, validation and feedback
  behavior, termination semantics, serialized state, and observation formats.
- Use patch releases for compatible fixes, minor releases for compatible features,
  and major releases for incompatible changes after v1.0.0. During v0.x development,
  call out incompatible changes explicitly and use a minor bump for them.
- Once npm manifests exist, update `package.json` and `package-lock.json` together
  with `npm version <version> --no-git-tag-version`. Review the resulting diff.
- Do not introduce the web-only `PATCH_NOTES_VERSION` into this package.
- Preserve dictionary order during extraction: web Daily answers depend on it.
  Dictionary and rules changes must be identifiable in reproducible experiments;
  document their versioning scheme when those interfaces are implemented.
- Release PRs summarize changes, compatibility or migration notes, verification,
  and all issues completed in the release. Use that body for GitHub Release notes.
- Before release, run available package checks and validate the packed artifact in
  a consumer. Do not treat success against a sibling source checkout as proof that
  an installed package works.
- Publishing registry, package name, credentials, and release automation have not
  been configured. A push to `main` currently does not publish or create a release.
- Keep release tags and package versions aligned; do not overwrite published
  versions or move existing release tags. Fix published problems in a new version.

## Continuous Integration

- `.github/workflows/ci.yml` runs on all pull requests and pushes to `main` and
  `release/**`. Its `test` job provides the check required by the main Ruleset.
- CI uses Node.js 22 and read-only repository permissions. It does not publish
  packages, create release tags, deploy the web game, or merge pull requests.
- Before a package manifest exists, CI checks initialization documents and rejects
  JavaScript/TypeScript source without package tooling. A bootstrap pass is not an
  engine test result.
- Once `package.json` exists, CI requires a lockfile and the `lint`, `test`, and
  `build` scripts. It runs `npm ci`, `npm run lint`, `npm test`, `npm run build`, and
  `npm pack --dry-run`. Implement those scripts with the package setup; do not
  silently skip missing checks or pass an empty test suite.
- `npm pack --dry-run` checks package contents but does not replace release-time
  installation and verification of the actual packed artifact in a consumer.

## Extraction And Verification

- Preserve current web behavior before redesigning APIs. Check source behavior,
  not only summaries in documentation, and add parity tests for extracted rules.
- Standard rules are five-letter English words and at most six submitted guesses.
  The chain locks the last letter for guesses 1→2, 3→4, 5→6, and the first letter
  for guesses 2→3 and 4→5.
- The current web game checks chain-based early loss after the fifth submitted
  guess, when the sixth guess cannot solve the answer. Do not apply that early-loss
  predicate after every turn. A winning guess takes precedence over loss checks.
- Preserve duplicate-letter feedback: correct matches consume answer occurrences
  before present matches. Keep answer words and allowed guesses distinct; Custom
  puzzles can use answers from either list.
- Keep hidden answers out of agent observations. Agents submit complete words,
  including the locked chain letter; the engine validates that constraint.
- Add meaningful tests for rule changes, invalid actions, terminal states,
  determinism, serialization contracts, and hidden-answer isolation as implemented.
- Extraction and web integration are separate reviewable changes. Verify web
  compatibility before replacing its existing implementation.
- Documentation-only changes require diff and link/path review, not a full test
  suite. Run implementation checks once actual tooling exists.
- Preserve the upstream MIT attribution when extracting code and dictionary data.

## Working Practices

- Keep edits scoped to the requested task and preserve unrelated changes.
- Check repository and branch before mutations in this multi-repository workspace.
- After a developer merge, update the target branch, remove the merged local branch
  only when safe, and prune stale remote refs. Squash merges may not satisfy Git's
  ancestry-based deletion check; verify the merge instead of force-deleting blindly.
- Reusable workflows belong in `.agents/skills/` when introduced; tool-specific
  wrappers should delegate to them. No repository skills are installed yet.
- Communicate with the developer in Korean. Summaries should briefly state what
  changed, what was verified, and what remains.
