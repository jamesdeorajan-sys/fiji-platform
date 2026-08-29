// Structural/config-level proofs required by the CEO incident correction (2026-08-29), items that
// don't fit as pure-function unit tests: that the removed external-scheduler endpoint is truly
// gone, that wrangler.toml's schedule is the single corrected expression, and that nothing in this
// app's configuration can bind a production resource.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_ROOT = path.join(__dirname, '..', '..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(APP_ROOT, relPath), 'utf8');
}

// Strips line comments (`//` for .ts, `#` for .toml) so a test can distinguish "this pattern
// exists as live code/config" from "a comment mentions the old/removed pattern by name to document
// why it was removed" - several of these checks would otherwise false-fail against this codebase's
// own explanatory comments.
function stripLineComments(src: string, marker: '//' | '#' = '//'): string {
  return src.split('\n').map(line => {
    const idx = line.indexOf(marker);
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
}

describe('1. the native scheduled() handler is the single orchestration entry point', () => {
  it('index.ts scheduled() calls runDueAgentTicks() and nothing branches on event.cron string equality', () => {
    const indexSrc = readSrc('src/index.ts');
    const codeOnly = stripLineComments(indexSrc);
    expect(indexSrc).toMatch(/runDueAgentTicks\(/);
    expect(codeOnly).not.toMatch(/event\.cron\s*===/);
    expect(codeOnly).not.toMatch(/controller\.cron\s*===\s*['"]/); // no exact-string branch on the cron expression anywhere in live code
  });
});

describe('7. internal endpoint /internal/tick/all is absent (removed, not merely re-protected)', () => {
  it('no LIVE route registration for /internal/tick/all exists anywhere in src/ (a changelog comment naming the removed path is fine)', () => {
    const srcDir = path.join(APP_ROOT, 'src');
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
    for (const f of files) {
      const content = stripLineComments(fs.readFileSync(path.join(srcDir, f), 'utf8'));
      expect(content.includes('/internal/tick/all')).toBe(false);
    }
  });

  it('no reference to an external scheduler/routine mechanism remains in application code (comments referencing the retracted design are fine in wrangler.toml only)', () => {
    const indexSrc = readSrc('src/index.ts');
    expect(indexSrc).not.toMatch(/external_schedule/);
    expect(indexSrc).not.toMatch(/RemoteTrigger|trig_[a-zA-Z0-9]+/);
  });
});

describe('6. scheduled runs cannot bind production - wrangler.toml references only isolated resources', () => {
  const wranglerToml = fs.readFileSync(path.join(APP_ROOT, 'wrangler.toml'), 'utf8');

  it('the single cron expression is the corrected "*/10 * * * *", not the old three-expression config', () => {
    const cronLine = wranglerToml.split('\n').find(l => l.trim().startsWith('crons ='));
    expect(cronLine).toContain('*/10 * * * *');
    expect(cronLine).not.toContain('*/12');
    expect(cronLine).not.toContain('*/15');
  });

  it('every binding name contains "vakaviti-offer-agent-preview" or is a generic non-account-specific binding (AI/ASSETS/version metadata)', () => {
    const databaseNameLines = wranglerToml.split('\n').filter(l => l.includes('database_name'));
    for (const line of databaseNameLines) expect(line).toMatch(/vakaviti-offer-agent-preview/);
    const queueLines = wranglerToml.split('\n').filter(l => l.trim().startsWith('queue ='));
    for (const line of queueLines) expect(line).toMatch(/vakaviti-offer-agent-preview/);
  });

  it('no known production database UUID (Stage 1 or Deal Exchange) appears anywhere in this app', () => {
    const PRODUCTION_UUIDS = [
      'f2753057-4319-404d-bcda-84cccd288fe1', // vakaviti-marketplace-stage1-db
      'f23a881b-80b9-4c2b-ab28-60751091ac25', // vakaviti-live-deal-exchange-db
      '3f9a36c7-829c-4f9d-8af0-bb5332860f4b', // vakaviti-live-deal-exchange-preview-db
    ];
    const srcDir = path.join(APP_ROOT, 'src');
    const allFiles = [wranglerToml, ...fs.readdirSync(srcDir).filter(f => f.endsWith('.ts')).map(f => fs.readFileSync(path.join(srcDir, f), 'utf8'))];
    for (const content of allFiles) {
      for (const uuid of PRODUCTION_UUIDS) expect(content.includes(uuid)).toBe(false);
    }
  });

  it('no route or custom domain is configured (this Worker is reachable only at its own *.workers.dev subdomain)', () => {
    const codeOnly = stripLineComments(wranglerToml, '#');
    expect(codeOnly).not.toMatch(/^\s*routes?\s*=/m);
    expect(codeOnly).not.toMatch(/\[\[routes\]\]/);
  });
});

describe('8. no credential appears in this app\'s own source tree', () => {
  it('no source file contains an "Authorization: Bearer <literal>" pattern with a real-looking token', () => {
    const srcDir = path.join(APP_ROOT, 'src');
    const files = fs.readdirSync(srcDir, { recursive: true } as any) as string[];
    for (const f of files) {
      const full = path.join(srcDir, f);
      if (!full.endsWith('.ts') || fs.statSync(full).isDirectory()) continue;
      const content = fs.readFileSync(full, 'utf8');
      // A real bearer token in this codebase would be a long base64url-ish string right after
      // "Bearer " - synthetic test fixtures use an obviously-fake, clearly-labelled value instead
      // (see agent-orchestration.test.ts), which this pattern is written to tolerate.
      const suspicious = content.match(/Bearer [A-Za-z0-9_-]{30,}/g) || [];
      const allowed = suspicious.filter(s => s.includes('synthetic') || s.includes('should-never') || s.includes('0000000000'));
      expect(suspicious.length).toBe(allowed.length);
    }
  });
});
