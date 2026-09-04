import type { StageView } from "../stage-state";

interface StageBackdropProps {
  readonly view: StageView;
  readonly className?: string;
}

/**
 * The 3D-projected backdrop + floor. Uses CSS `perspective` on the parent and
 * `translateZ` to push the sky behind the desks; the floor carries a
 * perspective-tilted gradient and a faint vignette. The active camera / mode
 * data-attributes drive which spotlight gradient lights the scene.
 */
export function StageBackdrop({ view, className = "" }: StageBackdropProps) {
  return (
    <div
      className={`stage-backdrop ${className}`}
      data-stage={view.mode}
      data-camera={view.camera}
      data-round={view.round}
      aria-hidden="true"
    >
      <div className="stage-backdrop__sky" />
      <div className="stage-backdrop__halo stage-backdrop__halo--a" />
      <div className="stage-backdrop__halo stage-backdrop__halo--b" />
      <div className="stage-backdrop__halo stage-backdrop__halo--judge" />
      <div className="stage-backdrop__floor">
        <div className="stage-backdrop__floor-lines" />
        <div className="stage-backdrop__floor-glow" />
      </div>
    </div>
  );
}
