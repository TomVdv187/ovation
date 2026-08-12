import "server-only";
import { agentToolNameSchema, type AgentToolName } from "@ovation/core";

/**
 * The tools the model is given, 1:1 with `agentToolNameSchema` in
 * packages/core. The enum is the contract — no tool is invented here, and the
 * assertion at the bottom of this file fails the build if the two ever drift.
 *
 * `eventId` is deliberately absent from every schema: the server injects the
 * event the console is looking at, so the model cannot act on a different one.
 */

export interface AnthropicTool {
  name: AgentToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const summaryProp = {
  summary: {
    type: "string",
    description:
      "One line, plain English, describing what the organiser is approving. Shown on the card.",
  },
} as const;

export const AGENT_TOOLS: AnthropicTool[] = [
  {
    name: "update_event_theme",
    description:
      "Propose a restyle of the public event page. Use for dress code, mood, palette and typography changes. Cosmetic — no guest is contacted.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        preset: {
          type: "string",
          enum: ["classic", "blacktie"],
          description:
            "`blacktie` is the formal, dark, gold-accented treatment. `classic` is the default editorial look.",
        },
        dressCode: {
          type: "string",
          description: "e.g. 'Black tie', 'Business', 'Cocktail'.",
        },
        notes: {
          type: "string",
          description: "The direction you took, for the organiser's record.",
        },
        palette: {
          type: "object",
          description: "Optional CSS colour overrides.",
          properties: {
            bg: { type: "string" },
            surface: { type: "string" },
            ink: { type: "string" },
            inkMuted: { type: "string" },
            accent: { type: "string" },
            accentSoft: { type: "string" },
            line: { type: "string" },
          },
        },
        typography: {
          type: "object",
          description: "Optional font-stack overrides.",
          properties: {
            display: { type: "string" },
            body: { type: "string" },
            displayWeight: { type: "integer" },
            tracking: { type: "string", enum: ["tight", "normal", "wide"] },
          },
        },
      },
    },
  },

  {
    name: "update_agenda",
    description:
      "Propose a replacement running order. Send the COMPLETE agenda — this replaces what is published, it does not merge.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        agenda: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  startsAt: { type: "string", description: "ISO 8601 datetime" },
                  endsAt: { type: "string", description: "ISO 8601 datetime" },
                  description: { type: "string" },
                  speaker: { type: "string" },
                  room: { type: "string" },
                  kind: {
                    type: "string",
                    enum: [
                      "DOORS",
                      "TALK",
                      "PANEL",
                      "BREAK",
                      "DINNER",
                      "NETWORKING",
                      "CLOSE",
                    ],
                  },
                },
                required: ["id", "title", "startsAt"],
              },
            },
          },
          required: ["items"],
        },
      },
      required: ["agenda"],
    },
  },

  {
    name: "change_event_date",
    description:
      "Propose moving the event. DESTRUCTIVE: it invalidates calendar invites, rewrites the public page and obliges a re-announcement to every guest. Always explain the knock-on effects in your reply.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        date: {
          type: "string",
          description: "New start, ISO 8601. Keep the existing time of day unless told otherwise.",
        },
        endsAt: { type: "string", description: "New end, ISO 8601. Optional." },
        reason: { type: "string", description: "Why the date is moving." },
      },
      required: ["date"],
    },
  },

  {
    name: "draft_emails",
    description:
      "Propose a personalised email campaign to specific guests. OUTBOUND: nothing is sent by this tool and nothing can auto-approve. Call get_no_show_risks first to obtain real guest ids — never invent them.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        guestIds: {
          type: "array",
          items: { type: "string" },
          description: "Guest ids from a previous tool result. Required, at least one.",
        },
        intent: {
          type: "string",
          enum: [
            "INVITE",
            "REMINDER",
            "RECOVERY",
            "VIP_UPGRADE",
            "WAITLIST_PROMOTION",
          ],
        },
        brief: {
          type: "string",
          description: "The steer behind the copy, e.g. 'warm, short, mention the rooftop dinner'.",
        },
        subject: {
          type: "string",
          description: "The subject line the organiser will see and approve.",
        },
        body: {
          type: "string",
          description:
            "The draft body the organiser will see and approve, sent verbatim. Use {{name}} for the recipient. Never state a fact you were not given.",
        },
      },
      required: ["guestIds", "intent"],
    },
  },

  {
    name: "create_ticket_tier",
    description:
      "Propose opening a new ticket tier. OPERATIONAL: always needs a human, never auto-approves.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        name: { type: "string" },
        priceCents: {
          type: "integer",
          description: "Minor units. €175 is 17500. Never a float.",
        },
        quota: { type: "integer", description: "Seats in this tier." },
        opensAt: { type: "string", description: "ISO 8601. Omit to open immediately." },
      },
      required: ["name", "priceCents", "quota"],
    },
  },

  {
    name: "draft_sponsor_offer",
    description:
      "Propose a package upgrade offer to an existing sponsor. OUTBOUND: nothing is sent and nothing can auto-approve. Ground the offer in the sponsor's real engagement.",
    input_schema: {
      type: "object",
      properties: {
        ...summaryProp,
        sponsorId: { type: "string", description: "Real sponsor id from the state below." },
        targetPackage: { type: "string", enum: ["GOLD", "SILVER", "CUSTOM"] },
        incrementalAmountCents: {
          type: "integer",
          description: "Additional spend in minor units.",
        },
        subject: { type: "string", description: "Subject line for the offer email." },
        body: { type: "string", description: "Draft body the organiser approves verbatim." },
      },
      required: ["sponsorId", "targetPackage", "incrementalAmountCents"],
    },
  },

  {
    name: "get_no_show_risks",
    description:
      "Read-only. Returns guests at risk of not turning up, highest risk first, with their real ids. Answer inline — this creates no proposal.",
    input_schema: {
      type: "object",
      properties: {
        minRisk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        limit: { type: "integer", description: "Default 20, max 100." },
      },
    },
  },

  {
    name: "get_budget_summary",
    description:
      "Read-only. Ticket revenue, sponsor revenue, committed costs and margin for this event. Answer inline — this creates no proposal.",
    input_schema: { type: "object", properties: {} },
  },
];

// The registry must stay exactly the contract's enum — no more, no less.
const declared = new Set(AGENT_TOOLS.map((t) => t.name));
const contract = new Set(agentToolNameSchema.options);
if (
  declared.size !== contract.size ||
  [...contract].some((name) => !declared.has(name))
) {
  throw new Error(
    "Agent tool registry has drifted from agentToolNameSchema in @ovation/core.",
  );
}
