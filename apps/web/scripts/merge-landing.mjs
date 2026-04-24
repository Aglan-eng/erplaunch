#!/usr/bin/env node
/**
 * Merge landing-page static output into the SPA's dist/ so a single Vercel
 * deployment serves both:
 *
 *   /                      → landing/index.html  (marketing entry point)
 *   /login, /signup, ...   → SPA  (via vercel.json rewrite to /app.html)
 *   /assets/*              → SPA's Vite bundles
 *   /styles.css, /chat.js, /favicon.svg, /robots.txt, /sitemap.xml
 *                           → landing static assets
 *
 * Mechanics:
 *   1. Rename dist/index.html (SPA's Vite entry) to dist/app.html so Vercel
 *      can still serve the SPA on every non-root route via rewrite.
 *   2. Copy every file from apps/landing/public/ into dist/, overwriting
 *      index.html (which is now the landing, not the SPA).
 *
 * Runs at deploy time as part of vercel.json buildCommand.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '..', 'dist');
const landingPublic = path.resolve(__dirname, '..', '..', 'landing', 'public');

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  if (!(await exists(webDist))) {
    throw new Error(`merge-landing: SPA dist not found at ${webDist} — did 'pnpm --filter @ofoq/web build' run first?`);
  }
  if (!(await exists(landingPublic))) {
    throw new Error(`merge-landing: landing/public not found at ${landingPublic} — did 'pnpm --filter @ofoq/landing build' run first?`);
  }

  // Step 1: move SPA's Vite-generated index.html out of the way so the
  // landing's index.html can take /. Vercel rewrites will route every
  // non-static route to /app.html to re-enter the SPA.
  const spaIndex = path.join(webDist, 'index.html');
  const spaEntry = path.join(webDist, 'app.html');
  if (await exists(spaIndex)) {
    await fs.rename(spaIndex, spaEntry);
    console.log('[merge-landing] renamed dist/index.html → dist/app.html (SPA entry)');
  }

  // Step 2: copy every landing static asset into dist. index.html replaces
  // the slot we just vacated; the others land alongside it.
  const entries = await fs.readdir(landingPublic, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(landingPublic, entry.name);
    const dest = path.join(webDist, entry.name);
    if (entry.isFile()) {
      await fs.copyFile(src, dest);
      console.log(`[merge-landing] copied landing/public/${entry.name} → dist/${entry.name}`);
    } else if (entry.isDirectory()) {
      // Use fs.cp for recursive directory copy; landing currently ships a
      // flat public/ but this keeps the script forward-compatible.
      await fs.cp(src, dest, { recursive: true });
      console.log(`[merge-landing] copied landing/public/${entry.name}/ → dist/${entry.name}/`);
    }
  }

  console.log('[merge-landing] done.');
}

main().catch((err) => {
  console.error('[merge-landing] FAILED:', err);
  process.exit(1);
});
