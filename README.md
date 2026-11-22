# Wor-chain-dle Engine

Shared game engine for the [Wor-chain-dle](https://github.com/Ootzk/Wor-chain-dle) web game and solving agents.

## Status

Repository initialized. Engine extraction and implementation have not started yet.

## Planned scope

- Standard game rules: word validation, alternating chain constraints, tile feedback, and win/loss evaluation.
- Deterministic game creation and state transitions without browser or React dependencies.
- Agent observations that exclude the hidden answer.
- Versioned answer and allowed-guess dictionaries shared by the web game and solvers.

The initial implementation is planned as a TypeScript package. Web UI, browser storage, achievements, cosmetics, and solver-specific training and evaluation remain in their respective projects. Seasonal Event rules are outside the initial extraction scope.

## Related projects

- [Wor-chain-dle web game](https://github.com/Ootzk/Wor-chain-dle)
- [Wor-chain-dle organization](https://github.com/Wor-chain-dle)

## License

MIT. See [LICENSE](LICENSE).

The source game is based on [AnyLanguage-Word-Guessing-Game](https://github.com/roedoejet/AnyLanguage-Word-Guessing-Game). Preserve upstream attribution when extracting source code.
