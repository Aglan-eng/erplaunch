import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionButton } from '../src/components/rbac/PermissionButton';

/**
 * Phase 44.4 — coverage for PermissionButton.
 *
 * The hook fetches /me/permissions via axios; we mock the api module
 * so the hook resolves synchronously to a fixture set per test.
 * Render uses react-dom/server.renderToStaticMarkup to keep it pure
 * Node — same pattern as other web tests.
 */

vi.mock('../src/lib/api', () => {
  return {
    api: {
      get: vi.fn(async () => ({ data: { data: globalThis.__permFixture } })),
    },
  };
});

declare global {
  // eslint-disable-next-line no-var
  var __permFixture: unknown;
}

function withClient(node: React.ReactElement): string {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  // Pre-seed the cache with the fixture so the synchronous render
  // sees the data immediately rather than going through the loading
  // state.
  client.setQueryData(['me-permissions', null], globalThis.__permFixture);
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, node),
  );
}

beforeEach(() => {
  globalThis.__permFixture = {
    userId: 'u1', firmId: 'f1', engagementId: null, stage: 'BUILD',
    firmRoles: [], engagementRoles: [], assignedModulesByRole: {},
    effective: {
      DECISIONS: 'WRITE',
      RISKS: 'READ',
      BILLING: 'NONE',
      ENGAGEMENT_META: 'WRITE',
      WIZARD_ANSWERS: 'NONE',
      ISSUES: 'NONE',
      MEETINGS: 'NONE',
      MEMBERS: 'NONE',
      DATA_COLLECTION: 'NONE',
      ACTION_ITEMS: 'NONE',
      COMMENTS: 'NONE',
      IMAGES: 'NONE',
      GENERATORS: 'NONE',
      ACTIVITY_LOG: 'NONE',
      INTEGRATIONS: 'NONE',
      ROLES: 'NONE',
    },
  };
});

describe('PermissionButton', () => {
  it('renders enabled with no tooltip when permission allows', () => {
    const html = withClient(
      <PermissionButton action="WRITE" resource="DECISIONS">
        New Decision
      </PermissionButton>
    );
    // No `disabled` attribute on the rendered button.
    expect(html).not.toMatch(/<button[^>]*\bdisabled\b/);
    // No tooltip.
    expect(html).not.toContain('Requires');
    // data-permission-allowed reflects the verdict.
    expect(html).toContain('data-permission-allowed="true"');
  });

  it('renders disabled with a Requires-tooltip when permission denies', () => {
    const html = withClient(
      <PermissionButton action="WRITE" resource="BILLING">
        Update Billing
      </PermissionButton>
    );
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
    expect(html).toContain('Requires INTERNAL_ACCOUNTANT to edit billing');
    expect(html).toContain('data-permission-allowed="false"');
  });

  it('disables when external `disabled` prop is set even if permitted', () => {
    const html = withClient(
      <PermissionButton action="WRITE" resource="DECISIONS" disabled>
        Submitting...
      </PermissionButton>
    );
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
    // External disabled doesn't add a permission tooltip.
    expect(html).not.toContain('Requires');
  });

  it('READ verdict on RISKS allows when matrix has READ', () => {
    const html = withClient(
      <PermissionButton action="READ" resource="RISKS">
        View Risks
      </PermissionButton>
    );
    expect(html).not.toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('WRITE verdict on RISKS denies (only READ granted) with tooltip', () => {
    const html = withClient(
      <PermissionButton action="WRITE" resource="RISKS">
        Add Risk
      </PermissionButton>
    );
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
    expect(html).toContain('Requires PROJECT_MANAGER to edit risks');
  });
});
