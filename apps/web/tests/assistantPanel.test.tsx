/**
 * Phase 55.2 — AssistantPanel SSR tests.
 *
 * Verifies the context-aware panel's structural contract:
 *   - The sidebar trigger is rendered as part of every AppShell.
 *   - The panel is hidden by default (not in the DOM).
 *   - When forced open via the test harness, it renders the
 *     context line, transcript, composer, and an empty-state hint.
 *   - On a customer route, the panel exposes `data-customer-id`
 *     so the context-line assertion can pin the route → customer
 *     binding.
 *
 * Because SSR can't run the open/close click handlers, we drive
 * the open state by mounting the panel inside an `AssistantProvider`
 * that's wrapped to start open. The provider's keyboard hook is
 * also a client-only effect.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  AssistantProvider,
  AssistantTrigger,
  useAssistantPanel,
} from '../src/components/assistant/AssistantPanel';
import { AuthContext } from '../src/contexts/AuthContext';

function fakeAuth() {
  return {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Demo', role: 'APP_ADMIN' as const },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

// Touch the hook export so the import isn't dropped — runtime sanity.
void useAssistantPanel;

function render(node: React.ReactElement, route = '/dashboard'): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('AssistantTrigger — sidebar affordance', () => {
  it('renders the trigger inside the provider', () => {
    const html = render(
      <AssistantProvider>
        <AssistantTrigger />
      </AssistantProvider>,
    );
    expect(html).toContain('data-testid="assistant-trigger"');
    expect(html).toContain('Assistant');
  });

  it('hides the label when collapsed=true (icon-only rail)', () => {
    const html = render(
      <AssistantProvider>
        <AssistantTrigger collapsed={true} />
      </AssistantProvider>,
    );
    expect(html).toContain('data-testid="assistant-trigger"');
    expect(html).not.toContain('⌘J');
  });
});

describe('AssistantPanel — closed by default', () => {
  it('does not render the panel when no one has opened it', () => {
    const html = render(
      <AssistantProvider>
        <div data-testid="page-body">hello</div>
      </AssistantProvider>,
    );
    expect(html).not.toContain('data-testid="assistant-panel"');
    expect(html).toContain('data-testid="page-body"');
  });
});

describe('AssistantPanel — forced-open render shape', () => {
  it('renders header + context line + transcript + composer when open', () => {
    const html = render(
      <AssistantProvider initialOpen={true}>
        <div />
      </AssistantProvider>,
    );
    expect(html).toContain('data-testid="assistant-panel"');
    expect(html).toContain('data-testid="assistant-close"');
    expect(html).toContain('data-testid="assistant-context-line"');
    expect(html).toContain('data-testid="assistant-transcript"');
    expect(html).toContain('data-testid="assistant-input"');
    expect(html).toContain('data-testid="assistant-send"');
    expect(html).toContain('data-testid="assistant-empty"');
  });

  it('firm-wide route → context line names the route, no customer id', () => {
    const html = render(
      <AssistantProvider initialOpen={true}>
        <div />
      </AssistantProvider>,
      '/dashboard',
    );
    expect(html).toMatch(/data-testid="assistant-panel"[^>]*data-customer-id=""/);
    expect(html).toContain('Firm-wide context');
    expect(html).toContain('/dashboard');
  });

  it('customer route → panel carries the customer id + assists on that customer', () => {
    const html = renderToStaticMarkup(
      <AuthContext.Provider value={fakeAuth()}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/customers/cust-42?tab=overview']}>
            <Routes>
              <Route
                path="/customers/:id"
                element={
                  <AssistantProvider initialOpen={true}>
                    <div />
                  </AssistantProvider>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );
    expect(html).toContain('data-testid="assistant-panel"');
    expect(html).toMatch(/data-testid="assistant-panel"[^>]*data-customer-id="cust-42"/);
    expect(html).toContain('Assisting with customer cust-42');
    // Composer placeholder adapts to the customer scope.
    expect(html).toContain('Ask about this customer');
  });
});
