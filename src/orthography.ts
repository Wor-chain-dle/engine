import { CONFIG } from './config.js'

const characters = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
]

if (CONFIG.normalization) {
  characters.forEach(
    (val, i) => (characters[i] = val.normalize(CONFIG.normalization)),
  )
}

export const ORTHOGRAPHY: readonly string[] = Object.freeze(characters)
