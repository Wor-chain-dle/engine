/** Values affecting standard rules, copied from web v1.7.0. */
export const CONFIG = Object.freeze({
  tries: 6,
  wordLength: 5,
  normalization: 'NFC' as const,
  startDate: '2026-02-16',
  escapeSpecialCharacters: true,
})

export const RULES_VERSION = 'standard-v1' as const
