#!/usr/bin/env node
/**
 * Stop hook — the last cheap check before a turn ends.
 *
 * It runs only the dependency-free validators, not the full gate: a Stop hook
 * that takes 40 seconds trains people to disable it. The full `npm run gate` is
 * still the definition of done and remains the agent's responsibility.
 *
 * Guarded by `stop_hook_active` so a failing validator can prompt exactly one
 * round of fixing rather than an unbounded loop.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const VALIDATORS = [
  ['architecture', 'scripts/validate/architecture.mjs'],
  ['test-discipline', 'scripts/validate/test-discipline.mjs'],
  ['specs', 'scripts/validate/specs.mjs'],
];

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
};

const main = async () => {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    payload = {};
  }

  // Already asked once this turn. Asking again would loop.
  if (payload.stop_hook_active === true) process.exit(0);

  const projectDir = payload.cwd ?? process.cwd();
  const failures = [];

  for (const [name, script] of VALIDATORS) {
    const scriptPath = path.join(projectDir, script);
    if (!existsSync(scriptPath)) continue;

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: projectDir,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      failures.push(`${name}:\n${(result.stdout ?? '') + (result.stderr ?? '')}`.trimEnd());
    }
  }

  if (failures.length === 0) process.exit(0);

  console.error(
    `The repository is not in a valid state:\n\n${failures.join('\n\n')}\n\n` +
      `Fix these, then run \`npm run gate\` before finishing.`,
  );
  process.exit(2);
};

main().catch(() => process.exit(0));
