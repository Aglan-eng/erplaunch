/**
 * PendingSubmission payload schema registry (Phase 28, Q5).
 *
 * Each PendingSubmissionTargetType has a Zod schema describing its
 * expected `payload` shape. Phase 28 ships only the 'TEST' schema (a
 * passthrough that accepts any object) plus the registry plumbing.
 * Phases 29-32 each call registerSubmissionPayloadSchema() at module
 * load time:
 *
 *   Phase 29 (WIZARD_ANSWER):  z.object({ questionId: z.string(), answer: z.unknown() })
 *   Phase 30 (DATA_FILE):      z.object({ dataCollectionItemId: z.string(), fileId: z.string() })
 *   Phase 31 (QA_MESSAGE):     z.object({ threadId: z.string().nullable(), body: z.string().min(1) })
 *   Phase 32 (DECISION_SIGNOFF): z.object({ decisionId: z.string(), agree: z.boolean(), comment: z.string().nullable() })
 *
 * Validation contract: POST /portal/submissions runs the registered
 * schema's safeParse() against the incoming payload. Failure → 400
 * VALIDATION_ERROR with a structured details array. No registered schema
 * for the targetType → 400 UNKNOWN_TARGET_TYPE (defensive — prevents
 * Phase 29+ rolling out an acceptor without also registering its schema).
 *
 * Mirrors the acceptor registry pattern in pendingSubmissionAcceptors.ts —
 * same last-wins re-registration semantics so tests + hot-reload work.
 */

import { z, type ZodTypeAny } from 'zod';
import type { PendingSubmissionTargetType } from '../db/pendingSubmission.js';

const REGISTRY = new Map<PendingSubmissionTargetType, ZodTypeAny>();

export function registerSubmissionPayloadSchema(
  targetType: PendingSubmissionTargetType,
  schema: ZodTypeAny,
): void {
  if (REGISTRY.has(targetType)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pendingSubmissionPayloadSchemas] re-registering schema for ${targetType} (last-wins)`,
    );
  }
  REGISTRY.set(targetType, schema);
}

export function getSubmissionPayloadSchema(
  targetType: PendingSubmissionTargetType,
): ZodTypeAny | null {
  return REGISTRY.get(targetType) ?? null;
}

// ─── TEST schema — Phase 28 only ────────────────────────────────────────────
//
// Accepts any object payload. Phase 28 tests use this to verify the route
// handler's validation flow without coupling to a real targetType's shape.
// Phases 29-32 will register strict schemas for their concrete targetTypes.
registerSubmissionPayloadSchema('TEST', z.object({}).passthrough());
