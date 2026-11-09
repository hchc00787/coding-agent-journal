#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseSessionFile } from '../src/parse.js';

const roots = process.argv.slice(2);

if (roots.length === 0) {
  console.error('Usage: node scripts/smoke-public-fixtures.mjs <fixture-dir> [fixture-dir...]');
  process.exit(2);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      result.skipped_symlinks++;
    } else if (entry.isDirectory()) {
      yield* walk(file);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield file;
    }
  }
}

const result = {
  root_count: roots.length,
  files: 0,
  skipped_symlinks: 0,
  parsed: 0,
  no_session: 0,
  empty_files: 0,
  errors: [],
  versions: new Map(),
  files_with_version: 0,
  evidence: 0,
  modified: 0,
  read: 0,
  toolCalls: 0,
};

function relativeToRoot(rootIndex, root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return { root_index: rootIndex, file: relative || path.basename(file) };
}

function cleanError(root, error) {
  return String(error?.message || error).split(path.resolve(root)).join('<fixture-root>');
}

function versionsIn(text) {
  const versions = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"version"')) continue;
    try {
      const version = JSON.parse(line)?.version;
      if (typeof version === 'string') versions.add(version);
    } catch {
      // Malformed JSONL lines are parser smoke input, not version metadata.
    }
  }
  return versions;
}

for (const [rootIndex, root] of roots.entries()) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    result.errors.push({ root_index: rootIndex, error: 'not a directory' });
    continue;
  }
  for (const file of walk(root)) {
    result.files++;
    const location = relativeToRoot(rootIndex, root, file);
    try {
      const text = fs.readFileSync(file, 'utf8');
      const session = parseSessionFile(file);
      if (!session) {
        result.no_session++;
        if (!text.trim()) result.empty_files++;
      } else {
        result.parsed++;
        result.evidence += session.evidence.length;
        result.modified += session.filesModified.size;
        result.read += session.filesRead.size;
        result.toolCalls += session.toolCalls;
      }

      const fileVersions = versionsIn(text);
      if (fileVersions.size > 0) result.files_with_version++;
      for (const version of fileVersions) {
        result.versions.set(version, (result.versions.get(version) || 0) + 1);
      }
    } catch (error) {
      result.errors.push({ ...location, error: cleanError(root, error) });
    }
  }
}

if (result.files === 0 && result.errors.length === 0) {
  result.errors.push({ error: 'no .jsonl files found' });
}

result.versions = [...result.versions.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
console.log(JSON.stringify(result, null, 2));
if (result.errors.length > 0) process.exit(1);
