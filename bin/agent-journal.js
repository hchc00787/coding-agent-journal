#!/usr/bin/env node
// agent-journal: local-first work journal from AI coding-agent session logs.
// Defaults: read-only on logs, writes to ./agent-journal-out, no upload, no commit.
import fs from 'node:fs';
import path from 'node:path';
import { parseDir } from '../src/parse.js';
import { buildJournal } from '../src/journal.js';
import { renderMarkdown } from '../src/report-md.js';
import { renderHtml } from '../src/report-html.js';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const input = opt('input', path.join(process.env.HOME || '', '.claude', 'projects'));
const outDir = opt('out', path.join(process.cwd(), 'agent-journal-out'));
const fullText = args.includes('--full-text');

if (fullText) {
  console.error('WARNING: --full-text embeds longer verbatim log excerpts. Redaction is heuristic and NOT comprehensive;');
  console.error('the output may still contain secrets, private code, or personal data. Review every line before sharing.');
}
if (!fs.existsSync(input)) {
  console.error(`No session log directory at ${input}`);
  process.exit(2);
}
const sessions = parseDir(input);
const journal = buildJournal(sessions, { fullText });

// Output goes only into a directory this tool owns: one it creates, or an existing EMPTY one,
// or one holding its ownership manifest from a previous run. Any other existing, non-empty
// directory is refused untouched (nothing is created, modified or appended), so a foreign
// project's files and .gitignore can never be changed.
const MANIFEST = '.agent-journal-output';
if (fs.existsSync(outDir)) {
  if (!fs.statSync(outDir).isDirectory()) {
    console.error(`Refusing: ${outDir} exists and is not a directory.`);
    process.exit(3);
  }
  if (fs.readdirSync(outDir).length > 0 && !fs.existsSync(path.join(outDir, MANIFEST))) {
    console.error(`Refusing to write into ${outDir}: it is not empty and was not created by agent-journal. Nothing was changed. Use a new or empty --out directory.`);
    process.exit(3);
  }
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, MANIFEST), 'Created by coding-agent-journal. Safe to delete this directory.\n');
// Generated artifacts stay out of version control: the owned directory ignores everything in it.
fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
fs.writeFileSync(path.join(outDir, 'journal.md'), renderMarkdown(journal));
fs.writeFileSync(path.join(outDir, 'journal.html'), renderHtml(journal));
const skippedMalformed = sessions.reduce((a, s) => a + s.skippedMalformed, 0);
const skippedDuplicate = sessions.reduce((a, s) => a + s.skippedDuplicate, 0);
console.log(`Parsed ${sessions.length} sessions across ${journal.days.length} days.`);
if (skippedMalformed || skippedDuplicate)
  console.log(`Skipped ${skippedMalformed} malformed and ${skippedDuplicate} duplicate log lines.`);
console.log(`Wrote ${path.join(outDir, 'journal.md')} and journal.html (local only, gitignored).`);
