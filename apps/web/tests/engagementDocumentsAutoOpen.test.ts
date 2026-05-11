/**
 * Phase 50.9.4 — auto-open trigger contract for EngagementDocumentsPage.
 *
 * The sidebar "Generate Document" shortcut routes to
 *   /engagements/:id/documents?action=generate
 * and the page's mount effect inspects the query string to decide
 * whether to auto-open the template-picker modal. This file pins the
 * pure helper that drives that decision so a future refactor doesn't
 * silently change the URL contract (which would break the sidebar
 * shortcut without anything else screaming).
 */
import { describe, it, expect } from 'vitest';
import { shouldAutoOpenGenerateModal } from '../src/pages/EngagementDocumentsPage';

describe('shouldAutoOpenGenerateModal', () => {
  it('returns true when action=generate', () => {
    const params = new URLSearchParams('?action=generate');
    expect(shouldAutoOpenGenerateModal(params)).toBe(true);
  });

  it('returns false when no action param is present', () => {
    expect(shouldAutoOpenGenerateModal(new URLSearchParams(''))).toBe(false);
  });

  it('returns false for unknown action values', () => {
    const params = new URLSearchParams('?action=edit');
    expect(shouldAutoOpenGenerateModal(params)).toBe(false);
  });

  it('coexists with other query params without confusion', () => {
    const params = new URLSearchParams('?utm_source=email&action=generate&ref=2026');
    expect(shouldAutoOpenGenerateModal(params)).toBe(true);
  });

  it('is case-sensitive on the value (action=Generate is NOT a match)', () => {
    // Intentional: future shortcut variants like ?action=preview must
    // be additive — case-folding here would conflate them.
    const params = new URLSearchParams('?action=Generate');
    expect(shouldAutoOpenGenerateModal(params)).toBe(false);
  });
});
