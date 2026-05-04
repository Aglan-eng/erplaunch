import { describe, it, expect } from 'vitest';
import {
  getPortalBrandingStyle,
  type FirmBranding,
} from '../src/components/portal/PortalBrandedHeader';

/**
 * Phase 27 — unit coverage for the portal branding helper.
 *
 * The DOM-rendering portion of the white-label propagation is exercised by
 * the Playwright e2e suite in apps/web-e2e/. This file covers the pure-TS
 * helper that bridges the FirmBranding payload onto the CSS custom
 * properties Tailwind arbitrary-value classes consume.
 *
 * Pairs with apps/api/tests/routes/portal.branding.test.ts which covers
 * the new GET /engagements/portal/:token/branding endpoint that the
 * pre-auth PortalLoginPage hits.
 */

describe('getPortalBrandingStyle', () => {
  it('maps primary + secondary colours onto CSS custom properties', () => {
    const branding: FirmBranding = {
      displayName: 'Acme',
      logoUrl: null,
      primaryColor: '#112233',
      secondaryColor: '#445566',
      supportEmail: null,
    };

    const style = getPortalBrandingStyle(branding) as Record<string, string>;
    expect(style['--portal-primary']).toBe('#112233');
    expect(style['--portal-secondary']).toBe('#445566');
  });

  it('passes colour values through verbatim (no normalisation, hex / oklch / rgb all work)', () => {
    const branding: FirmBranding = {
      displayName: 'Mixed Co',
      logoUrl: '/u/logo.png',
      primaryColor: 'oklch(68% 0.21 250)',
      secondaryColor: 'rgb(64, 128, 255)',
      supportEmail: 'help@mixed.example',
    };

    const style = getPortalBrandingStyle(branding) as Record<string, string>;
    expect(style['--portal-primary']).toBe('oklch(68% 0.21 250)');
    expect(style['--portal-secondary']).toBe('rgb(64, 128, 255)');
  });

  it('returns an object with exactly the two custom properties (no spillover)', () => {
    const branding: FirmBranding = {
      displayName: 'Lean',
      logoUrl: null,
      primaryColor: '#aabbcc',
      secondaryColor: '#ddeeff',
      supportEmail: null,
    };

    const style = getPortalBrandingStyle(branding) as Record<string, string>;
    const keys = Object.keys(style);
    expect(keys).toHaveLength(2);
    expect(keys.sort()).toEqual(['--portal-primary', '--portal-secondary']);
  });
});
