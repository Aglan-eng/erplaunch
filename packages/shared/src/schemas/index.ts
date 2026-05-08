import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Password reset — request phase (Phase 16). Intentionally minimal: email only.
// Route always returns 202 regardless of whether the address maps to a user,
// so enumeration attacks can't distinguish registered vs unregistered emails.
export const RequestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

// Password reset — redemption phase. The token is the raw 64-hex string
// embedded in the email link; the server hashes it before DB lookup.
export const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
});

// Change password — authenticated flow for signed-in users (Phase 17).
// Requires the current password as a re-auth check so a stolen session
// cookie alone cannot rotate the password.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

// Email verification — redemption phase (Phase 19). The token is the raw
// 64-hex string from the verification email; the server hashes it before
// DB lookup. No password in this payload — verification is identity-only.
export const VerifyEmailSchema = z.object({
  token: z.string().min(20).max(200),
});

// Slug: kebab-case, 3-40 chars. Start+end alphanumeric. No consecutive dashes.
// Reserved word check happens in the route so the schema stays platform-agnostic.
export const SlugRegex = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export const CreateCustomAdaptorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(SlugRegex, 'Slug must be lowercase, 3-40 chars, letters/numbers/dashes, no leading/trailing dash.'),
});

export const UpdateCustomAdaptorDraftSchema = z.object({
  manifest: z.unknown().optional(),
  schema: z.unknown().optional(),
  license: z.unknown().optional(),
  phases: z.unknown().optional(),
  generators: z.unknown().optional(),
  rules: z.unknown().optional(),
});

export const RegisterSchema = z.object({
  firmName: z.string().trim().min(2).max(100),
  firmSlug: z.string().trim().toLowerCase().regex(SlugRegex, 'Slug must be lowercase, 3-40 chars, letters/numbers/dashes, no leading/trailing dash.'),
  adminName: z.string().trim().min(2).max(100),
  adminEmail: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export const CreateEngagementSchema = z.object({
  clientName: z.string().min(1).max(200),
  /** Platform adaptor ID. Optional — defaults to 'netsuite' in the route. */
  adaptorId: z.string().min(1).max(80).optional(),
});

export const PatchProfileSchema = z.object({
  answers: z.record(z.unknown()),
});

// Edition IDs are adaptor-specific: NetSuite ships STARTER/MID_MARKET/ONEWORLD,
// Odoo uses COMMUNITY/ENTERPRISE, custom adaptors declare whatever makes sense
// for the target system. The engagement route validates the concrete value
// against the active adaptor's license model, so this schema stays loose.
export const PutLicenseSchema = z.object({
  edition: z.string().min(1).max(80),
  modules: z.array(z.string().min(1).max(80)),
});

export const CreateJobSchema = z.object({
  // Phase 45.2 — HANDOFF_PACKAGE adds a closeout-time generator that
  // produces support-team-oriented docs (system catalog, AAI map,
  // SLA terms, escalation matrix, KT slides). Phase 45.7 adds
  // QUARTERLY_HEALTH_CHECK — a periodic SLA-stage report bundling
  // ticket KPIs, open-issue rollups, and recommended next actions.
  type: z.enum([
    'BUSINESS_PROFILE',
    'SDF',
    'SUITESCRIPT',
    'TRAINING_DOCX',
    'RUNBOOK',
    'UAT_SCRIPTS',
    'HANDOFF_PACKAGE',
    'QUARTERLY_HEALTH_CHECK',
    // Phase 46.3 — pre-sales proposal bundle (cover letter + summary
    // + solution overview + implementation approach + pricing + why-us
    // + T&Cs). Phase 46.4 follows with SOW.
    'PROPOSAL',
    // Phase 46.4 — Statement of Work (single signed PDF). Phase 46.5
    // wires DocuSign or a manual upload path on top of the artifact.
    'SOW',
  ]),
});

export const UpdateEngagementSchema = z.object({
  clientName: z.string().min(1).max(200).optional(),
  status: z
    .enum(['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE', 'ARCHIVED'])
    .optional(),
  startDate: z.string().optional().nullable(),
  contractEndDate: z.string().optional().nullable(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type CreateEngagementInput = z.infer<typeof CreateEngagementSchema>;
export type PatchProfileInput = z.infer<typeof PatchProfileSchema>;
export type PutLicenseInput = z.infer<typeof PutLicenseSchema>;
export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateEngagementInput = z.infer<typeof UpdateEngagementSchema>;
export type CreateCustomAdaptorInput = z.infer<typeof CreateCustomAdaptorSchema>;
export type UpdateCustomAdaptorDraftInput = z.infer<typeof UpdateCustomAdaptorDraftSchema>;
export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
