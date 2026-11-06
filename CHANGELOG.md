# Changelog

## Unreleased

- Reads standard Claude Code text spill files (`tool-results/<tool-use-id>.txt`) for outcome evidence, labels missing or truncated spill output, and refuses arbitrary paths or symlinked spill locations.

## 0.1.0 - 2026-11-03

First public release (experimental).

- Parses Claude Code JSONL session logs into `journal.md` and `journal.html`.
- Per-session outcome labels: log-reported pass or failure, agent-claimed only, unknown.
- Token usage with list-price cost estimates. Estimates are not billed spend.
- Heuristic redaction of common secret patterns. Not a safe-anonymization guarantee.
- Known limits: real logs not yet validated, Bash file changes not detected, separate subagent files are separate entries, no Codex support.
