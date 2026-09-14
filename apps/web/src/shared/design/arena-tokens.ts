import rawArenaTokens from "./arena-tokens.json";

export interface ArenaTokenSource {
  readonly colors: {
    readonly stage: {
      readonly background: string;
      readonly skyTop: string;
      readonly skyMid: string;
      readonly floor: string;
      readonly cyclorama: string;
    };
    readonly material: {
      readonly walnut: string;
      readonly walnutShadow: string;
      readonly walnutDeep: string;
      readonly blackenedMetal: string;
      readonly cream: string;
      readonly creamWarm: string;
      readonly taupe: string;
      readonly taupeMid: string;
      readonly woodWarm: string;
      readonly woodMid: string;
      readonly woodShadow: string;
      readonly woodHighlight: string;
    };
    readonly identity: {
      readonly ember: IdentityToken;
      readonly vesper: IdentityToken;
      readonly judge: IdentityToken;
    };
    readonly utility: {
      readonly evidence: string;
      readonly success: string;
      readonly warning: string;
      readonly focusRing: string;
    };
    readonly type: {
      readonly primary: string;
      readonly secondary: string;
      readonly muted: string;
      readonly faint: string;
    };
  };
  readonly alpha: {
    readonly panel: number;
    readonly panelSoft: number;
    readonly speech: number;
    readonly border: number;
    readonly scrim: number;
  };
  readonly shape: {
    readonly cardRadiusPx: number;
    readonly softRadiusPx: number;
  };
  readonly motion: {
    readonly cameraMs: number;
    readonly lightMs: number;
    readonly revealMs: number;
  };
}

export interface IdentityToken {
  readonly base: string;
  readonly bright: string;
  readonly deep: string;
  readonly glow: string;
}

export const ARENA_TOKENS = rawArenaTokens satisfies ArenaTokenSource;

export type ArenaIdentity = keyof typeof ARENA_TOKENS.colors.identity;
