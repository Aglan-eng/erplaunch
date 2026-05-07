import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortalPreviewPanel } from '../src/components/settings/PortalPreviewPanel';

/**
 * Phase 41.3 — coverage for the Settings → Branding portal preview.
 *
 * The panel mirrors what a client sees when they sign into the portal,
 * driven entirely by the form state on the Settings page so colour /
 * logo / display-name tweaks update in real time. These tests pin the
 * pieces a customer demo cares about — display name, primary colour
 * applied to the CTA, support email link colour, and the logo / first-
 * letter fallback — without standing up @testing-library or jsdom.
 */

describe('PortalPreviewPanel', () => {
  it('renders the firm display name in the header', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="Acme Advisory"
        logoUrl={null}
        primaryColor="#4f46e5"
        secondaryColor="#818cf8"
        supportEmail="support@acme.example"
      />
    );
    expect(html).toContain('Acme Advisory');
    expect(html).toContain('Client Project Portal');
  });

  it('falls back to the first letter of the display name when no logo is set', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="Beacon Partners"
        logoUrl={null}
        primaryColor="#4f46e5"
        secondaryColor="#818cf8"
        supportEmail={null}
      />
    );
    expect(html).toContain('data-testid="portal-preview-tile-fallback"');
    expect(html).toContain('>B<');
  });

  it('renders the logo when provided and skips the fallback tile', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="Beacon Partners"
        logoUrl="https://cdn.example.com/logo.png"
        primaryColor="#4f46e5"
        secondaryColor="#818cf8"
        supportEmail={null}
      />
    );
    expect(html).toContain('https://cdn.example.com/logo.png');
    expect(html).not.toContain('data-testid="portal-preview-tile-fallback"');
  });

  it('applies the primary colour to the CTA button', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="X"
        logoUrl={null}
        primaryColor="#10b981"
        secondaryColor="#34d399"
        supportEmail={null}
      />
    );
    // Tailwind class can't carry the dynamic colour; the panel uses an
    // inline `background` style so the consultant sees their actual
    // colour in the preview.
    expect(html).toContain('data-testid="portal-preview-cta"');
    expect(html).toContain('background:#10b981');
  });

  it('renders the support link when supportEmail is set, with primary-coloured text', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="X"
        logoUrl={null}
        primaryColor="#10b981"
        secondaryColor="#34d399"
        supportEmail="help@beacon.example"
      />
    );
    expect(html).toContain('data-testid="portal-preview-support-link"');
    expect(html).toContain('help@beacon.example');
    // The link uses inline `color: <primary>` styling — same shape as
    // the CTA test, just `color` instead of `background`.
    expect(html).toContain('color:#10b981');
  });

  it('hides the support link when supportEmail is null', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="X"
        logoUrl={null}
        primaryColor="#10b981"
        secondaryColor="#34d399"
        supportEmail={null}
      />
    );
    expect(html).not.toContain('data-testid="portal-preview-support-link"');
  });

  it('uses primary→secondary gradient on the header band', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="X"
        logoUrl={null}
        primaryColor="#ff0000"
        secondaryColor="#00ff00"
        supportEmail={null}
      />
    );
    expect(html).toContain('linear-gradient(135deg, #ff0000, #00ff00)');
  });

  it('always shows three section rows in the body mock', () => {
    const html = renderToStaticMarkup(
      <PortalPreviewPanel
        displayName="X"
        logoUrl={null}
        primaryColor="#000000"
        secondaryColor="#ffffff"
        supportEmail={null}
      />
    );
    expect(html).toContain('questions waiting');
    expect(html).toContain('new message');
    expect(html).toContain('Decision sign-off');
  });
});
