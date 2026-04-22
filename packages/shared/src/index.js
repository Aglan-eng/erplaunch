import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
});

export const UpdateEngagementSchema = z.object({
  clientName: z.string().min(1).optional(),
  status: z.string().optional(),
});

export const PatchProfileSchema = z.object({
  answers: z.record(z.unknown()),
});

export const PutLicenseSchema = z.object({
  edition: z.string(),
  modules: z.array(z.string()),
});

export const CreateJobSchema = z.object({
  type: z.string().min(1),
});

// Question bank exports
export const QUESTIONS = {
  R2R: [],
  P2P: [],
  O2C: [],
  MFG: [],
  RTN: [],
};
