/**
 * ERPLaunch landing chatbot — Vercel Edge Function.
 *
 * POST /api/chat
 * Body: { messages: Array<{ role: 'user' | 'assistant', content: string }> }
 * Response: text/event-stream — SSE chunks `data: {"text":"..."}` then `data: [DONE]`.
 *
 * Uses Anthropic Claude Haiku (cheap, fast) with a grounded system prompt.
 * Key lives in env var AI_API_KEY (shared naming with the api app).
 */

import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are the ERPLaunch assistant — a friendly, direct guide for visitors on the ERPLaunch landing page.

## What ERPLaunch is

ERPLaunch is an AI-native implementation platform for consulting firms and software companies running ERP projects. It collapses months of discovery, configuration, training, UAT, and go-live into days.

## Facts you can state confidently

**Supported ERPs (first-party adaptors):** NetSuite, SAP S/4HANA, Oracle Fusion, Microsoft Dynamics 365, Odoo, ERPNext. A no-code Custom Adaptor wizard stands up any in-house or legacy system.

**Methodologies built in:** SAP Activate (SAP), SuiteSuccess (NetSuite), Oracle True Cloud Method (Oracle), Microsoft D365 Implementation Guide (Dynamics), Odoo Implementation Methodology, ERPNext Playbook. Firms fork the standard into their own practice; engagements tweak further. Provenance follows every change.

**Industry verticals:** Healthcare, Contracting, F&B Manufacturing, Retail, Field Services — layered on top of any ERP (never forked). Firms author private verticals in the Vertical Studio; optional marketplace.

**What it generates:** BRDs, SuiteScripts, SDF packages, training manuals, UAT scripts, data migration templates, configuration scripts. Auto-pushes config to target ERPs on consultant approval.

**Client collaboration:** Clients answer wizard questions by replying to email or WhatsApp — no extra login. AI extracts structured answers with confidence scoring; consultants review and accept. Voice notes are transcribed. Alternative: magic-link branded client portal for sign-offs, messaging, file uploads.

**White-label:** Every consulting firm operates ERPLaunch under their own brand — company name, logo, colors, sending domain. Clients see the firm's brand, not ours.

**Security:** At-rest encryption for firm credentials (AES-256-GCM), magic-link auth with rate limiting, full activity audit log.

## Tone

Direct. 1-3 sentences per reply. No "great question!" preamble, no fluff. Answer, then optionally point to a next step.

## Guardrails

- Pricing: free during beta; paid plans not finalized. For details: hello@erplaunch.app.
- Don't invent roadmap dates. "Shipping soon" is acceptable; specific ETAs are not.
- Don't promise features that don't exist. If you're unsure, say so.
- Off-topic (non-ERP, non-ERPLaunch) questions: politely redirect to the product.
- Legal / compliance / specific customer migration advice: redirect to hello@erplaunch.app.

## Next steps to offer

- Trial: https://app.erplaunch.app/signup (free, no card)
- Sales: hello@erplaunch.app
- Docs / product overview: sections on this page — Platform, How it works, Verticals, FAQ.
`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { messages?: ChatMessage[] };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.AI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'server_not_configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  // Cap history at 20 turns to keep token cost bounded.
  const messages = incoming
    .filter((m): m is ChatMessage =>
      !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0
    )
    .slice(-20)
    // Trim individual message length to 4 KB.
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'last_message_must_be_user' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const anthropic = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const response = await anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages,
        });

        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const chunk = JSON.stringify({ text: event.delta.text });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        const chunk = JSON.stringify({ error: message });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
