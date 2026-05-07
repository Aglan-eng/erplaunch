import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PermissionDeniedState,
  extractPermissionDenied,
} from '../src/components/rbac/PermissionDeniedState';

/**
 * Phase 44.5 — coverage for the friendly 403 empty state + the
 * extractPermissionDenied helper that pulls structured info out of
 * the API error.
 */

describe('PermissionDeniedState (component)', () => {
  it('renders the default title + body without an admin email', () => {
    const html = renderToStaticMarkup(
      <PermissionDeniedState requiredRole="PROJECT_LEAD" verb="view" resourceLabel="decisions" />
    );
    // Apostrophe is HTML-escaped as &#x27; by react-dom/server.
    expect(html).toContain('You don&#x27;t have permission to view this');
    expect(html).toContain('Talk to your App Admin');
    expect(html).toContain('PROJECT_LEAD');
    expect(html).toContain('to view decisions');
    // No CTA when adminEmail is omitted.
    expect(html).not.toContain('data-testid="permission-denied-cta"');
  });

  it('renders a mailto CTA when adminEmail is provided', () => {
    const html = renderToStaticMarkup(
      <PermissionDeniedState
        requiredRole="APP_ADMIN"
        verb="edit"
        resourceLabel="billing"
        adminEmail="admin@example.com"
      />
    );
    expect(html).toContain('data-testid="permission-denied-cta"');
    expect(html).toContain('admin@example.com');
    // mailto link with subject prefilled.
    expect(html).toContain('mailto:admin%40example.com');
    expect(html).toContain('subject=Requesting%20APP_ADMIN%20access');
  });

  it('falls back to "a higher role" when requiredRole is undefined', () => {
    const html = renderToStaticMarkup(<PermissionDeniedState />);
    expect(html).toContain('a higher role');
  });

  it('omits the resource phrase when resourceLabel is missing', () => {
    const html = renderToStaticMarkup(
      <PermissionDeniedState requiredRole="PROJECT_MANAGER" verb="view" />
    );
    expect(html).toContain('to access this surface');
  });

  it('honours an override title', () => {
    const html = renderToStaticMarkup(
      <PermissionDeniedState
        requiredRole="APP_ADMIN"
        verb="view"
        resourceLabel="this engagement"
        title="This engagement is admin-only"
      />
    );
    expect(html).toContain('This engagement is admin-only');
    // The default-title text (with HTML-escaped apostrophe) shouldn't appear.
    expect(html).not.toContain('You don&#x27;t have permission');
  });
});

describe('extractPermissionDenied (helper)', () => {
  it('returns null when err is undefined / null / non-object', () => {
    expect(extractPermissionDenied(undefined)).toBeNull();
    expect(extractPermissionDenied(null)).toBeNull();
    expect(extractPermissionDenied('plain string')).toBeNull();
  });

  it('returns null when status is not 403', () => {
    expect(
      extractPermissionDenied({
        response: { status: 401, data: { error: { code: 'UNAUTHORIZED' } } },
      }),
    ).toBeNull();
  });

  it('returns null when code is not FORBIDDEN', () => {
    expect(
      extractPermissionDenied({
        response: { status: 403, data: { error: { code: 'OTHER' } } },
      }),
    ).toBeNull();
  });

  it('returns the requiredRole + message for a 403 FORBIDDEN', () => {
    const out = extractPermissionDenied({
      response: {
        status: 403,
        data: {
          error: {
            code: 'FORBIDDEN',
            message: 'You don\'t have permission to view risks.',
            requiredRole: 'PROJECT_MANAGER',
          },
        },
      },
    });
    expect(out).toEqual({
      requiredRole: 'PROJECT_MANAGER',
      message: "You don't have permission to view risks.",
    });
  });
});
