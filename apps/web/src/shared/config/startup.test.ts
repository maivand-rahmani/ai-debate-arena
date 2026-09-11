import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * v0.4 security: the documented dev/production startup commands must bind the
 * Next server to the loopback interface by default. The whole local security
 * model (no auth, no CSRF) depends on this; if the startup scripts stop
 * matching `--hostname 127.0.0.1`, this test fails instead of silently
 * exposing the API to the LAN.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..", "..", "..");
const REPO_ROOT = dirname(dirname(WEB_ROOT));

function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8").then(JSON.parse);
}

describe("loopback startup contract", () => {
  it("binds @arena/web dev and start to 127.0.0.1", async () => {
    const pkg = (await readJson(join(WEB_ROOT, "package.json"))) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.dev).toMatch(/--hostname[= ]127\.0\.0\.1(?!\d)/);
    expect(pkg.scripts?.start).toMatch(/--hostname[= ]127\.0\.0\.1(?!\d)/);
  });

  it("keeps the root workspace start/delegate commands coherent", async () => {
    const pkg = (await readJson(join(REPO_ROOT, "package.json"))) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.start).toBe("npm -w @arena/web run start");
    expect(pkg.scripts?.dev).toContain("run dev");
  });

  it("documents that non-loopback deployment is unsupported", async () => {
    const readme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("127.0.0.1");
    expect(readme).toContain("not supported");
    const dev = await readFile(join(REPO_ROOT, "docs", "development.md"), "utf8");
    expect(dev).toContain("127.0.0.1");
  });
});
