"use client";

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";

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

interface ModalIds {
  readonly titleId: string;
  readonly descriptionId: string;
}

const ModalIdsContext = createContext<ModalIds | null>(null);

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusableSelector =
    'button:not([disabled]):not([data-modal-backdrop]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // Esc closes and focus never escapes the dialog while it is open.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const restore = restoreFocusRef.current;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [focusableSelector, onClose]);

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
    : ({ "aria-labelledby": titleId } as const);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-describedby={descriptionId} {...labelProps}>
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="modal__backdrop"
        data-modal-backdrop
        tabIndex={-1}
      />
      <ModalIdsContext.Provider value={{ titleId, descriptionId }}>
        <div
          ref={panelRef}
          className={["modal__panel", panelClassName].filter(Boolean).join(" ")}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
        >
          <ModalChrome closeButtonRef={closeButtonRef} onClose={onClose} closeLabel={closeLabel} />
          {children}
        </div>
      </ModalIdsContext.Provider>
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
  const fallbackTitleId = useId();
  const fallbackDescriptionId = useId();
  const ids = useContext(ModalIdsContext);
  const titleId = ids?.titleId ?? fallbackTitleId;
  const descriptionId = ids?.descriptionId ?? fallbackDescriptionId;
  return (
    <header className="modal__head">
      <div className="modal__head-text">
        {eyebrow ? <p className="modal__eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <p id={descriptionId} className={sub ? "modal__sub" : "sr-only"}>
          {sub ?? "Dialog content"}
        </p>
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
