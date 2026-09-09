/**
 * Smoke tests for the generic `<Modal>` shell. Verifies the prop
 * surface + the render-to-static-markup contract that every dialog in
 * the app depends on.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <Modal open={false} onClose={() => undefined}>
        <span>should not appear</span>
      </Modal>,
    );
    expect(html).toBe("");
  });

  it("renders a dialog with a backdrop, the shell close button, and the slot content when open", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => undefined} ariaLabel="Test dialog">
        <p>Hello</p>
      </Modal>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Test dialog"');
    expect(html).toContain("modal__backdrop");
    expect(html).toContain("modal__panel");
    expect(html).toContain("modal__close");
    expect(html).toContain("Hello");
  });

  it("renders the ModalHeader title and sub", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => undefined}>
        <ModalHeader eyebrow="Eyebrow" title="My dialog" sub="Sub text" />
        <ModalBody>
          <p>Body</p>
        </ModalBody>
      </Modal>,
    );
    expect(html).toContain("Eyebrow");
    expect(html).toContain("My dialog");
    expect(html).toContain("Sub text");
  });

  it("renders the optional footer slot", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => undefined}>
        <ModalBody>
          <p>Body</p>
        </ModalBody>
        <ModalFooter>
          <span>footer text</span>
        </ModalFooter>
      </Modal>,
    );
    expect(html).toContain("modal__foot");
    expect(html).toContain("footer text");
  });

  it("applies panelClassName to the panel root for width overrides", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => undefined} panelClassName="modal--wide">
        <p>Body</p>
      </Modal>,
    );
    expect(html).toContain("modal__panel modal--wide");
  });

  it("uses the custom close label when provided", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => undefined} closeLabel="Dismiss">
        <p>Body</p>
      </Modal>,
    );
    expect(html).toContain('aria-label="Dismiss"');
  });
});
