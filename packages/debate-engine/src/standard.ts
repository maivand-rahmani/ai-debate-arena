import { z } from "zod";
import { STANDARD_TOOL_TIMEOUT_MS } from "./token-policy";

/**
 * Every bounded tool the local Standard server can execute for a contender.
 * This registry name set matches the canonical `DebateStreamToolName` wire
 * union so agent actions, public events, and match records agree.
 */
export const STANDARD_TOOL_NAMES = ["web_search", "fetch_url", "run_code"] as const;
export type StandardToolName = (typeof STANDARD_TOOL_NAMES)[number];

/** Tools the Standard agent may choose from its match-long loadout. */
export const STANDARD_AGENT_TOOL_NAMES = STANDARD_TOOL_NAMES;
export type StandardAgentToolName = (typeof STANDARD_AGENT_TOOL_NAMES)[number];

export const STANDARD_RUN_CODE_LANGUAGES = ["javascript", "python"] as const;
export type StandardRunCodeLanguage = (typeof STANDARD_RUN_CODE_LANGUAGES)[number];

/**
 * Tool actions carry their primary argument in `query`: a search phrase for
 * `web_search`, a URL for `fetch_url`, or the program source for `run_code`.
 * `run_code` additionally requires an interpreter `language`.
 */
const standardToolActionSchema = z.discriminatedUnion("tool", [
  z.object({
    action: z.literal("tool"),
    tool: z.literal("web_search"),
    query: z.string().trim().min(2).max(240),
  }),
  z.object({
    action: z.literal("tool"),
    tool: z.literal("fetch_url"),
    query: z.string().trim().min(1).max(2048),
  }),
  z.object({
    action: z.literal("tool"),
    tool: z.literal("run_code"),
    language: z.enum(STANDARD_RUN_CODE_LANGUAGES),
    query: z.string().trim().min(1).max(20000),
  }),
]);

export type StandardToolAction = z.infer<typeof standardToolActionSchema>;

export const standardAgentActionSchema = z.union([
  standardToolActionSchema,
  z.object({
    action: z.literal("speak"),
    content: z.string().trim().min(1).max(12000),
    ready: z.boolean().optional(),
  }),
]);

export type StandardAgentAction = z.infer<typeof standardAgentActionSchema>;

export interface StandardToolResult {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
}

/**
 * Arguments handed to a tool executor. `query` is the tool's primary input:
 * a search phrase for `web_search`, a URL for `fetch_url`, or the program
 * source for `run_code`. `language` selects the `run_code` interpreter.
 * `timeoutMs` carries the match's configured per-tool bound; when omitted the
 * executor falls back to {@link STANDARD_TOOL_TIMEOUT_MS}.
 */
export interface StandardToolInput {
  readonly query: string;
  readonly language?: StandardRunCodeLanguage;
  readonly timeoutMs?: number;
}

/** Maps a parsed tool action onto the executor's input shape. */
export function standardToolInputFor(action: StandardToolAction, timeoutMs?: number): StandardToolInput {
  const base: StandardToolInput =
    action.tool === "run_code" ? { query: action.query, language: action.language } : { query: action.query };
  return timeoutMs === undefined ? base : { ...base, timeoutMs };
}

export interface StandardToolCall {
  readonly callId: string;
  readonly side: "A" | "B";
  readonly tool: StandardToolName;
  readonly query: string;
  readonly output: string;
  readonly ok: boolean;
  readonly error?: string;
  /**
   * True when the tool was refused before execution because the move's
   * affordable tool budget was already spent. Refused (attempted) calls are
   * public failure events but are not priced tool executions.
   */
  readonly rejected?: boolean;
  readonly createdAt: string;
}

export type StandardToolExecutor = (
  tool: StandardToolName,
  input: StandardToolInput,
  signal?: AbortSignal,
) => Promise<StandardToolResult>;

/** One entry in the server-owned Standard tool registry. */
export interface StandardToolDefinition {
  readonly name: StandardToolName;
  readonly execute: (input: StandardToolInput, signal?: AbortSignal) => Promise<StandardToolResult>;
}

export const standardToolCallSchema = z.object({
  callId: z.string().min(1),
  side: z.enum(["A", "B"]),
  tool: z.enum(STANDARD_TOOL_NAMES),
  query: z.string().min(1),
  output: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  rejected: z.boolean().optional(),
  createdAt: z.string().min(1),
});

// --- Tool bounds ------------------------------------------------------------

/** Maximum characters read from an HTTP response before extraction. */
const RESPONSE_READ_CAP = 160_000;
/** Maximum characters returned in any single tool result. */
const TOOL_OUTPUT_CAP = 6_000;
/** Maximum characters kept from each `run_code` stream. */
const RUN_CODE_STREAM_CAP = 4_000;
/** Maximum combined characters returned from `run_code`. */
const RUN_CODE_OUTPUT_CAP = 8_000;
const TOOL_USER_AGENT = "AI-Debate-Arena/0.4";

// --- Generic registry lookup ------------------------------------------------

/**
 * Server-owned tool registry. Executors run in the Node server process only;
 * the browser receives just the bounded {@link StandardToolResult}.
 */
export const STANDARD_TOOLS: Readonly<Record<StandardToolName, StandardToolDefinition>> = {
  web_search: { name: "web_search", execute: runWebSearch },
  fetch_url: { name: "fetch_url", execute: runFetchUrl },
  run_code: { name: "run_code", execute: runRunCode },
};

export function getStandardTool(name: string): StandardToolDefinition | undefined {
  return (STANDARD_TOOLS as Readonly<Record<string, StandardToolDefinition>>)[name];
}

/** Executes a registered tool by name, or fails with a bounded error result. */
export async function runStandardTool(
  name: StandardToolName,
  input: StandardToolInput,
  signal?: AbortSignal,
): Promise<StandardToolResult> {
  const tool = getStandardTool(name);
  if (!tool) return { ok: false, output: "Unknown tool", error: "Unknown tool" };
  return tool.execute(input, signal);
}

// --- Executors --------------------------------------------------------------

/** Preserved DuckDuckGo HTML search: bounded fetch plus five parsed results. */
async function runWebSearch(input: StandardToolInput, signal?: AbortSignal): Promise<StandardToolResult> {
  const query = input.query.trim();
  if (query.length < 2) return { ok: false, output: "Search query is too short.", error: "Invalid search query" };
  const combined = combineWithTimeout(signal, resolveToolTimeoutMs(input.timeoutMs));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      signal: combined.signal,
      headers: { "user-agent": TOOL_USER_AGENT },
    });
    if (!response.ok) {
      return { ok: false, output: `Search returned HTTP ${response.status}.`, error: "Search request failed" };
    }
    const html = await readBoundedText(response, RESPONSE_READ_CAP);
    const results = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 5)
      .map((match, index) => `${index + 1}. ${decodeHtml(stripTags(match[2] ?? ""))}\n   ${decodeHtml(match[1] ?? "")}`)
      .filter(Boolean);
    const output = results.length
      ? results.join("\n\n").slice(0, TOOL_OUTPUT_CAP)
      : stripTags(html).replace(/\s+/g, " ").trim().slice(0, TOOL_OUTPUT_CAP);
    return output
      ? { ok: true, output }
      : { ok: false, output: "Search returned no readable results.", error: "Empty search result" };
  } catch {
    if (combined.signal.aborted) {
      return { ok: false, output: "Search timed out.", error: "Search timed out" };
    }
    return { ok: false, output: "Search could not be reached.", error: "Search request failed" };
  }
}

/** Fetches one URL and returns plain text, capped for the match stream. */
async function runFetchUrl(input: StandardToolInput, signal?: AbortSignal): Promise<StandardToolResult> {
  const raw = input.query.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, output: "The URL is not valid.", error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, output: "Only http and https URLs can be fetched.", error: "Unsupported URL protocol" };
  }
  const combined = combineWithTimeout(signal, resolveToolTimeoutMs(input.timeoutMs));
  try {
    const response = await fetch(url.toString(), {
      signal: combined.signal,
      headers: { "user-agent": TOOL_USER_AGENT },
    });
    if (!response.ok) {
      return { ok: false, output: `Fetch returned HTTP ${response.status}.`, error: "Fetch request failed" };
    }
    const html = await readBoundedText(response, RESPONSE_READ_CAP);
    const text = extractPlainText(html).slice(0, TOOL_OUTPUT_CAP);
    return text
      ? { ok: true, output: text }
      : { ok: false, output: "The page contained no readable text.", error: "Empty page" };
  } catch {
    if (combined.signal.aborted) {
      return { ok: false, output: "Fetch timed out.", error: "Fetch timed out" };
    }
    return { ok: false, output: "The page could not be reached.", error: "Fetch request failed" };
  }
}

/**
 * Runs JavaScript (via the current Node executable) or Python (via a discovered
 * interpreter) in a temp file, with a hard timeout and capped output. All
 * failure paths return a structured `ok: false` result so one bad script cannot
 * break the match.
 */
async function runRunCode(input: StandardToolInput, signal?: AbortSignal): Promise<StandardToolResult> {
  const language = input.language;
  if (language !== "javascript" && language !== "python") {
    return { ok: false, output: "run_code needs a language of javascript or python.", error: "Unsupported language" };
  }
  const code = input.query;
  if (!code.trim()) {
    return { ok: false, output: "No code was provided.", error: "Empty code" };
  }

  const [{ spawn }, fs, os, path] = await Promise.all([
    import("node:child_process"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);

  const command = language === "javascript"
    ? { exe: process.execPath, args: [] as string[] }
    : await resolvePythonCommand(spawn);
  if (!command) {
    return { ok: false, output: "Python is not available on this machine.", error: "Runtime unavailable" };
  }

  let dir: string;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "arena-run-"));
  } catch (error) {
    return { ok: false, output: `Could not prepare a workspace: ${errorText(error)}`, error: "Runtime unavailable" };
  }

  const file = path.join(dir, language === "javascript" ? "main.js" : "main.py");
  try {
    await fs.writeFile(file, code, "utf8");
    return await executeCode(spawn, command.exe, [...command.args, file], signal, resolveToolTimeoutMs(input.timeoutMs));
  } catch (error) {
    return { ok: false, output: `Code execution failed: ${errorText(error)}`, error: "Execution failed" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

type SpawnFn = typeof import("node:child_process").spawn;

interface ResolvedCommand {
  readonly exe: string;
  readonly args: readonly string[];
}

async function resolvePythonCommand(spawn: SpawnFn): Promise<ResolvedCommand | null> {
  const candidates: readonly ResolvedCommand[] = process.platform === "win32"
    ? [{ exe: "python", args: [] }, { exe: "py", args: ["-3"] }, { exe: "python3", args: [] }]
    : [{ exe: "python3", args: [] }, { exe: "python", args: [] }];
  for (const candidate of candidates) {
    if (await commandExists(spawn, candidate.exe, candidate.args)) return candidate;
  }
  return null;
}

function commandExists(spawn: SpawnFn, exe: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (exists: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(exists);
    };
    try {
      const child = spawn(exe, [...args, "--version"], { stdio: "ignore", windowsHide: true });
      child.once("error", () => done(false));
      child.once("exit", () => done(true));
    } catch {
      done(false);
    }
  });
}

function executeCode(
  spawn: SpawnFn,
  exe: string,
  args: readonly string[],
  signal?: AbortSignal,
  timeoutMs: number = STANDARD_TOOL_TIMEOUT_MS,
): Promise<StandardToolResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, [...args], { windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result: StandardToolResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: { toString(encoding: string): string }) => {
      if (stdout.length < RUN_CODE_STREAM_CAP) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: { toString(encoding: string): string }) => {
      if (stderr.length < RUN_CODE_STREAM_CAP) stderr += chunk.toString("utf8");
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ABORT_ERR") {
        finish({ ok: false, output: "Code execution was cancelled.", error: "Code execution cancelled" });
        return;
      }
      finish({ ok: false, output: `Could not start the runtime: ${error.message}`, error: "Runtime unavailable" });
    });
    child.once("close", (code) => {
      const output = formatRunCodeOutput(stdout, stderr);
      if (timedOut) {
        finish({ ok: false, output: output || "Code execution timed out.", error: "Code execution timed out" });
        return;
      }
      if (signal?.aborted) {
        finish({ ok: false, output: output || "Code execution was cancelled.", error: "Code execution cancelled" });
        return;
      }
      if (code === 0) {
        finish({ ok: true, output: output || "(no output)" });
        return;
      }
      finish({
        ok: false,
        output: output || `Process exited with code ${code ?? "unknown"}.`,
        error: `Code exited with code ${code ?? "unknown"}`,
      });
    });
  });
}

function formatRunCodeOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  const out = stdout.slice(0, RUN_CODE_STREAM_CAP).trimEnd();
  const err = stderr.slice(0, RUN_CODE_STREAM_CAP).trimEnd();
  if (out) parts.push(out);
  if (err) parts.push(`[stderr]\n${err}`);
  return parts.join("\n").slice(0, RUN_CODE_OUTPUT_CAP);
}

// --- Shared helpers ---------------------------------------------------------

/**
 * Resolves a caller-supplied per-tool timeout, falling back to the engine
 * default when the value is missing or not a positive finite number.
 */
function resolveToolTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : STANDARD_TOOL_TIMEOUT_MS;
}

function combineWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): { readonly signal: AbortSignal } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (output.length < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return output.slice(0, limit);
}

function extractPlainText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return decodeHtml(withoutScripts.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseStandardAgentAction(text: string): StandardAgentAction {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced);
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1));

  for (const candidate of candidates) {
    try {
      const parsed = standardAgentActionSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next tolerant JSON candidate.
    }
  }
  throw new Error("Agent returned an invalid Standard action");
}
