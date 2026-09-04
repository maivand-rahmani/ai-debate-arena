import type { ReactElement } from "react";
import type { DebateSide } from "@/entities/debate";
import type { ContenderMood } from "../mood";

interface ContenderMascotProps {
  readonly side: DebateSide;
  readonly className?: string;
  readonly mood?: ContenderMood;
}

/**
 * Inline-SVG contender mascot for the v0.3 broadcast stage.
 *
 * The two contenders share a single SVG geometry but flip the palette and
 * silhouette features so the desks feel like opposite sides of the same
 * studio:
 *   - A (dusty terracotta):  sharp triangular haircut, square jaw, tie
 *   - B (muted plum):        rounder head, round glasses, bowtie
 *
 * Mood layers are rendered conditionally based on the `mood` prop (which
 * comes from `deriveMoods`); each layer is a small inline SVG element so
 * no AI call or animation library is involved.
 */
export function ContenderMascot({ side, className = "", mood = "thinking" }: ContenderMascotProps) {
  const isA = side === "A";
  const accent = isA ? "#c97a5d" : "#8c6f8f";
  const accentDeep = isA ? "#8b4f3a" : "#5e4862";
  const accentLight = isA ? "#e8b59b" : "#b89cbe";
  const halo = isA ? "rgba(201,122,93,.45)" : "rgba(140,111,143,.45)";
  const id = isA ? "mascotA" : "mascotB";

  return (
    <svg
      className={className}
      viewBox="0 0 220 240"
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={halo} stopOpacity="0.85" />
          <stop offset="70%" stopColor={halo} stopOpacity="0.15" />
          <stop offset="100%" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={accent} stopOpacity="1" />
          <stop offset="100%" stopColor={accentDeep} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4ede1" stopOpacity="1" />
          <stop offset="100%" stopColor="#dccbb0" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-tie`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={accentLight} stopOpacity="1" />
          <stop offset="100%" stopColor={accentDeep} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Backdrop halo */}
      <circle cx="110" cy="100" r="100" fill={`url(#${id}-halo)`} />

      {/* Shoulders / body */}
      <path
        d="M28 220 C 28 168 70 138 110 138 C 150 138 192 168 192 220 Z"
        fill={`url(#${id}-body)`}
      />
      {/* Lapel accent stripe (A: tie; B: bowtie + scarf) */}
      {isA ? (
        <>
          <path d="M110 138 L96 220 L82 220 L92 152 Z" fill={accentDeep} opacity="0.55" />
          <path d="M110 138 L124 220 L138 220 L128 152 Z" fill="#f4ede1" opacity="0.18" />
          {/* Tie */}
          <path
            d="M104 142 L116 142 L120 168 L110 200 L100 168 Z"
            fill={`url(#${id}-tie)`}
          />
        </>
      ) : (
        <>
          <path d="M70 220 L70 156 L80 156 L80 220 Z" fill={accentDeep} opacity="0.5" />
          <path d="M190 220 L190 156 L180 156 L180 220 Z" fill={accentDeep} opacity="0.5" />
          <path d="M110 138 L110 220 L120 220 L120 152 Z" fill="#f4ede1" opacity="0.18" />
          {/* Bowtie */}
          <path d="M90 142 L110 138 L130 142 L130 156 L110 152 L90 156 Z" fill={accentDeep} />
          <path d="M104 144 L116 144 L116 156 L104 156 Z" fill={accentLight} />
        </>
      )}

      {/* Neck */}
      <rect x="98" y="124" width="24" height="18" rx="6" fill="#cdbfa6" />

      {/* Head */}
      <ellipse cx="110" cy="98" rx="46" ry="50" fill={`url(#${id}-face)`} />

      {/* Hair / crown shape — sharp geometric wedge for A, soft curls for B */}
      {isA ? (
        <path
          d="M62 92 C 62 56 86 32 110 32 C 134 32 158 56 158 92 L 158 102 L 144 92 L 132 102 L 118 92 L 110 102 L 102 92 L 88 102 L 76 92 L 62 102 Z"
          fill="#2a1f15"
          opacity="0.95"
        />
      ) : (
        <>
          <path
            d="M64 96 C 64 60 88 36 110 36 C 132 36 156 60 156 96 C 156 90 152 84 146 80 C 150 78 152 74 150 70 C 146 66 138 70 132 68 C 138 64 140 60 134 58 C 128 56 122 62 116 60 C 122 56 124 52 116 50 C 108 48 102 54 96 52 C 102 48 100 42 92 44 C 84 46 84 54 78 56 C 84 52 80 46 72 50 C 66 54 70 64 66 68 C 60 72 60 84 64 96 Z"
            fill="#3d2e22"
            opacity="0.95"
          />
          {/* Round glasses for B */}
          <circle cx="98" cy="92" r="10" fill="none" stroke="#2a1f15" strokeWidth="2" />
          <circle cx="122" cy="92" r="10" fill="none" stroke="#2a1f15" strokeWidth="2" />
          <line x1="108" y1="92" x2="112" y2="92" stroke="#2a1f15" strokeWidth="2" />
        </>
      )}

      {/* Eyebrows — flat by default; furrowed for heated */}
      {mood === "heated" ? (
        <>
          <path d="M82 78 L104 82" stroke="#1d150e" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M138 78 L116 82" stroke="#1d150e" strokeWidth="3.4" strokeLinecap="round" />
        </>
      ) : mood === "confused" || mood === "panicking" ? (
        <>
          <path d="M82 80 L104 76" stroke="#1d150e" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M138 80 L116 76" stroke="#1d150e" strokeWidth="3.4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="82" y="78" width="22" height="3" rx="1.5" fill="#1d150e" />
          <rect x="116" y="78" width="22" height="3" rx="1.5" fill="#1d150e" />
        </>
      )}

      {/* Eyes — geometric rectangles; round glasses cover B's eyes when present */}
      {isA ? (
        <>
          <rect x="86" y="86" width="14" height="10" rx="2" fill="#1d150e" />
          <rect x="120" y="86" width="14" height="10" rx="2" fill="#1d150e" />
          <rect x="89" y="88" width="3" height="3" fill={accentLight} />
          <rect x="123" y="88" width="3" height="3" fill={accentLight} />
        </>
      ) : (
        <>
          <circle cx="98" cy="92" r="3.5" fill="#1d150e" />
          <circle cx="122" cy="92" r="3.5" fill="#1d150e" />
          <circle cx="99" cy="91" r="1.2" fill={accentLight} />
          <circle cx="123" cy="91" r="1.2" fill={accentLight} />
        </>
      )}

      {/* Mouth — mood-specific */}
      {mouthPath(mood, isA)}

      {/* Headset mic / lapel mic dot */}
      {isA ? (
        <>
          <circle cx={46} cy="140" r="6" fill={accent} />
          <rect x={38} y="138" width="16" height="2" rx="1" fill="#f4ede1" opacity="0.7" />
        </>
      ) : (
        <>
          <circle cx={174} cy="140" r="6" fill={accent} />
          <rect x={168} y="138" width="16" height="2" rx="1" fill="#f4ede1" opacity="0.7" />
        </>
      )}

      {/* Side label A/B inside the chest plate */}
      <text
        x="110"
        y="194"
        textAnchor="middle"
        fontFamily='"Syne", ui-sans-serif, sans-serif'
        fontWeight="800"
        fontSize="26"
        fill="#1d150e"
        opacity="0.65"
      >
        {side}
      </text>

      {/* --- Mood layers (decorative overlays) ----------------------------- */}
      <MoodOverlay mood={mood} accent={accent} accentLight={accentLight} accentDeep={accentDeep} />

      {/* Victory / defeat crown + halo flourishes */}
      {mood === "victorious" ? (
        <>
          <path
            d="M76 50 L96 30 L110 50 L124 30 L144 50 L130 60 L110 56 L90 60 Z"
            fill={accentLight}
            opacity="0.9"
          />
          <circle cx="110" cy="20" r="4" fill={accentLight} opacity="0.9" />
        </>
      ) : null}
      {mood === "defeated" ? (
        <>
          <path
            d="M82 36 Q 110 56 138 36"
            stroke="#3d2e22"
            strokeWidth="3"
            fill="none"
            opacity="0.7"
          />
        </>
      ) : null}
    </svg>
  );
}

function mouthPath(mood: ContenderMood, isA: boolean): ReactElement {
  switch (mood) {
    case "speaking":
    case "panicking":
      return (
        <ellipse
          cx="110"
          cy="120"
          rx={isA ? 10 : 8}
          ry={isA ? 6 : 5}
          fill="#1d150e"
        />
      );
    case "confident":
      return (
        <path
          d="M96 116 Q 110 124 124 116"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "heated":
      return (
        <path
          d="M96 122 Q 110 130 124 122"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "listening":
      return (
        <path
          d="M98 118 Q 110 122 122 118"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "confused":
      return (
        <path
          d="M98 122 Q 110 116 122 122"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "impressed":
      return (
        <path
          d="M96 118 Q 110 128 124 118"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "victorious":
      return (
        <path
          d="M90 114 Q 110 132 130 114"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "defeated":
      return (
        <path
          d="M96 124 Q 110 116 124 124"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "thinking":
    default:
      return (
        <path
          d="M100 120 L120 120"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      );
  }
}

interface MoodOverlayProps {
  readonly mood: ContenderMood;
  readonly accent: string;
  readonly accentLight: string;
  readonly accentDeep: string;
}

function MoodOverlay({ mood, accent, accentLight, accentDeep }: MoodOverlayProps): ReactElement {
  switch (mood) {
    case "thinking":
      return (
        <g aria-hidden="true">
          <ellipse cx="150" cy="48" rx="22" ry="14" fill="#f4ede1" opacity="0.9" />
          <ellipse cx="140" cy="68" rx="6" ry="5" fill="#f4ede1" opacity="0.9" />
          <ellipse cx="132" cy="80" rx="3" ry="2.5" fill="#f4ede1" opacity="0.9" />
          <text
            x="150"
            y="52"
            textAnchor="middle"
            fontFamily='"Syne", ui-sans-serif, sans-serif'
            fontWeight="800"
            fontSize="14"
            fill={accentDeep}
          >
            ?
          </text>
        </g>
      );
    case "speaking":
      return (
        <g aria-hidden="true">
          <path
            d="M148 60 Q 168 56 168 40"
            stroke={accentLight}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            opacity="0.8"
          />
        </g>
      );
    case "heated":
      return (
        <g aria-hidden="true">
          <path
            d="M70 32 Q 76 24 72 16 Q 80 22 86 14"
            stroke="#c89b3d"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M140 30 Q 146 22 142 14 Q 150 20 156 12"
            stroke="#c89b3d"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>
      );
    case "confused":
      return (
        <g aria-hidden="true">
          <text
            x="60"
            y="44"
            fontFamily='"Syne", ui-sans-serif, sans-serif'
            fontWeight="800"
            fontSize="22"
            fill={accentDeep}
          >
            ?
          </text>
          <text
            x="148"
            y="36"
            fontFamily='"Syne", ui-sans-serif, sans-serif'
            fontWeight="800"
            fontSize="18"
            fill={accentDeep}
          >
            ?
          </text>
        </g>
      );
    case "impressed":
      return (
        <g aria-hidden="true">
          <circle cx="58" cy="50" r="2" fill={accentLight} opacity="0.9" />
          <circle cx="68" cy="40" r="1.5" fill={accentLight} opacity="0.9" />
          <circle cx="156" cy="46" r="2" fill={accentLight} opacity="0.9" />
          <circle cx="148" cy="36" r="1.5" fill={accentLight} opacity="0.9" />
        </g>
      );
    case "victorious":
      return (
        <g aria-hidden="true">
          <circle cx="62" cy="50" r="3" fill={accentLight} opacity="0.85" />
          <circle cx="160" cy="52" r="3" fill={accentLight} opacity="0.85" />
        </g>
      );
    case "defeated":
      return (
        <g aria-hidden="true">
          <path
            d="M64 60 Q 70 70 60 76"
            stroke="#5c4a38"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
        </g>
      );
    case "panicking":
      return (
        <g aria-hidden="true">
          <path
            d="M62 36 L70 28 L66 40 L74 32"
            stroke="#c89b3d"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.95"
          />
          <path
            d="M156 36 L148 28 L152 40 L144 32"
            stroke="#c89b3d"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.95"
          />
          <path
            d="M64 60 Q 70 70 60 76 Q 70 80 60 86"
            stroke="#5c4a38"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M156 60 Q 150 70 160 76 Q 150 80 160 86"
            stroke="#5c4a38"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
        </g>
      );
    case "confident":
      return (
        <g aria-hidden="true">
          <path
            d="M148 50 L156 46 L156 56 Z"
            fill={accentLight}
            opacity="0.85"
          />
        </g>
      );
    case "listening":
    default:
      return (
        <g aria-hidden="true">
          <path
            d="M152 50 Q 168 50 168 60"
            stroke={accent}
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
        </g>
      );
  }
}
