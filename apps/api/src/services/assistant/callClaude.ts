/**
 * Phase 55.2 — Claude wrapper for the ERPLaunch assistant.
 *
 * Reuses the shared `aiClient` (single Anthropic client across the
 * codebase). When the key isn't configured (dev/local), returns a
 * deterministic heuristic reply so the route still works end-to-end
 * — the UI never sees a dropped connection.
 *
 * The system prompt names the model: an ERPLaunch implementation
 * assistant aware of the 14-stage lifecycle, the four owner roles,
 * the document catalog, ERP-implementation methodology. Advisory
 * only — it never mutates data; it can suggest deep-link actions.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getAiModel, getAnthropicClient } from '../aiClient.js';
import type { AssistantContext } from './buildContext.js';

export interface SuggestedAction {
  /** Short button label. */
  label: string;
  /** Kind — `navigate` deep-links; `info` is non-interactive. */
  kind: 'navigate' | 'info';
  /** Relative app route for `navigate`; free text for `info`. */
  target: string;
}

export interface AssistantReply {
  reply: string;
  suggestedActions: SuggestedAction[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the ERPLaunch implementation assistant. ERPLaunch helps consulting firms run customer ERP implementations end to end, from first lead to renewal.

You know:
- The 14-stage customer lifecycle: Lead → Qualified → Proposal → Negotiation → Won → Discovery → Scoping → Build → UAT → Go-live → Hypercare → Live SLA → Renewal Due → Renewed. Plus terminal stages Lost and Churned.
- The four owner roles: Sales (Lead..Won), Project Lead (Discovery..Go-live), CSM (Hypercare..Renewed), AR (whole lifecycle for billing).
- The document catalog — proposals, SOWs, kickoff decks, BRDs are available today; many other doc types are still listed as "coming soon".
- Standard ERP implementation methodology: discovery questionnaires feed solution design, fit-gap drives scope, build produces configuration workbooks, UAT precedes go-live, hypercare wraps to steady-state SLA.

Your job:
- Be advisory and accurate. Use only the context you are given — do not invent customer names, numbers, or events.
- If something is not in the context, say you do not have it and suggest what the user can open to find out.
- Keep replies concise and plain-English. Bullet sparingly.
- Never claim to have changed data. You do not mutate anything — you advise and the user clicks.

After your reply, output a final JSON code block (\`\`\`json ... \`\`\`) with an array named "actions" of suggested deep-links the UI can render as buttons. Each entry is { "label": "...", "kind": "navigate" | "info", "target": "..." }. Use these route shapes:
- /customers/<id>?tab=documents
- /customers/<id>?tab=implementation
- /customers/<id>?tab=activity
- /reports?tab=pipeline | delivery | health | renewals | utilization
- /inbox
Use at most 3 actions. If no obvious actions, return an empty array.`;

const MAX_HEURISTIC_LEN = 400;

function heuristicReply(userMessage: string, context: AssistantContext): AssistantReply {
  if (context.scope === 'customer' && context.customer) {
    const c = context.customer;
    const reply =
      `I am the ERPLaunch assistant (offline mode — AI key not configured locally).\n\n` +
      `You're looking at ${c.name}, currently at the ${c.currentStage} stage. ` +
      `Health is ${c.healthScore} (${c.healthBand}). There are ${c.openBlockers} open blockers and ${c.pendingDecisions} pending decisions.\n\n` +
      `I can't reason fully without the model — but the Documents and Implementation tabs hold the work this stage needs.`;
    return {
      reply: reply.slice(0, MAX_HEURISTIC_LEN),
      suggestedActions: [
        { label: 'Open Documents', kind: 'navigate', target: `/customers/${c.id}?tab=documents` },
        { label: 'Open Implementation', kind: 'navigate', target: `/customers/${c.id}?tab=implementation` },
      ],
    };
  }
  const f = context.firm;
  const reply =
    `Offline mode (no AI key configured locally). ` +
    `Firm rollup: ${f?.pipelineStalled ?? 0} stalled pipeline customers, ${f?.customersAtRisk ?? 0} at-risk, ` +
    `${f?.renewalsNext90 ?? 0} renewals due in 90d.`;
  void userMessage;
  return {
    reply,
    suggestedActions: [
      { label: 'Open Inbox', kind: 'navigate', target: '/inbox' },
      { label: 'Open Reports', kind: 'navigate', target: '/reports' },
    ],
  };
}

/**
 * Strip the trailing JSON actions block out of the model's reply and
 * parse it. The model is instructed to emit \`\`\`json {actions: [...]} \`\`\`
 * at the end of its message — both the visible reply and the actions
 * are returned.
 */
function parseActionsBlock(raw: string): AssistantReply {
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return { reply: raw.trim(), suggestedActions: [] };
  const jsonText = match[1];
  const reply = raw.replace(match[0], '').trim();
  try {
    const parsed = JSON.parse(jsonText) as { actions?: SuggestedAction[] };
    const actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5) : [];
    // Sanitise — only navigate/info, only string targets/labels.
    const clean: SuggestedAction[] = actions
      .filter(
        (a) =>
          typeof a?.label === 'string' &&
          typeof a?.target === 'string' &&
          (a.kind === 'navigate' || a.kind === 'info'),
      )
      .map((a) => ({
        label: String(a.label).slice(0, 80),
        kind: a.kind,
        target: String(a.target).slice(0, 200),
      }));
    return { reply, suggestedActions: clean };
  } catch {
    return { reply, suggestedActions: [] };
  }
}

export async function callAssistant(opts: {
  context: AssistantContext;
  history: ChatMessage[];
  message: string;
}): Promise<AssistantReply> {
  const client = getAnthropicClient();
  if (!client) {
    return heuristicReply(opts.message, opts.context);
  }
  const contextBlob = `Current context:\n${JSON.stringify(opts.context, null, 2)}`;
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextBlob },
    ...opts.history.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
    { role: 'user', content: opts.message },
  ];
  try {
    const response = await client.messages.create({
      model: getAiModel(),
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        textParts.push((block as { text: string }).text);
      }
    }
    const text = textParts.join('\n').trim() || '(no reply)';
    return parseActionsBlock(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown AI error';
    return {
      reply:
        `I hit an error reaching the AI provider — ${detail}. ` +
        `The data you can see in the app is still accurate; please retry in a moment.`,
      suggestedActions: [],
    };
  }
}
