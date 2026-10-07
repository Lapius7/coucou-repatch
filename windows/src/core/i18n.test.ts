import { beforeAll, describe, expect, it } from "vitest";
import { setLanguage, t } from "./i18n";
import i18nSource from "./i18n.ts?raw";

// The file itself, as text (Vite's ?raw): the dictionaries are not exported.
const source = i18nSource;
const keysOf = (block: string) => new Set([...block.matchAll(/^\s*"([a-zA-Z0-9_. -]+)":/gm)].map((m) => m[1]));

// The two dictionaries are the two object literals in the file: English first, then Japanese.
const [, enBlock, jaBlock] = source.split(/const (?:en|ja)\b[^=]*=\s*\{/);
const en = keysOf(enBlock.split(/\n\};/)[0]);
const ja = keysOf(jaBlock.split(/\n\};/)[0]);

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = { documentElement: {} };
});

describe("the dictionaries", () => {
  it("were found", () => {
    expect(en.size).toBeGreaterThan(200);
    expect(ja.size).toBeGreaterThan(200);
  });

  it("every English text has a Japanese one, and the other way round", () => {
    const missingJa = [...en].filter((k) => !ja.has(k));
    const missingEn = [...ja].filter((k) => !en.has(k));
    expect({ missingJa, missingEn }).toEqual({ missingJa: [], missingEn: [] });
  });
});

describe("t()", () => {
  it("fills {name} and leaves unknown names visible", () => {
    setLanguage("en");
    expect(t("chat.removeFile")).toBe("Remove this file");
    expect(t("no.such.key")).toBe("no.such.key");
    expect(t("up.drop")).toBe("Drop your files here");
  });

  it("answers in Japanese when asked to", () => {
    setLanguage("ja");
    expect(t("chat.removeFile")).toBe("このファイルを外す");
    setLanguage("en");
  });

  it("picks the singular or the plural by the count", () => {
    setLanguage("en");
    expect(t("n.turns", { n: 1 })).toMatch(/^1 turn$/);
    expect(t("n.turns", { n: 3 })).toMatch(/^3 turns$/);
  });
});
