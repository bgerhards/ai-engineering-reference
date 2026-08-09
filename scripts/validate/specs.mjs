#!/usr/bin/env node
/**
 * specs.mjs — makes the spec set safe to hand to several agents at once.
 *
 * The expensive failure in parallel delivery is not a badly written spec, it is
 * two specs that quietly claim the same file. Nobody notices until two agents
 * finish and their branches will not merge. So the interesting check here is the
 * last one: no two specs in the same wave may own intersecting paths.
 *
 * It also enforces the frontmatter schema (see spec-driven-delivery skill),
 * resolves `depends_on` graphs, refuses cycles, and insists a dependency sits in
 * a strictly earlier wave — a same-wave dependency looks parallel and is not.
 *
 * The frontmatter parser is deliberately tiny and hand-rolled (no yaml dep). It
 * supports exactly three forms: `key: scalar`, `key: []`, and block lists.
 *
 * Usage: node scripts/validate/specs.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_DIR = 'specs';
const STATUSES = ['draft', 'ready', 'in-progress', 'done'];
const ID_PATTERN = /^SPEC-\d{3}$/;

const errors = [];
const warnings = [];
/** Returns null so `return fail(...)` reads as "record it and give up on this key". */
const fail = (file, line, message) => {
  errors.push({ file, line, message });
  return null;
};
const warn = (file, line, message) => warnings.push({ file, line, message });

/** `key: scalar` | `key: []` | `key:` followed by `  - item` lines. Trailing `# comments` stripped. */
const parseFrontmatter = (text) => {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { values: null, bodyFrom: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { values: null, bodyFrom: 0 };

  const values = {};
  const clean = (raw) => raw.replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  let current = null;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && current !== null) {
      values[current].value.push(clean(item[1]));
      continue;
    }
    const entry = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, rest] = entry;
    if (rest.trim() === '') {
      values[key] = { value: [], line: i + 1, list: true };
      current = key;
    } else if (rest.trim() === '[]') {
      values[key] = { value: [], line: i + 1, list: true };
      current = null;
    } else {
      values[key] = { value: clean(rest), line: i + 1, list: false };
      current = null;
    }
  }
  return { values, bodyFrom: end + 1 };
};

const sectionOf = (body, heading) => {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trimStart().startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
};

// Conservative glob intersection: could any single path be matched by both patterns?
//
// Translated by a single left-to-right scan so the two wildcards never re-read each
// other's output: a single star stops at a slash, a double star crosses one.
//
// The three slash-adjacent forms are special-cased because a double star has to be
// able to match ZERO directories. Rendering slash-doublestar-slash as slash-dot-star-
// slash cannot: it demands at least one directory, so a pattern like
// "src/domain/lending/<doublestar>/<star>.ts" would fail to collide with
// "src/domain/lending/loan.ts", and two specs in one wave could quietly claim the same
// file. Catching exactly that is why this validator exists.
//
// (Line comments, not a block comment: the glob examples above contain star-slash
// sequences that would close a block comment early.)
const toRegex = (pattern) => {
  const escapeChar = (character) => character.replace(/[.+^${}()|[\]\\?]/, '\\$&');
  let body = '';
  let index = 0;

  while (index < pattern.length) {
    const rest = pattern.length - index;

    if (pattern.startsWith('/**/', index)) {
      body += '/(?:.*/)?'; // zero or more directories, keeping one slash
      index += 4;
    } else if (index === 0 && pattern.startsWith('**/', index)) {
      body += '(?:.*/)?';
      index += 3;
    } else if (rest === 3 && pattern.startsWith('/**', index)) {
      body += '(?:/.*)?'; // a trailing /** also matches the directory itself
      index += 3;
    } else if (pattern.startsWith('**', index)) {
      body += '.*';
      index += 2;
    } else if (pattern[index] === '*') {
      body += '[^/]*';
      index += 1;
    } else {
      body += escapeChar(pattern[index]);
      index += 1;
    }
  }

  return new RegExp(`^${body}$`);
};
const sample = (pattern) => pattern.replace(/\*\*/g, '__any__/__any__').replace(/\*/g, '__any__');
const intersects = (a, b) => a === b || toRegex(a).test(sample(b)) || toRegex(b).test(sample(a));

const readSpecs = () => {
  const dir = path.join(ROOT, SPEC_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('SPEC-') && name.endsWith('.md') && name !== 'SPEC-TEMPLATE.md')
    .sort()
    .map((name) => {
      const file = `${SPEC_DIR}/${name}`;
      const text = readFileSync(path.join(dir, name), 'utf8');
      const { values, bodyFrom } = parseFrontmatter(text);
      return { file, name, values, body: text.split('\n').slice(bodyFrom).join('\n') };
    });
};

const requireScalar = (spec, key, validate, hint) => {
  const entry = spec.values[key];
  if (entry === undefined) return fail(spec.file, 1, `frontmatter is missing required key '${key}'.`);
  if (entry.list) return fail(spec.file, entry.line, `'${key}' must be a scalar, not a list.`);
  if (!validate(entry.value)) return fail(spec.file, entry.line, `'${key}' is '${entry.value}' — ${hint}.`);
  return entry.value;
};

const requireList = (spec, key, allowEmpty) => {
  const entry = spec.values[key];
  if (entry === undefined) fail(spec.file, 1, `frontmatter is missing required key '${key}'.`);
  else if (!entry.list) fail(spec.file, entry.line, `'${key}' must be a list (use '[]' for none).`);
  else if (!allowEmpty && entry.value.length === 0) fail(spec.file, entry.line, `'${key}' must not be empty.`);
  else return entry.value;
  return [];
};

const checkFrontmatter = (spec) => {
  const filePrefix = spec.name.slice(0, 8);
  const id = requireScalar(spec, 'id', (v) => ID_PATTERN.test(v), 'expected the form SPEC-000');
  if (id !== null && id !== filePrefix) {
    fail(spec.file, spec.values['id'].line, `id '${id}' does not match the filename prefix '${filePrefix}'.`);
  }
  requireScalar(spec, 'title', (v) => v.length > 0, 'a title must not be empty');
  requireScalar(spec, 'status', (v) => STATUSES.includes(v), `expected one of ${STATUSES.join(' | ')}`);
  const wave = requireScalar(spec, 'wave', (v) => /^\d+$/.test(v), 'expected a non-negative integer');
  requireScalar(spec, 'estimated_tests', (v) => /^\d+$/.test(v) && Number(v) > 0, 'expected a positive integer');

  const dependsOn = requireList(spec, 'depends_on', true);
  const owns = requireList(spec, 'owns', false);
  for (const contract of requireList(spec, 'shared_contracts', true)) {
    if (!/^\S+\s+\(.+\)$/.test(contract)) {
      fail(spec.file, spec.values['shared_contracts'].line, `shared_contracts entry '${contract}' must read 'path (rule text)'.`);
    }
  }
  return { ...spec, id, wave: wave === null ? null : Number(wave), dependsOn, owns, status: spec.values['status']?.value };
};

const checkBody = (spec) => {
  const criteria = sectionOf(spec.body, 'Acceptance criteria');
  if (criteria === null) {
    fail(spec.file, 1, "body is missing an '## Acceptance criteria' section.");
  } else {
    const items = criteria.match(/^\s*- \[[ xX]\]/gm) ?? [];
    if (items.length < 3) {
      fail(spec.file, 1, `'## Acceptance criteria' has ${String(items.length)} checklist item(s); at least 3 are required.`);
    }
  }
  if (sectionOf(spec.body, 'Out of scope') === null) {
    fail(spec.file, 1, "body is missing an '## Out of scope' section — every spec names the work it deliberately excludes.");
  }
};

const checkGraph = (specs) => {
  const byId = new Map();
  for (const spec of specs) {
    if (spec.id === null) continue;
    const seen = byId.get(spec.id);
    if (seen) fail(spec.file, 1, `id '${spec.id}' is already used by ${seen.file}.`);
    else byId.set(spec.id, spec);
  }

  for (const spec of specs) {
    const line = spec.values['depends_on']?.line ?? 1;
    for (const dependency of spec.dependsOn) {
      const target = byId.get(dependency);
      if (dependency === spec.id) fail(spec.file, line, 'depends on itself.');
      else if (!target) fail(spec.file, line, `depends_on '${dependency}', which does not exist.`);
      else if (spec.wave !== null && target.wave !== null && target.wave >= spec.wave) {
        fail(spec.file, line, `depends on ${dependency} (wave ${String(target.wave)}) but sits in wave ${String(spec.wave)} — a dependency must be in a strictly earlier wave.`);
      }
    }
  }

  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const cycle = trail.slice(trail.indexOf(id)).concat(id).join(' -> ');
      fail(byId.get(id).file, 1, `dependency cycle: ${cycle}.`);
      return;
    }
    state.set(id, 'open');
    for (const next of byId.get(id).dependsOn) if (byId.has(next)) visit(next, [...trail, id]);
    state.set(id, 'done');
  };
  for (const id of byId.keys()) visit(id, []);
};

/** Every unordered pair, once each: collision is symmetric, so reporting it twice helps nobody. */
const distinctPairs = (items) => {
  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) pairs.push([items[i], items[j]]);
  }
  return pairs;
};

/** The `owns` entries of two specs that could match the same path, as `'left ~ right'`. */
const collidingPaths = (left, right) =>
  left.owns.flatMap((a) => right.owns.filter((b) => intersects(a, b)).map((b) => `${a} ~ ${b}`));

const checkOwnership = (specs) => {
  const waves = new Map();
  for (const spec of specs) {
    if (spec.wave === null) continue;
    waves.set(spec.wave, [...(waves.get(spec.wave) ?? []), spec]);
  }
  for (const [wave, members] of waves) {
    for (const [left, right] of distinctPairs(members)) {
      const overlaps = collidingPaths(left, right);
      if (overlaps.length === 0) continue;
      fail(left.file, left.values['owns'].line, `wave ${String(wave)}: ownership collides with ${right.id} (${right.file}) on ${overlaps.join(', ')}. Split the file, or move one spec to a later wave.`);
    }
  }
};

/** For a glob, the deepest literal directory prefix is the best we can check without expanding. */
const existsOnDisk = (pattern) => {
  if (!pattern.includes('*')) return existsSync(path.join(ROOT, pattern));
  const prefix = pattern.slice(0, pattern.indexOf('*'));
  const dir = prefix.slice(0, prefix.lastIndexOf('/') + 1);
  return dir === '' || existsSync(path.join(ROOT, dir));
};

const checkOwnedPathsExist = (spec) => {
  if (spec.status !== 'done') return;
  for (const owned of spec.owns) {
    if (!existsOnDisk(owned)) {
      warn(spec.file, spec.values['owns'].line, `status is 'done' but owned path '${owned}' does not exist on disk.`);
    }
  }
};

const run = () => {
  const json = process.argv.includes('--json');
  const raw = readSpecs();
  const parsed = [];
  for (const spec of raw) {
    if (spec.values === null) {
      fail(spec.file, 1, 'missing or unterminated `---` frontmatter block.');
      continue;
    }
    if (!/^SPEC-\d{3}-/.test(spec.name)) fail(spec.file, 1, 'filename must start with SPEC-000-.');
    const checked = checkFrontmatter(spec);
    checkBody(checked);
    checkOwnedPathsExist(checked);
    parsed.push(checked);
  }
  checkGraph(parsed);
  checkOwnership(parsed);

  if (json) {
    console.log(JSON.stringify({ ok: errors.length === 0, specsChecked: raw.length, errors, warnings }, null, 2));
  } else {
    for (const w of warnings) console.log(`  ! ${w.file}:${String(w.line)}  ${w.message}`);
    if (errors.length === 0) {
      console.log(`✓ specs — ${String(raw.length)} spec(s) checked, ${String(warnings.length)} warning(s).`);
    } else {
      console.log(`✗ specs — ${String(errors.length)} problem(s) across ${String(raw.length)} spec(s):\n`);
      for (const e of errors) console.log(`  ${e.file}:${String(e.line)}\n      ${e.message}`);
      console.log('\n  The schema lives in .claude/skills/spec-driven-delivery/SKILL.md.');
    }
  }
  process.exit(errors.length === 0 ? 0 : 1);
};

run();
