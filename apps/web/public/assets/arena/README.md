# Arena asset intake

The visual source of truth is [`docs/arena-visual-system.md`](../../../../docs/arena-visual-system.md).

The 3D arena currently ships with procedural stand-ins so the scene remains
usable before final art is delivered. The client-only loader is ready for the
following local GLB files:

- `set.glb`
- `desk.glb`
- `monitor.glb`
- `chair.glb`
- `character-a.glb`
- `character-b.glb`
- `character-judge.glb`
- `props.glb`

Character files should include these named nodes for future animation mapping:

- `Head`
- `Mouth`
- `Brow.L`
- `Brow.R`

Keep the files browser-friendly: apply transforms before export, use consistent
world scale, keep hero characters near the documented budget, and avoid remote
textures or decoder dependencies. Visual assets do not define Rapier colliders;
the scene owns those separately.

## Workstation orientation

Monitor GLBs must preserve a real player workstation relationship: the display
glass faces the seated character toward negative Z, while the rear housing,
stand, cable exit, and power routing face the spectator side. Do not export a
monitor with the screen permanently facing the audience. Leave enough depth for
the character, keyboard/control surface, and routed power/signal cables to read
as separate assembled parts.

## Visual requirements

- `desk.glb`: rounded broadcast desk, fascia, inset identity panel, work
  surface, feet, cable pass-through, and no physics mesh;
- `monitor.glb`: widescreen thin bezel, rear housing, VESA plate, vents,
  webcam/status light, weighted stand, and connector/cable exit;
- `chair.glb`: padded seat/back, arms, pedestal/gas lift, base, casters;
- character GLBs: readable seated broadcast poses, clothing/hands/face, and
  the required animation anchors;
- `set.glb`/`props.glb`: dimensional studio architecture and assembled props,
  with materials that remain readable under neutral key/fill/rim lighting.
