/**
 * Phase 50.5 — GenerateFromTemplateModal static-render tests.
 *
 * The modal is closed by default and renders no DOM. The open
 * variant renders the three-step shell — picker on open, name on
 * step 2, preview on step 3. Click flow (mutations + clipboard +
 * query invalidation) is e2e-tested in Phase 50.6.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerateFromTemplateModal } from '../src/components/GenerateFromTemplateModal';

function render(open: boolean): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <GenerateFromTemplateModal
        engagementId="eng-1"
        open={open}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('GenerateFromTemplateModal', () => {
  it('renders nothing when closed', () => {
    const html = render(false);
    expect(html).toBe('');
  });

  it('renders the picker step shell when open', () => {
    const html = render(true);
    expect(html).toContain('data-testid="generate-from-template-modal"');
    expect(html).toContain('Pick a template');
    expect(html).toContain('data-testid="generate-modal-close"');
  });

  it('disables the Next button until a template is selected', () => {
    const html = render(true);
    expect(html).toContain('data-testid="generate-modal-next"');
    // React serialises `disabled` BEFORE other attributes — accept
    // either ordering rather than assume one.
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*data-testid="generate-modal-next"|<button[^>]*data-testid="generate-modal-next"[^>]*disabled/,
    );
  });

  it('has role="dialog" and aria-modal for accessibility', () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});
