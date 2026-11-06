# Contributing

Thanks for looking. This project is experimental and small, so keep changes small too.

## Setup

Node 18+ with no dependencies. Run the tests with:

    npm test

On Windows, the symlink regression tests need permission to create symlinks (for example Developer Mode or an elevated shell). Use an environment with symlink support when running the full suite.

## Ground rules

- Fixtures must be synthetic or from a source whose license allows it, with a line in `test/fixtures/PROVENANCE.md`. Never commit real session logs.
- Keep the tool local-only: no network calls, no upload, no auto-commit.
- Claims must stay honest. Outcomes are what the log reports, not verified results. Do not describe redaction as safe anonymization.
- Add or update a test for each behavior change.
- One focused change per pull request. Say what you checked and what you did not.

## Bugs

Open an issue with the command you ran and a synthetic or redacted example of the log line that went wrong. Do not paste private logs.
