import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErplaunchLogo } from '../src/components/ui/ErplaunchLogo';

/**
 * Phase 38.5 — confirms the login + dashboard logo lockup renders without
 * needing @testing-library. Uses react-dom/server.renderToStaticMarkup
 * (already pulled in by the SSR-safe parts of the app) so the assertion
 * runs in pure Node.
 */

describe('ErplaunchLogo', () => {
  it('renders the SVG glyph + ERPLaunch wordmark by default', () => {
    const html = renderToStaticMarkup(<ErplaunchLogo />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="ERPLaunch"');
    expect(html).toContain('ERPLaunch');
  });

  it('omits the wordmark when glyphOnly is true', () => {
    const html = renderToStaticMarkup(<ErplaunchLogo glyphOnly />);
    expect(html).toContain('<svg');
    // The wordmark <span> is the only place "ERPLaunch" text appears outside
    // the aria-label — rendering glyph-only should leave that text only in
    // the aria-label attribute.
    const occurrences = (html.match(/ERPLaunch/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('uses the light-on-dark variant when requested', () => {
    const html = renderToStaticMarkup(<ErplaunchLogo variant="light-on-dark" />);
    // Light variant uses #ffffff for the word color — assert presence in the
    // inline style.
    expect(html).toContain('#ffffff');
  });

  it('size lg produces a 48px glyph; sm produces 24px', () => {
    const lg = renderToStaticMarkup(<ErplaunchLogo size="lg" />);
    const sm = renderToStaticMarkup(<ErplaunchLogo size="sm" />);
    expect(lg).toContain('width="48"');
    expect(sm).toContain('width="24"');
  });
});
