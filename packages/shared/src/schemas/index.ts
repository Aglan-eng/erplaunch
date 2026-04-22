import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const CreateEngagementSchema = z.object({
  clientName: z.string().min(1).max(200),
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
export type CreateEngagementInput = z.infer<typeof CreateEngagementSchema>;
export type PatchProfileInput = z.infer<typeof PatchProfileSchema>;
export type PutLicenseInput = z.infer<typeof PutLicenseSchema>;
export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateEngagementInput = z.infer<typeof UpdateEngagementSchema>;
