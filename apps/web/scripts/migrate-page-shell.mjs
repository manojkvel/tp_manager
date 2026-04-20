#!/usr/bin/env node
// One-shot migration: strip the legacy page-level <main style={...}> wrapper
// and "← Breadcrumb" link paragraph from interior pages, since AppShell now
// provides the outer <main>. Idempotent — safe to re-run (no-op if already
// migrated). We deliberately keep interior content/styling alone so behaviour
// doesn't change; this only removes the duplicate chrome.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages');
const SKIP = new Set([
  'LoginPage.tsx',
  'ForgotPasswordPage.tsx',
  'DashboardPage.tsx',
  'StationViewPage.tsx', // printable view — owns its chrome
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (extname(name) === '.tsx') acc.push(p);
  }
  return acc;
}

const MAIN_OPEN_RE =
  /<main\s+style=\{\{\s*fontFamily:\s*'system-ui,\s*sans-serif',\s*padding:\s*'1\.5rem'(?:,\s*maxWidth:\s*\d+)?\s*\}\}>/;

let changed = 0;
for (const file of walk(ROOT)) {
  if (SKIP.has(file.split('/').pop())) continue;
  const orig = readFileSync(file, 'utf8');
  if (!MAIN_OPEN_RE.test(orig)) continue;

  let out = orig
    // <main style={...}>  ->  <>
    .replace(MAIN_OPEN_RE, '<>')
    // matching </main>     ->  </>
    .replace(/<\/main>/g, '</>')
    // Legacy top-of-page breadcrumb line ("<p><Link to='/'>← …</Link></p>")
    // that duplicates the sidebar nav. Remove it.
    .replace(/^\s*<p><Link to="[^"]*">←[^<]*<\/Link><\/p>\s*\n/m, '');

  if (out !== orig) {
    writeFileSync(file, out);
    changed += 1;
    console.log(`✓ ${file.replace(ROOT, 'src/pages')}`);
  }
}
console.log(`\n${changed} page(s) migrated.`);
