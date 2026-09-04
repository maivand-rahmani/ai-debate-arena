interface JudgeMascotProps {
  readonly className?: string;
}

/**
 * Stylized inline-SVG judge mascot. Larger and more imposing than the
 * contender mascots — geometric wig, gavel pillar, gold halo — so the
 * central plinth reads as the authority figure in the broadcast.
 */
export function JudgeMascot({ className = "" }: JudgeMascotProps) {
  const gold = "#e8c47a";
  const goldDeep = "#b8934a";
  const goldGlow = "rgba(232,196,122,.5)";
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
          <stop offset="0%" stopColor={goldGlow} stopOpacity="0.9" />
          <stop offset="70%" stopColor={goldGlow} stopOpacity="0.18" />
          <stop offset="100%" stopColor={goldGlow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-robe`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={gold} stopOpacity="1" />
          <stop offset="100%" stopColor={goldDeep} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f8eed0" stopOpacity="1" />
          <stop offset="100%" stopColor="#e0cfa0" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Backdrop halo — bigger than the contender halos */}
      <circle cx="130" cy="110" r="120" fill={`url(#${id}-halo)`} />

      {/* Robe */}
      <path
        d="M20 220 C 20 168 72 138 130 138 C 188 138 240 168 240 220 Z"
        fill={`url(#${id}-robe)`}
      />
      {/* Robe folds */}
      <path
        d="M70 220 L70 160 L80 160 L80 220 Z"
        fill={goldDeep}
        opacity="0.5"
      />
      <path
        d="M190 220 L190 160 L180 160 L180 220 Z"
        fill={goldDeep}
        opacity="0.5"
      />
      <path
        d="M130 138 L130 220 L120 220 L120 152 Z"
        fill="#ffffff"
        opacity="0.18"
      />

      {/* Gavel pillar on the desk in front */}
      <rect x="118" y="206" width="6" height="20" rx="2" fill={goldDeep} />
      <rect x="106" y="200" width="30" height="10" rx="2" fill={gold} stroke={goldDeep} strokeWidth="1.5" />

      {/* Neck */}
      <rect x="115" y="120" width="30" height="22" rx="6" fill="#cdbfa6" />

      {/* Head */}
      <ellipse cx="130" cy="98" rx="52" ry="56" fill={`url(#${id}-face)`} />

      {/* Wig — flowing geometric curls */}
      <path
        d="M72 102 C 72 60 96 30 130 30 C 164 30 188 60 188 102 L 188 116 L 176 108 L 168 118 L 156 108 L 146 118 L 138 108 L 130 118 L 122 108 L 114 118 L 104 108 L 92 118 L 84 108 L 72 116 Z"
        fill="#f4f1ed"
        opacity="0.95"
      />
      {/* Wig band — a thin gold rim along the forehead */}
      <path
        d="M82 86 C 90 70 110 60 130 60 C 150 60 170 70 178 86"
        stroke={gold}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />

      {/* Eyes — serious, centered */}
      <rect x="104" y="92" width="16" height="11" rx="2" fill="#0e0e12" />
      <rect x="140" y="92" width="16" height="11" rx="2" fill="#0e0e12" />
      {/* Eye glints */}
      <rect x="107" y="94" width="3" height="3" fill={gold} />
      <rect x="143" y="94" width="3" height="3" fill={gold} />

      {/* Brows — flat, authoritative */}
      <rect x="100" y="82" width="26" height="3" rx="1.5" fill="#0e0e12" />
      <rect x="134" y="82" width="26" height="3" rx="1.5" fill="#0e0e12" />

      {/* Mouth — neutral, straight */}
      <path
        d="M110 124 L150 124"
        stroke="#0e0e12"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />

      {/* Collar / central robe medallion */}
      <circle cx="130" cy="170" r="10" fill={goldDeep} stroke={gold} strokeWidth="2" />
      <text
        x="130"
        y="174"
        textAnchor="middle"
        fontFamily='"Syne", ui-sans-serif, sans-serif'
        fontWeight="800"
        fontSize="12"
        fill="#0e0e12"
      >
        J
      </text>
    </svg>
  );
}
