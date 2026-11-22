// Executes pinned, unmodified web source in a small deterministic test harness.
// No sibling checkout, React render, storage, or network access is needed.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { Temporal } from 'temporal-polyfill'

export const fixtureRoot = fileURLToPath(
  new URL('./fixtures/upstream/', import.meta.url),
)
export const manifest = JSON.parse(
  readFileSync(resolve(fixtureRoot, 'manifest.json'), 'utf8'),
)

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
}

export function createUpstream() {
  const cache = new Map()
  let date = '2026-02-20'
  let timeZone = 'Asia/Seoul'
  let random = 0.5
  const math = Object.create(Math)
  math.random = () => random
  const temporal = {
    Temporal: {
      PlainDate: Temporal.PlainDate,
      Now: {
        plainDateISO: () => Temporal.PlainDate.from(date),
        timeZoneId: () => timeZone,
      },
    },
  }
  function load(relativePath) {
    const fullPath = resolve(fixtureRoot, relativePath)
    if (cache.has(fullPath)) return cache.get(fullPath)
    const exports = {}
    cache.set(fullPath, exports)
    vm.runInNewContext(
      compile(readFileSync(fullPath, 'utf8')),
      {
        exports,
        Math: math,
        require: (specifier) => {
          if (specifier === 'temporal-polyfill') return temporal
          if (!specifier.startsWith('.'))
            throw new Error(`Unexpected import ${specifier}`)
          return load(resolve(dirname(fullPath), `${specifier}.ts`))
        },
      },
      { filename: relativePath },
    )
    return exports
  }

  const config = load('src/constants/config.ts').CONFIG
  const words = load('src/lib/words.ts')
  const chain = load('src/lib/chain.ts')
  const statuses = load('src/lib/statuses.ts')
  const answers = load('src/constants/wordlist.ts').WORDS
  const additionalGuesses = load('src/constants/validGuesses.ts').VALIDGUESSES

  const eventSource = ts.createSourceFile(
    'events.ts',
    readFileSync(resolve(fixtureRoot, 'src/lib/events.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const selectors = new Set([
    'eventWordPermutations',
    'hashSeed',
    'createSeededRandom',
    'getEventWordPermutation',
    'getEventWordOfDay',
  ])
  const selectionSource = eventSource.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((declaration) =>
          selectors.has(declaration.name.getText(eventSource)),
        ),
    )
    .map((statement) => statement.getText(eventSource))
    .join('\n')
  const events = {}
  vm.runInNewContext(compile(selectionSource), {
    exports: events,
    WORDS: answers,
    CONFIG: config,
    Temporal,
  })

  const appSource = ts.createSourceFile(
    'App.tsx',
    readFileSync(resolve(fixtureRoot, 'src/App.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let onEnter
  let applyLoadedGameStatus
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(appSource) === 'onEnter'
    ) {
      onEnter = node.initializer.getText(appSource)
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(appSource) === 'applyLoadedGameStatus'
    ) {
      applyLoadedGameStatus = node.initializer.getText(appSource)
    }
    ts.forEachChild(node, visit)
  }
  visit(appSource)
  if (!onEnter || !applyLoadedGameStatus)
    throw new Error('Original game callbacks not found')
  const submissionScript = new vm.Script(
    compile(`const onEnter = ${onEnter}; onEnter();`),
  )
  const restorationScript = new vm.Script(
    compile(
      `const applyLoadedGameStatus = ${applyLoadedGameStatus}; applyLoadedGameStatus(loadedGuesses);`,
    ),
  )

  function restoreStatus(solution, guesses) {
    const status = { won: false, lost: false }
    restorationScript.runInNewContext({
      ...chain,
      CONFIG: config,
      ORTHOGRAPHY_PATTERN: load('src/lib/tokenizer.ts').ORTHOGRAPHY_PATTERN,
      solution,
      loadedGuesses: guesses.map((word) => [...word]),
      setIsGameWon: (value) => {
        status.won = value
      },
      setIsGameLost: (value) => {
        status.lost = value
      },
    })
    return status
  }

  function submit(solution, previousGuesses, word, terminal = null) {
    const rows = previousGuesses.map((guess) => [...guess])
    const lock = chain.getChainInfo(rows)
    const currentGuess = lock
      ? lock.position === 'first'
        ? [...word].slice(1)
        : [...word].slice(0, -1)
      : [...word]
    const output = {
      guesses: [...previousGuesses],
      endReason: terminal,
      invalid: null,
    }
    const noop = () => {}
    submissionScript.runInNewContext({
      ...chain,
      isWinningWord: words.isWinningWord,
      isWordInWordList: words.isWordInWordList,
      CONFIG: config,
      ORTHOGRAPHY_PATTERN: load('src/lib/tokenizer.ts').ORTHOGRAPHY_PATTERN,
      solution,
      guesses: rows,
      currentGuess,
      isGameWon: terminal === 'win',
      isGameLost: terminal !== null && terminal !== 'win',
      isDaily: false,
      stats: {},
      playStats: {},
      ALERT_TIME_MS: 2000,
      setTimeout: noop,
      updatePlayStats: noop,
      recordEnterAttempt: (_, kind) => {
        output.invalid = kind === 'valid' ? null : kind
      },
      setIsNotEnoughLetters: noop,
      setIsWordNotFoundAlertOpen: noop,
      setCurrentGuess: noop,
      setGuesses: (next) => {
        output.guesses = Array.from(next, (row) => row.join(''))
      },
      collectEventItemsForSubmission: noop,
      countTileStatusesForGame: () => ({}),
      completePlayStats: () => ({}),
      evaluateCompletedGameAchievements: noop,
      saveCompletedPlayStats: (_, reason) => {
        output.endReason = reason
      },
      setIsGameWon: noop,
      setIsGameLost: noop,
      startNextGuess: noop,
      addStatsForCompletedGame: noop,
      setStats: noop,
    })
    return output
  }

  return {
    words,
    chain,
    statuses,
    events,
    answers,
    additionalGuesses,
    submit,
    restoreStatus,
    setDate: (value, zone = 'Asia/Seoul') => {
      date = value
      timeZone = zone
    },
    setRandom: (value) => {
      random = value
    },
  }
}
