/**
 * Phase 49.3 — brandPackParser unit tests.
 *
 * Pin the parser contract:
 *   - Empty input → EMPTY_PACK
 *   - Missing required sections → MISSING_SECTIONS with the missing list
 *   - Malformed structured sections (pricing without SKU, vertical
 *     without Outcome, etc.) → MALFORMED_SECTION
 *   - Theme without required fields or with invalid values → INVALID_THEME
 *   - Happy path → all 12 fields land in patch with correct shape
 */
import { describe, it, expect } from 'vitest';
import { parseBrandPack } from '../../src/services/brandPackParser.js';

const FULL_VALID_PACK = `# Acme Brand Pack

## 1. Tagline

Outcome-first ERP delivery, every time.

## 2. Subtitle

Where consultants meet measurable wins.

## 3. Company Description

Acme Consulting partners with mid-market firms to ship ERP that actually
moves the needle. We've delivered 200+ implementations across the GCC and
the UK.

## 4. Why Us

We're outcome-first, not effort-first. Every engagement ends with KPIs,
not a stack of slides.

## 5. Methodology

### 5.1 Frame

Baseline the operating model. We document what's happening today before
we propose what should change.

### 5.2 Build

Cut the new system. Configuration + integrations land in parallel.

### 5.3 Land

Go live with confidence. Hypercare is part of the price, not an upsell.

## 6. Roadmap

### 6.1 Quick wins

First 90 days post-go-live: KPI dashboards, role-based reports.

### 6.2 Scale

Next 6 months: deeper analytics, multi-entity consolidation.

## 7. Proposal Structure

### 7.1 Introduction

- Anchor the pain
- Quote the prospect

### 7.2 Proposed System

- Module-by-module breakdown
- Configuration vs. customisation split

## 8. Pricing Template

### 8.1 Discovery package

**SKU:** PKG-DISCOVERY-001
**Description:** 4-week scoping engagement
**Annual:** $25,000

### 8.2 Implementation package

**SKU:** PKG-IMPL-001
**Description:** Full ERP implementation
**Annual:** $150,000

## 9. Industry Verticals

### 9.1 Retail and Wholesale Distribution

**Outcome:** Single source of truth for SKU-level margin.
**Strategic context:** Omnichannel operators consolidating ERP.
**Approach:** Phase 1 GL + AR/AP, Phase 2 inventory + fulfilment.

### 9.2 Manufacturing

**Outcome:** Cycle-time reduction and BOM accuracy.
**Strategic context:** Discrete + process MFG operators on legacy MRP.
**Approach:** Start with the production module, layer planning later.

## 10. Voice Guide

Use sentence case for headlines. Active voice. No buzzwords.

## 11. CTA Options

### 11.1 Lock in your kickoff date this week.

Best for: prospects who've already validated budget.

### 11.2 Book a 30-minute working session.

Best for: late-stage evaluation.

## 12. Theme

**Font family:** Inter, system-ui, sans-serif
**Headline case:** sentence
**Accent color:** #1a8754
`;

describe('parseBrandPack — happy path', () => {
  it('returns ok=true for a complete pack', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    expect(r.ok).toBe(true);
  });

  it('extracts all 4 free-text sections', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.tagline).toContain('Outcome-first ERP delivery');
    expect(r.patch.subtitle).toContain('measurable wins');
    expect(r.patch.companyDescription).toContain('200+ implementations');
    expect(r.patch.whyUs).toContain('outcome-first, not effort-first');
  });

  it('parses methodology subsections in order', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.methodology).toEqual([
      { step: 1, title: 'Frame', body: expect.stringContaining('Baseline the operating model') },
      { step: 2, title: 'Build', body: expect.stringContaining('Cut the new system') },
      { step: 3, title: 'Land', body: expect.stringContaining('Go live with confidence') },
    ]);
  });

  it('parses roadmap with phase ordinals', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.roadmap).toHaveLength(2);
    expect(r.patch.roadmap![0]).toMatchObject({ phase: 1, title: 'Quick wins' });
    expect(r.patch.roadmap![1]).toMatchObject({ phase: 2, title: 'Scale' });
  });

  it('parses proposal structure with bullets', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.proposalStructure).toHaveLength(2);
    expect(r.patch.proposalStructure![0].bullets).toEqual(['Anchor the pain', 'Quote the prospect']);
  });

  it('parses pricing template with numeric Annual', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.pricingTemplate).toEqual([
      { sku: 'PKG-DISCOVERY-001', description: '4-week scoping engagement', annual: 25000 },
      { sku: 'PKG-IMPL-001', description: 'Full ERP implementation', annual: 150000 },
    ]);
  });

  it('parses industry verticals', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.industryVerticals).toHaveLength(2);
    expect(r.patch.industryVerticals![0]).toMatchObject({
      name: 'Retail and Wholesale Distribution',
      outcome: 'Single source of truth for SKU-level margin.',
    });
  });

  it('parses CTA options', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.ctaOptions).toHaveLength(2);
    expect(r.patch.ctaOptions![0].label).toContain('Lock in your kickoff date');
  });

  it('parses theme block', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    expect(r.patch.themeFontFamily).toBe('Inter, system-ui, sans-serif');
    expect(r.patch.themeHeadlineCase).toBe('sentence');
    expect(r.patch.themeAccentColor).toBe('#1a8754');
  });
});

describe('parseBrandPack — error paths', () => {
  it('returns EMPTY_PACK for empty input', () => {
    const r = parseBrandPack('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('EMPTY_PACK');
  });

  it('returns EMPTY_PACK for whitespace-only input', () => {
    const r = parseBrandPack('   \n\n  \t');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('EMPTY_PACK');
  });

  it('returns MISSING_SECTIONS when required sections are missing', () => {
    const partial = '# Pack\n\n## 1. Tagline\n\nx\n\n## 12. Theme\n\n**Font family:** Inter\n**Headline case:** sentence\n**Accent color:** #112233\n';
    const r = parseBrandPack(partial);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('MISSING_SECTIONS');
    expect(r.missingSections).toContain(2);
    expect(r.missingSections).toContain(11);
    expect(r.missingSections).not.toContain(1);
    expect(r.missingSections).not.toContain(12);
  });

  it('returns MALFORMED_SECTION when a pricing item has no SKU', () => {
    const broken = FULL_VALID_PACK.replace(
      '**SKU:** PKG-DISCOVERY-001\n',
      '',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('MALFORMED_SECTION');
    expect(r.malformedSection).toBe(8);
    expect(r.message).toContain('SKU');
  });

  it('returns MALFORMED_SECTION when a vertical has no Approach', () => {
    const broken = FULL_VALID_PACK.replace(
      '**Approach:** Phase 1 GL + AR/AP, Phase 2 inventory + fulfilment.',
      '',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('MALFORMED_SECTION');
    expect(r.malformedSection).toBe(9);
  });

  it('returns INVALID_THEME when headline case is unknown', () => {
    const broken = FULL_VALID_PACK.replace(
      '**Headline case:** sentence',
      '**Headline case:** banana',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('INVALID_THEME');
    expect(r.malformedSection).toBe(12);
  });

  it('returns INVALID_THEME when accent color is not hex', () => {
    const broken = FULL_VALID_PACK.replace(
      '**Accent color:** #1a8754',
      '**Accent color:** green',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('INVALID_THEME');
  });

  it('returns INVALID_THEME when accent color is missing entirely', () => {
    const broken = FULL_VALID_PACK.replace(
      '**Accent color:** #1a8754\n',
      '',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('INVALID_THEME');
    expect(r.message).toContain('Accent color');
  });

  it('returns MALFORMED_SECTION with non-numeric Annual', () => {
    const broken = FULL_VALID_PACK.replace(
      '**Annual:** $25,000',
      '**Annual:** five thousand bucks',
    );
    const r = parseBrandPack(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe('MALFORMED_SECTION');
    expect(r.malformedSection).toBe(8);
  });
});

describe('parseBrandPack — currency tolerance', () => {
  it('handles $ + commas + spaces in Annual', () => {
    const r = parseBrandPack(FULL_VALID_PACK);
    if (!r.ok) throw new Error('expected ok');
    // The fixture uses "$25,000" — the parser should land on 25000 not "25000".
    expect(r.patch.pricingTemplate?.[0].annual).toBe(25000);
  });
});
