import { describe, it, expect } from 'vitest';
import {
  generateDashboards,
  inferCenter,
} from '../../../src/services/generators/sdfDashboardGenerator.js';
import type { EmittedSavedSearch } from '../../../src/services/generators/sdfSavedSearchGenerator.js';

/**
 * Pack F — Dashboard generator tests.
 *
 * Pack contract:
 *   1. Parse "<role>: <KPI1>, <KPI2>, ..." per line.
 *   2. Route role to NetSuite Center via keyword classifier.
 *   3. For each KPI, find a savedsearch whose title contains the KPI
 *      name as a case-insensitive substring; bind as a SEARCH_FORM
 *      portlet with alternating column placement.
 *   4. Unmatched KPIs preserved in a comment block at the top of the
 *      dashboard XML so the consultant sees what's missing.
 */

const FAKE_SEARCHES: EmittedSavedSearch[] = [
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_trial_balance', recordtype: 'TRANSACTION', title: 'Trial Balance', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_ar_aging', recordtype: 'INVOICE', title: 'AR Aging', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_open_ar', recordtype: 'INVOICE', title: 'Open AR', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_top_customers_by_rev', recordtype: 'CUSTOMER', title: 'Top Customers by Revenue', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_pending_bills', recordtype: 'VENDORBILL', title: 'Pending Vendor Bills', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_open_po', recordtype: 'PURCHORD', title: 'Open Purchase Orders', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_inventory_variance', recordtype: 'INVENTORYITEM', title: 'Inventory Variance', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_lots_expiring_soon', recordtype: 'INVENTORYITEM', title: 'Lots Expiring in 90 Days', origin: 'starter' },
  { filename: 'Objects/x.xml', scriptid: 'customsearch_nsix_open_production_orders', recordtype: 'ASSEMBLYBUILD', title: 'Open Production Orders', origin: 'kpi-catalog' },
];

const ATLAS_DASHBOARDS =
  'CFO: Trial Balance, AR Aging, Open AR, Top Customers\n' +
  'AP Clerk: Pending Bills, Open Purchase Orders\n' +
  'Sales Manager: Top Customers, Open Purchase Orders\n' +
  'Inventory Manager: Inventory Variance, Lots Expiring, Open Production Orders';

// ─── inferCenter classifier ────────────────────────────────────────────────

describe('inferCenter — role-to-center keyword classifier', () => {
  it('routes finance roles → ACCOUNTING_CENTER', () => {
    expect(inferCenter('CFO')).toBe('ACCOUNTING_CENTER');
    expect(inferCenter('Controller')).toBe('ACCOUNTING_CENTER');
    expect(inferCenter('AP Clerk')).toBe('ACCOUNTING_CENTER');
    expect(inferCenter('AR Clerk')).toBe('ACCOUNTING_CENTER');
    expect(inferCenter('Finance Director')).toBe('ACCOUNTING_CENTER');
  });

  it('routes sales roles → SALES_CENTER', () => {
    expect(inferCenter('Sales Manager')).toBe('SALES_CENTER');
    expect(inferCenter('Account Exec')).toBe('SALES_CENTER');
    expect(inferCenter('Business Dev Manager')).toBe('SALES_CENTER');
  });

  it('routes inventory / supply chain → INVENTORY_CENTER', () => {
    expect(inferCenter('Inventory Manager')).toBe('INVENTORY_CENTER');
    expect(inferCenter('Warehouse Lead')).toBe('INVENTORY_CENTER');
    expect(inferCenter('Supply Chain Director')).toBe('INVENTORY_CENTER');
  });

  it('routes procurement → PURCHASE_CENTER', () => {
    expect(inferCenter('Procurement Lead')).toBe('PURCHASE_CENTER');
    expect(inferCenter('Senior Buyer')).toBe('PURCHASE_CENTER');
  });

  it('routes manufacturing / production → MANUFACTURING_CENTER', () => {
    expect(inferCenter('Manufacturing Manager')).toBe('MANUFACTURING_CENTER');
    expect(inferCenter('Production Lead')).toBe('MANUFACTURING_CENTER');
    expect(inferCenter('Plant Manager')).toBe('MANUFACTURING_CENTER');
  });

  it('routes executive roles → EXECUTIVE_CENTER', () => {
    expect(inferCenter('CEO')).toBe('EXECUTIVE_CENTER');
    expect(inferCenter('COO')).toBe('EXECUTIVE_CENTER');
    expect(inferCenter('Executive Director')).toBe('EXECUTIVE_CENTER');
  });

  it('finance keywords win over executive when role title contains both (specificity-first)', () => {
    // "Executive Assistant to CFO" contains both "executive" and "CFO".
    // Finance roles match first per priority order — an EA-to-CFO uses
    // the CFO's accounting view in practice, not the executive view.
    expect(inferCenter('Executive Assistant to CFO')).toBe('ACCOUNTING_CENTER');
  });

  it('default → CLASSIC for unrecognised roles', () => {
    expect(inferCenter('Project Coordinator')).toBe('CLASSIC');
    expect(inferCenter('Random Title')).toBe('CLASSIC');
  });
});

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateDashboards — empty / smoke', () => {
  it('emits nothing when roleDashboardsAnswer is empty', () => {
    const out = generateDashboards({ roleDashboardsAnswer: '', savedSearches: FAKE_SEARCHES });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('emits nothing when answer is undefined', () => {
    const out = generateDashboards({ roleDashboardsAnswer: undefined, savedSearches: FAKE_SEARCHES });
    expect(out.files).toEqual({});
  });

  it('skips bad-format lines', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance\nrandom gibberish\nSales: Top Customers',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted).toHaveLength(2);
  });
});

// ─── Per-role emission ──────────────────────────────────────────────────────

describe('generateDashboards — per-role emission', () => {
  it('emits one publisheddashboard per role line', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: ATLAS_DASHBOARDS,
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted).toHaveLength(4);
  });

  it('scriptid follows custpubdash_nsix_<role_slug> convention', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance, AR Aging',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted[0].scriptid).toBe('custpubdash_nsix_cfo');
    expect(out.files['Objects/custpubdash_nsix_cfo.xml']).toContain(
      '<publisheddashboard scriptid="custpubdash_nsix_cfo">',
    );
  });

  it('dashboard name reads "<Role> Dashboard"', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'AP Clerk: Pending Bills',
      savedSearches: FAKE_SEARCHES,
    });
    expect(Object.values(out.files)[0]).toContain('<name>AP Clerk Dashboard</name>');
  });

  it('every dashboard XML has the publisheddashboard root + dashboards block', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: ATLAS_DASHBOARDS,
      savedSearches: FAKE_SEARCHES,
    });
    for (const xml of Object.values(out.files)) {
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<publisheddashboard scriptid="');
      expect(xml).toContain('<dashboards>');
      expect(xml).toContain('<centertab>SHORTCUTS</centertab>');
      expect(xml).toContain('<mode>UNLOCKED</mode>');
    }
  });
});

// ─── Center mapping in output ──────────────────────────────────────────────

describe('generateDashboards — center mapping', () => {
  it('CFO routes to ACCOUNTING_CENTER', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance',
      savedSearches: FAKE_SEARCHES,
    });
    expect(Object.values(out.files)[0]).toContain('<center>ACCOUNTING_CENTER</center>');
    expect(out.emitted[0].center).toBe('ACCOUNTING_CENTER');
  });

  it('Sales Manager routes to SALES_CENTER', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'Sales Manager: Top Customers',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted[0].center).toBe('SALES_CENTER');
  });

  it('Inventory Manager routes to INVENTORY_CENTER', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'Inventory Manager: Inventory Variance',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted[0].center).toBe('INVENTORY_CENTER');
  });
});

// ─── KPI matching + portlet wiring ─────────────────────────────────────────

describe('generateDashboards — KPI matching + portlet wiring', () => {
  it('matches KPIs to savedsearches by case-insensitive title substring', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance, AR Aging',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted[0].matchedSearchScriptids).toEqual([
      'customsearch_nsix_trial_balance',
      'customsearch_nsix_ar_aging',
    ]);
  });

  it('emits one <portlet> per matched KPI in alternating columns', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance, AR Aging, Open AR',
      savedSearches: FAKE_SEARCHES,
    });
    const xml = Object.values(out.files)[0];
    const portlets = xml.match(/<portlet>/g) ?? [];
    expect(portlets).toHaveLength(3);
    expect(xml).toContain('<id>customsearch_nsix_trial_balance</id>');
    expect(xml).toContain('<id>customsearch_nsix_ar_aging</id>');
    expect(xml).toContain('<id>customsearch_nsix_open_ar</id>');
    expect(xml).toContain('<portlettype>SEARCH_FORM</portlettype>');
  });

  it('records unmatched KPIs and preserves them in the comment header', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance, NonexistentKPI, AR Aging',
      savedSearches: FAKE_SEARCHES,
    });
    expect(out.emitted[0].unmatchedKpis).toEqual(['NonexistentKPI']);
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('NonexistentKPI');
    expect(xml).toContain('Unmatched KPIs');
  });

  it('"none" comment block when every KPI matches', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'CFO: Trial Balance, AR Aging',
      savedSearches: FAKE_SEARCHES,
    });
    expect(Object.values(out.files)[0]).toContain('every requested KPI bound to a savedsearch');
  });

  it('Atlas-shaped dashboards: every role binds to ≥1 portlet', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: ATLAS_DASHBOARDS,
      savedSearches: FAKE_SEARCHES,
    });
    for (const e of out.emitted) {
      expect(e.matchedSearchScriptids.length, `role ${e.roleName} bound zero portlets`).toBeGreaterThan(0);
    }
  });
});

// ─── XML escaping ──────────────────────────────────────────────────────────

describe('generateDashboards — XML escaping', () => {
  it('escapes special chars in role name + KPI list', () => {
    const out = generateDashboards({
      roleDashboardsAnswer: 'Tom & Jerry: "Quoted" KPI',
      savedSearches: FAKE_SEARCHES,
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('Tom &amp; Jerry');
  });
});
