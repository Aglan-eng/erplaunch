/**
 * Phase 50.5 — TemplateVariablePalette render test.
 *
 * Static-render shape check — every group section renders, every
 * token chip has a `data-testid` matching its name. Click flow
 * (clipboard write + "Copied" badge) is exercised by the smoke
 * test in Phase 50.6 since clipboard APIs need jsdom shim.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TemplateVariablePalette } from '../src/components/TemplateVariablePalette';
import { TOKEN_CATALOG, TOKEN_GROUPS_IN_ORDER } from '../src/lib/tokenCatalog';

describe('TemplateVariablePalette', () => {
  it('renders the palette container with the documented heading', () => {
    const html = renderToStaticMarkup(<TemplateVariablePalette />);
    expect(html).toContain('data-testid="template-variable-palette"');
    expect(html).toContain('Variable palette');
  });

  it('renders one group section per group in TOKEN_GROUPS_IN_ORDER', () => {
    const html = renderToStaticMarkup(<TemplateVariablePalette />);
    for (const group of TOKEN_GROUPS_IN_ORDER) {
      expect(html).toContain(`data-testid="palette-group-${group}"`);
    }
  });

  it('renders a chip for every entry in TOKEN_CATALOG', () => {
    const html = renderToStaticMarkup(<TemplateVariablePalette />);
    for (const entry of TOKEN_CATALOG) {
      expect(html).toContain(`data-testid="palette-token-${entry.token}"`);
    }
  });

  it('chip text matches the token name verbatim', () => {
    const html = renderToStaticMarkup(<TemplateVariablePalette />);
    // Spot-check three tokens from different groups.
    expect(html).toContain('firm.name');
    expect(html).toContain('engagement.client');
    expect(html).toContain('decisions.signedOff');
  });
});
