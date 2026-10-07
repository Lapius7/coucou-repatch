import { describe, expect, it } from "vitest";
import { BAR_H, BAR_W, COMPACT_W, NOTCH_H, islandSize } from "./layout";

describe("islandSize", () => {
  it("the closed island is the small notch, or a thin bar", () => {
    expect(islandSize("compact", "overview")).toEqual({ w: COMPACT_W, h: NOTCH_H });
    expect(islandSize("compact", "overview", 0, false, 0, true)).toEqual({ w: BAR_W, h: BAR_H });
    expect(BAR_H).toBeLessThan(NOTCH_H);
    expect(BAR_W).toBeLessThan(COMPACT_W);
  });

  it("a hidden island has no height", () => {
    expect(islandSize("hidden", "overview").h).toBe(0);
  });

  it("an open island is taller for a long finished card or a picture in the chat, and only for those", () => {
    const base = islandSize("expanded", "finished").h;
    expect(islandSize("expanded", "finished", 0, false, 40).h).toBe(base + 40);
    const chat = islandSize("expanded", "prompt", 0).h;
    expect(islandSize("expanded", "prompt", 0, false, 60).h).toBe(chat + 60);
    expect(islandSize("expanded", "diff", 0, false, 60).h).toBe(islandSize("expanded", "diff").h);
  });

  it("pulled larger, the same size whatever the view, only where that makes sense", () => {
    const a = islandSize("expanded", "log", 0, true);
    const b = islandSize("expanded", "diff", 0, true);
    expect(a).toEqual(b);
    expect(islandSize("expanded", "overview", 0, true)).toEqual(islandSize("expanded", "overview"));
  });
});
