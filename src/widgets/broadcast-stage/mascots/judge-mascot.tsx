import type { ReactElement } from "react";
import type { JudgeMood } from "../mood";

interface JudgeMascotProps {
  readonly className?: string;
  readonly mood?: JudgeMood;
}

/**
 * Inline-SVG judge mascot for the v0.3 broadcast stage.
 *
 * Distinct silhouette from the contenders: a wide robe (warm honey), a
 * flowing geometric wig, and a small medallion. The plinth SVG below adds
 * the gavel pillar; this component focuses on the figure.
 *
 * Mood layers (standing-by | evaluating | revealed | impressed |
 *                not-impressed | stoic | dismayed) are conditional SVGs.
 */
export function JudgeMascot({ className = "", mood = "standing-by" }: JudgeMascotProps) {
  const honey = "#c89b3d";
  const honeyLight = "#d4a843";
  const honeyDeep = "#8a6823";
  const honeyGlow = "rgba(200,155,61,.5)";
  const id = "judgeMascot";

  return (
    <svg
      className={className}
      viewBox="0 0 260 240"
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={honeyGlow} stopOpacity="0.85" />
          <stop offset="70%" stopColor={honeyGlow} stopOpacity="0.15" />
          <stop offset="100%" stopColor={honeyGlow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-robe`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={honeyLight} stopOpacity="1" />
          <stop offset="100%" stopColor={honeyDeep} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4ede1" stopOpacity="1" />
          <stop offset="100%" stopColor="#dccbb0" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Backdrop halo */}
      <circle cx="130" cy="110" r="120" fill={`url(#${id}-halo)`} />

      {/* Robe */}
      <path
        d="M20 220 C 20 168 72 138 130 138 C 188 138 240 168 240 220 Z"
        fill={`url(#${id}-robe)`}
      />
      <path d="M70 220 L70 156 L80 156 L80 220 Z" fill={honeyDeep} opacity="0.5" />
      <path d="M190 220 L190 156 L180 156 L180 220 Z" fill={honeyDeep} opacity="0.5" />
      <path d="M130 138 L130 220 L120 220 L120 152 Z" fill="#f4ede1" opacity="0.18" />

      {/* Neck */}
      <rect x="115" y="120" width="30" height="22" rx="6" fill="#cdbfa6" />

      {/* Head */}
      <ellipse cx="130" cy="98" rx="52" ry="56" fill={`url(#${id}-face)`} />

      {/* Wig — flowing geometric curls */}
      <path
        d="M72 102 C 72 60 96 30 130 30 C 164 30 188 60 188 102 L 188 116 L 176 108 L 168 118 L 156 108 L 146 118 L 138 108 L 130 118 L 122 108 L 114 118 L 104 108 L 92 118 L 84 108 L 72 116 Z"
        fill="#f4ede1"
        opacity="0.95"
      />
      {/* Wig band — thin honey rim */}
      <path
        d="M82 86 C 90 70 110 60 130 60 C 150 60 170 70 178 86"
        stroke={honey}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />

      {/* Eyebrows — mood-specific */}
      {mood === "not-impressed" || mood === "dismayed" ? (
        <>
          <path d="M100 82 L126 86" stroke="#1d150e" strokeWidth="3" strokeLinecap="round" />
          <path d="M160 82 L134 86" stroke="#1d150e" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : mood === "impressed" ? (
        <>
          <path d="M100 84 L126 80" stroke="#1d150e" strokeWidth="3" strokeLinecap="round" />
          <path d="M160 84 L134 80" stroke="#1d150e" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="100" y="82" width="26" height="3" rx="1.5" fill="#1d150e" />
          <rect x="134" y="82" width="26" height="3" rx="1.5" fill="#1d150e" />
        </>
      )}

      {/* Eyes — round, with optional reading glasses for evaluating */}
      <rect x="104" y="92" width="16" height="11" rx="2" fill="#1d150e" />
      <rect x="140" y="92" width="16" height="11" rx="2" fill="#1d150e" />
      <rect x="107" y="94" width="3" height="3" fill={honey} />
      <rect x="143" y="94" width="3" height="3" fill={honey} />

      {/* Mouth — mood-specific */}
      {judgeMouth(mood)}

      {/* Collar / central robe medallion */}
      <circle cx="130" cy="170" r="10" fill={honeyDeep} stroke={honey} strokeWidth="2" />
      <text
        x="130"
        y="174"
        textAnchor="middle"
        fontFamily='"Syne", ui-sans-serif, sans-serif'
        fontWeight="800"
        fontSize="12"
        fill="#1d150e"
      >
        J
      </text>

      {/* --- Mood layers ---------------------------------------------------- */}
      <JudgeMoodOverlay mood={mood} />
    </svg>
  );
}

function judgeMouth(mood: JudgeMood): ReactElement {
  switch (mood) {
    case "evaluating":
      return (
        <path
          d="M112 124 L148 124"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      );
    case "impressed":
      return (
        <path
          d="M114 122 Q 130 132 146 122"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "not-impressed":
      return (
        <path
          d="M114 128 Q 130 120 146 128"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "dismayed":
      return (
        <path
          d="M114 130 Q 130 124 146 130"
          stroke="#1d150e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "revealed":
      return (
        <path
          d="M112 124 L148 124"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    case "stoic":
    case "standing-by":
    default:
      return (
        <path
          d="M110 124 L150 124"
          stroke="#1d150e"
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
  }
}

function JudgeMoodOverlay({ mood }: { mood: JudgeMood }): ReactElement {
  switch (mood) {
    case "evaluating":
      return (
        <g aria-hidden="true">
          {/* Reading glasses — drop on the bridge */}
          <circle cx="112" cy="98" r="13" fill="none" stroke="#1d150e" strokeWidth="2" />
          <circle cx="148" cy="98" r="13" fill="none" stroke="#1d150e" strokeWidth="2" />
          <line x1="125" y1="98" x2="135" y2="98" stroke="#1d150e" strokeWidth="2" />
          {/* Scorecard in front */}
          <rect x="92" y="208" width="76" height="14" rx="2" fill="#f4ede1" />
          <line x1="100" y1="216" x2="160" y2="216" stroke="#1d150e" strokeWidth="1" />
          <line x1="100" y1="220" x2="150" y2="220" stroke="#1d150e" strokeWidth="1" />
        </g>
      );
    case "revealed":
      return (
        <g aria-hidden="true">
          {/* Gavel raised */}
          <rect x="120" y="190" width="6" height="22" rx="2" fill="#8a6823" />
          <rect x="106" y="184" width="34" height="10" rx="2" fill="#c89b3d" stroke="#8a6823" strokeWidth="1.5" />
          <path
            d="M150 196 L162 184 L170 196 L158 208 Z"
            fill="#c89b3d"
            stroke="#8a6823"
            strokeWidth="1.5"
          />
        </g>
      );
    case "impressed":
      return (
        <g aria-hidden="true">
          <circle cx="78" cy="48" r="2.5" fill="#d4a843" opacity="0.9" />
          <circle cx="190" cy="50" r="2.5" fill="#d4a843" opacity="0.9" />
          <circle cx="74" cy="36" r="1.5" fill="#d4a843" opacity="0.8" />
          <circle cx="186" cy="36" r="1.5" fill="#d4a843" opacity="0.8" />
        </g>
      );
    case "not-impressed":
      return (
        <g aria-hidden="true">
          {/* Monocle */}
          <circle cx="112" cy="98" r="13" fill="none" stroke="#1d150e" strokeWidth="2" />
          <line x1="112" y1="111" x2="112" y2="130" stroke="#1d150e" strokeWidth="1.5" />
        </g>
      );
    case "dismayed":
      return (
        <g aria-hidden="true">
          <path
            d="M70 60 Q 76 70 66 76 Q 76 80 66 86"
            stroke="#5c4a38"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M190 60 Q 184 70 194 76 Q 184 80 194 86"
            stroke="#5c4a38"
            strokeWidth="2"
            fill="none"
            opacity="0.7"
          />
        </g>
      );
    case "stoic":
    case "standing-by":
    default:
      return (
        <g aria-hidden="true">
          <path
            d="M118 188 L142 188"
            stroke="#8a6823"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.6"
          />
        </g>
      );
  }
}
