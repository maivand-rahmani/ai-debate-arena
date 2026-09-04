import type { Config } from "tailwindcss";

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
  ],
  theme: {
    extend: {
      colors: {
        arena: {
          50: "#f4f1ed",
          100: "#e9e8e7",
          200: "#9d9da5",
          300: "#85858e",
          400: "#6c6b75",
          500: "#3b3b44",
          600: "#25252c",
          700: "#19191f",
          800: "#101015",
          900: "#0e0e12",
        },
        coral: {
          50: "#ffe7df",
          100: "#ff987f",
          200: "#ff8067",
          300: "#ff6c50",
          400: "#e85840",
          500: "#c44731",
        },
        violet: {
          50: "#ece4ff",
          100: "#c5b5ff",
          200: "#b69dff",
          300: "#a98cff",
          400: "#8e6dff",
          500: "#6e4ee0",
        },
        gold: {
          50: "#f8eed0",
          100: "#e8c47a",
          200: "#d4af6c",
          300: "#b8934a",
          400: "#8a6a30",
        },
        success: "#84d3a3",
      },
      fontFamily: {
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
      },
      animation: {
        "panel-enter": "panel-enter 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "caret-blink": "caret-blink 1s steps(2) infinite",
        "vs-pulse": "vs-pulse 2.6s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "verdict-reveal": "verdict-reveal 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "score-rise": "score-rise 500ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        pulse: "pulse 1.5s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
