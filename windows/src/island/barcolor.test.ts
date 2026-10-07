import { describe, expect, it } from "vitest";
import { barGradient, barPalette, lighten, shiftHue, workingNames } from "./barcolor";

const task = (id: string, color: string, state: string) => ({ id, color, state });

describe("the colours of the thin bar", () => {
  it("is a calm rainbow when nothing is going on", () => {
    const p = barPalette([task("integration_claude", "#ffffff", "idle")]);
    expect(p.stops).toHaveLength(5);
    expect(p.speed).toBe(7);
  });

  it("takes the colours of the sessions that are working", () => {
    const p = barPalette([task("s1", "#3b82f6", "working"), task("s2", "#22c55e", "thinking"), task("s3", "#ef4444", "idle")]);
    expect(p.stops).toContain("#3b82f6");
    expect(p.stops).toContain("#22c55e");
    expect(p.stops).not.toContain("#ef4444"); // idle: not in it
    expect(p.speed).toBe(3.2);
  });

  it("one session still makes a gradient, and thinking alone is a little slower", () => {
    const p = barPalette([task("s1", "#3b82f6", "thinking")]);
    expect(p.stops.length).toBeGreaterThan(1);
    expect(new Set(p.stops).size).toBeGreaterThan(1);
    expect(p.speed).toBe(4.5);
  });

  it("the 'no session yet' placeholder is not a session", () => {
    const p = barPalette([task("integration_claude", "#ffffff", "working")]);
    expect(p.speed).toBe(7);
  });

  it("a session waiting for you wins over everything, quick and warm", () => {
    const p = barPalette([task("s1", "#3b82f6", "working"), task("s2", "#22c55e", "approval")]);
    expect(p.speed).toBe(1.8);
    expect(p.stops).not.toContain("#3b82f6");
  });

  it("an error and a finished turn have their own colours", () => {
    expect(barPalette([task("s1", "#3b82f6", "error")], "error").stops).toContain("#f4505e");
    expect(barPalette([task("s1", "#3b82f6", "finished")], "finished").stops).toContain("#34d399");
  });

  it("uses at most four sessions, each colour once", () => {
    const many = ["#111111", "#222222", "#333333", "#444444", "#555555"].map((c, i) => task(`s${i}`, c, "working"));
    expect(barPalette(many).stops).toHaveLength(12);
    const same = [task("a", "#3b82f6", "working"), task("b", "#3b82f6", "working")];
    expect(barPalette(same).stops).toHaveLength(3);
  });

  it("the gradient comes back to its first colour, so it flows without a seam", () => {
    const p = barPalette([task("s1", "#3b82f6", "working")]);
    const g = barGradient(p);
    expect(g.startsWith("linear-gradient(90deg, ")).toBe(true);
    expect(g.endsWith(`${p.stops[0]})`)).toBe(true);
  });

  it("colour helpers: a shifted colour differs, white stays white, a bad colour does not crash", () => {
    expect(shiftHue("#ff0000", 120)).toBe("#00ff00");
    expect(lighten("#000000")).toBe("#404040");
    expect(lighten("#ffffff")).toBe("#ffffff");
    expect(shiftHue("not a colour", 30)).toMatch(/^#[0-9a-f]{6}$/);
    expect(barPalette([task("s1", "oops", "working")]).stops.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});

describe("who is at work (the bar's hover text)", () => {
  const named = (id: string, name: string, state: string) => ({ id, name, color: "#3b82f6", state });

  it("names the sessions that are working or thinking, not the placeholder or the idle ones", () => {
    expect(workingNames([
      named("a", "aurora", "working"),
      named("b", "web", "thinking"),
      named("c", "docs", "idle"),
      named("integration_claude", "VS Code", "working"),
    ])).toEqual(["aurora", "web"]);
    expect(workingNames([])).toEqual([]);
  });
});
