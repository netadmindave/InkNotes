# InkNotes

A handwriting-styled, math-aware notes app for Android: Samsung Galaxy Tab S9+ with the S Pen, and phones like the Pixel 8 with finger writing. Everything except the one-time recognizer download works offline.

## Features
- **Real pages**: Letter (8.5×11) or A4, chosen per note in the ⋮ menu. Content flows onto the next page; ＋ Add page adds a blank one. PDF export keeps the exact page size. Pinch or ⋮ → Zoom to zoom.
- **Fingers**: ☝️ *Finger writes* (on by default when no pen is detected, e.g. Pixel 8) makes one finger write and two fingers scroll and pinch-zoom. 🔒 *Lock* means only two fingers move the page.
- **Write anywhere with the S Pen** (Samsung Notes style). Pen, pencil and highlighter tools, 6 colours, 3 sizes, a stroke eraser (or hold the S Pen side button) and lasso selection. Pen pressure is used. The pen writes and fingers scroll, so your palm doesn't leave marks.
- **⇄ Convert handwriting** into neat handwriting-font text or typeset formulas. The **Aa Text / ∑ Math / Auto** switch decides how it's read; Auto picks formulas out line by line. A preview lets you switch each piece between text and math, pick alternatives, or edit before inserting. Recognition is Google ML Kit Digital Ink, on-device (one-time ~20 MB model download). Formula layout (fractions, roots, exponents, subscripts, ∫/∑ limits) is InkNotes' own analyzer.
- **Handwriting look**: text renders in a handwriting font (Caveat, Kalam, Patrick Hand or Shadows Into Light) on lined, grid, dot or plain paper.
- **Text ⇄ Math switch**: the **Aa Text / ∑ Math** toggle in the toolbar. Switching while writing splits a new block at the cursor. In a math block, Enter finishes the formula and returns to text.
- **Formulas**: type AsciiMath (`int_0^oo e^(-x^2) dx = sqrt(pi)/2`) or LaTeX (starting with `\`). Live preview while typing, plus a symbol bar (fractions, roots, integrals, Greek, relations, ...). Rendered with KaTeX. Optional handwritten-style formulas.
- **Math inside sentences**: `E = mc^2`, `x_1`, `dn/dT`, `sqrt(2)` and `$...$` render as math automatically (can be switched off).
- **✨ Clean up**: fixes spacing and punctuation, sentence capitals, "i" → "I", doubled words and spelling (Hunspell en_US plus a physics/optics word list), and never touches formulas. Unsure words get one-tap suggestions or "add to dictionary". Ink areas get their strokes smoothed. Undo reverts it.
- **Ink areas**: draw with the S Pen; strokes use pen pressure. Hold the pen's side button (or pick Eraser) to erase strokes. By default only the pen draws, so your palm and fingers scroll.
- Lists (`- `, `1. `), headings (`# `), checkboxes (`[ ] `), `**bold**`.
- Export to PDF/print, share as text with LaTeX, back up and restore all notes as JSON.

Typing with Samsung's own recognizer: in a typed block, use Samsung's **S Pen to text** (write directly on the text field) or the Samsung Keyboard's handwriting mode.

## Build
GitHub Actions builds a signed release APK on every push to `main` and publishes it under **Releases**. Every build uses the same signing key (`keystore/`), so new versions install over old ones.

Local build: `gradle :app:assembleRelease` (needs the Android SDK, platform 35).

## Third-party
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
