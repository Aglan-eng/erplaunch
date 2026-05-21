/**
 * Phase 55.2 — Server-side context builder for the AI assistant.
 *
 * Never trusts the client for data. Given a firm + user + optional
 * customerId, builds a structured object the model can reason over.
 * On a customer page: customer detail (name, stage, health,
 * owners, open blockers, pending decisions, recent activity,
 * stage-widget signal, document-catalog status for the stage).
 * Otherwise: a firm-wide rollup (pipeline, customers at risk,
 * renewals due, owners overloaded).
 */
import { getDb } from '../../db/index.js';
import { getCustomerDetail } from '../../db/customerDetail.js';
import { documentsForStage } from '../exporters/documentCatalog.js';
import { buildPipelineReport, buildHealthReport, buildRenewalsReport, buildUtilizationReport } from '../reports/buildReports.js';

export interface AssistantContext {
  scope: 'customer' | 'firm';
  page?: string;
  /** Set when scope === 'customer'. */
  customer?: CustomerContext;
  /** Set when scope === 'firm'. */
  firm?: FirmContext;
}

interface CustomerContext {
  id: string;
  name: string;
  currentStage: string;
  healthScore: number;
  healthBand: 'red' | 'yellow' | 'green';
  arr: number | null;
  owners: {
    sales: string | null;
    projectLead: string | null;
    csm: string | null;
    ar: string | null;
  };
  openBlockers: number;
  pendingDecisions: number;
  recentActivity: Array<{
    action: string;
    fromStage: string | null;
    toStage: string | null;
    actorName: string;
    createdAt: string;
  }>;
  stageWidget: unknown;
  documentsForStage: Array<{ id: string; name: string; status: 'available' | 'coming-soon' }>;
}

interface FirmContext {
  pipelineStalled: number;
  customersAtRisk: number;
  renewalsNext90: number;
  totalArrAtRisk: number;
  ownersOverloaded: number;
}

interface RowMeta {
  action: unknown;
  fromStage: unknown;
  toStage: unknown;
  actorName: unknown;
  createdAt: unknown;
}

async function loadCustomerContext(firmId: string, customerId: string): Promise<CustomerContext | null> {
  const detail = await getCustomerDetail(customerId, firmId);
  if (!detail) return null;

  const db = getDb();
  const blockers = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM IssueItem WHERE engagementId = ? AND status = 'OPEN'`,
    args: [customerId],
  });
  const openBlockers = Number((blockers.rows[0] as unknown as { c?: number | string } | undefined)?.c ?? 0);
  const decisions = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM DecisionItem WHERE engagementId = ? AND decidedAt IS NULL`,
    args: [customerId],
  });
  const pendingDecisions = Number((decisions.rows[0] as unknown as { c?: number | string } | undefined)?.c ?? 0);

  const activity = await db.execute({
    sql: `SELECT a.action, a.fromStage, a.toStage, a.createdAt, u.name AS actorName
          FROM ActivityLog a LEFT JOIN User u ON u.id = a.actorUserId
          WHERE a.customerId = ? OR a.engagementId = ?
          ORDER BY a.createdAt DESC LIMIT 10`,
    args: [customerId, customerId],
  });
  const recentActivity = activity.rows.map((raw) => {
    const r = raw as unknown as RowMeta;
    return {
      action: String(r.action),
      fromStage: r.fromStage == null ? null : String(r.fromStage),
      toStage: r.toStage == null ? null : String(r.toStage),
      actorName: r.actorName == null ? 'system' : String(r.actorName),
      createdAt: String(r.createdAt),
    };
  });

  const docs = documentsForStage(detail.currentStage).map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
  }));

  return {
    id: detail.id,
    name: detail.name,
    currentStage: detail.currentStage,
    healthScore: detail.healthScore,
    healthBand: detail.healthBand,
    arr: detail.arr ?? null,
    owners: {
      sales: detail.salesOwner?.name ?? null,
      projectLead: detail.projectLeadOwner?.name ?? null,
      csm: detail.csmOwner?.name ?? null,
      ar: detail.arOwner?.name ?? null,
    },
    openBlockers,
    pendingDecisions,
    recentActivity,
    stageWidget: detail.stageWidget,
    documentsForStage: docs,
  };
}

async function loadFirmContext(firmId: string): Promise<FirmContext> {
  const [pipeline, health, renewals, util] = await Promise.all([
    buildPipelineReport(firmId),
    buildHealthReport(firmId),
    buildRenewalsReport(firmId),
    buildUtilizationReport(firmId),
  ]);
  return {
    pipelineStalled: pipeline.stalledCount,
    customersAtRisk: health.distribution.red,
    renewalsNext90: renewals.next90Days.length,
    totalArrAtRisk: renewals.totalArrAtRisk,
    ownersOverloaded: util.overloadedUsers,
  };
}

export async function buildAssistantContext(opts: {
  firmId: string;
  customerId?: string | null;
  page?: string;
}): Promise<AssistantContext> {
  if (opts.customerId) {
    const customer = await loadCustomerContext(opts.firmId, opts.customerId);
    if (customer) {
      return { scope: 'customer', page: opts.page, customer };
    }
  }
  const firm = await loadFirmContext(opts.firmId);
  return { scope: 'firm', page: opts.page, firm };
}
