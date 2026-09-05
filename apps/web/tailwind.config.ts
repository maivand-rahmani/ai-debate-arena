import type { Config } from "tailwindcss";

/**
 * v0.3 Arena palette — warm muted television studio.
 *
 * We deliberately keep the existing token names (`arena`, `coral`, `violet`,
 * `gold`) so the existing utility classes still compile, but redefine each
 * stop to a warm muted tone. The cold cyber/blue-purple dashboard feel and
 * glassmorphism are gone; the new visual language is dusty terracotta,
 * muted plum, honey gold, and a walnut/cream/taupe backdrop.
 */
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Score card + verdict reveal tones rely on these classes being present
    // even when the winning side is not statically known at build time.
    "bg-arena-coral-300/10",
    "bg-arena-coral-300/60",
    "border-arena-coral-300/30",
    "border-arena-coral-300/40",
    "border-arena-coral-300/50",
    "bg-arena-violet-300/10",
    "bg-arena-violet-300/60",
    "border-arena-violet-300/30",
    "border-arena-violet-300/40",
    "border-arena-violet-300/50",
    "text-arena-coral-100",
    "text-arena-coral-200",
    "text-arena-violet-100",
    "text-arena-violet-200",
    "text-arena-gold-100",
    "text-arena-gold-200",
    // v0.3 broadcast mood + camera + reaction surfaces.
    "data-camera",
    "data-mood-a",
    "data-mood-b",
    "data-mood-judge",
    "data-reaction",
    "data-stage-banner",
  ],
  theme: {
    extend: {
      colors: {
        // Walnut / taupe / cream neutrals. The arena surface is now a
        // television-studio set, not a dark cyber dashboard.
        arena: {
          50: "#f4ede1",   // cream parchment
          100: "#e6dcc6",  // warm cream
          200: "#b8a285",  // taupe
          300: "#8a7a64",  // muted taupe
          400: "#5c4a38",  // walnut shadow
          500: "#3d2e22",  // walnut
          600: "#2a1f15",  // dark walnut
          700: "#1d150e",  // deep walnut
          800: "#14110d",  // blackened walnut
          900: "#0c0a07",  // shadow
        },
        // Dusty terracotta — Contender A signature.
        coral: {
          50: "#f4d9c7",
          100: "#e8b59b",
          200: "#d89478",
          300: "#c97a5d",
          400: "#a85d44",
          500: "#8b4f3a",
        },
        // Muted plum — Contender B signature.
        violet: {
          50: "#dccddc",
          100: "#b89cbe",
          200: "#a785b3",
          300: "#8c6f8f",
          400: "#6e546f",
          500: "#5e4862",
        },
        // Honey — Judge signature.
        gold: {
          50: "#f5e3b8",
          100: "#d4a843",
          200: "#c89b3d",
          300: "#a87a26",
          400: "#8a6823",
        },
        success: "#94b87a",
      },
      fontFamily: {
        // Keep the existing show fonts (Syne display + DM Sans body) — no
        // new package dependency is introduced for v0.3.
        display: ['"Syne"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        "panel-enter": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "caret-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "vs-pulse": {
          "0%, 100%": { opacity: "0.7", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "verdict-reveal": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "score-rise": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "50%": { opacity: ".45", transform: "scale(.8)" },
        },
        // v0.3 broadcast flourishes — all CSS-driven, no JS animation.
        "spot-sweep": {
          "0%, 100%": { opacity: ".55", transform: "translateX(-4%) skewX(-12deg)" },
          "50%": { opacity: ".95", transform: "translateX(4%) skewX(-12deg)" },
        },
        "mascot-bob": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        "teleprompter-roll": {
          from: { transform: "translateY(8%)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "banner-marquee": {
          "0%": { transform: "translateX(-8%)" },
          "100%": { transform: "translateX(108%)" },
        },
        "reaction-pop": {
          from: { opacity: "0", transform: "translateY(20px) scale(.9) rotate(-4deg)" },
          to: { opacity: "1", transform: "translateY(0) scale(1) rotate(-2deg)" },
        },
      },
      animation: {
        "panel-enter": "panel-enter 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "caret-blink": "caret-blink 1s steps(2) infinite",
        "vs-pulse": "vs-pulse 2.6s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "verdict-reveal": "verdict-reveal 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "score-rise": "score-rise 500ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        pulse: "pulse 1.5s infinite",
        "spot-sweep": "spot-sweep 4.6s ease-in-out infinite",
        "mascot-bob": "mascot-bob 3.4s ease-in-out infinite",
        "teleprompter-roll": "teleprompter-roll 260ms ease-out both",
        "banner-marquee": "banner-marquee 24s linear infinite",
        "reaction-pop": "reaction-pop 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
