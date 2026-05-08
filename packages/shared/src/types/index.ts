// ─── ENUMS ────────────────────────────────────────────────────────────────────

export type Plan = 'STARTER' | 'PRO' | 'ENTERPRISE';
export type UserRole = 'ADMIN' | 'PROJECT_MANAGER' | 'SENIOR_CONSULTANT' | 'CONSULTANT';
export type NSEdition = 'STARTER' | 'MID_MARKET' | 'ONEWORLD';
export type PhaseTrigger = 'LICENSE' | 'REQUIREMENT';
export type PhaseStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
export type EngagementStatus =
  | 'DISCOVERY'
  | 'SCOPING'
  | 'BUILD'
  | 'UAT'
  | 'GO_LIVE'
  | 'ARCHIVED';
export type ConflictType =
  | 'LICENSE_GAP'
  | 'PHASE_DEPENDENCY'
  | 'CONFIG_CONFLICT'
  | 'DATA_WARNING';
export type Severity = 'BLOCK' | 'WARN' | 'INFO';
export type JobType = 'BUSINESS_PROFILE' | 'SDF' | 'SUITESCRIPT' | 'TRAINING_DOCX' | 'RUNBOOK' | 'UAT_SCRIPTS' | 'HANDOFF_PACKAGE';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';

// ─── MODELS ───────────────────────────────────────────────────────────────────

export interface Firm {
  id: string;
  name: string;
  plan: Plan;
  slug: string;
  createdAt: Date;
}

export interface User {
  id: string;
  firmId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export type BusinessProfileAnswers = Record<string, unknown>;

export interface BusinessProfile {
  id: string;
  engagementId: string;
  version: number;
  answers: BusinessProfileAnswers;
  completeness: Record<string, number>;
  updatedAt: Date;
}

export interface LicenseProfile {
  id: string;
  engagementId: string;
  edition: NSEdition;
  modules: string[];
  updatedAt: Date;
}

export interface Phase {
  id: string;
  engagementId: string;
  name: string;
  order: number;
  flows: string[];
  trigger: PhaseTrigger;
  targetDate?: Date;
  status: PhaseStatus;
}

export interface ConflictLog {
  id: string;
  engagementId: string;
  ruleId: string;
  type: ConflictType;
  severity: Severity;
  questionIds: string[];
  message: string;
  resolution: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface GenerationJob {
  id: string;
  engagementId: string;
  type: JobType;
  status: JobStatus;
  outputUrl?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface Engagement {
  id: string;
  firmId: string;
  clientName: string;
  status: EngagementStatus;
  createdAt: Date;
  updatedAt: Date;
  profile?: BusinessProfile;
  license?: LicenseProfile;
  phases?: Phase[];
  conflicts?: ConflictLog[];
  jobs?: GenerationJob[];
}
