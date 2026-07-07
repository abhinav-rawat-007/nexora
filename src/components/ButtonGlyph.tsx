import type { ControllerButton, ControllerKind } from "@/types";
import { buttonGlyph } from "@/lib/gamepad";

/** Renders a physical controller button as a small Xbox/PlayStation-style glyph badge (colored circle for A/B/X/Y and Cross/Circle/Square/Triangle, plain pill otherwise). */
export function ButtonGlyph({ button, kind }: { button: ControllerButton; kind: ControllerKind }) {
  const glyph = buttonGlyph(button, kind);
  if (glyph.shape === "circle") {
    return (
      <span className="button-glyph button-glyph-circle" style={{ backgroundColor: glyph.color }} aria-hidden="true">
        {glyph.text}
      </span>
    );
  }
  return (
    <span className="button-glyph button-glyph-pill" aria-hidden="true">
      {glyph.text}
    </span>
  );
}
