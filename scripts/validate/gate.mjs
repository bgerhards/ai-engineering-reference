#!/usr/bin/env node
/**
 * gate.mjs — the definition of done, in one command.
 *
 * Every check that stands between a change and "finished" runs here, in a fixed
 * order chosen so the cheapest, most specific failure surfaces first: you learn
 * about a type error in two seconds rather than after a four-minute test run.
 *
 * The gate exists so "done" is a fact rather than an opinion, and so nobody has
 * to remember six commands. Every step keeps running even after an earlier one
 * fails — one run should tell you everything that is wrong, not just the first
 * thing. The summary at the end is the report; the streamed output is the detail.
 *
 *   node scripts/validate/gate.mjs              # everything, including coverage
 *   node scripts/validate/gate.mjs --quick      # no coverage — what the Stop hook runs
 *   node scripts/validate/gate.mjs --only=specs # one step, while iterating
 *   node scripts/validate/gate.mjs --json       # machine-readable summary
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NODE = process.execPath;

const script = (name) => [NODE, [`scripts/validate/${name}.mjs`]];

const STEPS = [
  {
    name: 'typecheck',
    command: () => [NPM, ['run', 'typecheck']],
    next: 'Fix the type errors above. `npm run typecheck` reruns just this step.',
  },
  {
    name: 'lint',
    command: () => [NPM, ['run', 'lint']],
    next: 'Run `npm run lint:fix` for the mechanical ones; layering and complexity errors need a real fix, not a disable comment.',
  },
  {
    name: 'architecture',
    command: () => script('architecture'),
    next: 'An import crossed a boundary. Read .claude/skills/hexagonal-architecture/SKILL.md — the fix is usually a port, not an exception.',
  },
  {
    name: 'specs',
    command: () => script('specs'),
    next: 'A spec is malformed or two specs in one wave claim the same file. Re-split the ownership or move one spec to a later wave.',
  },
  {
    name: 'test-discipline',
    command: () => script('test-discipline'),
    next: 'A test is focused, skipped without a reason, asserting nothing, or a module has no test at all. Each one is a hole in the net.',
  },
  {
    name: 'tests',
    command: (quick) => [NPM, ['run', quick ? 'test' : 'test:coverage']],
    next: 'Read the first failure, not the last. If coverage failed, find the uncovered branch and either test it or delete it.',
  },
];

const parseArgs = (argv) => {
  const only = argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
  return { quick: argv.includes('--quick'), json: argv.includes('--json'), only };
};

const formatDuration = (ms) => (ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

const runStep = (step, { quick, json }) => {
  const [command, args] = step.command(quick);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  const durationMs = Date.now() - started;
  const output = json ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '';
  const status = result.error ? 1 : (result.status ?? 1);
  return {
    name: step.name,
    ok: status === 0,
    status,
    durationMs,
    ...(result.error ? { message: result.error.message } : {}),
    ...(json && status !== 0 ? { output: output.split('\n').slice(-40).join('\n') } : {}),
  };
};

const printSummary = (results, options) => {
  const width = Math.max(...STEPS.map((step) => step.name.length));
  console.log('\n  gate summary');
  console.log(`  ${'-'.repeat(width + 22)}`);
  for (const result of results) {
    const mark = result.skipped ? '-' : result.ok ? '✓' : '✗';
    const state = result.skipped ? 'skipped' : result.ok ? 'pass' : 'FAIL';
    console.log(
      `  ${mark} ${result.name.padEnd(width)}  ${state.padEnd(7)}  ${result.skipped ? '' : formatDuration(result.durationMs).padStart(7)}`,
    );
  }
  const failed = results.filter((result) => !result.ok && !result.skipped);
  const total = results.reduce((sum, result) => sum + (result.durationMs ?? 0), 0);
  console.log(`  ${'-'.repeat(width + 22)}`);
  console.log(`  ${failed.length === 0 ? 'gate passed' : `${String(failed.length)} step(s) failed`} in ${formatDuration(total)}${options.quick ? ' (quick: coverage skipped)' : ''}\n`);

  if (failed.length > 0) {
    console.log('  what to do next:');
    for (const result of failed) {
      console.log(`    ${result.name}: ${STEPS.find((step) => step.name === result.name).next}`);
    }
    console.log('');
  }
};

const run = () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.only !== undefined && !STEPS.some((step) => step.name === options.only)) {
    console.error(`unknown step '${options.only}'. Available: ${STEPS.map((step) => step.name).join(', ')}.`);
    process.exit(1);
  }

  const results = [];
  for (const step of STEPS) {
    if (options.only !== undefined && step.name !== options.only) {
      results.push({ name: step.name, ok: true, skipped: true });
      continue;
    }
    if (!options.json) console.log(`\n> ${step.name}\n`);
    results.push(runStep(step, options));
  }

  const failed = results.filter((result) => !result.ok && !result.skipped);
  if (options.json) {
    console.log(JSON.stringify({ ok: failed.length === 0, quick: options.quick, steps: results }, null, 2));
  } else {
    printSummary(results, options);
  }
  process.exit(failed.length === 0 ? 0 : 1);
};

run();
