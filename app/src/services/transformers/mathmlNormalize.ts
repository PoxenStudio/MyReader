// MathML's three structural elements that describe *meta* information about a
// formula — `<semantics>`, `<annotation>` and `<annotation-xml>` — and the empty
// slot placeholder `<none>`.
//
// Books ship them, and so does KaTeX, but nothing downstream can lay them out:
//
//   * DOMPurify's default allow-list (`mathMl` in its `tags.ts`) covers only the
//     presentation elements. `<semantics>`, `<annotation>`, `<annotation-xml>`
//     and `<none>` sit in `mathMlDisallowed`, which feeds nothing but the
//     namespace check — so the sanitizer *removes* all four.
//   * `KEEP_CONTENT` is on by default, so removal means "unwrap and keep the
//     text" for anything not in `FORBID_CONTENTS`. `<annotation>`'s only child
//     is a text node: the TeX source ends up in the running text and the formula
//     renders twice. `<none/>` is empty, so unwrapping it silently drops a
//     script slot and `<mmultiscripts>` pairs its pre-scripts up wrong.
//   * `<annotation-xml>` *is* in `FORBID_CONTENTS`, so it takes its children
//     with it. That is the right outcome for the XHTML/HTML fallback copy most
//     converters add — but it also destroys the formula for the (legal) books
//     that keep the presentation MathML inside
//     `<annotation-xml encoding="MathML-Presentation">`.
//   * `<mprescripts/>` is the odd one out: it is in *both* lists, so the default
//     allow-list keeps it. Nothing to do here — but see the guard in
//     `mathml.test.ts` that pins that behaviour, because a DOMPurify bump moving
//     it to the disallowed-only side would silently break every pre-script
//     formula.
//
// Normalizing here rather than by widening the sanitizer keeps the security
// allow-list minimal and makes the outcome testable offline, and it covers the
// `viewSettings.allowScript` path too — the sanitizer is skipped there, this
// transformer is not.
//
// The rules below have been verified against DOMPurify 3.4.2 with the exact
// options `sanitizer.ts` uses (see `output/_dp_test/` in the workspace):
//
//   <semantics><mrow>…</mrow><annotation>x^{2}</annotation></semantics>
//     → <mrow>…</mrow>x^{2}                        // formula printed twice
//
//   <mmultiscripts>T i j <mprescripts/><none/> k </mmultiscripts>
//     → <mmultiscripts>T i j <mprescripts/> k </mmultiscripts>   // slots shifted
//
//   <annotation-xml encoding="MathML-Presentation"><mfrac>…</mfrac></annotation-xml>
//     → (empty)                                    // formula destroyed
//
// Widening the allow-list does not fix any of these: with `semantics` and
// `annotation` added, `textContent` is still `x2x^{2}`; with `annotation-xml`
// added, its `encoding` attribute survives (it is in DOMPurify's default MathML
// attribute list) while the namespace check strips the HTML/XHTML children
// anyway, leaving an empty shell and the `encoding="text/html"` integration
// point back in the DOM.

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

// `encoding` values that mean "the formula itself lives inside this
// <annotation-xml>". Everything else — `application/xhtml+xml`, `text/html`, a
// missing attribute — is the fallback copy, or content MathML (`MathML-Content`,
// whose `<apply>`/`<ci>` children are not presentation elements the engine can
// lay out: hoisting those would only leak their text into the page).
const PRESENTATION_ENCODINGS = new Set(['mathml', 'mathml-presentation']);

const collectMathMl = (root: Document | Element, localName: string): Element[] =>
  Array.from(root.getElementsByTagName('*')).filter(
    (el) => el.namespaceURI === MATHML_NS && el.localName.toLowerCase() === localName,
  );

/**
 * Reduce the MathML in `root` to what a layout engine can actually render, and
 * return how many elements were touched (callers use `0` to skip re-serializing
 * a section that came in already clean).
 *
 * `<mprescripts/>` is deliberately left alone: it is allowed by default and it
 * carries meaning, unlike the meta elements above.
 */
export const normalizeMathMl = (root: Document | Element): number => {
  let changed = 0;

  // Innermost first: an <annotation-xml> can contain another one, and the inner
  // one has to be dealt with before the outer one hoists its children.
  for (const annotationXml of collectMathMl(root, 'annotation-xml').reverse()) {
    const encoding = (annotationXml.getAttribute('encoding') ?? '').trim().toLowerCase();
    if (PRESENTATION_ENCODINGS.has(encoding)) {
      // Lift the presentation markup into the <annotation-xml>'s place. Moving
      // children out of a node that is itself being replaced loses nothing.
      annotationXml.replaceWith(...Array.from(annotationXml.childNodes));
    } else {
      annotationXml.remove();
    }
    changed += 1;
  }

  // <annotation> holds the fallback *source* of the formula as text — the TeX
  // string KaTeX emits, usually. Nothing renders it, so keeping it (which is
  // what the sanitizer's unwrap does) prints the source beside the formula.
  for (const annotation of collectMathMl(root, 'annotation')) {
    annotation.remove();
    changed += 1;
  }

  // <semantics> may hold several children; a renderer uses the first one it can
  // lay out and ignores the rest. Reduce it to that first child so the result
  // matches what the engine would have shown, and matches the shape a book
  // without <semantics> would have had.
  //
  // Document order is enough (no need to sort deepest-first): when an outer
  // <semantics> is reduced, an inner one that is not the kept child gets
  // detached, and `replaceWith` on a detached node is a no-op.
  for (const semantics of collectMathMl(root, 'semantics')) {
    if (!semantics.parentNode) continue;
    const firstChild = Array.from(semantics.children).find(
      (child) => child.namespaceURI === MATHML_NS,
    );
    if (firstChild) {
      // Moves the kept child into the <semantics>'s place; the remaining
      // children go away with the <semantics> itself.
      semantics.replaceWith(firstChild);
    } else {
      semantics.remove();
    }
    changed += 1;
  }

  return changed;
};
