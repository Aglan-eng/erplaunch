import { describe, it, expect } from 'vitest';
import { generatePoApprovalScript } from '../../../src/services/generators/sdfPoApprovalScriptGenerator.js';

/**
 * Syntactic-validity check for emitted SuiteScript.
 *
 * Wraps the script in a stub that defines AMD's global `define` (the
 * NetSuite SuiteScript runtime provides it; Node doesn't) and then
 * pumps the whole thing through `new Function(...)`, which the V8
 * parser accepts iff the source is syntactically valid JS. Throws
 * SyntaxError otherwise. Dependency-free — no acorn / babel needed.
 *
 * `new Function` does NOT execute the body until called, so the
 * SuiteScript module body is only PARSED here, never run. This is the
 * cheapest valid-JS sanity gate I can build without adding a parser.
 */
function assertParsesAsJs(script: string): void {
  const stubbed = `var define = function(){}; ${script}`;
  new Function(stubbed);
}

/**
 * SuiteScript User Event Generator tests — first real-LOGIC SuiteScript
 * file from a wizard answer (XML-only generators came earlier).
 *
 * Pack contract:
 *   1. Parse the wizard's free-text TEXTAREA answer (one tier per line)
 *      into structured (label, minAmount, maxAmount, approver) tuples.
 *   2. When ALL lines parse → emit "resolved-mode" SuiteScript with the
 *      thresholds hardcoded in the APPROVAL_TIERS array.
 *   3. When ANY line fails → emit "fallback-mode" SuiteScript with the
 *      verbatim wizard answer in a TODO comment + a placeholder array
 *      the consultant fills in.
 *   4. Output is real production code — must NOT carry the audit Fix #7
 *      "STARTER SCAFFOLDING" banner that placeholder generators get.
 *   5. Output must parse as valid JS (sanity check via acorn).
 *
 * Test stratification:
 *   - Tier-line parsing (each of the 4 patterns; spacing variants;
 *     currency-symbol stripping; comma-thousands)
 *   - Resolved-mode JSDoc + APPROVAL_TIERS array correctness
 *   - Fallback-mode behavior (one bad line → whole file falls back)
 *   - Real-code contract (no STARTER SCAFFOLDING banner; valid JS)
 *   - Atlas-shaped seed (mirror of the demo bundle's 4-tier answer)
 */

const ATLAS_4_TIER_ANSWER =
  '<$5,000: auto-approve\n' +
  '$5,000-$50,000: Department Manager\n' +
  '$50,000-$250,000: VP Operations\n' +
  '>$250,000: CFO + Steering';

const BASE_INPUT = {
  approvalTiers: ATLAS_4_TIER_ANSWER,
  clientName: 'Atlas Industries Group',
  firmName: 'NSIX',
};

// ─── Tier-line parsing ───────────────────────────────────────────────────────

describe('generatePoApprovalScript — tier-line parsing', () => {
  it('parses the "<$X" pattern into minAmount=0', () => {
    const out = generatePoApprovalScript({ ...BASE_INPUT, approvalTiers: '<$5,000: auto-approve' });
    expect(out).toContain('minAmount: 0');
    expect(out).toContain('maxAmount: 5000');
    expect(out).toContain("approver: 'auto'");
  });

  it('parses the "$X-$Y" range pattern with both bounds', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '$5,000-$50,000: Department Manager',
    });
    expect(out).toContain('minAmount: 5000');
    expect(out).toContain('maxAmount: 50000');
    expect(out).toContain("approver: 'Department Manager'");
  });

  it('parses the ">$Y" pattern into maxAmount=Infinity', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '>$250,000: CFO + Steering',
    });
    expect(out).toContain('minAmount: 250000');
    expect(out).toContain('maxAmount: Infinity');
    expect(out).toContain("approver: 'CFO + Steering'");
  });

  it('strips currency symbols and comma-thousands', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '$1,250,000-$10,000,000: Board Approval',
    });
    expect(out).toContain('minAmount: 1250000');
    expect(out).toContain('maxAmount: 10000000');
  });

  it('tolerates extra whitespace around delimiters', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '  <$5,000  :   auto-approve  ',
    });
    expect(out).toContain('minAmount: 0');
    expect(out).toContain('maxAmount: 5000');
    expect(out).toContain("approver: 'auto'");
  });

  it('handles CRLF line endings (Windows pasted answers)', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '<$5,000: auto-approve\r\n$5,000-$50,000: Manager',
    });
    expect(out).toContain('maxAmount: 5000');
    expect(out).toContain('maxAmount: 50000');
  });

  it('Atlas 4-tier answer parses all 4 lines into APPROVAL_TIERS', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    // Each tier appears once in APPROVAL_TIERS as a literal label
    expect(out).toContain("label: '<$5,000'");
    expect(out).toContain("label: '$5,000-$50,000'");
    expect(out).toContain("label: '$50,000-$250,000'");
    expect(out).toContain("label: '>$250,000'");
    // Resolved mode → no fallback marker
    expect(out).not.toContain('TODO: parse failed');
  });
});

// ─── Resolved-mode JSDoc + structure ─────────────────────────────────────────

describe('generatePoApprovalScript — resolved-mode JSDoc + structure', () => {
  it('declares @NApiVersion 2.1', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('@NApiVersion 2.1');
  });

  it('declares @NScriptType UserEventScript', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('@NScriptType UserEventScript');
  });

  it('declares @NModuleScope SameAccount', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('@NModuleScope SameAccount');
  });

  it('credits firm + client in the JSDoc header', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toMatch(/Generated by ERPLaunch from NSIX[^\n]*Atlas Industries Group/);
  });

  it('embeds the verbatim wizard answer in the JSDoc comment block', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('<$5,000: auto-approve');
    expect(out).toContain('>$250,000: CFO + Steering');
  });

  it('exports beforeSubmit + afterSubmit', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('return { beforeSubmit, afterSubmit }');
  });

  it('uses N/runtime + N/email + N/search + N/log modules', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toMatch(/define\(\['N\/runtime', 'N\/email', 'N\/search', 'N\/log'\]/);
  });

  it('emits exactly 4 APPROVAL_TIERS entries when wizard has 4 tiers', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    const tierEntries = out.match(/\{ label: /g) ?? [];
    expect(tierEntries).toHaveLength(4);
  });
});

// ─── Fallback mode (any unparseable line) ────────────────────────────────────

describe('generatePoApprovalScript — fallback mode', () => {
  it('triggers fallback when ANY line is unparseable (one bad line poisons the whole file)', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: '<$5,000: auto-approve\nthis is not a tier line\n>$50,000: CFO',
    });
    expect(out).toContain('TODO: parse failed');
  });

  it('embeds the verbatim wizard answer in the fallback TODO comment block', () => {
    const messy = 'gibberish line one\nanother gibberish line';
    const out = generatePoApprovalScript({ ...BASE_INPUT, approvalTiers: messy });
    expect(out).toContain('TODO: parse failed');
    expect(out).toContain('gibberish line one');
    expect(out).toContain('another gibberish line');
  });

  it('still emits a syntactically-valid script with placeholder APPROVAL_TIERS', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: 'unparseable',
    });
    expect(out).toContain('APPROVAL_TIERS');
    // Placeholder array uses TODO so consultant knows to fill it
    expect(out).toContain('TODO');
  });

  it('returns fallback for empty input as well (no tiers → can not resolve)', () => {
    const out = generatePoApprovalScript({ ...BASE_INPUT, approvalTiers: '' });
    expect(out).toContain('TODO');
  });
});

// ─── Real-code contract (no scaffolding banner; parses as valid JS) ──────────

describe('generatePoApprovalScript — real-code contract', () => {
  it('does NOT carry the audit Fix #7 STARTER SCAFFOLDING banner', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).not.toContain('STARTER SCAFFOLDING');
    expect(out).not.toContain('Starter Scaffolding');
  });

  it('does NOT carry the matching scaffolding warning prose', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).not.toMatch(/this file is a scaffolding/i);
    expect(out).not.toMatch(/replace this file/i);
  });

  it('resolved-mode output parses as valid JavaScript', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(() => assertParsesAsJs(out)).not.toThrow();
  });

  it('fallback-mode output parses as valid JavaScript', () => {
    const out = generatePoApprovalScript({
      ...BASE_INPUT,
      approvalTiers: 'unparseable',
    });
    expect(() => assertParsesAsJs(out)).not.toThrow();
  });

  it('output references the hardcoded NetSuite approval-status field IDs', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('APPROVED_STATUS_ID');
    expect(out).toContain('PENDING_APPROVAL_ID');
    // approvalstatus is the field NetSuite uses — pin it so the script
    // doesn't drift to a fictional field name in a future refactor.
    expect(out).toContain("fieldId: 'approvalstatus'");
  });

  it('routes non-auto tiers to a custom required-approver field', () => {
    const out = generatePoApprovalScript(BASE_INPUT);
    expect(out).toContain('custbody_nsix_required_approver');
  });
});
