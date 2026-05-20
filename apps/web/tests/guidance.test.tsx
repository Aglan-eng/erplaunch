/**
 * Phase 53.1 — guidance-layer SSR tests.
 *
 * The components are all SSR-friendly (popover present in DOM,
 * toggled via state + CSS; tour state lives in localStorage with
 * sane no-op fallbacks under SSR). These tests pin the structural
 * contracts so a future refactor doesn't quietly strip the
 * onboarding copy.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HelpTip } from '../src/components/guidance/HelpTip';
import { EmptyState } from '../src/components/guidance/EmptyState';
import { OnboardingTour, hasSeenTour } from '../src/components/guidance/OnboardingTour';
import { HelpPage } from '../src/pages/HelpPage';
import { AuthContext } from '../src/contexts/AuthContext';

function fakeAuth() {
  return {
    user: {
      id: 'u-1',
      firmId: 'f-1',
      email: 't@x.io',
      name: 'Demo',
      role: 'APP_ADMIN' as const,
    },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function renderInRouter(node: React.ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── HelpTip ──────────────────────────────────────────────────────────────

describe('HelpTip', () => {
  it('renders the trigger button with the accessible label', () => {
    const html = renderToStaticMarkup(
      <HelpTip testid="ht-test" label="What is X?" body="X explains itself." />,
    );
    expect(html).toContain('data-testid="ht-test"');
    expect(html).toContain('aria-label="What is X?"');
    expect(html).toContain('role="tooltip"');
  });

  it('renders the body content in the DOM (SSR-friendly toggle via CSS)', () => {
    const html = renderToStaticMarkup(
      <HelpTip label="What is X?" body="X is the thing that does the thing." />,
    );
    // The body must be present in the SSR'd markup even though
    // visibility is toggled client-side via the `hidden` class.
    expect(html).toContain('X is the thing that does the thing.');
    expect(html).toContain('What is X?');
  });

  it('wires aria-controls between trigger and tooltip', () => {
    const html = renderToStaticMarkup(<HelpTip label="L" body="B" />);
    const triggerMatch = html.match(/aria-controls="(helptip-[^"]+)"/);
    expect(triggerMatch).not.toBeNull();
    expect(html).toContain(`id="${triggerMatch![1]}"`);
  });
});

// ─── EmptyState ───────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders headline + explanation', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        headline="No customers yet."
        explanation="Add your first customer to start tracking a deal from lead to renewal."
        testid="es-customers"
      />,
    );
    expect(html).toContain('data-testid="es-customers"');
    expect(html).toContain('No customers yet.');
    expect(html).toContain('Add your first customer');
  });

  it('renders an action link when `to` is provided', () => {
    const html = renderInRouter(
      <EmptyState
        headline="No customers yet."
        explanation="Add one."
        action={{ label: 'New customer', to: '/customers/new' }}
        testid="es-with-link"
      />,
    );
    expect(html).toContain('data-testid="es-with-link-action"');
    expect(html).toContain('href="/customers/new"');
    expect(html).toContain('New customer');
  });

  it('renders an action button when `onClick` is provided', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        headline="X"
        explanation="Y"
        action={{ label: 'Do thing', onClick: () => {} }}
        testid="es-with-click"
      />,
    );
    expect(html).toContain('data-testid="es-with-click-action"');
    expect(html).toMatch(/<button[^>]*>\s*Do thing\s*<\/button>/);
  });
});

// ─── OnboardingTour ───────────────────────────────────────────────────────

describe('OnboardingTour', () => {
  it('renders the first step when forced (welcome=1 path)', () => {
    const html = renderInRouter(<OnboardingTour forceShow={true} />);
    expect(html).toContain('data-testid="onboarding-tour"');
    expect(html).toContain('data-testid="onboarding-tour-step-0-title"');
    expect(html).toContain('Welcome to ERPLaunch');
  });

  it('exposes Skip + Next controls on the first step', () => {
    const html = renderInRouter(<OnboardingTour forceShow={true} />);
    expect(html).toContain('data-testid="onboarding-tour-skip"');
    expect(html).toContain('data-testid="onboarding-tour-next"');
    // Back button hidden on first step.
    expect(html).not.toContain('data-testid="onboarding-tour-back"');
  });

  it('renders five progress dots (one per step)', () => {
    const html = renderInRouter(<OnboardingTour forceShow={true} />);
    // 5 dot spans inside the dots container.
    const dotsMatch = html.match(/data-testid="onboarding-tour-dots"[^>]*>([\s\S]*?)<\/div>/);
    expect(dotsMatch).not.toBeNull();
    const dotCount = (dotsMatch![1].match(/<span/g) ?? []).length;
    expect(dotCount).toBe(5);
  });

  it('does NOT render when the seen-flag is set and forceShow is false', () => {
    // Simulate the post-tour state.
    const w = globalThis as unknown as { localStorage?: { getItem: (k: string) => string | null } };
    const fakeStorage: { getItem: (k: string) => string | null } = {
      getItem: (k: string) => (k === 'erplaunch.hasSeenTour' ? '1' : null),
    };
    const orig = w.localStorage;
    w.localStorage = fakeStorage;
    try {
      expect(hasSeenTour()).toBe(true);
      const html = renderInRouter(<OnboardingTour forceShow={false} />);
      expect(html).not.toContain('data-testid="onboarding-tour"');
    } finally {
      w.localStorage = orig;
    }
  });
});

// ─── Help guide page ──────────────────────────────────────────────────────

describe('HelpPage', () => {
  it('renders all six guide sections', () => {
    const html = renderInRouter(<HelpPage />);
    for (const id of ['lifecycle', 'owners', 'health', 'inbox', 'documents', 'reports']) {
      expect(html).toContain(`data-testid="help-section-${id}"`);
      expect(html).toContain(`data-testid="help-toc-${id}"`);
    }
  });

  it('lists every one of the 14 lifecycle stages', () => {
    const html = renderInRouter(<HelpPage />);
    for (const stage of [
      'Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Discovery',
      'Scoping',
      'Build',
      'UAT',
      'Go-live',
      'Hypercare',
      'Live SLA',
      'Renewal Due',
      'Renewed',
    ]) {
      expect(html).toContain(stage);
    }
  });

  it('exposes the Replay-tour button', () => {
    const html = renderInRouter(<HelpPage />);
    expect(html).toContain('data-testid="help-replay-tour"');
    expect(html).toContain('Replay the welcome tour');
  });
});
