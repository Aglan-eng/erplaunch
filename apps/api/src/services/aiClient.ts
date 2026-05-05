/**
 * AI client factory (Phase 37.4).
 *
 * Centralizes Anthropic SDK construction so every caller reads the same env
 * var (`AI_API_KEY`). Replaces scattered `new Anthropic()` calls that
 * silently relied on the SDK's default `ANTHROPIC_API_KEY` lookup — which
 * forced the PO to set both `AI_API_KEY` AND `ANTHROPIC_API_KEY` on Render
 * to keep the Custom Adaptor parser working.
 *
 * Returns `null` when no key is configured. Callers degrade explicitly:
 * - aiAdvisor / aiProfileGenerator → fall back to heuristics.
 * - customAdaptorParse → mark the adaptor row FAILED with a clear
 *   "AI not configured" message instead of crashing inside the SDK.
 * - dataCollection → return a structured error to the consultant.
 */
import Anthropic from '@anthropic-ai/sdk';

export function getAnthropicApiKey(): string | null {
  const key = process.env.AI_API_KEY;
  if (!key) return null;
  return key;
}

export function getAnthropicClient(): Anthropic | null {
  const key = getAnthropicApiKey();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

/**
 * Returns the configured AI provider name. Today only `'anthropic'` is
 * wired; future providers (OpenAI / Bedrock) will branch here. Unset
 * defaults to `'anthropic'` for backwards compat.
 */
export function getAiProvider(): string {
  return process.env.AI_PROVIDER || 'anthropic';
}

/**
 * Returns the configured AI model name. Anthropic-specific default kept
 * because that's the only wired provider today; the default disappears
 * once provider-specific routing arrives.
 */
export function getAiModel(): string {
  return process.env.AI_MODEL || 'claude-sonnet-4-20250514';
}
