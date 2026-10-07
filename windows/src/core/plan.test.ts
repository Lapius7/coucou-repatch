import { describe, expect, it } from "vitest";
import {
  parseAccount, parsePlan, parsePlanText, pickPlan, planColor, planName, shownPct, sourceOf, timeLeft,
  type PlanSet,
} from "./plan";

describe("parsePlan: the rate_limits of the status line", () => {
  it("reads both windows", () => {
    const p = parsePlan({
      five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
      seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
    });
    expect(p?.fiveHour).toEqual({ pct: 23.5, resetsAt: 1738425600 });
    expect(p?.sevenDay).toEqual({ pct: 41.2, resetsAt: 1738857600 });
  });

  it("works with one window missing", () => {
    const p = parsePlan({ seven_day: { used_percentage: 5, resets_at: 1738857600 } });
    expect(p?.fiveHour).toBeUndefined();
    expect(p?.sevenDay?.pct).toBe(5);
  });

  it("ignores absurd values and gives null when nothing is usable", () => {
    expect(parsePlan({ five_hour: { used_percentage: 150, resets_at: 1 } })).toBeNull();
    expect(parsePlan({ five_hour: { used_percentage: -1, resets_at: 1 } })).toBeNull();
    expect(parsePlan({ five_hour: { used_percentage: 10, resets_at: 0 } })).toBeNull();
    expect(parsePlan({ five_hour: { used_percentage: "x", resets_at: 5 } })).toBeNull();
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan("text")).toBeNull();
    expect(parsePlan({})).toBeNull();
  });
});

describe("parsePlanText: what `claude -p /usage` prints", () => {
  const now = Date.UTC(2026, 9, 6, 18, 0, 0); // 2026-10-07 03:00 in Tokyo
  const text = [
    "Current session: 99% used · resets Oct 7, 5:39am (Asia/Tokyo)",
    "Current week (all models): 38% used · resets Oct 12, 1:59pm (Asia/Tokyo)",
  ].join("\n");

  it("reads the percentages and the reset moments in the printed time zone", () => {
    const p = parsePlanText(text, now);
    expect(p?.fiveHour?.pct).toBe(99);
    expect(p?.sevenDay?.pct).toBe(38);
    expect(p?.fiveHour?.resetsAt).toBe(Date.UTC(2026, 9, 6, 20, 39) / 1000); // 05:39 JST
    expect(p?.sevenDay?.resetsAt).toBe(Date.UTC(2026, 9, 12, 4, 59) / 1000); // 13:59 JST
  });

  it("gives null for anything else (signed out, an error message)", () => {
    expect(parsePlanText("Not logged in", now)).toBeNull();
    expect(parsePlanText("", now)).toBeNull();
  });
});

describe("parseAccount: `claude auth status`", () => {
  it("reads the account", () => {
    expect(parseAccount(JSON.stringify({ loggedIn: true, email: "a@b.c", subscriptionType: "pro", authMethod: "claude.ai" }))).toEqual({
      email: "a@b.c", plan: "pro", method: "claude.ai",
    });
  });

  it("gives null when signed out or unreadable", () => {
    expect(parseAccount(JSON.stringify({ loggedIn: false }))).toBeNull();
    expect(parseAccount(JSON.stringify({ loggedIn: true }))).toBeNull();
    expect(parseAccount("not json")).toBeNull();
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount("")).toBeNull();
  });

  it("writes the plan out", () => {
    expect(planName("pro")).toBe("Pro");
    expect(planName("max")).toBe("Max");
    expect(planName("")).toBe("");
  });
});

describe("what is shown", () => {
  it("a window that has reset shows 0 %", () => {
    const w = { pct: 80, resetsAt: 1000 };
    expect(shownPct(w, 999_000)).toBe(80);
    expect(shownPct(w, 1_000_000)).toBe(0);
  });

  it("colours: green under 50, amber to 80, red above", () => {
    expect(planColor(0)).toBe("#22C55E");
    expect(planColor(49.9)).toBe("#22C55E");
    expect(planColor(50)).toBe("#F59E0B");
    expect(planColor(79)).toBe("#F59E0B");
    expect(planColor(80)).toBe("#F4505E");
    expect(planColor(100)).toBe("#F4505E");
  });

  it("time left", () => {
    const now = 1_000_000_000_000;
    const at = (seconds: number) => now / 1000 + seconds;
    expect(timeLeft(at(30), now)).toBe("30s");
    expect(timeLeft(at(45 * 60), now)).toBe("45m");
    expect(timeLeft(at(125 * 60), now)).toBe("2h 05m");
    expect(timeLeft(at(3 * 86400 + 5 * 3600), now)).toBe("3d 5h");
    expect(timeLeft(at(-5), now)).toBe("0s");
  });
});

describe("whose limits", () => {
  it("a Linux path is WSL, a drive letter or UNC path is Windows", () => {
    expect(sourceOf("/home/me/p")).toBe("wsl");
    expect(sourceOf("C:\\Users\\me")).toBe("windows");
    expect(sourceOf("D:/work")).toBe("windows");
    expect(sourceOf("\\\\server\\share")).toBe("windows");
    expect(sourceOf("")).toBeNull();
    expect(sourceOf(undefined)).toBeNull();
    expect(sourceOf("relative")).toBeNull();
  });

  const win = { fiveHour: { pct: 10, resetsAt: 9 }, updatedAt: 100 };
  const wsl = { fiveHour: { pct: 70, resetsAt: 9 }, updatedAt: 200 };
  const both: PlanSet = { windows: win, wsl };

  it("a chosen source shows only that one", () => {
    expect(pickPlan(both, "windows", "/home/me")?.source).toBe("windows");
    expect(pickPlan({ wsl }, "windows", null)).toBeNull();
  });

  it("auto follows the session on screen, then whoever spoke last", () => {
    expect(pickPlan(both, "auto", "C:\\p")?.source).toBe("windows");
    expect(pickPlan(both, "auto", "/home/me")?.source).toBe("wsl");
    expect(pickPlan(both, "auto", null)?.source).toBe("wsl"); // updated last
    expect(pickPlan({}, "auto", null)).toBeNull();
  });
});
