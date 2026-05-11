/**
 * Phase 50.9.1 — exporter color-resolver tests.
 *
 * Pins the fallback chain the three exporters (PDF/DOCX/PPTX) share:
 *   primary   ← Firm.primaryColor   → Brand Pack themeAccentColor → PLATFORM_PRIMARY
 *   secondary ← Firm.secondaryColor → Brand Pack themeAccentColor → PLATFORM_SECONDARY
 *   accent    ← Brand Pack themeAccentColor → Firm.primaryColor   → PLATFORM_ACCENT
 *
 * Why the chain: the pre-50.9.1 wiring sent the platform purple
 * `#4f46e5` into every PDF when Firm.primaryColor was NULL — even
 * when the firm had ingested a Brand Pack with their real palette —
 * because `getFirmBranding` returned the platform default as a
 * concrete value and the exporter's `?? PLATFORM_PRIMARY` never
 * fired. The resolver below treats Brand Pack accent as the second
 * choice so a Brand-Pack-only firm gets their actual color.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveExportColors,
  PLATFORM_PRIMARY_HEX,
  PLATFORM_SECONDARY_HEX,
  PLATFORM_ACCENT_HEX,
} from '../../../src/services/exporters/types.js';

describe('resolveExportColors', () => {
  it('uses Firm.primaryColor when set', () => {
    const out = resolveExportColors({
      primaryColor: '#0A1A2F',
      secondaryColor: '#1FAE5C',
      themeAccentColor: '#FFAA00',
    });
    expect(out.primary).toBe('#0A1A2F');
    expect(out.secondary).toBe('#1FAE5C');
    expect(out.accent).toBe('#FFAA00');
  });

  it('falls back to Brand Pack themeAccentColor for primary when Firm.primaryColor is null', () => {
    const out = resolveExportColors({
      primaryColor: null,
      secondaryColor: null,
      themeAccentColor: '#1FAE5C',
    });
    // This is the Xelerate-on-prod case: Brand Pack ingested, no
    // Settings → Branding colors set. Should land green, not platform
    // purple.
    expect(out.primary).toBe('#1FAE5C');
    expect(out.secondary).toBe('#1FAE5C');
    expect(out.accent).toBe('#1FAE5C');
  });

  it('falls back to platform defaults when both Firm colors and Brand Pack accent are null', () => {
    const out = resolveExportColors({
      primaryColor: null,
      secondaryColor: null,
      themeAccentColor: null,
    });
    expect(out.primary).toBe(PLATFORM_PRIMARY_HEX);
    expect(out.secondary).toBe(PLATFORM_SECONDARY_HEX);
    expect(out.accent).toBe(PLATFORM_ACCENT_HEX);
  });

  it('uses Firm.primaryColor for accent when themeAccentColor is unset', () => {
    const out = resolveExportColors({
      primaryColor: '#0A1A2F',
      secondaryColor: null,
      themeAccentColor: null,
    });
    // Accent inherits primary so headings/cover dividers don't
    // suddenly look platform-default while the body looks branded.
    expect(out.accent).toBe('#0A1A2F');
  });

  it('NEVER returns the legacy platform purple `#4f46e5`', () => {
    // Defence-in-depth: the platform purple from DEFAULT_BRANDING was
    // the smoking gun for the 50.9.1 bug. If a future refactor
    // re-imports that hex value into the resolver, this fails loudly.
    for (const inputs of [
      { primaryColor: null, secondaryColor: null, themeAccentColor: null },
      { primaryColor: '#0A1A2F', secondaryColor: null, themeAccentColor: '#1FAE5C' },
      { primaryColor: null, secondaryColor: '#1FAE5C', themeAccentColor: null },
    ]) {
      const out = resolveExportColors(inputs);
      expect(out.primary.toLowerCase()).not.toBe('#4f46e5');
      expect(out.secondary.toLowerCase()).not.toBe('#4f46e5');
      expect(out.accent.toLowerCase()).not.toBe('#4f46e5');
    }
  });

  it('accepts undefined fields (caller convenience)', () => {
    const out = resolveExportColors({});
    expect(out.primary).toBe(PLATFORM_PRIMARY_HEX);
    expect(out.secondary).toBe(PLATFORM_SECONDARY_HEX);
    expect(out.accent).toBe(PLATFORM_ACCENT_HEX);
  });
});
