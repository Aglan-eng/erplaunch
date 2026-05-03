import { describe, it, expect } from 'vitest';
import { generateGoNoGoMatrix } from '../../../src/services/generators/goNoGoMatrixGenerator.js';

describe('Pack V — goNoGoMatrixGenerator: structure', () => {
  it('emits the 3-decision-point sequence', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### T-2 hours: Pre-Cutover Go-or-Hold');
    expect(out.markdown).toMatch(/### T\+\d+h: Mid-Cutover Checkpoint/);
    expect(out.markdown).toMatch(/### T\+\d+h: Final Go Declaration/);
  });

  it('emits Decision Authority + Sign-off sections', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## Decision Authority');
    expect(out.markdown).toContain('## Sign-off');
  });

  it('platform default reads as ERP', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flows through when provided', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });

  it('mid-checkpoint timestamp is half of cutoverWindowHours', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      cutoverWindowHours: 48,
    });
    expect(out.markdown).toContain('### T+24h: Mid-Cutover Checkpoint');
    expect(out.markdown).toContain('### T+48h: Final Go Declaration');
  });

  it('defaults cutoverWindowHours to 36 → mid 18 / final 36', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### T+18h: Mid-Cutover Checkpoint');
    expect(out.markdown).toContain('### T+36h: Final Go Declaration');
  });
});

describe('Pack V — goNoGoMatrixGenerator: criteria + owners parsing', () => {
  it('parses goNoGoCriteria into pre-cutover decision rows', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoCriteria:
        'Migration tie-out: 100% TB match across all 4 entities\n' +
        'Smoke test pass rate: 100% of P0 scenarios green',
    });
    expect(out.markdown).toContain('| Migration tie-out | 100% TB match across all 4 entities |');
    expect(out.markdown).toContain('| Smoke test pass rate | 100% of P0 scenarios green |');
  });

  it('parses goNoGoOwners into the sign-off table', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoOwners:
        'Migration data: Karim Yaseen (Group CFO)\n' +
        'Final go/no-go: Helena Reyes (Sponsor)',
    });
    expect(out.markdown).toContain('| Migration data | Karim Yaseen (Group CFO) |');
    expect(out.markdown).toContain('| Final go/no-go | Helena Reyes (Sponsor) |');
  });

  it('shows placeholder rows when no criteria captured', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no criteria captured)_');
  });
});

describe('Pack V — goNoGoMatrixGenerator: owner resolution by area-keyword overlap', () => {
  it('matches criterion area to owner area by token overlap', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoCriteria: 'Migration tie-out: 100% TB match\nFunctional readiness: All P0 smoke green',
      goNoGoOwners:
        'Migration data: Karim Yaseen\n' +
        'Functional readiness: Aisha Othman\n' +
        'Final go/no-go: Helena Reyes',
    });
    // Migration tie-out → Migration data owner = Karim Yaseen.
    expect(out.markdown).toMatch(/\| Migration tie-out \| 100% TB match \| Karim Yaseen \|/);
    // Functional readiness → Functional readiness owner = Aisha Othman.
    expect(out.markdown).toMatch(/\| Functional readiness \| All P0 smoke green \| Aisha Othman \|/);
  });

  it('falls back to last owner when criterion area has no token overlap', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoCriteria: 'Some unmatched criterion: pass threshold',
      goNoGoOwners:
        'Migration data: Karim Yaseen\n' +
        'Functional readiness: Aisha Othman\n' +
        'Final go/no-go: Helena Reyes',
    });
    // Unmatched → catch-all to last owner (Helena Reyes — Final go/no-go).
    expect(out.markdown).toContain('| Some unmatched criterion | pass threshold | Helena Reyes |');
  });

  it('finds the explicit Final go/no-go owner for the Decision Authority section', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoOwners:
        'Migration data: Karim\n' +
        'Final go/no-go: Helena Reyes (Sponsor)',
    });
    expect(out.markdown).toContain('**final go/no-go is owned by**: **Helena Reyes (Sponsor)**');
  });

  it('falls back to last owner when no "Final go/no-go" entry exists', () => {
    const out = generateGoNoGoMatrix({
      clientName: 'Atlas',
      goNoGoOwners: 'Owner A: Person A\nOwner B: Person B',
    });
    expect(out.markdown).toContain('**final go/no-go is owned by**: **Person B**');
  });

  it('placeholder owner when no owners captured', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN final go/no-go owner]_');
  });
});

describe('Pack V — goNoGoMatrixGenerator: cross-references', () => {
  it('cross-refs Rollback_Plan + Communication_Plan', () => {
    const out = generateGoNoGoMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Rollback_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Communication_Plan.md');
  });
});
