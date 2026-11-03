# coding-agent-journal

> **Status: experimental (v0.1.0).** Automated tests use bundled synthetic fixtures, and it was smoke-tested on openly licensed public fixture files from two other projects (not bundled; this shows it does not crash on them, not broad compatibility); real-world Claude Code logs are not yet validated. Outcome detection and redaction are heuristic, cost figures are list-price estimates, not billed spend, and Codex and other agents are not supported. See [CHANGELOG.md](CHANGELOG.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Local-first CLI that turns AI coding-agent session logs (Claude Code JSONL transcripts today) into a durable work journal: task, actions, files touched, token usage, and an honest outcome per session.

## Principles

- **Local-only by default.** Reads logs, writes `journal.md` / `journal.html` into an output directory whose `.gitignore` excludes everything. No upload, no commit, no network.
- **Honest outcomes.** Each session gets one of:
  - `log-reported pass` / `log-reported failure` - a signal (test counts or nonzero exit codes) appeared in tool-output text recorded in the log. That text is self-reported by whatever ran in the session; this tool did not rerun or verify it. A command exiting 0 is neutral: it is mentioned only as that fact and never makes a pass; a nonzero exit code counts as failure evidence.
  - `agent-claimed only` - the last agent message explicitly states completion ("done", "fixed", "tests pass"...) with no corroborating signal. Questions and plans ("I'll look into it") do not count.
  - `unknown` - no outcome signal. A command exiting 0 is reported only as that fact in the detail text; it never turns a session into a pass.
- **Files** are tracked as `modified` (Edit/Write tool calls) or `read` (Read tool calls), separately. Markdown lists the paths; HTML shows only counts. Bash-driven changes are not detected. Test-pass text found inside a Read result or quoted source can look like a test run; outcome detection is heuristic.
- **Safety of output.** Everything taken from logs is treated as untrusted: values are escaped in HTML, neutralized in Markdown (no live images, links or headings), and token counts must be finite non-negative numbers or the session is marked partial/unknown. The tool writes only into a directory it owns: a new one, an empty one, or one it created earlier (marked by `.agent-journal-output`). Any other non-empty directory is refused without changes, so it cannot touch another project's files or `.gitignore`. The output directory contains its own `.gitignore` with `*`.
- **Costs are never presented as actual spend.** Cost is shown only as an estimate at Anthropic's published API list prices (dated, source URL in the report footer), labeled `list-price est.`; it is not billed spend (subscriptions, batch, long-context, fast mode, regional pricing and 1h cache writes are not modeled). Models missing from the table show `unknown cost`; there is no fallback rate. The tool does not read actual billed cost.
- **Heuristic redaction, not a guarantee.** Secrets and private paths are pattern-redacted and task text is bounded. This is **not comprehensive**. `--full-text` embeds longer verbatim excerpts, prints a warning, and its output must be reviewed line by line before any sharing.

## Usage

    node bin/agent-journal.js --input ~/.claude/projects --out ./agent-journal-out
    node bin/agent-journal.js --input ~/.claude/projects --out ./agent-journal-out --full-text   # longer excerpts; review before sharing

## Log format coverage (best-effort)

Based on third-party documented formats, not an official schema:
- https://claude-dev.tools/docs/jsonl-format
- https://github.com/markmdev/claude-skills/blob/main/transcript-parser/references/transcript-schema.md

Covered: `user` / `assistant` entries, tool_use blocks, tool_result text blocks, per-`message.id` usage dedupe, `uuid` line dedupe, out-of-order timestamps, malformed-line skipping.
Not covered: externalized tool results (`tool-results/toolu_*.txt`), `file-history-snapshot` diffs, `progress` / `queue-operation` noise (ignored), Codex or other agent formats. Sidechain events that appear inside a file are included in that file's session; separate subagent files appear as separate entries, not merged. Bundled fixtures are synthetic. As a smoke test (not bundled, not a compatibility claim), the parser was also run on openly licensed public test fixtures from daaain/claude-code-log (MIT) and jakemarsh/ccthread (MIT): it parsed all files without error, and the run exposed two bugs (Windows-style paths, mixed-model sessions) that are fixed. Wider smoke run: 32 MIT-licensed public fixtures from daaain/claude-code-log, whose `version` fields range from 1.0.24 to 2.1.198, parsed without error. Those are fixture files written by other projects, so this shows the parser does not crash on them; it does not show compatibility with all current real-world logs, which remain untested. Sessions mixing several models show unknown cost.

## Development

    node --test test/journal.test.js

## Credits and license

MIT, see LICENSE. The log format notes come from third-party documentation (links above); no third-party code or fixture content is included in this repository. Public fixtures mentioned in the coverage section were used only for local smoke testing and are not redistributed.
