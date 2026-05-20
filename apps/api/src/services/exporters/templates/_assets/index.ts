/**
 * Phase 51.4 — bundled asset loader for the slide-deck templates.
 *
 * Reads the textured Xelerate backgrounds + Playfair Display/Lora
 * TTFs from disk once at module load and exposes them as base64
 * data-URIs. Render's Alpine Chromium has no system fonts, no shared
 * cache, and no outbound network during PDF generation — so every
 * binary asset must be inlined into the HTML before puppeteer's
 * `setContent`.
 *
 * Caching: a single `fs.readFileSync` per asset at module init.
 * Files are static + small (~2-3MB each); the cost is paid once per
 * worker process and amortised across every render in that process.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPngDataUri(filename: string): string {
  const buf = readFileSync(join(__dirname, filename));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function loadFontDataUri(filename: string): string {
  const buf = readFileSync(join(__dirname, 'fonts', filename));
  return `data:font/ttf;base64,${buf.toString('base64')}`;
}

export const ASSETS = {
  bgGreen: loadPngDataUri('bg-green.png'),
  bgNavy: loadPngDataUri('bg-navy.png'),
  fonts: {
    playfairBold: loadFontDataUri('PlayfairDisplay-Bold.ttf'),
    loraRegular: loadFontDataUri('Lora-Regular.ttf'),
    loraSemiBold: loadFontDataUri('Lora-SemiBold.ttf'),
  },
} as const;

/**
 * The `@font-face` block — emitted at the top of every slide-deck
 * template's <style>. Kept here so proposal + (later) SOW + future
 * slide templates can share the same font registration without
 * duplicating the base64 payload across template files.
 */
export function fontFaceCss(): string {
  return `
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url(${ASSETS.fonts.playfairBold}) format('truetype');
}
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(${ASSETS.fonts.loraRegular}) format('truetype');
}
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url(${ASSETS.fonts.loraSemiBold}) format('truetype');
}
`;
}
