#!/usr/bin/env node
/**
 * Judge eval (F9-25 / F7-12 / F9-11): golden fixtures x rubric v1/v2 through
 * the real configured judge, appending a run section to
 * `docs/eval/rubric-v1-vs-v2.md`.
 *
 * Exactly one judge call per case (12 per full run) via the production
 * `runJudge` pipeline (parse / normalize / single retry). Per-case failures
 * become `ERROR` cells and the run continues.
 *
 * Usage:
 *   npm run eval:judge
 *   npm run eval:judge -- --provider=opencode-go --model=muse-spark-1.3-contributor
 *   npm run eval:judge -- --only=clear-A,1   (single fixture,version cell)
 *   npm run eval:judge -- --dry-run          (plan only: no network, no writes)
 *
 * Note: this script deliberately avoids importing `provider-store.ts` /
 * `model.ts` (both pull `server-only`, unresolvable outside Next). It reads
 * the provider store JSON directly and mirrors `defaultCallModel`'s judge
 * branch; everything else (prompt, parse, normalize, retry) is production.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";

import { runJudge } from "../src/features/run-debate/server/debate-runner.ts";
import { GOLDEN_TRANSCRIPT_FIXTURES } from "../src/entities/debate/__fixtures__/transcripts/index.ts";
import { debateVerdictSchema } from "../src/entities/debate/verdict.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(HERE)));
const REPORT_PATH = join(REPO_ROOT, "docs", "eval", "rubric-v1-vs-v2.md");
const CASE_TIMEOUT_MS = 120_000;
const RUBRIC_VERSIONS = ["1", "2"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq === -1) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      const key = token.slice(2, eq);
      let value = token.slice(eq + 1);
      // Tolerate shells (notably PowerShell) that split `--only=a,b` at the
      // comma into two argv entries: rejoin a bare trailing token.
      if (key === "only" && !value.includes(",")) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value += `,${next}`;
          i += 1;
        }
      }
      args[key] = value;
    }
  }
  return args;
}

function providerStorePath() {
  return (
    process.env.AI_DEBATE_ARENA_PROVIDER_FILE ?? join(homedir(), ".ai-debate-arena", "providers.json")
  );
}

async function resolveProvider(preferredId) {
  const store = JSON.parse(await readFile(providerStorePath(), "utf8"));
  const providers = Array.isArray(store.providers) ? store.providers : [];
  if (preferredId) {
    const found = providers.find((p) => p.id === preferredId);
    if (!found) throw new Error(`Provider not found in store: ${preferredId}`);
    return found;
  }
  if (providers.length === 0) throw new Error(`No providers configured at ${providerStorePath()}`);
  return providers[0];
}

function toLanguageModel(provider, modelId) {
  if (provider.api === "responses") {
    return createOpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey }).responses(modelId);
  }
  return createOpenAICompatible({ baseURL: provider.baseUrl, apiKey: provider.apiKey }).languageModel(
    modelId,
  );
}

/**
 * The one small judge-call function: mirrors `defaultCallModel`'s judge
 * branch (structured output, then deterministic temperature-0 plain fallback).
 */
async function judgeCallModel(provider, modelId, callArgs) {
  const languageModel = toLanguageModel(provider, modelId);
  const providerOptions = { openai: { reasoningEffort: "low" } };
  try {
    const structured = await generateText({
      model: languageModel,
      system: callArgs.system,
      prompt: callArgs.prompt,
      maxOutputTokens: callArgs.maxOutputTokens,
      abortSignal: callArgs.abortSignal,
      providerOptions,
      output: Output.object({ schema: debateVerdictSchema }),
    });
    const output = structured.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      throw new Error("Judge structured output was empty");
    }
    return { text: JSON.stringify(output), chunks: [] };
  } catch {
    const fallback = await generateText({
      model: languageModel,
      system: callArgs.system,
      prompt:
        `${callArgs.prompt}\n\nRespond with ONLY valid JSON matching the required schema: ` +
        `concrete integer scores 0-100, no markdown fences, no prose.`,
      maxOutputTokens: callArgs.maxOutputTokens,
      abortSignal: callArgs.abortSignal,
      temperature: 0,
      providerOptions,
    });
    return { text: fallback.text, chunks: [] };
  }
}

function cell(value) {
  return String(value).replaceAll("|", "/").replaceAll("\n", " ").trim();
}

function shortNotes(row) {
  if (row.error) return cell(row.error).slice(0, 140);
  return cell(row.reasoning ?? "").slice(0, 140);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";

  let onlyFixture = null;
  let onlyVersion = null;
  if (args.only) {
    const parts = String(args.only).split(",");
    onlyFixture = parts[0] ?? null;
    onlyVersion = parts[1] ?? null;
    const knownFixtures = new Set(GOLDEN_TRANSCRIPT_FIXTURES.map((f) => f.id));
    if (!onlyFixture || !knownFixtures.has(onlyFixture)) {
      throw new Error(`--only fixture must be one of: ${[...knownFixtures].join(", ")}`);
    }
    if (!onlyVersion || !RUBRIC_VERSIONS.includes(onlyVersion)) {
      throw new Error(`--only version must be one of: ${RUBRIC_VERSIONS.join(", ")}`);
    }
  }

  const cases = [];
  for (const fixture of GOLDEN_TRANSCRIPT_FIXTURES) {
    for (const rubricVersion of RUBRIC_VERSIONS) {
      if (onlyFixture && (fixture.id !== onlyFixture || rubricVersion !== onlyVersion)) continue;
      cases.push({ fixture, rubricVersion });
    }
  }

  const provider = dryRun
    ? { id: "<dry-run>", name: "<dry-run>", model: "<dry-run>" }
    : await resolveProvider(args.provider ?? process.env.AI_DEBATE_EVAL_PROVIDER ?? null);
  const modelId =
    args.model ?? process.env.AI_DEBATE_EVAL_MODEL ?? provider.model ?? "<missing-model>";

  console.log(
    `judge-eval: ${cases.length} case(s) provider=${provider.id} model=${modelId}${dryRun ? " (dry run)" : ""}`,
  );

  const rows = [];
  for (const { fixture, rubricVersion } of cases) {
    const label = `${fixture.id},v${rubricVersion}`;
    if (dryRun) {
      console.log(`  [dry-run] ${label}`);
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);
    const startedAt = Date.now();
    const seenTexts = [];
    const recordingCallModel = async (callArgs) => {
      const result = await judgeCallModel(provider, modelId, callArgs);
      seenTexts.push(result.text);
      return result;
    };
    try {
      const result = await runJudge(
        {
          topic: fixture.topic,
          turns: fixture.turns,
          providerId: provider.id,
          model: modelId,
          rubricVersion,
        },
        {
          callModel: recordingCallModel,
          abortSignal: controller.signal,
        },
      );
      rows.push({
        fixture: fixture.id,
        version: rubricVersion,
        winner: result.verdict.winner,
        scoreA: result.verdict.scoreA,
        scoreB: result.verdict.scoreB,
        latencyMs: result.judgeMs ?? Date.now() - startedAt,
        reasoning: result.verdict.reasoning,
        error: null,
      });
      console.log(
        `  [ok] ${label} winner=${result.verdict.winner} ${result.verdict.scoreA}-${result.verdict.scoreB} judgeMs=${result.judgeMs}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        fixture: fixture.id,
        version: rubricVersion,
        winner: "ERROR",
        scoreA: "ERROR",
        scoreB: "ERROR",
        latencyMs: Date.now() - startedAt,
        reasoning: null,
        error: message,
      });
      console.log(`  [ERROR] ${label} ${message.slice(0, 160)}`);
      if (process.env.AI_DEBATE_EVAL_DEBUG) {
        seenTexts.forEach((text, index) => {
          console.log(`  [debug] attempt ${index + 1} (${text.length} chars): ${text.slice(0, 500)}`);
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (dryRun) {
    console.log(`judge-eval: dry run complete, no report written (${cases.length} planned).`);
    return;
  }

  const byFixture = new Map();
  for (const row of rows) {
    if (!byFixture.has(row.fixture)) byFixture.set(row.fixture, {});
    byFixture.get(row.fixture)[row.version] = row;
  }
  let same = 0;
  let comparable = 0;
  for (const versions of byFixture.values()) {
    if (versions["1"] && versions["2"] && !versions["1"].error && !versions["2"].error) {
      comparable += 1;
      if (versions["1"].winner === versions["2"].winner) same += 1;
    }
  }
  const agreementFor = (fixtureId) => {
    const versions = byFixture.get(fixtureId) ?? {};
    if (!versions["1"] || !versions["2"]) return "n/a";
    if (versions["1"].error || versions["2"].error) return "n/a";
    return versions["1"].winner === versions["2"].winner ? "same" : "DIFFER";
  };

  const stamp = new Date().toISOString();
  const lines = [
    `## Run ${stamp} (provider=${provider.id}, model=${modelId})`,
    "",
    "| fixture | rubric | winner | scoreA-scoreB | latencyMs | agreement | notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${cell(row.fixture)} | ${cell(row.version)} | ${cell(row.winner)} | ${cell(row.scoreA)}-${cell(row.scoreB)} | ${cell(row.latencyMs)} | ${cell(agreementFor(row.fixture))} | ${shortNotes(row)} |`,
    );
  }
  lines.push("", `Agreement (v1 vs v2 same winner): ${same}/${comparable}.`, "");

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(REPORT_PATH, "utf8");
  } catch {
    existing = "";
  }
  const header = [
    "# Rubric v1 vs v2 judge evaluation",
    "",
    "Generated by `npm run eval:judge` (`scripts/judge-eval.mjs`, F9-25). Each run",
    "appends one section: every golden fixture x rubric v1/v2 judged once by the",
    "configured provider through the production `runJudge` pipeline. Per-case",
    "failures are recorded as `ERROR` cells; the run continues.",
    "",
  ].join("\n");
  await writeFile(REPORT_PATH, `${existing === "" ? header : existing}${lines.join("\n")}\n`, "utf8");
  console.log(`judge-eval: appended ${rows.length} row(s) to docs/eval/rubric-v1-vs-v2.md`);
  console.log(`judge-eval: agreement v1-vs-v2 ${same}/${comparable} same winner`);
}

main().catch((error) => {
  console.error(`judge-eval: fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
