/**
 * Phase 48.1 — PortalOpenTicket component tests.
 *
 * Static-render tests (no jsdom click handling) — they pin the
 * conditional render shape: the form is hidden behind a CTA, and
 * the whole component is hidden when the client member isn't
 * authenticated.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalOpenTicket } from '../src/components/portal/PortalOpenTicket';

function renderWithProviders(ui: React.ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

describe('PortalOpenTicket', () => {
  it('renders nothing when the client member is not authenticated', () => {
    const html = renderWithProviders(<PortalOpenTicket authenticated={false} />);
    expect(html).toBe('');
  });

  it('renders the "Need help?" CTA when authenticated', () => {
    const html = renderWithProviders(<PortalOpenTicket authenticated={true} />);
    expect(html).toContain('data-testid="portal-open-ticket"');
    expect(html).toContain('data-testid="portal-open-ticket-cta"');
    expect(html).toContain('Need help?');
    expect(html).toContain('Open a ticket');
  });

  it('keeps the form collapsed on first render — only the CTA shows', () => {
    const html = renderWithProviders(<PortalOpenTicket authenticated={true} />);
    // The form container is not yet rendered.
    expect(html).not.toContain('data-testid="portal-open-ticket-form"');
    // No success state until a submit lands.
    expect(html).not.toContain('data-testid="portal-open-ticket-success"');
  });
});
