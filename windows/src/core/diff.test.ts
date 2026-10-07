import { describe, expect, it } from "vitest";
import { buildRows, diffLines } from "./diff";

const kinds = (ops: { kind: string }[]) => ops.map((o) => o.kind);

describe("diffLines", () => {
  it("treats identical text as all context", () => {
    expect(kinds(diffLines(["a", "b"], ["a", "b"]))).toEqual(["ctx", "ctx"]);
  });

  it("finds one changed line in the middle", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(ops.filter((o) => o.kind === "del").map((o) => o.text)).toEqual(["b"]);
    expect(ops.filter((o) => o.kind === "add").map((o) => o.text)).toEqual(["B"]);
    expect(ops.filter((o) => o.kind === "ctx")).toHaveLength(2);
  });

  it("handles pure additions and pure removals", () => {
    expect(kinds(diffLines([], ["x", "y"]))).toEqual(["add", "add"]);
    expect(kinds(diffLines(["x", "y"], []))).toEqual(["del", "del"]);
  });

  it("keeps the order of the lines", () => {
    const after = diffLines(["1", "2", "3"], ["1", "inserted", "2", "3"]);
    expect(after.filter((o) => o.kind !== "del").map((o) => o.text)).toEqual(["1", "inserted", "2", "3"]);
  });
});

describe("buildRows", () => {
  const file = ["l1", "l2", "l3", "new4", "l5", "l6", "l7"].join("\n") + "\n";

  it("places the change in the file: line numbers and three lines of context", () => {
    const r = buildRows([{ old: "old4", new: "new4" }], file);
    expect(r.placed).toBe(true);
    expect(r.add).toBe(1);
    expect(r.del).toBe(1);
    expect(r.rows.map((x) => x.kind)).toEqual(["ctx", "ctx", "ctx", "del", "add", "ctx", "ctx", "ctx"]);
    expect(r.rows[0]).toMatchObject({ text: "l1", no: 1 });
    expect(r.rows.find((x) => x.kind === "add")).toMatchObject({ text: "new4", no: 4 });
    expect(r.rows.at(-1)).toMatchObject({ text: "l7", no: 7 });
  });

  it("shows only the change when the file can not be read", () => {
    const r = buildRows([{ old: "old4", new: "new4" }], null);
    expect(r.placed).toBe(false);
    expect(r.rows.map((x) => x.kind)).toEqual(["del", "add"]);
    expect(r.rows[0].no).toBeUndefined();
  });

  it("a new file is all additions", () => {
    const r = buildRows([{ old: "", new: "a\nb\n" }], null);
    expect(r.add).toBe(2);
    expect(r.del).toBe(0);
    expect(r.rows.every((x) => x.kind === "add")).toBe(true);
  });

  it("a final newline does not make a line of its own", () => {
    expect(buildRows([{ old: "", new: "x\n" }], null).add).toBe(1);
    expect(buildRows([{ old: "", new: "x\r\ny\r\n" }], null).add).toBe(2);
  });

  it("separates the changes of a MultiEdit with a gap row", () => {
    const r = buildRows([{ old: "a", new: "b" }, { old: "c", new: "d" }], null);
    expect(r.rows.map((x) => x.kind)).toEqual(["del", "add", "gap", "del", "add"]);
  });

  it("cuts a very long change and says how much is left out", () => {
    const long = Array.from({ length: 300 }, (_, i) => `row ${i + 1}`).join("\n");
    const r = buildRows([{ old: "", new: long }], null);
    expect(r.rows).toHaveLength(160);
    expect(r.more).toBe(140);
    expect(r.add).toBe(300);
  });
});
