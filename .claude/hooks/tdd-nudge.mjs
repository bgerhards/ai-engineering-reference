#!/usr/bin/env node
/**
 * PostToolUse hook — notices production code that arrived without a test.
 *
 * This is a nudge, not a gate. It cannot know whether the test was written
 * first, only whether one exists at all; the honest enforcement of test-first
 * ordering is the discipline in .claude/skills/tdd-cycle/SKILL.md. What this
 * catches reliably is the module that quietly has no test whatsoever.
 *
 * Exit 2 puts the message in front of Claude without undoing the edit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
};

const walk = (directory) => {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
};

const main = async () => {
  const raw = await readStdin();
  if (raw.trim() === '') process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const projectDir = payload.cwd ?? process.cwd();
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== 'string') process.exit(0);

  const relativePath = path.relative(projectDir, filePath).split(path.sep).join('/');

  // Only production modules that carry behaviour are in scope.
  if (!relativePath.startsWith('src/')) process.exit(0);
  if (!relativePath.endsWith('.ts')) process.exit(0);
  if (relativePath === 'src/main.ts') process.exit(0);
  if (relativePath.startsWith('src/composition/')) process.exit(0);
  if (relativePath.startsWith('src/application/ports/')) process.exit(0);

  let source = '';
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0);
  }

  // A file exporting only types has no behaviour to test.
  const hasRuntimeExport = /export\s+(const|function|class|async function)\s/.test(source);
  if (!hasRuntimeExport) process.exit(0);

  const moduleName = path.basename(relativePath, '.ts');
  const testFiles = walk(path.join(projectDir, 'tests'));

  const isCovered = testFiles.some((testFile) => {
    if (path.basename(testFile).startsWith(`${moduleName}.`)) return true;
    try {
      const testSource = readFileSync(testFile, 'utf8');
      return testSource.includes(`/${moduleName}.js`) || testSource.includes(`/${moduleName}'`);
    } catch {
      return false;
    }
  });

  if (isCovered) process.exit(0);

  console.error(
    `No test imports ${relativePath}.\n\n` +
      `This repo is test-first: write the failing test for the next behaviour, watch it\n` +
      `fail, then make it pass. The gate will reject an untested module under src/domain\n` +
      `or src/application/use-cases (coverage there is 100%).\n\n` +
      `Expected somewhere under tests/: a file importing ${moduleName}.`,
  );
  process.exit(2);
};

main().catch(() => process.exit(0));
