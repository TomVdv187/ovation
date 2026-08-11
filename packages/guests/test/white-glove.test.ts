import { describe, expect, it } from "vitest";
import {
  blankWhiteGlove,
  openWhiteGlove,
  outstandingWhiteGlove,
  readWhiteGlove,
} from "../src/engine/white-glove";

const guest = { name: "Charlotte Peeters", dietary: "Vegetarian" };

describe("white-glove checklist", () => {
  it("calls out all four items for a VIP nobody has started on", () => {
    const outstanding = outstandingWhiteGlove(blankWhiteGlove(), guest);
    expect(outstanding).toHaveLength(4);
    expect(outstanding.every((item) => item.includes("Charlotte Peeters"))).toBe(true);
  });

  it("names the dietary requirement it wants confirmed", () => {
    const outstanding = outstandingWhiteGlove(blankWhiteGlove(), guest);
    expect(outstanding.some((item) => item.includes("vegetarian cover"))).toBe(true);
  });

  it("asks the open question when no dietary requirement is on file", () => {
    const outstanding = outstandingWhiteGlove(blankWhiteGlove(), {
      name: "Bram Willems",
      dietary: null,
    });
    expect(outstanding.some((item) => item.includes("whether Bram Willems has a dietary"))).toBe(
      true,
    );
  });

  it("drops an item once it is filled in", () => {
    const checklist = { ...blankWhiteGlove(), seating: "Table 1, near the stage" };
    const outstanding = outstandingWhiteGlove(checklist, guest);
    expect(outstanding).toHaveLength(3);
    expect(outstanding.some((item) => item.includes("Assign"))).toBe(true);
    expect(outstanding.some((item) => item.includes("a table"))).toBe(false);
  });

  it("respects an item ticked off with nothing to record — a VIP who drives himself", () => {
    const checklist = { ...blankWhiteGlove(), done: ["transport"] };
    const outstanding = outstandingWhiteGlove(checklist, guest);
    expect(outstanding).toHaveLength(3);
    expect(outstanding.some((item) => item.includes("transport"))).toBe(false);
  });

  it("treats whitespace as unfilled", () => {
    const checklist = { ...blankWhiteGlove(), host: "   " };
    expect(outstandingWhiteGlove(checklist, guest)).toHaveLength(4);
  });

  it("survives a malformed blob in the JSON column rather than taking the screen down", () => {
    expect(readWhiteGlove(null)).toEqual(blankWhiteGlove());
    expect(readWhiteGlove("not an object")).toEqual(blankWhiteGlove());
    expect(readWhiteGlove({ transport: 42 })).toEqual(blankWhiteGlove());
    expect(readWhiteGlove({ transport: "Car service", done: ["seating"] })).toEqual({
      ...blankWhiteGlove(),
      transport: "Car service",
      done: ["seating"],
    });
  });

  it("pre-fills a new checklist from what we already know", () => {
    expect(openWhiteGlove({ dietary: "Halal" }).dietary).toBe("Halal");
    expect(openWhiteGlove({ dietary: null })).toEqual(blankWhiteGlove());
  });
});
