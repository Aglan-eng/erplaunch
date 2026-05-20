/**
 * Phase 51.4 hotfix — pin the inlined-asset bake.
 *
 * If `inline-export-assets.ts` was never run (or the generated file
 * got out of sync with the binary sources), `assets.generated.ts`
 * holds empty / placeholder strings and the proposal PDF renders
 * blank. These tests catch that locally + in CI before a blank deck
 * reaches prod.
 */
import { describe, it, expect } from 'vitest';
import {
  BG_GREEN_B64,
  BG_NAVY_B64,
  FONT_PLAYFAIR_B64,
  FONT_LORA_REGULAR_B64,
  FONT_LORA_SEMIBOLD_B64,
} from '../../../src/services/exporters/templates/_assets/assets.generated.js';
import { ASSETS, fontFaceCss } from '../../../src/services/exporters/templates/_assets/index.js';

describe('inlined export assets — base64 consts present', () => {
  it('every const is a non-empty string', () => {
    expect(BG_GREEN_B64.length).toBeGreaterThan(1000);
    expect(BG_NAVY_B64.length).toBeGreaterThan(1000);
    expect(FONT_PLAYFAIR_B64.length).toBeGreaterThan(1000);
    expect(FONT_LORA_REGULAR_B64.length).toBeGreaterThan(1000);
    expect(FONT_LORA_SEMIBOLD_B64.length).toBeGreaterThan(1000);
  });

  it('PNG consts begin with the iVBOR signature (base64 of PNG magic 89 50 4E 47)', () => {
    expect(BG_GREEN_B64.startsWith('iVBOR')).toBe(true);
    expect(BG_NAVY_B64.startsWith('iVBOR')).toBe(true);
  });

  it('TTF consts begin with the AAEAAA signature (base64 of 00 01 00 00)', () => {
    expect(FONT_PLAYFAIR_B64.startsWith('AAEAAA')).toBe(true);
    expect(FONT_LORA_REGULAR_B64.startsWith('AAEAAA')).toBe(true);
    expect(FONT_LORA_SEMIBOLD_B64.startsWith('AAEAAA')).toBe(true);
  });
});

describe('ASSETS data-URI shape', () => {
  it('exposes ready-to-use data URIs for the templates', () => {
    expect(ASSETS.bgGreen.startsWith('data:image/png;base64,iVBOR')).toBe(true);
    expect(ASSETS.bgNavy.startsWith('data:image/png;base64,iVBOR')).toBe(true);
    expect(ASSETS.fonts.playfairBold.startsWith('data:font/ttf;base64,AAEAAA')).toBe(true);
    expect(ASSETS.fonts.loraRegular.startsWith('data:font/ttf;base64,AAEAAA')).toBe(true);
    expect(ASSETS.fonts.loraSemiBold.startsWith('data:font/ttf;base64,AAEAAA')).toBe(true);
  });

  it('fontFaceCss() emits @font-face declarations referencing the inlined TTFs', () => {
    const css = fontFaceCss();
    expect(css).toContain("font-family: 'Playfair Display'");
    expect(css).toContain("font-family: 'Lora'");
    expect(css).toContain('data:font/ttf;base64,AAEAAA');
    expect(css).toContain("format('truetype')");
  });
});
