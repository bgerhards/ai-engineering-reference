#!/usr/bin/env node
/**
 * architecture.mjs — the dependency rule, enforced mechanically.
 *
 * Hexagonal architecture only pays off if the arrows keep pointing inward.
 * They erode one reasonable-looking import at a time, and a reviewer reading a
 * diff cannot see that `../../adapters/...` crossed a boundary. This script can.
 *
 * What it enforces (see RULES tables below — they are the spec):
 *   1. Layer order: domain < application < adapters < composition. A file may
 *      import its own layer or an inner one, never an outer one.
 *   2. The domain is platform-free: no `node:*` at all. The application layer
 *      may name a `node:*` type but must not execute one.
 *   3. `src/composition` is private to `src/main.ts` — it is wiring, not API.
 *   4. Determinism: time, randomness and the environment live in adapters only.
 *      Every one of those outside an adapter is a test that will flake later.
 *
 * Static scan only: regex over import/export/dynamic-import specifiers, with
 * comments blanked out first so commented-out code cannot trip a rule. String
 * bodies survive, because a specifier is one. No TypeScript parser, no deps.
 * `import type` is recognised; inline `{ type X }` specifiers are not, which
 * errs on the strict side for the one rule where it matters.
 *
 * Usage: node scripts/validate/architecture.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = 'src';

/** Inner to outer. `rank` is the only thing the dependency rule looks at. */
const LAYERS = [
  { name: 'domain', prefix: 'src/domain/', rank: 0 },
  { name: 'application', prefix: 'src/application/', rank: 1 },
  { name: 'adapters', prefix: 'src/adapters/', rank: 2 },
  { name: 'composition', prefix: 'src/composition/', rank: 3 },
];
/** `src/main.ts` is the process entry point: outside every layer, allowed everything. */
const ENTRY = { name: 'entry', rank: 4 };

/** src -> src imports. First matching rule wins, so specific rules come first. */
const IMPORT_RULES = [
  {
    id: 'use-case-imports-adapter',
    applies: (from, to) => from.rel.startsWith('src/application/use-cases/') && to.layer === 'adapters',
    message: (from, to) =>
      `use case imports the adapter '${to.rel}'. Depend on a port in src/application/ports/ instead and let src/composition wire the concrete adapter.`,
  },
  {
    id: 'composition-is-private',
    applies: (from, to) => to.layer === 'composition' && from.rel !== 'src/main.ts',
    message: (from, to) =>
      `imports '${to.rel}'. Only src/main.ts may reach into src/composition — everything else receives its dependencies as arguments.`,
  },
  {
    id: 'dependency-rule',
    applies: (from, to) => to.rank > from.rank,
    message: (from, to) => `${from.layer} imports ${to.layer} ('${to.rel}'). Imports must point inward.`,
  },
];

/** src -> `node:*` imports. */
const BUILTIN_RULES = [
  {
    id: 'domain-is-platform-free',
    applies: (from) => from.layer === 'domain',
    message: (from, spec) =>
      `domain imports '${spec}'. The domain must run unchanged in a CLI, a Lambda or a test harness — model the capability as a port.`,
  },
  {
    id: 'application-no-platform-values',
    applies: (from, _spec, typeOnly) => from.layer === 'application' && !typeOnly,
    message: (from, spec) =>
      `application imports the value '${spec}'. A type-only import is fine; executing a platform API here belongs in an adapter.`,
  },
];

/** Whole-file text scan. Determinism: these must not appear outside adapters. */
const TEXT_RULES = [
  {
    id: 'determinism',
    allowed: (rel) => rel.startsWith('src/adapters/') || rel === 'src/main.ts',
    patterns: [
      { re: /\bnew Date\s*\(\s*\)/g, hint: 'inject a Clock port and call clock.now()' },
      { re: /\bDate\.now\s*\(/g, hint: 'inject a Clock port and call clock.now()' },
      { re: /\bMath\.random\s*\(/g, hint: 'inject an IdGenerator (or similar) port' },
      { re: /\bprocess\.env\b/g, hint: 'read configuration in src/main.ts and pass it in' },
    ],
  },
];

const walk = (dir) => {
  const absolute = path.join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(rel);
    return entry.isFile() && rel.endsWith('.ts') && !rel.endsWith('.d.ts') ? [rel] : [];
  });
};

const QUOTES = new Set(['"', "'", '`']);

/**
 * The three consumers below each read one lexical region starting at `start` and
 * report the text to emit in its place plus the index the scan resumes from.
 * Emitting one character per character consumed is what keeps offsets — and so
 * line numbers — aligned with the original source.
 */
const consumeLineComment = (text, start) => {
  let i = start;
  while (i < text.length && text[i] !== '\n') i += 1;
  return { out: ' '.repeat(i - start), next: i };
};

const consumeBlockComment = (text, start) => {
  let out = '';
  let i = start;
  while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
    out += text[i] === '\n' ? '\n' : ' ';
    i += 1;
  }
  return { out: `${out}  `, next: i + 2 };
};

/** String bodies survive: an import specifier is a string, and that is what we came for. */
const consumeStringLiteral = (text, start) => {
  const quote = text[start];
  let out = quote;
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      out += text[i] + (text[i + 1] ?? '');
      i += 2;
      continue;
    }
    const closing = text[i] === quote;
    out += text[i];
    i += 1;
    if (closing) break;
  }
  return { out, next: i };
};

const consumeFrom = (text, i) => {
  if (text[i] === '/' && text[i + 1] === '/') return consumeLineComment(text, i);
  if (text[i] === '/' && text[i + 1] === '*') return consumeBlockComment(text, i);
  if (QUOTES.has(text[i])) return consumeStringLiteral(text, i);
  return { out: text[i], next: i + 1 };
};

/** Blanks out comments (keeping line numbers) so commented-out code never trips a rule. */
const stripComments = (text) => {
  let out = '';
  for (let i = 0; i < text.length; ) {
    const region = consumeFrom(text, i);
    out += region.out;
    i = region.next;
  }
  return out;
};

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

const isTypeOnly = (text, index) => {
  const head = text.slice(Math.max(0, index - 400), index);
  const start = Math.max(head.lastIndexOf('import'), head.lastIndexOf('export'));
  return start >= 0 && /^(import|export)\s+type\b/.test(head.slice(start));
};

const readImports = (text) => {
  const found = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      found.push({ spec: m[1], line: lineAt(text, m.index), typeOnly: isTypeOnly(text, m.index) });
    }
  }
  return found;
};

/** Resolves a specifier to a repo-relative `.ts` path, or null if it leaves src/. */
const resolveImport = (fromRel, spec) => {
  let target;
  if (spec.startsWith('@/')) target = path.posix.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  if (!target.startsWith(`${SRC}/`)) return null;
  const candidates = [target.replace(/\.js$/, '.ts'), `${target}.ts`, path.posix.join(target, 'index.ts')];
  for (const candidate of candidates) {
    const absolute = path.join(ROOT, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return target.replace(/\.js$/, '.ts');
};

const describeFile = (rel) => {
  if (rel === 'src/main.ts') return { rel, layer: ENTRY.name, rank: ENTRY.rank };
  const layer = LAYERS.find((candidate) => rel.startsWith(candidate.prefix));
  return layer ? { rel, layer: layer.name, rank: layer.rank } : { rel, layer: null, rank: null };
};

const checkFile = (rel, violations) => {
  const raw = readFileSync(path.join(ROOT, rel), 'utf8');
  const code = stripComments(raw);
  const from = describeFile(rel);
  if (from.layer === null) return;

  for (const { spec, line, typeOnly } of readImports(code)) {
    if (spec.startsWith('node:')) {
      const rule = BUILTIN_RULES.find((candidate) => candidate.applies(from, spec, typeOnly));
      if (rule) violations.push({ rule: rule.id, file: rel, line, message: rule.message(from, spec) });
      continue;
    }
    const targetRel = resolveImport(rel, spec);
    if (targetRel === null) continue;
    const to = describeFile(targetRel);
    if (to.layer === null) continue;
    const rule = IMPORT_RULES.find((candidate) => candidate.applies(from, to));
    if (rule) violations.push({ rule: rule.id, file: rel, line, message: rule.message(from, to) });
  }

  for (const textRule of TEXT_RULES) {
    if (textRule.allowed(rel)) continue;
    for (const { re, hint } of textRule.patterns) {
      re.lastIndex = 0;
      for (let m = re.exec(code); m !== null; m = re.exec(code)) {
        violations.push({
          rule: textRule.id,
          file: rel,
          line: lineAt(code, m.index),
          message: `'${m[0]}' outside src/adapters — ${hint}.`,
        });
      }
    }
  }
};

const run = () => {
  const json = process.argv.includes('--json');
  const files = walk(SRC);
  const violations = [];
  for (const rel of files) checkFile(rel, violations);

  if (json) {
    console.log(JSON.stringify({ ok: violations.length === 0, filesChecked: files.length, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log(`✓ architecture — ${String(files.length)} file(s) checked, no boundary violations.`);
  } else {
    console.log(`✗ architecture — ${String(violations.length)} violation(s) in ${String(files.length)} file(s):\n`);
    for (const v of violations) console.log(`  ${v.file}:${String(v.line)}  [${v.rule}]\n      ${v.message}`);
    console.log('\n  The layering rules live in .claude/skills/hexagonal-architecture/SKILL.md.');
  }
  process.exit(violations.length === 0 ? 0 : 1);
};

run();
