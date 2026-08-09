#!/usr/bin/env node
/**
 * PreToolUse hook — refuses an edit that would break the dependency rule.
 *
 * The architecture validator in the gate catches these too, but a violation
 * caught before the write costs one message; the same violation caught by the
 * gate costs a full edit-test-diagnose cycle. This hook is the cheap version.
 *
 * Exit 0 = allow. Exit 2 = block, with the reason on stderr fed back to Claude.
 */
import path from 'node:path';

const LAYERS = ['domain', 'application', 'adapters', 'composition'];

const layerOf = (relativePath) => {
  const match = /^src\/([^/]+)\//.exec(relativePath);
  if (match === null) return null;
  const index = LAYERS.indexOf(match[1]);
  return index === -1 ? null : { name: match[1], index };
};

/** Every import specifier in a chunk of TypeScript, statically. */
const importSpecifiers = (source) => {
  const specifiers = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
};

const NON_DETERMINISM = [
  [/\bnew Date\s*\(\s*\)/, 'new Date()'],
  [/\bDate\.now\s*\(/, 'Date.now()'],
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bprocess\.env\b/, 'process.env'],
];

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
};

/**
 * The edit this hook is able to judge, or null when there is nothing to judge —
 * unparseable input, a tool call that writes no text, or a file outside src/<layer>/.
 * A null here always means "allow": the gate is the backstop for anything we cannot read.
 */
const editUnderReview = (raw) => {
  if (raw.trim() === '') return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const input = payload.tool_input ?? {};
  if (typeof input.file_path !== 'string') return null;

  const projectDir = payload.cwd ?? process.cwd();
  const relativePath = path.relative(projectDir, input.file_path).split(path.sep).join('/');
  const layer = layerOf(relativePath);
  if (layer === null) return null;

  // For Edit we only see the replacement text, which is enough: a forbidden
  // import has to appear in the text being written.
  const written = [input.content, input.new_string]
    .filter((value) => typeof value === 'string')
    .join('\n');
  if (written === '') return null;

  return { relativePath, layer, written };
};

/** The layer a specifier points at, or null for a bare package or anything outside src/. */
const targetLayerOf = (relativePath, specifier) => {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const target = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : path
        .join(path.dirname(relativePath), specifier)
        .split(path.sep)
        .join('/');
  return layerOf(target.startsWith('src/') ? target : `src/${target}`);
};

/** Imports that reach outward, plus platform imports the domain may not make. */
const importProblems = ({ relativePath, layer, written }) => {
  const problems = [];
  for (const specifier of importSpecifiers(written)) {
    if (specifier.startsWith('node:') && layer.index === 0) {
      problems.push(
        `imports "${specifier}" — the domain layer must stay free of platform APIs. ` +
          `Define a port in src/application/ports and implement it in src/adapters.`,
      );
      continue;
    }

    const targetLayer = targetLayerOf(relativePath, specifier);
    if (targetLayer !== null && targetLayer.index > layer.index) {
      problems.push(
        `imports from "${targetLayer.name}" — dependencies point inward only ` +
          `(${LAYERS.join(' <- ')}). ${layer.name} may not know about ${targetLayer.name}.`,
      );
    }
  }
  return problems;
};

/** Time, randomness and the environment: adapters only, so the inner layers stay testable. */
const determinismProblems = ({ layer, written }) => {
  if (layer.index >= 2) return [];
  return NON_DETERMINISM.filter(([pattern]) => pattern.test(written)).map(
    ([, label]) =>
      `uses ${label} — only src/adapters and src/main.ts may touch time, ` +
      `randomness or the environment. Inject a port so tests stay deterministic.`,
  );
};

const main = async () => {
  const edit = editUnderReview(await readStdin());
  if (edit === null) process.exit(0);

  const problems = [...importProblems(edit), ...determinismProblems(edit)];
  if (problems.length === 0) process.exit(0);

  console.error(`Blocked: ${edit.relativePath} breaks the architecture rules.\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nSee .claude/skills/hexagonal-architecture/SKILL.md`);
  process.exit(2);
};

main().catch(() => {
  // A broken hook must never block work. Fail open, loudly enough to notice.
  console.error('guard-boundaries hook failed; allowing the edit.');
  process.exit(0);
});
