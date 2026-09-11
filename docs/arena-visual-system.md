# Arena Visual System

This document is the source of truth for the current AI Debate Arena visual
direction and 3D implementation. Read it before changing the broadcast stage,
scene layout, workstation assets, camera, lighting, or visual fallbacks.

Status: current implementation, 2026-09-11.

## Product priority

The debate remains the product's primary content. The 3D arena is cinematic
broadcast atmosphere: it should establish place, speaker identity, tension,
and phase without competing with captions, transcript, setup, or verdict data.

The visual target is premium stylized game-art broadcast television:
believable proportions and assembled objects, with intentional stylization and
clear identity colors. Do not turn the scene into a generic chat dashboard,
toy-block diorama, or photoreal asset showcase.

## Current runtime model

- The active scene is client-only React Three Fiber under
  `apps/web/src/widgets/broadcast-stage/3d/`.
- `CanvasGate` owns the SSR-safe boundary, WebGL capability probe, loading
  state, error boundary, and permanent 2D fallback.
- The current visual meshes are procedural stand-ins. Final GLBs are not yet
  checked into `apps/web/public/assets/arena/`.
- `arena-assets.ts` is the server-safe asset manifest. The client-only
  `arena-asset-loader.client.tsx` is the replacement boundary for future GLBs.
  Do not make the default scene request missing files; procedural fallbacks are
  the intentional current mode until the art files arrive.
- Physics colliders are authored separately from visual meshes. A visual
  redesign must not silently replace Rapier colliders with mesh geometry.
- Debate state, captions, HUD, verdict data, props, `SceneSignal`, and the 2D
  fallback are stable contracts. Visual work consumes those contracts; it does
  not rewrite the debate engine or event ordering.

## Art direction

### Palette and materials

The palette is dark walnut/ink architecture with warm cream surfaces and
restrained identity accents:

- Challenger / Agent A: terracotta.
- Advocate / Agent B: plum.
- Judge: honey/gold, larger and more authoritative.
- Architecture: walnut, blackened metal, taupe, cream cyclorama.

Use physical material variation—roughness, metalness, inset panels, seams,
bevels, and shadow-catching edges—to establish form. Emissive color is an
accent or status cue, not the primary way objects become visible. Neutral key
and fill illumination must carry the scene.

### Characters

The three procedural characters are seated broadcast hosts, not abstract
icons:

- readable face, eyes, brows, mouth, hair, clothing, hands, legs, and shoes;
- visible seated posture behind the workstation;
- distinct silhouettes and identity colors;
- Judge is larger, centered, elevated, and wears a commanding honey/gold robe
  and throne/chair treatment.

The shared character animation contract uses the existing refs and pose data.
Future character GLBs must expose `Head`, `Mouth`, `Brow.L`, and `Brow.R`.
Do not remove those semantic anchors when replacing procedural meshes.

### Workstations and computers

Computers are a core visual foundation for future programming-focused modes.
Treat each station as an assembled broadcast workstation:

- widescreen display with thin bezel, rear housing, VESA/mount detail,
  ventilation, webcam/status indicators, weighted stand, and glass screen;
- screen glass faces the seated player toward negative Z, not the spectator
  camera; the spectator wide shot intentionally sees the rear housing;
- the display is placed forward on the desk with a deliberate working gap so
  the character is not pressed against the screen;
- player-facing keyboard, mouse/control surface, and desk grommet;
- power adapter plus separate routed power and signal cable geometry;
- accent details remain subtle and match the side identity.

Future programming modes may add code/editor textures, terminals, diagnostic
lights, keyboards, or other desk props. Add them through the workstation
component/layout contract so the visual foundation remains reusable; do not
hard-code mode-specific UI into the debate engine.

### Set, banner, and floor

- The stage is a 14 x 7 raised broadcast platform inside a larger 24 x 24
  floor envelope.
- The cyclorama is a cream curved wall with side walls, acoustic ribs, truss,
  practical fixtures, and controlled depth.
- The title banner has a physical frame, aligned side supports, matching feet,
  and readable front-facing CanvasTexture text. Acoustic ribs stay outside the
  title panel instead of slicing through it.
- The floor uses alternating wood panels, seam grid, brass inlay lanes,
  center medallion, stage edge trim, and a finished front fascia. Keep the
  details low-contrast enough that captions remain dominant.
- Desks are rounded/burnished broadcast furniture with fascia, inset identity
  strips, work-surface inserts, metal feet, and separate collider tops.
- Chairs are padded studio chairs with backrests, armrests, pedestal/gas lift,
  base, and casters. Judge seating sits on the elevated center platform.

## Layout contract

All shared measurements live in `scene-layout.ts` and are unit-tested. Current
semantic anchors are:

| Element | Current relationship |
| --- | --- |
| Contender desks | X = -4.35 / +4.35, centered around Z = 0.72 |
| Contender characters | X = -4.35 / +4.35, seated around Z = -0.02 |
| Monitors | forward on each desk around Z = 0.94, glass normal toward -Z |
| Judge | centerline, character/platform around Z = -3.15 |
| Title banner | centered on the cyclorama, with frame derived from panel size |
| Dynamic props | gavel and mics obey the documented spawn-clearance invariant |

If proportions change, re-check together: chair depth, character seating,
monitor working distance, desk overlap, Judge platform clearance, prop spawn
clearance, camera framing, and caption readability. Never tune one object in
isolation and assume the composition remains valid.

## Camera and lighting

Semantic camera modes are stable: `idle`, `a`, `b`, `rebuttal`, `judge`,
`verdict`, and `neutral`. Presets are in `camera-presets.ts`; transitions and
OrbitControls handoff are in `camera-director.tsx`. Reframe presets whenever
hero proportions or platform geometry changes.

Lighting is a neutral studio rig:

- one soft shadow-casting key;
- controlled hemisphere/ambient fill;
- restrained terracotta/plum rim and desk accents;
- focused honey/gold Judge spotlight;
- ACES filmic tone mapping and capped DPR `[1, 1.5]`.

Faces, hands, display silhouettes, and captions must remain readable in close
shots. Avoid using saturated emission to compensate for incorrect light.

## Asset contract

The stable local asset root is `/assets/arena/`. The manifest IDs are:

`set`, `desk`, `monitor`, `chair`, `character-a`, `character-b`,
`character-judge`, and `props`.

Expected files and intake rules are documented in
`apps/web/public/assets/arena/README.md`. GLBs should be local, consistently
scaled, browser-friendly, free of remote texture/decoder dependencies, and
within the documented payload budgets. Visual assets never own Rapier
colliders.

## Performance contract

- Initial compressed arena payload target: about 8 MB or less.
- Individual character GLB target: about 1.5 MB or less.
- Wide-shot visible geometry target: 100k triangles or less.
- Wide-shot draw calls target: 150 or less.
- DPR stays capped near `[1, 1.5]`.
- Keep only the intended soft key shadow-casting unless a measured change
  justifies more shadow maps.
- No remote HDR, decoder, texture, or runtime asset dependency.
- Preserve the WebGL failure/reduced-motion/mobile paths.

## Change guide for agents

1. Read this document and the relevant tests before editing visual code.
2. Put shared dimensions and semantic relationships in `scene-layout.ts`.
3. Put pure camera/lighting/pose policy in the corresponding pure modules.
4. Keep R3F/Three/Rapier code inside the 3D widget boundary.
5. Keep visuals and colliders separate.
6. Preserve `SceneSignal`, caption/HUD layering, verdict handles, cancellation,
   and the 2D fallback.
7. Add or update focused layout/camera/lighting/asset tests for every contract
   change.
8. Run the web tests, TypeScript, 3D lint, and production build; perform a
   desktop visual check before handing off.

Do not reintroduce mirrored signage, audience-facing monitor glass, microwave
displays, floating cables, flat stage slabs, unframed banners, block chairs,
or unrelated engine/API changes while working on the scene.
