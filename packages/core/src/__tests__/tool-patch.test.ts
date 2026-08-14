import { describe, expect, it } from "vitest";
import {
  applyToolPatch,
  TOOL_PATCHABLE_FIELDS,
  TOOL_RISK,
  type AgentToolName,
} from "../schemas/agent";

/**
 * The approval patch, which is the last thing a human touches before a mutation
 * executes.
 *
 * These tests are written against the rule rather than the current field lists,
 * so adding a tool cannot quietly pass by inheriting somebody else's allowlist.
 */

const anEmailProposal = {
  eventId: "evt_owned",
  guestIds: ["gst_1", "gst_2"],
  intent: "REMINDER",
  draft: { subject: "Doors at 18:30", body: "See you there." },
};

const aSponsorProposal = {
  eventId: "evt_owned",
  sponsorId: "spo_nexa",
  targetPackage: "GOLD",
  incrementalAmountCents: 650_000,
  draft: { subject: "Gold", body: "Here is the case." },
};

describe("applyToolPatch — content is editable", () => {
  it("applies an allowlisted field", () => {
    const { input, discarded } = applyToolPatch("draft_emails", anEmailProposal, {
      draft: { subject: "Doors at 19:00", body: "Slight change." },
    });
    expect(input.draft).toEqual({ subject: "Doors at 19:00", body: "Slight change." });
    expect(discarded).toEqual([]);
  });

  it("accepts the wrapped { input } shape the console sends", () => {
    const { input } = applyToolPatch("create_ticket_tier", {
      eventId: "evt_owned",
      name: "Early",
      priceCents: 9_500,
      quota: 80,
    }, { input: { priceCents: 8_000 } });
    expect(input.priceCents).toBe(8_000);
    expect(input.name).toBe("Early");
  });
});

describe("applyToolPatch — targets are not", () => {
  it("discards guestIds: editing the recipients is a different action", () => {
    const { input, discarded } = applyToolPatch("draft_emails", anEmailProposal, {
      guestIds: ["gst_everyone_in_the_database"],
      draft: { subject: "Cancelled", body: "The event is cancelled." },
    });
    // The copy edit landed; the recipient list did not move.
    expect(input.draft).toEqual({ subject: "Cancelled", body: "The event is cancelled." });
    expect(input.guestIds).toEqual(["gst_1", "gst_2"]);
    expect(discarded).toEqual(["guestIds"]);
  });

  /**
   * The exact case the old blocklist would have let through. `sponsorId` is an
   * id this tool does not scope by event, so pinning `eventId` alone never
   * protected it.
   */
  it("discards sponsorId", () => {
    const { input, discarded } = applyToolPatch(
      "draft_sponsor_offer",
      aSponsorProposal,
      { sponsorId: "spo_someone_else", incrementalAmountCents: 1 },
    );
    expect(input.sponsorId).toBe("spo_nexa");
    expect(input.incrementalAmountCents).toBe(1);
    expect(discarded).toEqual(["sponsorId"]);
  });

  it("discards eventId for every tool that takes one", () => {
    for (const tool of Object.keys(TOOL_PATCHABLE_FIELDS) as AgentToolName[]) {
      const { input, discarded } = applyToolPatch(
        tool,
        { eventId: "evt_owned" },
        { eventId: "evt_someone_elses" },
      );
      expect(input.eventId, tool).toBe("evt_owned");
      expect(discarded, tool).toContain("eventId");
    }
  });

  it("discards an unknown field nobody has thought of yet", () => {
    const { input, discarded } = applyToolPatch("update_event_theme", {
      eventId: "evt_owned",
      theme: { preset: "classic" },
    }, { organisationId: "org_someone_else", role: "OWNER" });
    expect(input).toEqual({ eventId: "evt_owned", theme: { preset: "classic" } });
    expect(discarded.sort()).toEqual(["organisationId", "role"]);
  });
});

describe("applyToolPatch — default deny", () => {
  it("read-only tools accept no patch at all", () => {
    for (const tool of ["get_no_show_risks", "get_budget_summary"] as const) {
      expect(TOOL_PATCHABLE_FIELDS[tool]).toEqual([]);
      const { input, discarded } = applyToolPatch(tool, { eventId: "evt_owned" }, {
        eventId: "evt_other",
        minRisk: "LOW",
      });
      expect(input).toEqual({ eventId: "evt_owned" });
      expect(discarded.sort()).toEqual(["eventId", "minRisk"]);
    }
  });

  it("ignores a patch that is not an object", () => {
    for (const patch of [null, undefined, 42, "draft", ["draft"]]) {
      const { input, discarded } = applyToolPatch("draft_emails", anEmailProposal, patch);
      expect(input).toEqual(anEmailProposal);
      expect(discarded).toEqual([]);
    }
  });
});

describe("the allowlist itself", () => {
  /**
   * The compile-time guarantee, asserted at runtime as well: TOOL_PATCHABLE_FIELDS
   * is Record<AgentToolName, …>, so a new tool fails to compile until it is
   * listed. This catches the case where someone satisfies the compiler by
   * copying another tool's list — every tool in the registry must be present,
   * and the two tables must describe the same set of tools.
   */
  it("names every tool in the registry, and no others", () => {
    expect(Object.keys(TOOL_PATCHABLE_FIELDS).sort()).toEqual(
      Object.keys(TOOL_RISK).sort(),
    );
  });

  /** No allowlist may contain an identifier. This is the rule, not the list. */
  it("never allows a field whose name looks like a target", () => {
    for (const [tool, fields] of Object.entries(TOOL_PATCHABLE_FIELDS)) {
      for (const field of fields) {
        expect(/^(.*Id|.*Ids|id)$/.test(field), `${tool}.${field}`).toBe(false);
      }
    }
  });
});
