"use client";

import { findMatchTurn, parseStandardRoundTurn } from "@arena/types";
import type { DebateStreamSideResources, DebateStreamToolName } from "@arena/types";
import { currentSidePanel, isInMatch, type DebateRuntimeState, type SpeechPanel, type StandardTimelineEvent } from "@/features/run-debate/lib/reducer";
import type { MatchPlayback } from "@/features/arena/match/use-match-playback";

export interface ArenaResourceLimits {
  readonly startingCredits?: number;
  readonly maxToolsPerMove?: number;
  readonly toolTimeoutMs?: number;
}

export interface ArenaRailsProps {
  readonly state: DebateRuntimeState;
  readonly playback?: MatchPlayback;
  readonly standardLimits?: ArenaResourceLimits;
}

type RailSide = "A" | "B";
type RailTone = "ember" | "vesper";

interface RailIdentity {
  readonly side: RailSide;
  readonly name: string;
  readonly role: string;
  readonly tone: RailTone;
  readonly mark: string;
}

const IDENTITIES: Readonly<Record<RailSide, RailIdentity>> = {
  A: { side: "A", name: "Ember", role: "Challenger", tone: "ember", mark: "E" },
  B: { side: "B", name: "Vesper", role: "Advocate", tone: "vesper", mark: "V" },
};

const TOOL_LABEL: Readonly<Record<DebateStreamToolName, string>> = {
  web_search: "Web search",
  fetch_url: "URL fetch",
  run_code: "Code / run",
};

interface RailAction {
  readonly callId: string;
  readonly tool: DebateStreamToolName;
  readonly query: string;
  readonly status: "working" | "complete" | "failed" | "rejected";
}

interface RailEvidence {
  readonly callId: string;
  readonly tool: DebateStreamToolName;
  readonly query: string;
  readonly output: string;
  readonly status: "evidence" | "failed" | "rejected";
}

/**
 * The two quiet commentary desks that sit over both arena worlds. Each desk
 * keeps the complete public tool record in a bounded activity surface. This is
 * one shared presentation component: the WebGL HUD and the CSS fallback only
 * decide where it is mounted, never what it says.
 */
export function ArenaRails({ state, playback, standardLimits }: ArenaRailsProps) {
  if (!isInMatch(state)) return null;

  const focusedPanel = playback?.focusedPanel ?? null;
  const hasPlayback = playback !== undefined;
  // With no viewer-selected speech, the live side is still the broadcast
  // focus. This keeps the active contestant visually in the foreground while
  // preserving playback focus when a spectator is reading an older turn.
  const activeSide = focusedPanel?.side ?? (state.status === "streaming" ? state.currentSide : null);
  const focusSide = activeSide?.toLowerCase() ?? "none";

  return (
    <div className="arena-rails" data-caption-region="reserved" role="group" aria-label="Contender commentary desks">
      <div className="arena-rails__grid" data-focus-side={focusSide}>
        <ArenaRail
          identity={IDENTITIES.A}
          state={state}
          focusedPanel={focusedPanel}
          activeSide={activeSide}
          hasPlayback={hasPlayback}
          standardLimits={standardLimits}
        />
        <ArenaRail
          identity={IDENTITIES.B}
          state={state}
          focusedPanel={focusedPanel}
          activeSide={activeSide}
          hasPlayback={hasPlayback}
          standardLimits={standardLimits}
        />
      </div>
    </div>
  );
}

interface ArenaRailProps {
  readonly identity: RailIdentity;
  readonly state: DebateRuntimeState;
  readonly focusedPanel: SpeechPanel | null;
  readonly activeSide: RailSide | null;
  readonly hasPlayback: boolean;
  readonly standardLimits?: ArenaResourceLimits;
}

function ArenaRail({ identity, state, focusedPanel, activeSide, hasPlayback, standardLimits }: ArenaRailProps) {
  const isFocused = activeSide === identity.side;
  const panel = isFocused
    ? focusedPanel ?? currentSidePanel(state) ?? latestSealedPanel(state, identity.side)
    : latestSealedPanel(state, identity.side);
  const actions = deriveActions(state, identity.side);
  const evidence = deriveEvidence(state, identity.side);
  const resources = deriveResources(state, identity.side, standardLimits);
  const activityIsLive = state.mode !== "standard" || state.activeStandardEvents.length > 0;
  // A preview is only a preview while another speech is selected. During a
  // live stream the current side is the primary contestant; terminal frames
  // return to a balanced archive view.
  const preview = Boolean(focusedPanel && panel && !isFocused);
  const status = speechStatus(state, panel, isFocused);
  const headingId = `arena-rail-${identity.side.toLowerCase()}-heading`;

  return (
    <aside
      className={`arena-rail arena-rail--${identity.tone}${isFocused ? " is-focused" : ""}${preview ? " is-preview" : ""}`}
      aria-labelledby={headingId}
      data-side={identity.side.toLowerCase()}
      data-focused={isFocused ? "true" : "false"}
    >
      <header className="arena-rail__header">
        <span className="arena-rail__mark" aria-hidden="true">{identity.mark}</span>
        <div className="arena-rail__identity">
          <span className="arena-rail__role">{identity.role}</span>
          <h2 id={headingId}>{identity.name}</h2>
        </div>
        <span className="arena-rail__status" aria-live="polite">{status}</span>
      </header>

      <div className="arena-rail__speech" data-empty={!panel ? "true" : "false"}>
        {isFocused ? (
          <span className="arena-rail__focus-marker">
            <span className="arena-rail__focus-marker-dot" aria-hidden="true" />
            Primary view
          </span>
        ) : null}
        {panel ? (
          <blockquote>
            <p>{panel.content.trim() || "Preparing the first words…"}</p>
          </blockquote>
        ) : (
          <div className="arena-rail__ready">
            <span className="arena-rail__ready-line" aria-hidden="true" />
            <p>{hasPlayback ? "Ready for the opening call." : "Preparing the opening call."}</p>
          </div>
        )}
        {panel ? (
          <span className="arena-rail__phase">
            {phaseLabel(state.mode, panel)}{preview ? " · latest sealed" : ""}
          </span>
        ) : null}
      </div>

      {state.mode === "standard" || !isCurrentStandardMoveSealed(state) ? (
        <div className="arena-rail__activity" role="region" aria-label={`${identity.name} public tool activity`}>
          <div className="arena-rail__section">
            <div className="arena-rail__section-head">
              <h3>Public actions</h3>
              <span>
                {actions.length
                  ? `${actions.length} total · ${activityIsLive ? "Live" : "Last move"}`
                  : "No calls yet"}
              </span>
            </div>
            {actions.length ? (
              <ol className="arena-rail__actions">
                {actions.map((action) => (
                  <li
                    key={action.callId}
                    className={`arena-rail__action arena-rail__action--${action.status}`}
                    data-call-id={action.callId}
                  >
                    <span className="arena-rail__tool-mark" data-tool={action.tool} aria-hidden="true" />
                    <span className="arena-rail__action-copy">
                      <strong>{TOOL_LABEL[action.tool]}</strong>
                      <span>{compactQuery(action.query)}</span>
                      <span className="arena-rail__action-id">Call {action.callId}</span>
                    </span>
                    <span className="arena-rail__action-status">{actionStatus(action.status)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="arena-rail__empty">Research and execution will appear here.</p>
            )}
          </div>

          {state.mode === "standard" && evidence.length ? (
            <EvidenceReceipts identity={identity} evidence={evidence} />
          ) : null}
        </div>
      ) : null}

      <ResourceStrip resources={resources} />
    </aside>
  );
}

interface ResourceDisplay {
  readonly credits: string;
  readonly tools: string;
  readonly timeout: string;
  readonly limit: string;
  readonly source: "authoritative" | "setup" | "derived" | "unavailable";
}

function ResourceStrip({ resources }: { readonly resources: ResourceDisplay }) {
  return (
    <div className={`arena-rail__resources arena-rail__resources--${resources.source}`}>
      <div className="arena-rail__resource-head">
        <h3>Match resources</h3>
        <span>{resourceSourceLabel(resources.source)}</span>
      </div>
      <dl>
        <div>
          <dt>Credits</dt>
          <dd>{resources.credits}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{resources.tools}</dd>
        </div>
        <div>
          <dt>Timeout</dt>
          <dd>{resources.timeout}</dd>
        </div>
      </dl>
      <p className="arena-rail__limit" aria-live="polite">{resources.limit}</p>
    </div>
  );
}

function deriveResources(
  state: DebateRuntimeState,
  side: RailSide,
  standardLimits?: ArenaResourceLimits,
): ResourceDisplay {
  const snapshot = state.standardState;
  const sideResources = snapshot?.sides[side];
  if (sideResources) return authoritativeResources(snapshot, sideResources);

  if (state.mode !== "standard") {
    return {
      credits: "Not active",
      tools: "Not active",
      timeout: "Not active",
      limit: "Quick format · no resource budget",
      source: "unavailable",
    };
  }

  const derivedToolCount = deriveActions(state, side).length;
  const hasSetupLimit = standardLimits?.startingCredits !== undefined ||
    standardLimits?.maxToolsPerMove !== undefined || standardLimits?.toolTimeoutMs !== undefined;
  return {
    credits: standardLimits?.startingCredits !== undefined
      ? `${standardLimits.startingCredits} starting`
      : "Not reported",
    tools: `${derivedToolCount} used · ${standardLimits?.maxToolsPerMove !== undefined ? `${standardLimits.maxToolsPerMove} / move` : "max not reported"}`,
    timeout: standardLimits?.toolTimeoutMs !== undefined ? formatTimeout(standardLimits.toolTimeoutMs) : "Not reported",
    limit: hasSetupLimit ? "Setup limits · awaiting accounting snapshot" : "Accounting snapshot pending",
    source: hasSetupLimit ? "setup" : derivedToolCount > 0 ? "derived" : "unavailable",
  };
}

function authoritativeResources(
  snapshot: NonNullable<DebateRuntimeState["standardState"]>,
  resources: DebateStreamSideResources,
): ResourceDisplay {
  const limit = resources.depleted
    ? "Speech limit reached"
    : snapshot.moveLimitReached
      ? "Match move limit reached"
      : snapshot.closingRound
        ? "Closing round"
        : "Within match limits";
  return {
    credits: `${resources.creditsRemaining} left`,
    tools: `${resources.toolsUsed} used · ${resources.maxToolsPerMove} / move`,
    timeout: formatTimeout(resources.toolTimeoutMs),
    limit,
    source: "authoritative",
  };
}

function deriveActions(state: DebateRuntimeState, side: RailSide): readonly RailAction[] {
  const actions = new Map<string, RailAction>();
  for (const event of liveToolEvents(state)) {
    if (event.type === "tool-start" && event.tool.side === side) {
      actions.set(event.tool.callId, {
        callId: event.tool.callId,
        tool: event.tool.tool,
        query: event.tool.query,
        status: "working",
      });
    }
    if (event.type === "tool-result" && event.result.side === side) {
      actions.set(event.result.callId, {
        callId: event.result.callId,
        tool: event.result.tool,
        query: event.result.query,
        status: event.result.rejected ? "rejected" : event.result.ok ? "complete" : "failed",
      });
    }
  }
  return [...actions.values()];
}

function deriveEvidence(state: DebateRuntimeState, side: RailSide): readonly RailEvidence[] {
  return liveToolEvents(state).reduce<RailEvidence[]>((evidence, event) => {
    if (event.type !== "tool-result" || event.result.side !== side) return evidence;
    const result = event.result;
    const status: RailEvidence["status"] = result.rejected ? "rejected" : result.ok ? "evidence" : "failed";
    evidence.push({
      callId: result.callId,
      tool: result.tool,
      query: result.query,
      output: result.error ?? result.output,
      status,
    });
    return evidence;
  }, []);
}

function liveToolEvents(state: DebateRuntimeState): readonly StandardTimelineEvent[] {
  if (state.mode !== "standard") return state.standardEvents;
  if (state.activeStandardEvents.length > 0) return state.activeStandardEvents;
  if (state.lastStandardEvents && state.lastStandardEvents.length > 0) return state.lastStandardEvents;
  // Keep older in-memory fixtures readable while the reducer's retained
  // last-move snapshot is absent.
  return state.standardEvents;
}

function isCurrentStandardMoveSealed(state: DebateRuntimeState): boolean {
  if (state.mode !== "standard" || !state.currentSide || !state.currentPhase.startsWith("standard-")) return false;
  return state.panels.some((panel) =>
    panel.side === state.currentSide && panel.phase === state.currentPhase && panel.sealed,
  );
}

function EvidenceReceipts({
  identity,
  evidence,
}: {
  readonly identity: RailIdentity;
  readonly evidence: readonly RailEvidence[];
}) {
  return (
    <section className="arena-rail__evidence" aria-label={`${identity.name} public evidence receipts`}>
      <div className="arena-rail__section-head">
        <h3>Evidence receipts</h3>
        <span>{identity.name} · {evidence.length}</span>
      </div>
      <ol className="arena-rail__evidence-list">
        {evidence.map((item) => (
          <li key={item.callId} className={`arena-rail__evidence-item arena-rail__evidence-item--${item.status}`}>
            <div className="arena-rail__evidence-head">
              <strong>{TOOL_LABEL[item.tool]}</strong>
              <span>{evidenceStatus(item.status)}</span>
            </div>
            <p className="arena-rail__evidence-query"><span>Target</span>{compactQuery(item.query)}</p>
            <p className="arena-rail__evidence-output">
              <span>{evidenceOutputLabel(item.status)}</span>
              {compactEvidence(item.output)}
            </p>
            <details>
              <summary>Inspect result</summary>
              <dl>
                <div><dt>Call</dt><dd>{item.callId}</dd></div>
                <div><dt>Request</dt><dd>{item.query || "No request recorded."}</dd></div>
                <div><dt>Output</dt><dd>{item.output || "No public result recorded."}</dd></div>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function latestSealedPanel(state: DebateRuntimeState, side: RailSide): SpeechPanel | null {
  const panels = state.panels
    .filter((panel) => panel.side === side && panel.sealed)
    .sort((a, b) => panelOrder(a) - panelOrder(b));
  return panels[panels.length - 1] ?? null;
}

function panelOrder(panel: SpeechPanel): number {
  return panel.turn?.order ?? findMatchTurn("standard", panel.phase)?.order ?? Number.MAX_SAFE_INTEGER;
}

function phaseLabel(mode: DebateRuntimeState["mode"], panel: SpeechPanel): string {
  const turn = panel.turn ?? findMatchTurn("standard", panel.phase);
  if (!turn) return panel.phase;
  if (mode === "standard" && turn.role === "response") {
    const standardRound = parseStandardRoundTurn(panel.phase);
    const round = standardRound ? Math.floor((standardRound.order - 3) / 2) + 1 : 1;
    return `Open round ${round} · Response`;
  }
  return `${turn.role === "opening" ? "Opening" : "Response"} · turn ${turn.order}`;
}

function speechStatus(state: DebateRuntimeState, panel: SpeechPanel | null, isFocused: boolean): string {
  if (!panel) {
    if (state.status === "starting") return "Warming up";
    if (state.status === "judging") return "Judge reviewing";
    if (state.status === "finished") return "Verdict ready";
    if (state.status === "cancelled") return "Match ended";
    if (state.status === "error") return "Needs attention";
    return "Ready";
  }
  if (isFocused && !panel.sealed && state.status === "streaming") return "On air";
  if (isFocused) return "Selected";
  return "Preview";
}

function actionStatus(status: RailAction["status"]): string {
  if (status === "working") return "Working";
  if (status === "rejected") return "Not run";
  if (status === "failed") return "Failed";
  return "Complete";
}

function evidenceStatus(status: RailEvidence["status"]): string {
  if (status === "rejected") return "Not run";
  if (status === "failed") return "Failed";
  return "Public result";
}

function evidenceOutputLabel(status: RailEvidence["status"]): string {
  if (status === "rejected") return "Reason";
  if (status === "failed") return "Failure";
  return "Result";
}

function compactQuery(query: string): string {
  const compact = query.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact || "Public tool call";
}

function compactEvidence(output: string): string {
  const compact = output.trim().replace(/\s+/g, " ");
  return compact.length > 118 ? `${compact.slice(0, 115)}…` : compact || "No public result recorded.";
}

function formatTimeout(timeoutMs: number): string {
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) return `${timeoutMs / 1000}s`;
  return `${timeoutMs}ms`;
}

function resourceSourceLabel(source: ResourceDisplay["source"]): string {
  if (source === "authoritative") return "Live ledger";
  if (source === "setup") return "Setup limits";
  if (source === "derived") return "Before snapshot";
  return "Unavailable";
}
