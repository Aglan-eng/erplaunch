import { describe, it, expect } from 'vitest';
import { generatePostCutoverSmoke } from '../../../src/services/generators/postCutoverSmokeGenerator.js';

describe('Pack V — postCutoverSmokeGenerator: structure', () => {
  it('emits the canonical 4 sections', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## First 4 Hours — P0 Smoke');
    expect(out.markdown).toContain('## First 24 Hours — P1 Smoke');
    expect(out.markdown).toContain('## Pass Criteria');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('P0 has Login / Workflow / Data sub-sections', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### Login Smoke');
    expect(out.markdown).toContain('### Workflow Smoke');
    expect(out.markdown).toContain('### Data Smoke');
  });
});

describe('Pack V — postCutoverSmokeGenerator: P1 from Pack T regression', () => {
  it('parses regressionSmokeScenarios into P1 numbered rows', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      regressionSmokeScenarios:
        'Login as each role: User lands on correct center\n' +
        'Create PO + approve: Routing correct',
    });
    expect(out.markdown).toContain('- [ ] **P1-01: Login as each role** — User lands on correct center');
    expect(out.markdown).toContain('- [ ] **P1-02: Create PO + approve** — Routing correct');
  });

  it('placeholder when no regression scenarios captured', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('no Pack T regression scenarios captured');
  });

  it('graceful handling of malformed lines (no colon)', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      regressionSmokeScenarios: 'Just a name',
    });
    expect(out.markdown).toContain('- [ ] **P1-01: Just a name** — _[ASSIGN validation]_');
  });
});

describe('Pack V — postCutoverSmokeGenerator: scope-flag conditional rows', () => {
  it('poApprovalInScope=true adds approval-routing P0 row', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      poApprovalInScope: true,
    });
    expect(out.markdown).toContain('PO routes through approval workflow');
  });

  it('poApprovalInScope=false omits approval-routing P0 row', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).not.toContain('PO routes through approval workflow');
  });

  it('vbApprovalInScope=true adds vendor bill approval row', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      vbApprovalInScope: true,
    });
    expect(out.markdown).toContain('Vendor Bill routes through approval workflow');
  });

  it('multiCurrencyInScope=true adds revaluation row', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      multiCurrencyInScope: true,
    });
    expect(out.markdown).toContain('Multi-currency revaluation completes');
  });

  it('ssoInScope=true changes login line to mention SSO', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      ssoInScope: true,
    });
    expect(out.markdown).toContain('SSO (per `ns.foundation.ssoInScope`) flow works');
  });

  it('ssoInScope=false renders direct-credentials line', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Direct credentialed login works (SSO not in scope)');
  });
});

describe('Pack V — postCutoverSmokeGenerator: roles list', () => {
  it('roles populate Login Smoke list', () => {
    const out = generatePostCutoverSmoke({
      clientName: 'Atlas',
      roles: ['AP Clerk', 'AR Clerk', 'CFO'],
    });
    expect(out.markdown).toContain('- [ ] AP Clerk can log in');
    expect(out.markdown).toContain('- [ ] AR Clerk can log in');
    expect(out.markdown).toContain('- [ ] CFO can log in');
  });

  it('falls back to placeholder when no roles provided', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('populate `training.curriculum.trainingPerRole`');
  });
});

describe('Pack V — postCutoverSmokeGenerator: pass criteria + cross-refs', () => {
  it('pass criteria mentions 100% P0 + 95% P1 thresholds', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('100% of P0');
    expect(out.markdown).toContain('95%+ of P1');
  });

  it('cross-refs Cutover Runbook + Go_No_Go_Matrix + Rollback_Plan', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_No_Go_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Rollback_Plan.md');
  });

  it('cross-refs Pack T Regression Suite + Defect Log', () => {
    const out = generatePostCutoverSmoke({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Regression_Test_Suite.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
