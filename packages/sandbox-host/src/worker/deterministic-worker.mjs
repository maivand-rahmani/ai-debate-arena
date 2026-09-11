/**
 * Allow-listed deterministic sandbox worker (F10-19/F10-24).
 *
 * This script is SERVER-OWNED: the sandbox host spawns exactly this file
 * with the current Node executable, never anything else. It implements the
 * bounded JSON-over-stdio protocol in `../worker-protocol.ts`:
 *
 *   stdin : {"v":1,"op":"sha256","contentB64":"..."}   (single JSON value)
 *   stdout: {"ok":true,"sha256Hex":"...","contentBytes":N}\n
 *
 * Operations (all deterministic, all bounded):
 * - sha256    : SHA-256 over decoded UTF-8 bytes; reports hex + byte count.
 * - sleep     : sleeps a bounded number of milliseconds (timeout tests).
 * - flood     : writes junk bytes to stdout before responding (output-cap
 *               tests); the host is expected to kill the job.
 * - malformed : writes a non-protocol line (malformed-output tests).
 * - tree      : starts ONE grandchild copy of this same script (sleep op)
 *               and reports it, so tests can prove Job Object termination
 *               reaches the whole process tree.
 *
 * There is NO filesystem, network, provider, or environment access. The
 * worker never reads environment values beyond what Node itself requires,
 * never writes files, and never executes anything except its own script.
 * Input beyond the protocol stdin cap yields a bounded failure response.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const WORKER_INPUT_CAP_BYTES = 256 * 1024;
const WORKER_OUTPUT_CAP_BYTES = 1024 * 1024;

/** Read all of stdin, aborting once the cap is exceeded. */
function readStdinCapped() {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let capped = false;
    process.stdin.on("data", (chunk) => {
      if (capped) return;
      total += chunk.length;
      if (total > WORKER_INPUT_CAP_BYTES) {
        capped = true;
        resolve({ capped: true, text: "" });
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      if (capped) return;
      resolve({ capped: false, text: Buffer.concat(chunks).toString("utf8") });
    });
    process.stdin.on("error", () => {
      if (capped) return;
      resolve({ capped: true, text: "" });
    });
  });
}

function respond(value) {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line, "utf8") > WORKER_OUTPUT_CAP_BYTES) {
    process.stdout.write(JSON.stringify({ ok: false, error: "response_too_large" }) + "\n");
    return;
  }
  process.stdout.write(line + "\n");
}

function selfScriptPath() {
  return fileURLToPath(import.meta.url);
}

async function opTree() {
  // Start one grandchild copy of THIS script (server-owned, allow-listed)
  // running the sleep op, confirm it is alive, then report and wait for it.
  const grandchild = spawn(process.execPath, [selfScriptPath()], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    detached: false,
  });
  grandchild.stdin.write(JSON.stringify({ v: 1, op: "sleep", ms: 60_000 }) + "\n");
  grandchild.stdin.end();
  grandchild.stdout.resume();
  grandchild.stderr.resume();
  // Confirm liveness for up to ~2s so the report is truthful.
  const deadline = Date.now() + 2_000;
  for (;;) {
    let alive = false;
    try {
      process.kill(grandchild.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive || Date.now() >= deadline) {
      if (!alive) return { ok: false, error: "grandchild_not_started" };
      break;
    }
    await delay(50);
  }
  respond({ ok: true, spawnedChildren: 1 });
  // Stay alive until the grandchild exits (the host kills the job first).
  await new Promise((resolve) => grandchild.on("exit", resolve));
  process.exit(0);
}

const input = await readStdinCapped();
if (input.capped) {
  respond({ ok: false, error: "input_too_large" });
  process.exit(0);
}

let request;
try {
  request = JSON.parse(input.text);
} catch {
  respond({ ok: false, error: "bad_json" });
  process.exit(0);
}

if (
  !request ||
  typeof request !== "object" ||
  request.v !== 1 ||
  typeof request.op !== "string"
) {
  respond({ ok: false, error: "bad_request" });
  process.exit(0);
}

switch (request.op) {
  case "sha256": {
    const contentB64 = typeof request.contentB64 === "string" ? request.contentB64 : "";
    let content;
    try {
      content = Buffer.from(contentB64, "base64");
    } catch {
      respond({ ok: false, error: "bad_base64" });
      process.exit(0);
    }
    const digest = createHash("sha256").update(content).digest("hex");
    respond({ ok: true, sha256Hex: digest, contentBytes: content.length });
    process.exit(0);
  }
  case "sleep": {
    const ms = Number.isFinite(request.ms) ? Math.min(Math.max(Math.trunc(request.ms), 0), 120_000) : 0;
    await delay(ms);
    respond({ ok: true, sleptMs: ms });
    process.exit(0);
  }
  case "flood": {
    const bytes = Number.isFinite(request.bytes) ? Math.min(Math.max(Math.trunc(request.bytes), 0), 4 * 1024 * 1024) : 0;
    const chunk = Buffer.alloc(4096, 0x78);
    let written = 0;
    while (written < bytes) {
      const n = Math.min(chunk.length, bytes - written);
      process.stdout.write(chunk.subarray(0, n));
      written += n;
    }
    respond({ ok: true });
    process.exit(0);
  }
  case "malformed": {
    process.stdout.write("this is definitely not a protocol response\n");
    process.exit(0);
  }
  case "tree": {
    await opTree();
    process.exit(0);
  }
  default: {
    respond({ ok: false, error: "unknown_op" });
    process.exit(0);
  }
}
