import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewActions } from '../src/components/wizard/pending-review/ReviewActions';

/**
 * Phase 41.2 — coverage for the shared ReviewActions footer.
 *
 * Pinned behaviour:
 *   - Comment textarea is collapsed behind an "Add comment" button on
 *     first render (the audit found the always-expanded textarea was
 *     the biggest fluency drag for bulk accepts).
 *   - Default accept label is "Accept" (verb consistency across cards
 *     — was "Acknowledge" on QaMessageCard).
 *   - acceptLabel prop overrides for surfaces that need a different
 *     verb in the future.
 *   - testIdPrefix flows through to the rendered data-testid attrs so
 *     each card's tests can target its actions.
 */

describe('ReviewActions', () => {
  it('collapses the comment textarea on first render', () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        submissionId="sub-1"
        testIdPrefix="wizard-answer"
        isReviewing={false}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
    // The "Add comment" button is rendered, the textarea is not.
    expect(html).toContain('data-testid="wizard-answer-comment-toggle-sub-1"');
    expect(html).toContain('Add comment');
    expect(html).not.toContain('data-testid="wizard-answer-comment-sub-1"');
  });

  it('renders Accept as the default primary label', () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        submissionId="sub-1"
        testIdPrefix="qa-message"
        isReviewing={false}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('Accept');
    // The legacy QaMessageCard verb should be gone.
    expect(html).not.toContain('Acknowledge');
  });

  it('respects an explicit acceptLabel override', () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        submissionId="sub-1"
        testIdPrefix="x"
        acceptLabel="Approve"
        isReviewing={false}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('Approve');
    expect(html).not.toContain('>Accept<');
  });

  it('disables both buttons while a parent mutation is in flight', () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        submissionId="sub-1"
        testIdPrefix="x"
        isReviewing={true}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
    // Two disabled buttons (accept + reject).
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(2);
  });

  it('threads testIdPrefix through accept/reject buttons', () => {
    const html = renderToStaticMarkup(
      <ReviewActions
        submissionId="sub-42"
        testIdPrefix="data-file"
        isReviewing={false}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
    expect(html).toContain('data-testid="data-file-accept-sub-42"');
    expect(html).toContain('data-testid="data-file-reject-sub-42"');
  });
});
