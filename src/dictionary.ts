import { WORDS } from './constants/wordlist.js'
import { VALIDGUESSES } from './constants/validGuesses.js'

export { WORDS, VALIDGUESSES }
export { DICTIONARY_METADATA } from './constants/dictionaryMetadata.js'

/** Exact ordered data snapshot, independent of the engine's package version. */
export const DICTIONARY_VERSION = 'web-v1.7.0-b25c70c' as const

export const ALLOWED_WORDS: readonly string[] = Object.freeze([
  ...new Set([...WORDS, ...VALIDGUESSES]),
])
const allowedWords = new Set(ALLOWED_WORDS)

/** Matches the web's case-sensitive, NFC dictionary membership check. */
export function isWordInWordList(word: string): boolean {
  return allowedWords.has(word)
}

export function isWinningWord(word: string, solution: string): boolean {
  return word === solution
}
