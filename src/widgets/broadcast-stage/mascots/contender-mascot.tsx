import type { DebateSide } from "@/entities/debate";

interface ContenderMascotProps {
  readonly side: DebateSide;
  readonly className?: string;
}

/**
 * Stylized inline-SVG contender mascot. Two variants (A vs B) share geometry
 * but flip the accent color and orientation so the desks feel like opposite
 * sides of the same broadcast. No external assets, no animation library.
 */
export function ContenderMascot({ side, className = "" }: ContenderMascotProps) {
  const isA = side === "A";
  const accent = isA ? "#ff6c50" : "#a98cff";
  const accentDeep = isA ? "#e85840" : "#8e6dff";
  const halo = isA ? "rgba(255,108,80,.45)" : "rgba(169,140,255,.45)";
  const id = isA ? "mascotA" : "mascotB";

  return (
    <svg
      className={className}
      viewBox="0 0 220 220"
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={halo} stopOpacity="0.9" />
          <stop offset="70%" stopColor={halo} stopOpacity="0.15" />
          <stop offset="100%" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={accent} stopOpacity="1" />
          <stop offset="100%" stopColor={accentDeep} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4f1ed" stopOpacity="1" />
          <stop offset="100%" stopColor="#d8d4cc" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Backdrop halo */}
      <circle cx="110" cy="92" r="96" fill={`url(#${id}-halo)`} />

      {/* Shoulders / body */}
      <path
        d="M28 196 C 28 152 70 130 110 130 C 150 130 192 152 192 196 Z"
        fill={`url(#${id}-body)`}
      />
      {/* Lapel accent stripe */}
      <path
        d="M110 130 L110 196 L92 196 L92 144 Z"
        fill={accentDeep}
        opacity="0.55"
      />
      <path
        d="M110 130 L110 196 L128 196 L128 144 Z"
        fill={isA ? "#ffffff" : "#ffffff"}
        opacity="0.18"
      />

      {/* Neck */}
      <rect x="98" y="118" width="24" height="18" rx="6" fill="#cdbfa6" />

      {/* Head */}
      <ellipse cx="110" cy="92" rx="46" ry="50" fill={`url(#${id}-face)`} />

      {/* Hair / crown shape — a sharp geometric wedge to read as a stylized broadcast head */}
      <path
        d="M64 86 C 64 56 86 36 110 36 C 134 36 156 56 156 86 L 156 96 L 142 88 L 132 96 L 118 86 L 110 96 L 102 86 L 88 96 L 78 88 L 64 96 Z"
        fill={isA ? "#1d1d22" : "#1d1d22"}
        opacity="0.92"
      />

      {/* Eyes — geometric rectangles, slightly asymmetrical to feel characterful */}
      <rect x="86" y="86" width="14" height="10" rx="2" fill="#0e0e12" />
      <rect x="120" y="86" width="14" height="10" rx="2" fill="#0e0e12" />
      {/* Eye glints */}
      <rect x="89" y="88" width="3" height="3" fill={accent} />
      <rect x="123" y="88" width="3" height="3" fill={accent} />

      {/* Brows */}
      <rect x="82" y="78" width="22" height="3" rx="1.5" fill="#0e0e12" />
      <rect x="116" y="78" width="22" height="3" rx="1.5" fill="#0e0e12" />

      {/* Mouth — small confident line */}
      <path
        d="M96 116 Q 110 122 124 116"
        stroke="#0e0e12"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />

      {/* Side accent — a small broadcast headset / lapel mic dot */}
      <circle cx={isA ? 46 : 174} cy="140" r="6" fill={accent} />
      <rect x={isA ? 38 : 168} y="138" width="16" height="2" rx="1" fill="#f4f1ed" opacity="0.7" />

      {/* Side label A/B inside the chest plate */}
      <text
        x="110"
        y="180"
        textAnchor="middle"
        fontFamily='"Syne", ui-sans-serif, sans-serif'
        fontWeight="800"
        fontSize="28"
        fill="#0e0e12"
        opacity="0.75"
      >
        {side}
      </text>
    </svg>
  );
}
