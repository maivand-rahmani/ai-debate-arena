/**
 * Partial-write safety and secret-handling tests for the provider store
 * (`provider-db.ts`).
 *
 * `node:fs/promises` is wrapped so a single write's final atomic rename can
 * be made to fail on demand; everything else passes through to the real fs.
 * Verifies that a failed write leaves the previous store intact with no temp
 * or lock residue, that stray temp files from a crashed writer are ignored by
 * reads, and that keys stay on disk but never reach redacted read APIs.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failureState = vi.hoisted(() => ({ failRename: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const rename: typeof actual.rename = async (...args: Parameters<typeof actual.rename>) => {
    if (failureState.failRename) throw new Error("simulated rename failure");
    return actual.rename(...args);
  };
  return { ...actual, rename } as typeof actual;
});

vi.mock("server-only", () => ({}));

import { addProvider, getProvider, listProviders, providerStorePath } from "./provider-db";

const SECRET = "sk-partial-write-secret-abc123XYZ";
const OTHER_SECRET = "sk-failed-write-secret-987zyxWV";

let dir = "";
const ORIGINAL_FILE = process.env.AI_DEBATE_ARENA_PROVIDER_FILE;

function providerBody(id: string, apiKey = SECRET) {
  return { id, name: `Provider ${id}`, baseUrl: "http://localhost:9/v1", model: "mock-model", api: "chat", apiKey };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-debate-arena-pdb-"));
  process.env.AI_DEBATE_ARENA_PROVIDER_FILE = join(dir, "providers.json");
  failureState.failRename = false;
});

afterEach(async () => {
  if (ORIGINAL_FILE === undefined) delete process.env.AI_DEBATE_ARENA_PROVIDER_FILE;
  else process.env.AI_DEBATE_ARENA_PROVIDER_FILE = ORIGINAL_FILE;
  failureState.failRename = false;
  await rm(dir, { recursive: true, force: true });
});

describe("provider store partial-write safety", () => {
  it("keeps the previous store intact and leaves no residue when a write fails", async () => {
    await addProvider(providerBody("p-one"));
    const before = await readFile(providerStorePath(), "utf8");

    failureState.failRename = true;
    await expect(addProvider(providerBody("p-two", OTHER_SECRET))).rejects.toThrow(/simulated rename failure/);
    failureState.failRename = false;

    // The previous store is unchanged and still readable; the failed
    // mutation is fully absent.
    expect(await readFile(providerStorePath(), "utf8")).toBe(before);
    expect((await getProvider("p-one"))?.id).toBe("p-one");
    expect(await getProvider("p-two")).toBeUndefined();

    // No temp or lock residue accumulates in the store directory (a leftover
    // temp file would also be a plain-text secret copy on disk).
    const files = await readdir(dir);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(files.filter((name) => name.endsWith(".lock"))).toEqual([]);

    // The store recovers: the next mutation succeeds.
    await addProvider(providerBody("p-three"));
    const listed = await listProviders();
    expect(listed.map((entry) => entry.id).sort()).toEqual(["p-one", "p-three"]);
  });

  it("ignores leftover temporary files from a crashed writer", async () => {
    await addProvider(providerBody("p-one"));
    // A crashed writer would leave `<store>.<pid>.<uuid>.tmp` behind; its
    // content must never be mistaken for the live store.
    const strayPath = `${providerStorePath()}.999.stray-writer.tmp`;
    await writeFile(strayPath, '{ "providers": [{ "apiKey": "sk-stray-secret" }');

    const listed = await listProviders();
    expect(listed.map((entry) => entry.id)).toEqual(["p-one"]);
    expect(JSON.stringify(listed)).not.toContain("sk-stray-secret");
    expect(JSON.stringify(listed)).not.toContain('"apiKey"');

    // Mutations keep targeting the live store, not the stray temp file.
    await addProvider(providerBody("p-two"));
    expect((await listProviders()).map((entry) => entry.id).sort()).toEqual(["p-one", "p-two"]);
    expect(await readFile(strayPath, "utf8")).toContain("sk-stray-secret");
  });

  it("stores keys on disk but never exposes them through redacted read APIs", async () => {
    await addProvider(providerBody("p-one"));

    // The store file itself intentionally holds the key; read APIs redact.
    const raw = await readFile(providerStorePath(), "utf8");
    expect(raw).toContain(SECRET);

    const listed = await listProviders();
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain('"apiKey"');
    expect((await getProvider("p-one"))?.apiKey).toBe(SECRET);
  });
});
