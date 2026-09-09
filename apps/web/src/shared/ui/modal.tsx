"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Centered-modal shell shared by every overlay dialog in the arena.
 *
 * Visual language + interaction model are deliberately identical to
 * the original provider manager dialog: backdrop click + Esc both
 * close, the close button receives focus on open, body scroll is
 * locked while the dialog is mounted, and reduced-motion users get an
 * instant snap instead of the rise animation.
 *
 * The shell owns the close button + the focus management so feature
 * code stays free of ref boilerplate. Callers fill the body / footer
 * slots with their own content.
 */

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /**
   * Optional className appended to the panel root — use for
   * feature-specific width / padding overrides (e.g. the setup modal
   * is wider than the recent-matches modal).
   */
  readonly panelClassName?: string;
  /**
   * Optional accessible label override. When set, used as the dialog's
   * `aria-label`. Otherwise the dialog is labelled by the
   * `<ModalHeader>` title via `aria-labelledby`.
   */
  readonly ariaLabel?: string;
  /**
   * Custom close-button label. Default: "Close".
   */
  readonly closeLabel?: string;
}

export function Modal({ open, onClose, children, panelClassName, ariaLabel, closeLabel }: ModalProps) {
  if (!open) return null;
  return (
    <ModalPanel
      onClose={onClose}
      panelClassName={panelClassName}
      ariaLabel={ariaLabel}
      closeLabel={closeLabel}
    >
      {children}
    </ModalPanel>
  );
}

function ModalPanel({
  onClose,
  children,
  panelClassName,
  ariaLabel,
  closeLabel = "Close",
}: Omit<ModalProps, "open">) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus to the close button on mount.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const labelProps = ariaLabel
    ? ({ "aria-label": ariaLabel } as const)
    : ({} as const);

  return (
    <div className="modal" role="dialog" aria-modal="true" {...labelProps}>
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="modal__backdrop"
      />
      <div className={["modal__panel", panelClassName].filter(Boolean).join(" ")}>
        <ModalChrome closeButtonRef={closeButtonRef} onClose={onClose} closeLabel={closeLabel} />
        {children}
      </div>
    </div>
  );
}

/**
 * The shell chrome — the close button rendered into the top-right
 * corner of the panel. Feature code can render its own header (with
 * a title, sub, eyebrow) below; the close button stays in the
 * top-right via absolute positioning so headers don't fight it.
 */
function ModalChrome({
  closeButtonRef,
  onClose,
  closeLabel,
}: {
  closeButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <button
      ref={closeButtonRef}
      type="button"
      onClick={onClose}
      aria-label={closeLabel}
      className="modal__close modal__close--shell"
    >
      <span aria-hidden="true" className="font-display" style={{ fontSize: "1.1rem", lineHeight: 1 }}>
        ✕
      </span>
    </button>
  );
}

// --- Slots -----------------------------------------------------------------

interface ModalHeaderProps {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly sub?: ReactNode;
}

export function ModalHeader({ eyebrow, title, sub }: ModalHeaderProps) {
  const id = useId();
  return (
    <header className="modal__head">
      <div className="modal__head-text">
        {eyebrow ? <p className="modal__eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="modal__title">
          {title}
        </h2>
        {sub ? <p className="modal__sub">{sub}</p> : null}
      </div>
    </header>
  );
}

export function ModalBody({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={["modal__body", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function ModalFooter({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <footer className={["modal__foot", className].filter(Boolean).join(" ")}>{children}</footer>;
}
