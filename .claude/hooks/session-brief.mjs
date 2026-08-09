#!/usr/bin/env node
/**
 * SessionStart hook — a short, factual briefing so a fresh session knows where
 * the work actually stands instead of inferring it from the file tree.
 *
 * stdout from a SessionStart hook is added to the session context.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
};

const frontmatterValue = (source, key) => {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(source);
  return match === null ? null : match[1].trim();
};

const main = async () => {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    payload = {};
  }

  const projectDir = payload.cwd ?? process.cwd();
  const lines = [];

  const specsDir = path.join(projectDir, 'specs');
  if (existsSync(specsDir)) {
    const specs = readdirSync(specsDir)
      .filter((name) => /^SPEC-\d{3}.*\.md$/.test(name))
      .map((name) => {
        const source = readFileSync(path.join(specsDir, name), 'utf8');
        return {
          id: frontmatterValue(source, 'id') ?? name,
          title: frontmatterValue(source, 'title') ?? '',
          status: frontmatterValue(source, 'status') ?? 'unknown',
          wave: Number(frontmatterValue(source, 'wave') ?? '0'),
        };
      });

    if (specs.length > 0) {
      const open = specs.filter((spec) => spec.status !== 'done');
      const nextWave = open.length > 0 ? Math.min(...open.map((spec) => spec.wave)) : null;

      lines.push(`Specs: ${specs.length} total, ${specs.length - open.length} done.`);
      if (nextWave !== null) {
        const ready = open.filter((spec) => spec.wave === nextWave);
        lines.push(
          `Next wave (${nextWave}) — these can run in parallel, one agent each:`,
          ...ready.map((spec) => `  ${spec.id} [${spec.status}] ${spec.title}`),
        );
      }
    }
  }

  if (!existsSync(path.join(projectDir, 'node_modules'))) {
    lines.push('node_modules is absent — run `npm install` before the gate will work.');
  }

  lines.push(
    'Definition of done in this repo is `npm run gate`, not "my tests pass".',
    'Production code is written test-first; see .claude/skills/tdd-cycle/SKILL.md.',
  );

  console.log(lines.join('\n'));
  process.exit(0);
};

main().catch(() => process.exit(0));
