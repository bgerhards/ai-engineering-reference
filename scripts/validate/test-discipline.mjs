#!/usr/bin/env node
/**
 * test-discipline.mjs — catches suites that look green but prove nothing.
 *
 * A test suite is a safety net only for as long as every strand holds. The
 * failures below are the ones that silently cut strands while the CI badge
 * stays green, which makes them far more dangerous than an honest red build:
 *
 *   .only          — one focused test disables every other test in the run.
 *   .skip          — legitimate occasionally; unexplained, it becomes permanent.
 *   no expect()    — a test that asserts nothing passes forever, including when
 *                    the code it exercises is deleted.
 *   unit -> impure — a "unit" test wired to real infrastructure is slow, flaky,
 *                    and stops being a statement about the domain. Judged by
 *                    whether the imported module is actually impure, not by
 *                    which directory it happens to live in.
 *   orphan module  — a rule with no test is a rule nobody is defending.
 *
 * Warnings (never fatal) cover naming: this repo phrases test names as plain
 * statements about the system, not "should ..." wishes.
 *
 * Usage: node scripts/validate/test-discipline.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TESTED_LAYERS = ['src/domain/', 'src/application/use-cases/'];
/**
 * In-memory adapters are the test doubles themselves, so a unit test naming one
 * is not reaching out to anything.
 */
const ADAPTERS_ALLOWED_IN_UNIT = ['src/adapters/outbound/memory/'];
/**
 * What actually makes an import unsafe in a unit test is *impurity*, not which
 * directory the file sits in. `router.ts` and `problem.ts` live under adapters
 * because they speak HTTP, but they are pure functions over plain data — a unit
 * test of them is fast and deterministic, which is the whole point of the rule.
 *
 * So purity is derived from the module rather than from a hand-maintained
 * allowlist: a module is impure if it touches the platform or a source of
 * non-determinism, directly or through something it imports. That stays correct
 * as files are added, and it fails closed — `server.ts` (node:http),
 * `system-clock.ts` (new Date) and `random-id-generator.ts` (node:crypto) are
 * all still rejected.
 */
const IMPURITY = [
  [/(?:\bfrom|\bimport)\s*\(?\s*['"]node:/, 'imports a node: builtin'],
  [/\bnew Date\s*\(\s*\)/, 'calls new Date()'],
  [/\bDate\.now\s*\(/, 'calls Date.now()'],
  [/\bMath\.random\s*\(/, 'calls Math.random()'],
  [/\bprocess\.env\b/, 'reads process.env'],
];
const MIN_NAME_LENGTH = 15;

const errors = [];
const warnings = [];
const fail = (file, line, rule, message) => errors.push({ rule, file, line, message });
const warn = (file, line, rule, message) => warnings.push({ rule, file, line, message });

const walk = (dir) => {
  const absolute = path.join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(rel);
    return entry.isFile() && rel.endsWith('.ts') ? [rel] : [];
  });
};

const QUOTES = new Set(['"', "'", '`']);

/**
 * The three readers below each measure one lexical region starting at `start` and
 * report the span to blank and the index the scan resumes from. The quotes around a
 * string literal are deliberately outside its span: the mask has to keep them so a
 * later scan can still see where the literal was.
 */
const lineCommentAt = (text, start) => {
  let end = start;
  while (end < text.length && text[end] !== '\n') end += 1;
  return { kind: 'comment', blankFrom: start, blankTo: end, next: end };
};

const blockCommentAt = (text, start) => {
  let end = start + 2;
  while (end < text.length && !(text[end] === '*' && text[end + 1] === '/')) end += 1;
  return { kind: 'comment', blankFrom: start, blankTo: end + 2, next: end + 2 };
};

const stringLiteralAt = (text, start) => {
  const quote = text[start];
  let end = start + 1;
  while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
  return { kind: 'string', blankFrom: start + 1, blankTo: end, next: end + 1 };
};

/** The comment or string literal beginning at `i`, or null when `i` is ordinary code. */
const regionAt = (text, i) => {
  if (text[i] === '/' && text[i + 1] === '/') return lineCommentAt(text, i);
  if (text[i] === '/' && text[i + 1] === '*') return blockCommentAt(text, i);
  if (QUOTES.has(text[i])) return stringLiteralAt(text, i);
  return null;
};

/**
 * Blanks comments — and, unless `keepStrings`, string bodies — while preserving
 * length, so indices and line numbers still line up with the original text.
 * Everything structural (paren matching, `.only(` search) runs on the full mask;
 * names and import specifiers are read from text where strings survive.
 */
const mask = (text, keepStrings = false) => {
  const out = [...text];
  const blank = (from, to) => {
    for (let k = from; k < Math.min(to, text.length); k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const region = regionAt(text, i);
    if (region === null) {
      i += 1;
      continue;
    }
    if (!(keepStrings && region.kind === 'string')) blank(region.blankFrom, region.blankTo);
    i = region.next;
  }
  return out.join('');
};

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Index just past the `(` matching the one at `open`, or -1. */
const matchParen = (masked, open) => {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Every import specifier in `text`, as `{ spec, index }`.
 *
 * A fresh regex per call, deliberately: a shared `/g` regex carries `lastIndex`
 * between callers, so a nested scan silently rewinds the loop that invoked it —
 * which showed up here as every violation being reported twice.
 */
const specifiersIn = (text) => {
  const pattern = new RegExp(SPECIFIER.source, 'g');
  const found = [];
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    found.push({ spec: m[1] ?? m[2], index: m.index });
  }
  return found;
};

/** Resolves an import to a repo-relative `.ts` path under src/, or null. */
const resolveToSrc = (fromRel, spec) => {
  let target;
  if (spec.startsWith('@/')) target = path.posix.join('src', spec.slice(2));
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  if (!target.startsWith('src/')) return null;
  const candidates = [target.replace(/\.js$/, '.ts'), `${target}.ts`, path.posix.join(target, 'index.ts')];
  for (const candidate of candidates) {
    const absolute = path.join(ROOT, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return target.replace(/\.js$/, '.ts');
};

const checkFocusAndSkip = (rel, raw, masked) => {
  const lines = raw.split('\n');
  const only = /\.only\s*\(/g;
  for (let m = only.exec(masked); m !== null; m = only.exec(masked)) {
    fail(
      rel,
      lineAt(masked, m.index),
      'focused-test',
      'a `.only` here silently disables every other test in the run. Remove it before committing.',
    );
  }
  const skip = /\b(describe|it|test)\.skip\b/g;
  for (let m = skip.exec(masked); m !== null; m = skip.exec(masked)) {
    const line = lineAt(masked, m.index);
    const here = lines[line - 1] ?? '';
    let previous = '';
    for (let i = line - 2; i >= 0 && previous === ''; i -= 1) previous = (lines[i] ?? '').trim();
    if (!/SKIP-REASON:/.test(here) && !/SKIP-REASON:/.test(previous)) {
      fail(rel, line, 'unexplained-skip', `${m[1]}.skip needs a '// SKIP-REASON: ...' comment on the line above saying why, and what un-skips it.`);
    }
  }
};

const CALL = /\b(it|test)((?:\.\w+)*)\s*\(/g;
const SILENT_VARIANTS = ['.todo', '.each', '.failing', '.skip', '.concurrent.each'];

const checkAssertionsAndNames = (rel, raw, masked) => {
  CALL.lastIndex = 0;
  for (let m = CALL.exec(masked); m !== null; m = CALL.exec(masked)) {
    const open = m.index + m[0].length - 1;
    const line = lineAt(masked, m.index);
    const name = /^\s*\(\s*(['"`])([\s\S]*?)\1/.exec(raw.slice(open))?.[2];

    if (name !== undefined) {
      if (name.trim().length < MIN_NAME_LENGTH) {
        warn(rel, line, 'terse-name', `'${name}' is too short to describe a behaviour. Name the guarantee, not the function.`);
      }
      if (/^should\s/i.test(name)) {
        warn(rel, line, 'should-name', `'${name}' — phrase test names as statements about the system ('refuses a withdrawn copy'), not wishes.`);
      }
    }

    if (SILENT_VARIANTS.some((variant) => m[2].startsWith(variant))) continue;
    const close = matchParen(masked, open);
    if (close === -1) continue;
    if (!masked.slice(open, close).includes('expect(')) {
      fail(rel, line, 'assertion-free-test', `'${name ?? m[1]}' contains no expect(). A test that asserts nothing passes even after the code it covers is deleted.`);
    }
  }
};

/**
 * Why a module is impure, or null if it is pure. Follows imports so a pure-looking
 * façade over `node:fs` is still caught. Memoised, and cycle-safe via `seen`.
 */
const impurityCache = new Map();
const impurityOf = (target, seen = new Set()) => {
  if (impurityCache.has(target)) return impurityCache.get(target);
  if (seen.has(target)) return null;
  seen.add(target);

  const absolute = path.join(ROOT, target);
  if (!existsSync(absolute)) return null;
  // Comments out, strings in: `clock.ts` documents the `new Date()` ban in prose,
  // and specifiers have to survive for the transitive walk below.
  const source = mask(readFileSync(absolute, 'utf8'), true);

  let reason = null;
  for (const [pattern, description] of IMPURITY) {
    if (pattern.test(source)) {
      reason = `it ${description}`;
      break;
    }
  }

  if (reason === null) {
    for (const { spec } of specifiersIn(source)) {
      const next = resolveToSrc(target, spec);
      if (next === null || next === target) continue;
      const nested = impurityOf(next, seen);
      if (nested !== null) {
        reason = `it imports ${next}, which is impure (${nested})`;
        break;
      }
    }
  }

  impurityCache.set(target, reason);
  return reason;
};

/** Reads specifiers from the source: the mask blanks string bodies. */
const checkUnitIsolation = (rel, raw) => {
  if (!rel.startsWith('tests/unit/')) return;
  const reported = new Set();
  for (const { spec, index } of specifiersIn(raw)) {
    const target = resolveToSrc(rel, spec);
    if (target === null || !target.startsWith('src/adapters/')) continue;
    if (ADAPTERS_ALLOWED_IN_UNIT.some((prefix) => target.startsWith(prefix))) continue;

    const reason = impurityOf(target);
    if (reason === null) continue;

    // One finding per offending module: a value import and a type import of the
    // same file are one problem to fix, not two.
    if (reported.has(target)) continue;
    reported.add(target);

    fail(
      rel,
      lineAt(raw, index),
      'unit-touches-infrastructure',
      `imports '${target}', which is not safe in a unit test because ${reason}. Unit tests stay pure and deterministic — move this to tests/integration/ or tests/contract/.`,
    );
  }
};

/** Specifiers are read from the source, not the mask, because the mask blanks them. */
const importedSrcPaths = (rel, text) => {
  const found = new Set();
  for (const { spec } of specifiersIn(text)) {
    const target = resolveToSrc(rel, spec);
    if (target !== null) found.add(target);
  }
  return found;
};

const hasRuntimeExports = (text) => /export\s+(const|function|class|async|default|enum)\b/.test(text);

const checkOrphans = (covered) => {
  for (const rel of walk('src')) {
    if (!TESTED_LAYERS.some((prefix) => rel.startsWith(prefix))) continue;
    if (rel.endsWith('.d.ts')) continue;
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    if (!hasRuntimeExports(text)) continue;
    if (covered.has(rel)) continue;
    fail(rel, 1, 'orphan-module', 'no test under tests/ imports this module. Every rule in the domain and every use case needs a test that defends it.');
  }
};

const run = () => {
  const json = process.argv.includes('--json');
  const testFiles = walk('tests');
  const covered = new Set();

  for (const rel of testFiles) {
    const raw = readFileSync(path.join(ROOT, rel), 'utf8');
    const masked = mask(raw);
    for (const target of importedSrcPaths(rel, raw)) covered.add(target);
    checkFocusAndSkip(rel, raw, masked);
    checkAssertionsAndNames(rel, raw, masked);
    checkUnitIsolation(rel, raw);
  }
  checkOrphans(covered);

  if (json) {
    console.log(JSON.stringify({ ok: errors.length === 0, testFilesChecked: testFiles.length, errors, warnings }, null, 2));
  } else {
    for (const w of warnings) console.log(`  ! ${w.file}:${String(w.line)}  [${w.rule}] ${w.message}`);
    if (errors.length === 0) {
      console.log(`✓ test-discipline — ${String(testFiles.length)} test file(s) checked, ${String(warnings.length)} warning(s).`);
    } else {
      console.log(`✗ test-discipline — ${String(errors.length)} problem(s) in ${String(testFiles.length)} test file(s):\n`);
      for (const e of errors) console.log(`  ${e.file}:${String(e.line)}  [${e.rule}]\n      ${e.message}`);
      console.log('\n  The conventions live in .claude/skills/tdd-cycle/SKILL.md.');
    }
  }
  process.exit(errors.length === 0 ? 0 : 1);
};

run();
