import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
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

export const PutLicenseSchema = z.object({
  edition: z.enum(['STARTER', 'MID_MARKET', 'ONEWORLD']),
  modules: z.array(z.string()),
});

export const CreateJobSchema = z.object({
  type: z.enum(['BUSINESS_PROFILE', 'SDF', 'SUITESCRIPT', 'TRAINING_DOCX', 'RUNBOOK', 'UAT_SCRIPTS']),
});

export const UpdateEngagementSchema = z.object({
  clientName: z.string().min(1).max(200).optional(),
  status: z
    .enum(['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'])
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
