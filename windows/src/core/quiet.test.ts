import { describe, expect, it } from "vitest";
import { isQuietTime, minutesOf, mutedNow, type QuietSettings } from "./quiet";

const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m);
const night: QuietSettings = { quietEnabled: true, quietFrom: "23:00", quietTo: "07:00", quietApprovals: true };

describe("quiet hours", () => {
  it("reads a time of day", () => {
    expect(minutesOf("07:30")).toBe(450);
    expect(minutesOf("7:05")).toBe(425);
    expect(minutesOf("24:00")).toBeNull();
    expect(minutesOf("12:60")).toBeNull();
    expect(minutesOf("noon")).toBeNull();
  });

  it("a night that crosses midnight", () => {
    expect(isQuietTime(night, at(23, 0))).toBe(true);
    expect(isQuietTime(night, at(2, 30))).toBe(true);
    expect(isQuietTime(night, at(6, 59))).toBe(true);
    expect(isQuietTime(night, at(7, 0))).toBe(false);
    expect(isQuietTime(night, at(12))).toBe(false);
    expect(isQuietTime(night, at(22, 59))).toBe(false);
  });

  it("a period inside one day", () => {
    const lunch = { ...night, quietFrom: "12:00", quietTo: "13:00" };
    expect(isQuietTime(lunch, at(12, 30))).toBe(true);
    expect(isQuietTime(lunch, at(13, 0))).toBe(false);
    expect(isQuietTime(lunch, at(11, 59))).toBe(false);
  });

  it("is never quiet when switched off, or when the times make no sense", () => {
    expect(isQuietTime({ ...night, quietEnabled: false }, at(2))).toBe(false);
    expect(isQuietTime({ ...night, quietFrom: "x" }, at(2))).toBe(false);
    expect(isQuietTime({ ...night, quietFrom: "07:00", quietTo: "07:00" }, at(7))).toBe(false);
  });

  it("a request that waits for you can still ring", () => {
    expect(mutedNow(night, "finish", at(2))).toBe(true);
    expect(mutedNow(night, "approval", at(2))).toBe(false);
    expect(mutedNow(night, "question", at(2))).toBe(false);
    expect(mutedNow({ ...night, quietApprovals: false }, "approval", at(2))).toBe(true);
    expect(mutedNow(night, "finish", at(12))).toBe(false);
  });
});
