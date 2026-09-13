/* ============================================================
   annotate.js — marking up a document the way you mark up paper.

   Two kinds of mark, and they are genuinely different things:

     HIGHLIGHTS belong to WORDS. "Peritrophoblastic hypervascularisation"
     stays highlighted when the page is read on a phone instead of an
     iPad, because the highlight is anchored to that text, not to a
     rectangle on a screen of a particular width.

     INK belongs to a PLACE. An arrow drawn between two lines, a circle
     round a number, a note in the margin — these have no text to attach
     to, only a position. So they are anchored to the nearest BLOCK and
     stored in that block's own coordinates as fractions. When the block
     is drawn narrower or taller later, the ink is scaled with it and
     stays where it was put, relative to the paragraph it was about.

   THE HARD PART, SAID PLAINLY

   Ink on reflowing text cannot be perfect. A paragraph that wraps to
   five lines on a phone and three on an iPad is a different shape, and
   no coordinate system makes a stroke drawn across the three-line
   version land identically on the five-line one. Anchoring per block and
   scaling both axes keeps it in the right paragraph and close to the
   right line, which is what a person actually needs; pretending to more
   accuracy than that would mean freezing the layout, and a document you
   cannot read comfortably on a phone is worse than ink that has moved a
   few millimetres.

   Highlights have no such problem — they are ranges in text — which is
   why the two are stored differently rather than as one "mark".

   THE PENCIL, AND THE PALM

   On an iPad this has to follow the platform's own rule, because that is
   what people's hands already expect: THE PENCIL DRAWS, THE FINGER
   SCROLLS. So pointer events are filtered by `pointerType` — a `pen`
   draws, a `touch` scrolls. Nothing needs turning on and nothing needs
   turning off between writing a note and scrolling to the next question.

   But "a finger scrolls" is NOT palm rejection, and treating it as
   though it were is what made writing unusable. Writing means the hand
   RESTS on the glass, and the heel of it is a touch: it began a scroll,
   the page crept under the nib, and the stroke in progress was cut — so
   the writing came back as fragments of letters rather than words. The
   rule is therefore stronger: while the Pencil is down the hand does not
   exist at all, a pen landing cancels a scroll the palm has already
   started, and for a moment after the nib lifts the hand is still
   ignored, because it lifts last. Every tablet does this.

   A mouse draws too, because a laptop has no pencil and the feature
   should not be an iPad feature. A mouse never arms palm rejection —
   there is no hand on the glass to reject.

   Pressure is read where the hardware reports it (`e.pressure`) and kept
   FOR EVERY POINT, so the line thickens and thins where the hand did. A
   `<path>` has one stroke-width and can only be one thickness, so a
   stroke is drawn as a filled outline of the nib's two edges instead. A
   mouse reports a constant 0.5 and gets an even line, which is correct
   rather than a fallback.

   SAVING

   Debounced, per user, per document, through the Backend — see the note
   on the `annotations` table. Nothing is kept in this browser: marks
   made on an iPad are there on a phone, which is the whole reason they
   are worth making.
   ============================================================ */

const Annotate = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------------- the colours ----------------

     Four highlighters and four pens, which is what a pencil case holds
     and roughly what anybody uses. The highlighters are translucent so
     the words stay readable underneath — a highlight that hides the text
     it marks is a redaction. Anything beyond these is the colour well,
     which is the platform's own picker and therefore unlimited. */
  const HIGHLIGHTS = [
    { id: 'y', name: 'Yellow', c: '#ffe066' },
    { id: 'g', name: 'Green',  c: '#8ce99a' },
    { id: 'b', name: 'Blue',   c: '#a5d8ff' },
    { id: 'p', name: 'Pink',   c: '#ffc9de' }
  ];
  /* Underlines are a different instrument from highlighters and want
     different colours: a highlighter is a wash you read through, an
     underline is a line you read along, so it wants ink colours rather
     than pastels. */
  const UNDERLINES = [
    { id: 'r', name: 'Red',   c: '#e03131' },
    { id: 'u', name: 'Blue',  c: '#1971c2' },
    { id: 'n', name: 'Green', c: '#2f9e44' },
    { id: 'k', name: 'Black', c: '#12110f' }
  ];
  const PENS = [
    { id: 'k', name: 'Black', c: '#12110f' },
    { id: 'r', name: 'Red',   c: '#e03131' },
    { id: 'u', name: 'Blue',  c: '#1971c2' },
    { id: 'n', name: 'Green', c: '#2f9e44' }
  ];
  const WIDTHS = [
    { id: 'fine', name: 'Fine', w: 1.6 },
    { id: 'med',  name: 'Medium', w: 3 },
    { id: 'bold', name: 'Bold', w: 6 }
  ];

  /* ================= state ================= */

  let doc = '';                 // which document these marks belong to
  let host = null;              // the scrolling container
  let article = null;           // the element the marks are anchored inside
  let marks = [];               // [{kind:'hl'|'ink', ...}]
  let tool = 'read';            // read | hl | ul | pen | erase
  let hlColour = HIGHLIGHTS[0].c;
  let ulColour = UNDERLINES[0].c;
  let penColour = PENS[0].c;
  let penWidth = WIDTHS[1].w;
  let dirty = false, saving = null, saveTimer = null;
  let onState = () => {};
  const undone = [];

  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ================= anchoring =================

     Every block that can be marked carries a `data-an` key put there by
     whoever built the document. The key has to be STABLE — derived from
     the station's own structure (q3.p5), never from position in the DOM
     — or a mark would move to a different sentence the next time the
     page is drawn with one more question in it. */

  const blocks = () => [...(article?.querySelectorAll('[data-an]') || [])];
  const blockOf = key => article?.querySelector(`[data-an="${CSS.escape(key)}"]`) || null;

  /** The plain text of a block, as the offsets were measured against. */
  const textOf = el => el ? el.textContent : '';

  /**
   * Where in the document is this DOM position? Returns { key, offset }
   * — the annotated block it falls in, and how many characters into that
   * block's text it is.
   *
   * THE OFFSET IS NOT ALWAYS A CHARACTER OFFSET. A selection whose
   * container is an ELEMENT gives a CHILD INDEX instead — which is what
   * `selectNodeContents` and a double-tap both produce — and reading it
   * as a character count silently yields 0, so every such highlight
   * came out empty and was dropped. A Range measures both kinds
   * correctly: set it from the start of the block to the position, and
   * the length of its text is the answer.
   */
  function locate(node, offset) {
    let el = node.nodeType === 3 ? node.parentNode : node;
    while (el && el !== article && !el.hasAttribute?.('data-an')) el = el.parentNode;
    if (!el || el === article) return null;
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.setEnd(node, offset);
      return { key: el.getAttribute('data-an'), offset: r.toString().length };
    } catch { return { key: el.getAttribute('data-an'), offset: 0 }; }
  }

  /* ================= the live colour =================

     A FALLBACK NOW, NOT THE MECHANISM. See "the marker" below for what
     actually happens when the highlighter is dragged. This only matters
     where the marker cannot run — a browser without pointer events, or
     text selected some other way — and it costs one `<style>` element.
     `::selection` is a pseudo-element and cannot be set any other way. */
  let selStyle = null;
  function paintSelectionColour() {
    if (!selStyle) return;
    const live = tool === 'hl' || tool === 'ul';
    if (!live) { selStyle.textContent = ''; return; }
    /* A highlighter fills; an underline only marks the baseline, so its
       preview is a wash of the same colour at a fraction of the strength
       — enough to see what is about to be underlined, not so much that it
       reads as a highlight. */
    const c = tool === 'hl' ? hlColour : ulColour + '33';
    selStyle.textContent = `.rd-doc ::selection{background:${c};color:#0b0b0b}`
      + `.rd-doc ::-moz-selection{background:${c};color:#0b0b0b}`;
  }

  /* ================= highlights and underlines ================= */

  /**
   * Turn the current selection into a highlight. Returns false when
   * there is nothing to highlight or it spans blocks we cannot anchor
   * — a highlight that only half-exists is worse than none.
   */
  function markSelection(kind, colour) {
    const k = kind === 'ul' ? 'ul' : 'hl';
    const col = colour || (k === 'ul' ? ulColour : hlColour);
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!article.contains(r.commonAncestorContainer)) return false;
    const a = locate(r.startContainer, r.startOffset);
    const b = locate(r.endContainer, r.endOffset);
    if (!a || !b) return false;

    /* A selection dragged across three paragraphs becomes three
       highlights, one per block — each anchored to its own text, each
       removable on its own. One mark spanning blocks could not survive a
       re-render and could not be un-highlighted in part. */
    const keys = blocks().map(el => el.getAttribute('data-an'));
    const from = keys.indexOf(a.key), to = keys.indexOf(b.key);
    if (from < 0 || to < 0) return false;
    const made = [];
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      const key = keys[i];
      const el = blockOf(key);
      const text = textOf(el);
      const start = (i === from && from <= to) ? a.offset : (i === to && to < from) ? b.offset : 0;
      const end = (i === to && from <= to) ? b.offset : (i === from && to < from) ? a.offset : text.length;
      const s = Math.max(0, Math.min(start, end)), e = Math.min(text.length, Math.max(start, end));
      if (e - s < 1) continue;
      made.push({ id: uid(), kind: k, key, start: s, end: e, c: col,
        /* The quoted text travels with the mark so a scheme that has
           been edited since can be checked rather than silently
           highlighting the wrong words. */
        quote: text.slice(s, e).slice(0, 120), at: Date.now() });
    }
    if (!made.length) return false;
    marks.push(...made);
    sel.removeAllRanges();
    /* Only the new marks are painted. Re-rendering the page would
       re-measure every mark on it, which is the pause this removed. */
    made.forEach(paintMark);
    touch();
    return true;
  }

  /** Kept as it was, so callers that only highlight need not change. */
  const highlightSelection = colour => markSelection('hl', colour);
  const underlineSelection = colour => markSelection('ul', colour);

  /** One mark's rectangles, appended. The whole page is not touched. */
  function paintMark(m) {
    if (!layer || (m.kind !== 'hl' && m.kind !== 'ul')) return;
    const el = blockOf(m.key);
    if (!el) return;
    const text = textOf(el);
    if (m.start >= text.length) return;                    // the text has changed under it
    rangeRects(el, m.start, Math.min(m.end, text.length)).forEach(r => {
      const box = document.createElement('span');
      box.className = m.kind === 'ul' ? 'an-ul' : 'an-hl';
      box.dataset.mark = m.id;
      /* An underline is drawn as a line ON the baseline rather than a
         box behind the words: a 2px rule at the foot of the rectangle,
         which is where a pen would put it. */
      box.style.cssText = m.kind === 'ul'
        ? `left:${r.x}px;top:${(r.y + r.h - 2.5).toFixed(1)}px;width:${r.w}px;height:2px;background:${m.c}`
        : `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${m.c}`;
      layer.appendChild(box);
    });
  }

  /** Everything, from scratch. Only on load, on resize and after an erase. */
  function paintTextMarks() {
    layer.querySelectorAll('.an-hl,.an-ul').forEach(n => n.remove());
    marks.forEach(paintMark);
  }

  /** The rectangles a character range occupies, in article coordinates. */
  function rangeRects(el, start, end) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = 0, range = document.createRange(), t, sSet = false;
    while ((t = walk.nextNode())) {
      const len = t.nodeValue.length;
      if (!sSet && n + len >= start) { range.setStart(t, Math.max(0, start - n)); sSet = true; }
      if (sSet && n + len >= end) { range.setEnd(t, Math.max(0, end - n)); break; }
      n += len;
    }
    if (!sSet) return [];
    const base = article.getBoundingClientRect();
    return [...range.getClientRects()]
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }));
  }

  /* ================= where the words are =================

     A map of every word in a block — its character range and the
     rectangle it occupies — measured once and kept. It is what lets the
     marker paint while the nib is still moving: finding the word under
     the tip becomes arithmetic over numbers already in hand instead of a
     hit test that asks the browser to lay the page out again.

     Built a block at a time, the first time the nib goes near one, and
     thrown away whenever the page is re-drawn or re-sized. */
  const wordCache = new Map();
  let boxCache = null;

  const forgetGeometry = () => { wordCache.clear(); boxCache = null; };

  /** Every annotatable block's box, in article coordinates. */
  function boxes() {
    if (boxCache) return boxCache;
    const base = article.getBoundingClientRect();
    boxCache = blocks().map(el => {
      const r = el.getBoundingClientRect();
      return { key: el.getAttribute('data-an'), y: r.top - base.top, h: r.height };
    });
    return boxCache;
  }

  /** One block's words: { s, e, t, x, y, w, h }, in article coordinates. */
  function wordsOf(key) {
    if (wordCache.has(key)) return wordCache.get(key);
    const out = [];
    const el = blockOf(key);
    if (!el || !article) { wordCache.set(key, out); return out; }
    const base = article.getBoundingClientRect();
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rng = document.createRange();
    let n = 0, t;
    while ((t = walk.nextNode())) {
      const s = t.nodeValue;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(s))) {
        try {
          rng.setStart(t, m.index);
          rng.setEnd(t, m.index + m[0].length);
        } catch { continue; }
        /* A word that wraps has two rectangles; the first is the one the
           nib will be over when it reaches the word. */
        const r = [...rng.getClientRects()].find(q => q.width > 0 && q.height > 0);
        if (!r) continue;
        out.push({ s: n + m.index, e: n + m.index + m[0].length, t: m[0],
          x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      }
      n += s.length;
    }
    wordCache.set(key, out);
    return out;
  }

  /**
   * The word under a point — or, for a nib in the margin or between two
   * lines, the nearest one. `near` limits the search to the blocks the
   * point is actually in or beside, so a long document costs the same as
   * a short one.
   *
   * `on` says whether the point is really ON the word rather than merely
   * nearest to it. A pencil may be anywhere; a finger has to land on a
   * word, because a finger that lands anywhere else is scrolling.
   */
  function wordAt(cx, cy) {
    if (!article) return null;
    const base = article.getBoundingClientRect();
    const x = cx - base.left, y = cy - base.top;
    const bs = boxes();
    if (!bs.length) return null;
    let near = bs.filter(b => y >= b.y - 24 && y <= b.y + b.h + 24);
    if (!near.length) {
      let best = null;
      bs.forEach(b => {
        const d = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0;
        if (!best || d < best.d) best = { d, b };
      });
      near = best ? [best.b] : [];
    }
    let hit = null;
    for (const b of near) {
      const ws = wordsOf(b.key);
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        const dy = y < w.y ? w.y - y : y > w.y + w.h ? y - (w.y + w.h) : 0;
        const dx = x < w.x ? w.x - x : x > w.x + w.w ? x - (w.x + w.w) : 0;
        /* The line comes first: the word nearest ALONG the line the nib
           is on, never a closer word on the line above. */
        const d = dy * 4000 + dx;
        if (!hit || d < hit.d) hit = { d, key: b.key, i, on: dy === 0 && dx <= 6 };
      }
    }
    return hit ? { key: hit.key, i: hit.i, on: hit.on } : null;
  }

  /** Anchor word → focus word, as one span per block between them. */
  function spanOf(a, b) {
    const keys = blocks().map(el => el.getAttribute('data-an'));
    const ai = keys.indexOf(a.key), bi = keys.indexOf(b.key);
    if (ai < 0 || bi < 0) return [];
    const fwd = ai < bi || (ai === bi && a.i <= b.i);
    const from = fwd ? { k: ai, i: a.i } : { k: bi, i: b.i };
    const to = fwd ? { k: bi, i: b.i } : { k: ai, i: a.i };
    const out = [];
    for (let k = from.k; k <= to.k; k++) {
      const ws = wordsOf(keys[k]);
      if (!ws.length) continue;
      const s = k === from.k ? from.i : 0;
      const e = k === to.k ? to.i : ws.length - 1;
      if (e < s || !ws[s] || !ws[e]) continue;
      out.push({ key: keys[k], from: s, to: e, start: ws[s].s, end: ws[e].e });
    }
    return out;
  }

  /**
   * A span's words merged into one band per line — which is what makes
   * it read as a single stroke of a marker rather than a row of little
   * boxes with the spaces missing.
   */
  function bandsOf(span) {
    const ws = wordsOf(span.key);
    const out = [];
    for (let i = span.from; i <= span.to; i++) {
      const w = ws[i];
      if (!w) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - w.y) < Math.max(4, w.h * 0.5)) {
        const right = Math.max(last.x + last.w, w.x + w.w);
        last.x = Math.min(last.x, w.x);
        last.w = right - last.x;
        last.h = Math.max(last.h, w.h);
      } else out.push({ x: w.x, y: w.y, w: w.w, h: w.h });
    }
    return out;
  }

  /* ================= the marker =================

     WHAT WAS WRONG, IN ONE SENTENCE: the highlighter was not a
     highlighter, it was the browser's text selection with a colour put
     on afterwards.

     That is why it felt slow, and the delay was never the real
     complaint. Dragging a pencil over a line of text on an iPad starts
     iOS's own selection: the grey band appears, two round handles are
     planted at the ends, a magnifier pops up, and when the finger lifts
     the Copy / Define callout arrives — and only then, after all of
     that, does the colour appear. Nothing in that sequence belongs to a
     highlighter. A highlighter leaves colour behind the nib as it moves
     and there is nothing else to it.

     So the text is no longer selected at all. While the highlighter or
     the underline is chosen, the layer above the words takes the whole
     gesture, exactly as it already did for the pen, and the mark is
     painted from the nib's own position: the word under the tip is found
     in the map above and the band is drawn to it, every frame, in the
     colour of the instrument. No selection, no handles, no callout, no
     wait — and it snaps to whole words, so a pencil held at a natural
     angle marks the phrase you meant rather than half of it.

     A pencil marks wherever it lands. A FINGER is the hard case: it is
     both the marking tool and the scrolling tool on a phone, and the
     first movement decides which — along the line and it marks, down the
     page and it scrolls. That is the gesture each one already is. */
  let marker = null;      // { kind, c, a, b } while a stroke is live
  let pending = null;     // a finger that has not yet declared itself
  let loupe = null;

  function beginMark(at, kind) {
    marker = { kind, c: kind === 'ul' ? ulColour : hlColour, a: at, b: at };
    paintLive();
  }

  function startMark(e) {
    const at = wordAt(e.clientX, e.clientY);
    if (!at) return;
    /* A finger has not said yet whether it is marking or scrolling, so
       nothing is drawn and nothing is scrolled until it moves. */
    if (e.pointerType === 'touch') {
      pending = { at, x: e.clientX, y: e.clientY, id: e.pointerId, e };
      return;
    }
    beginMark(at, tool);
    showLoupe(e);
    try { pane.setPointerCapture?.(e.pointerId); } catch {}
  }

  function moveMark(e) {
    if (pending && e.pointerId === pending.id) {
      const dx = e.clientX - pending.x, dy = e.clientY - pending.y;
      if (Math.abs(dx) + Math.abs(dy) < 8) return true;   // not yet decided
      if (Math.abs(dx) > Math.abs(dy) && pending.at.on) {
        beginMark(pending.at, tool);
        try { pane.setPointerCapture?.(e.pointerId); } catch {}
      } else {
        /* Down the page, or begun off the text: this is a scroll, and it
           starts from where the finger first touched so nothing jumps. */
        startPan({ clientY: pending.y, pointerId: pending.id });
        pending = null;
        movePan(e);
        return true;
      }
      pending = null;
    }
    if (!marker) return false;
    const at = wordAt(e.clientX, e.clientY);
    if (at && (at.key !== marker.b.key || at.i !== marker.b.i)) {
      marker.b = at;
      paintLive();
    }
    showLoupe(e);
    return true;
  }

  function endMark() {
    if (pending) {
      /* Pressed and let go without moving: mark the one word, which is
         how every reader behaves and is often what is wanted. */
      if (pending.at.on) beginMark(pending.at, tool);
      pending = null;
    }
    hideLoupe();
    if (!marker) return false;
    const m = marker;
    marker = null;
    const spans = spanOf(m.a, m.b);
    clearLive();
    const at = Date.now();
    const made = [];
    spans.forEach(sp => {
      const el = blockOf(sp.key);
      const text = textOf(el);
      const s = Math.max(0, sp.start), e = Math.min(text.length, sp.end);
      if (e - s < 1) return;
      made.push({ id: uid(), kind: m.kind, key: sp.key, start: s, end: e, c: m.c,
        quote: text.slice(s, e).slice(0, 120), at });
    });
    if (!made.length) return true;
    marks.push(...made);
    undone.length = 0;
    made.forEach(paintMark);
    touch();
    return true;
  }

  const clearLive = () => layer?.querySelectorAll('.an-live').forEach(n => n.remove());

  /** The stroke as it stands, re-drawn. Nothing else on the page moves. */
  function paintLive() {
    clearLive();
    if (!marker || !layer) return;
    const ul = marker.kind === 'ul';
    spanOf(marker.a, marker.b).forEach(sp => bandsOf(sp).forEach(b => {
      const n = document.createElement('span');
      n.className = 'an-live ' + (ul ? 'an-ul' : 'an-hl');
      n.style.cssText = ul
        ? `left:${b.x}px;top:${(b.y + b.h - 2.5).toFixed(1)}px;width:${b.w}px;height:2px;background:${marker.c}`
        : `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${marker.c}`;
      layer.appendChild(n);
    }));
  }

  /* The hand covers the line it is marking. This is the word under the
     nib, held just above it — the same thing the iPad shows for its own
     selection, kept because it is the part of that behaviour worth
     keeping. */
  function showLoupe(e) {
    if (!loupe || !marker || !article) return;
    const w = wordsOf(marker.b.key)[marker.b.i];
    if (!w) return;
    const base = article.getBoundingClientRect();
    loupe.textContent = w.t.slice(0, 24);
    loupe.style.left = (e.clientX - base.left) + 'px';
    loupe.style.top = (e.clientY - base.top - 30) + 'px';
    loupe.hidden = false;
  }
  function hideLoupe() { if (loupe) loupe.hidden = true; }

  /* ================= ink ================= */

  /* TWO LAYERS, AND IT HAS TO BE TWO.

     A highlighter goes UNDER the words — that is what makes the text
     still readable through it, and it is what a real highlighter does to
     paper. A pen goes OVER them. One layer cannot be both, and the first
     version put everything underneath: the ink then disappeared behind
     any block with a background of its own, and — the fault that showed
     first — the pointer never reached the layer at all, because the text
     above it caught every event. Nothing could be drawn.

     So: `layer` sits behind the content and holds the highlights;
     `ink` sits in front and holds the strokes. Only `ink` ever takes the
     pointer, and only while a drawing tool is chosen. */
  let layer = null, ink = null, svg = null, drawing = null, live = null;
  let pane = null;                 // the scrolling pane: every pointer in it is ours

  /** The block a point is over, and the point in that block's fractions. */
  function inkAnchor(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    let b = el;
    while (b && b !== article && !b.hasAttribute?.('data-an')) b = b.parentNode;
    /* Ink in a margin, between paragraphs, belongs to the block nearest
       above it — that is what a person drawing an arrow there means. */
    if (!b || b === article) {
      const all = blocks();
      let best = null;
      all.forEach(x => {
        const r = x.getBoundingClientRect();
        if (r.top <= clientY && (!best || r.top > best.r.top)) best = { x, r };
      });
      b = best?.x || all[0];
    }
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { key: b.getAttribute('data-an'), w: r.width, h: r.height,
      fx: (clientX - r.left) / Math.max(1, r.width), fy: (clientY - r.top) / Math.max(1, r.height) };
  }

  /** A stroke's points back in article coordinates, at today's layout. */
  function inkPoints(m) {
    const el = blockOf(m.key);
    if (!el || !article) return [];
    const r = el.getBoundingClientRect();
    const base = article.getBoundingClientRect();
    const ox = r.left - base.left, oy = r.top - base.top;
    /* The third number is pressure. Strokes written before there was
       one have two, and read as an even hand. */
    return m.pts.map(([fx, fy, p]) => [ox + fx * r.width, oy + fy * r.height,
      typeof p === 'number' ? p : 0.5]);
  }

  /**
   * Jitter, taken out. A pencil on glass is not a steady hand and the
   * digitiser is not a perfect instrument; the samples wobble by a
   * fraction of a millimetre and the eye reads that wobble as a shaky
   * line. A three-point average along the stroke — position AND
   * pressure — is the whole of what makes writing look written.
   */
  function smooth(p) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      out.push([(p[i - 1][0] + p[i][0] * 2 + p[i + 1][0]) / 4,
        (p[i - 1][1] + p[i][1] * 2 + p[i + 1][1]) / 4,
        (p[i - 1][2] + p[i][2] * 2 + p[i + 1][2]) / 4]);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  /* How wide the nib is at one point. Pressure moves it between a third
     and a half again of the chosen width — enough that a downstroke
     reads as heavier than a hairline, never so much that a letter
     changes shape. */
  const halfWidth = (w, p) => (w / 2) * Math.max(0.38, Math.min(1.5, 0.45 + 0.85 * (p || 0.5)));

  /**
   * THE STROKE AS AN OUTLINE, NOT A LINE.
   *
   * A `<path>` has ONE stroke-width, so a stroke drawn that way can only
   * have one thickness — and the code that set it from pressure set it
   * from the LATEST sample, which means pressing harder at the end of a
   * word retroactively thickened the whole word. A pen does not do that.
   *
   * So the nib's edges are traced instead: each sample is offset to
   * either side by its own half-width, forward along one edge and back
   * along the other, and the shape is filled. A round cap at each end,
   * and the line thickens and thins exactly where the hand did.
   */
  function inkOutline(p, w) {
    const n = p.length;
    if (!n) return '';
    if (n === 1) {
      const r = halfWidth(w, p[0][2]);
      const [x, y] = p[0];
      return `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(r * 2).toFixed(1)},0`
        + `a${r.toFixed(1)},${r.toFixed(1)} 0 1,0 ${(-r * 2).toFixed(1)},0`;
    }
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const r = halfWidth(w, p[i][2]);
      L.push([p[i][0] - dy * r, p[i][1] + dx * r]);
      R.push([p[i][0] + dy * r, p[i][1] - dx * r]);
    }
    /* Each edge is drawn as quadratics through the midpoints of its own
       points, which is what keeps a curve a curve rather than a row of
       short straight segments. */
    const run = q => {
      let d = '';
      for (let i = 1; i < q.length - 1; i++) {
        const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2;
        d += `Q${q[i][0].toFixed(1)},${q[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
      }
      const last = q[q.length - 1];
      return d + `L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
    };
    const rEnd = halfWidth(w, p[n - 1][2]), rStart = halfWidth(w, p[0][2]);
    const back = R.slice().reverse();
    return `M${L[0][0].toFixed(1)},${L[0][1].toFixed(1)}`
      + run(L)
      + `A${rEnd.toFixed(1)},${rEnd.toFixed(1)} 0 0,1 ${back[0][0].toFixed(1)},${back[0][1].toFixed(1)}`
      + run(back)
      + `A${rStart.toFixed(1)},${rStart.toFixed(1)} 0 0,1 ${L[0][0].toFixed(1)},${L[0][1].toFixed(1)}Z`;
  }

  /** One stroke's SVG attributes, shared by the live path and a repaint. */
  function inkAttrs(m, node) {
    const d = inkOutline(smooth(inkPoints(m)), m.w);
    node.setAttribute('d', d);
    node.setAttribute('data-mark', m.id);
    node.setAttribute('fill', m.c);
    node.setAttribute('fill-rule', 'nonzero');
    /* A hairline along the outline, in the same colour, closes the seams
       where the two edges meet at a sharp turn. */
    node.setAttribute('stroke', m.c);
    node.setAttribute('stroke-width', '0.6');
    node.setAttribute('stroke-linejoin', 'round');
    if (m.hl) { node.setAttribute('fill-opacity', '.38'); node.setAttribute('stroke-opacity', '.38'); }
    return node;
  }

  function paintInk() {
    if (!svg) return;
    const base = article.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${base.width} ${article.scrollHeight}`);
    svg.style.width = base.width + 'px';
    svg.style.height = article.scrollHeight + 'px';
    svg.innerHTML = '';
    live = null;
    marks.filter(m => m.kind === 'ink').forEach(m => {
      if (!m.pts?.length) return;
      const node = inkAttrs(m, document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      svg.appendChild(node);
      /* A re-draw in the middle of a stroke — a picture finishing
         loading, say — must hand the stroke back its node, or the rest
         of the line would not appear until the nib lifted. */
      if (drawing && m === drawing) live = node;
    });
  }

  /* ================= drawing ================= */

  /* PALM REJECTION, PROPERLY.

     "A finger scrolls" was the whole of the old rule, and on a desk it
     is not enough. Writing means the hand RESTS on the glass, and the
     heel of it is a touch: it started a scroll, the page crept under
     the nib, and the browser — seeing a scroll begin — cancelled the
     pen stroke that was in progress. That is why the writing came back
     in fragments rather than words.

     So while the Pencil is down, the hand does not exist. Not "is
     ignored for drawing" — ignored entirely, including for scrolling.
     A pen going down also cancels a scroll the palm has already begun,
     because the palm lands first and the pen follows. And for a moment
     after the stroke ends the hand is still ignored, because it lifts
     after the nib does and would otherwise flick the page away.

     Every tablet does this. It is not an optimisation; without it you
     cannot write at all. */
  const PALM_GRACE = 700;              // ms after the nib lifts
  let penAt = 0;                       // when the pen was last in contact
  /* Only a PEN arms the grace period. A mouse cannot rest a hand on the
     glass, and on a touchscreen laptop a mouse merely passing over the
     page must not switch the finger off. While any stroke is live the
     hand is ignored whatever started it. */
  const nib = e => e.pointerType === 'pen';
  const palm = e => e.pointerType === 'touch' && (drawing || marker
    || performance.now() - penAt < PALM_GRACE);

  function onDown(e) {
    if (tool === 'read') return;
    if (palm(e)) { e.preventDefault(); return; }
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      /* A second finger is never a second mark. It is a pinch. */
      if (pointers.size === 2) { e.preventDefault(); startPinch(); return; }
      if (pointers.size > 2) { e.preventDefault(); return; }
    }
    if (e.pointerType !== 'touch') {
      if (nib(e)) penAt = performance.now();
      /* The palm landed first and is already scrolling. It stops now. */
      cancelAnimationFrame(glideRaf); glideRaf = null; pan = null;
    }
    /* The marker handles its own pointer rules — a pencil marks at once,
       a finger waits to see which gesture it is — so it is asked first
       and a touch is NOT handed to the scroller here. */
    if (tool === 'hl' || tool === 'ul') {
      if (e.pointerType !== 'touch') e.preventDefault();
      startMark(e);
      return;
    }
    if (tool !== 'pen' && tool !== 'erase') return;
    /* A finger, with no pen in play, scrolls — and the scrolling is
       OURS to do. `touch-action: pan-y` looked like the way to let a
       finger scroll a surface the pen draws on, and it was the earlier
       fault: the browser applied it to the PEN too, so a downward
       stroke was read as a scroll and cancelled mid-line. The layer
       takes the whole gesture instead. */
    if (e.pointerType === 'touch') { startPan(e); return; }
    e.preventDefault();
    if (tool === 'erase') { eraseAt(e.clientX, e.clientY); return; }
    const a = inkAnchor(e.clientX, e.clientY);
    if (!a) return;
    drawing = { id: uid(), kind: 'ink', key: a.key, c: penColour, w: penWidth,
      pts: [[round(a.fx), round(a.fy), round(pressureOf(e))]], at: Date.now() };
    marks.push(drawing);
    live = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    inkAttrs(drawing, live);
    /* Capture keeps the stroke coming to this layer even when the pencil
       leaves it mid-line. It THROWS rather than returning false when the
       pointer id is not one the browser is tracking — which happens with
       synthetic events and has been seen on iPadOS — and an exception
       here would abandon the stroke that has just been started. */
    try { pane.setPointerCapture?.(e.pointerId); } catch {}
  }

  /* A Pencil reports real pressure. A mouse reports 0.5 whether or not
     it is down, and gets an even line, which is right rather than a
     fallback. */
  const pressureOf = e => (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5;

  function onMove(e) {
    if (tool === 'read') return;
    if (palm(e)) { e.preventDefault(); return; }
    if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) { e.preventDefault(); movePinch(); return; }
    }
    if (nib(e)) penAt = performance.now();
    if (tool === 'hl' || tool === 'ul') {
      if (moveMark(e)) { if (e.pointerType !== 'touch') e.preventDefault(); return; }
      if (e.pointerType === 'touch') movePan(e);
      return;
    }
    if (e.pointerType === 'touch') { movePan(e); return; }
    if (!drawing) {
      if (tool === 'erase' && e.buttons) eraseAt(e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const el = blockOf(drawing.key);
    if (!el) return;
    const r = el.getBoundingClientRect();

    /* EVERY SAMPLE, NOT EVERY FRAME. An Apple Pencil is read at up to
       240 Hz; `pointermove` is delivered at the refresh rate. The rest
       of the samples are not lost, they are HELD — and asking for them
       is the difference between a written line and a run of chords
       through it. Without this, fast handwriting comes out angular and
       small letters lose their shape entirely. */
    const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const pts = (batch && batch.length ? batch : [e]);
    let added = false;
    for (const s of pts) {
      const fx = (s.clientX - r.left) / Math.max(1, r.width);
      const fy = (s.clientY - r.top) / Math.max(1, r.height);
      const last = drawing.pts[drawing.pts.length - 1];
      /* Samples closer than half a pixel are the digitiser's noise. */
      if (Math.abs(fx - last[0]) * r.width < 0.5 && Math.abs(fy - last[1]) * r.height < 0.5) continue;
      drawing.pts.push([round(fx), round(fy), round(pressureOf(s))]);
      added = true;
    }
    /* Only the live stroke is re-drawn. Rebuilding every stroke on the
       page for each sample — which is what this used to do — is work
       that grows with the length of the notes, and it is paid at
       exactly the moment the hand is moving fastest. */
    if (added && live) inkAttrs(drawing, live);
  }

  function onUp(e) {
    if (e && nib(e)) penAt = performance.now();
    if (e && e.pointerType === 'touch') {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) endPinch(); return; }
    }
    if (tool === 'read') return;
    if (tool === 'hl' || tool === 'ul') {
      const marked = endMark();
      /* A finger that turned out to be scrolling still has a glide to
         finish; one that marked never started a pan. */
      if (!marked && e && e.pointerType === 'touch') endPan();
      return;
    }
    if (e && e.pointerType === 'touch') { if (!palm(e)) endPan(); return; }
    if (!drawing) return;
    /* A DOT IS A MARK. This used to throw away any stroke of fewer than
       two points, on the reasoning that it was the pencil being put
       down — and so it threw away the dot on every i, every full stop,
       every tick and every short crossbar. Written words came back with
       pieces missing. A finger cannot draw at all and the palm is
       rejected outright, so a single point from a nib is something the
       hand meant. */
    if (live) inkAttrs(drawing, live);
    drawing = null; live = null;
    undone.length = 0;
    touch();
  }

  const round = n => Math.round(n * 10000) / 10000;

  /* ================= zoom =================

     ZOOMING THE TEXT, NOT THE PICTURE OF IT.

     A pinch on a PDF magnifies the page: the words get bigger and so do
     the margins, and past a certain point you are panning left and right
     to read a line. That is what a PDF reader must do, because a PDF is
     a fixed page. This is not a fixed page — it is a document — so a
     pinch makes the TYPE bigger and the column re-wraps to fit. The text
     never leaves the screen sideways, and there is nothing to pan.

     It is also the reason the marks survive it. A highlight is anchored
     to words and is simply re-measured at the new size; ink is anchored
     to its block. Magnifying would have meant every rectangle and every
     stroke needing the scale factor divided out of it in five places,
     and one of them would have been missed. */
  const ZOOM_MIN = 0.8, ZOOM_MAX = 2.2;
  let zoom = 1, baseFont = 17, pinch = null;
  const pointers = new Map();

  function applyZoom(z, settle) {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (!article) return;
    zoom = next;
    article.style.fontSize = (baseFont * zoom).toFixed(2) + 'px';
    if (settle) {
      /* Every mark's position was measured against the old type. They
         are hidden while the fingers move — a stale highlight sliding
         out from under its words looks broken — and re-measured once,
         when the gesture is over. */
      article.classList.remove('is-zooming');
      forgetGeometry();
      render();
      onState();
    } else article.classList.add('is-zooming');
  }

  const setZoom = z => applyZoom(z, true);
  const getZoom = () => zoom;
  const zoomBy = step => applyZoom(Math.round((zoom + step) * 20) / 20, true);

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /** Two fingers on the page: whatever else was happening, stops. */
  function startPinch() {
    if (drawing) { drawing = null; live = null; }
    marker = null; pending = null;
    clearLive(); hideLoupe();
    cancelAnimationFrame(glideRaf); glideRaf = null; pan = null;
    pinch = { d0: spread() || 1, z0: zoom };
  }
  function movePinch() {
    if (!pinch) return;
    const d = spread();
    if (!d) return;
    applyZoom(pinch.z0 * (d / pinch.d0), false);
    onState();
  }
  function endPinch() { pinch = null; applyZoom(zoom, true); }

  /* ---------------- scrolling, by hand ----------------

     Only while a drawing tool is chosen. It has to feel exactly like the
     browser's own, so it moves one-for-one with the finger and keeps
     going when the finger leaves — a list that stops dead the moment you
     let go feels broken even when every pixel is where you put it. */
  let pan = null, glideRaf = null;

  function startPan(e) {
    cancelAnimationFrame(glideRaf); glideRaf = null;
    pan = { id: e.pointerId, y: e.clientY, t: performance.now(), v: 0 };
  }
  function movePan(e) {
    if (!pan || pan.id !== e.pointerId || !host) return;
    const now = performance.now();
    const dy = e.clientY - pan.y;
    const dt = Math.max(1, now - pan.t);
    /* Smoothed, so one jittery sample at the end of a flick does not
       decide how far it glides. */
    pan.v = pan.v * 0.6 + (dy / dt) * 0.4;
    host.scrollTop -= dy;
    pan.y = e.clientY; pan.t = now;
  }
  function endPan() {
    const v0 = pan?.v || 0;
    pan = null;
    if (!host || Math.abs(v0) < 0.08) return;
    let v = v0;
    const step = () => {
      v *= 0.94;                                  // about a second to rest
      host.scrollTop -= v * 16;
      glideRaf = Math.abs(v) > 0.02 ? requestAnimationFrame(step) : null;
    };
    glideRaf = requestAnimationFrame(step);
  }

  function eraseAt(cx, cy) {
    /* The ink layer is under the finger, so asking what is at the point
       would always answer "the ink layer". `elementsFromPoint` returns
       everything under it, in order, and the first thing carrying a mark
       is the one being erased — which also means a highlight UNDER the
       text can be rubbed out through it. */
    const stack = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [document.elementFromPoint(cx, cy)];
    const hit = stack.find(el => el?.dataset?.mark);
    const id = hit?.dataset.mark;
    if (!id) return;
    marks = marks.filter(m => m.id !== id);
    render(); touch();
  }

  /* ================= saving ================= */

  function touch() {
    dirty = true; onState();
    clearTimeout(saveTimer);
    /* Debounced: a highlight is one write, not one per rectangle, and a
       page of ink is one write when the pencil stops. */
    saveTimer = setTimeout(save, 900);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (!doc) return;
    const payload = { v: 1, marks };
    saving = Backend.saveAnnotations(doc, payload)
      .then(() => { dirty = false; onState(); })
      .catch(e => { onState(e?.message || 'Your marks could not be saved.'); });
    return saving;
  }

  async function load(key) {
    doc = key; marks = []; undone.length = 0;
    try {
      const d = await Backend.getAnnotations(key);
      marks = Array.isArray(d?.marks) ? d.marks : [];
    } catch { marks = []; }
    return marks;
  }

  /* ================= mounting ================= */

  function render() {
    if (!article || !layer) return;
    /* Every measurement in the word map is a position on the page as it
       was; a re-draw or a re-size moves them, so they are forgotten
       rather than trusted. */
    forgetGeometry();
    clearLive();
    paintTextMarks();
    paintInk();
  }

  /**
   * Attach to a document. `art` is the element whose `[data-an]` blocks
   * are annotatable; `scroller` is what scrolls, so repaints can follow
   * a resize rather than a scroll (the marks are inside the article, so
   * scrolling moves them for free).
   */
  function mount(art, scroller, key, onChange) {
    article = art; host = scroller || art; pane = host; onState = onChange || (() => {});
    tool = 'read';
    baseFont = parseFloat(getComputedStyle(article).fontSize) || 17;
    zoom = 1;
    layer = document.createElement('div');
    layer.className = 'an-layer';
    ink = document.createElement('div');
    ink.className = 'an-ink-layer';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'an-ink');
    ink.appendChild(svg);
    loupe = document.createElement('span');
    loupe.className = 'an-loupe';
    loupe.hidden = true;
    ink.appendChild(loupe);
    article.appendChild(layer);
    article.appendChild(ink);
    selStyle = document.createElement('style');
    article.appendChild(selStyle);
    paintSelectionColour();

    /* THE WHOLE PANE, NOT THE COLUMN.
       The layer covers `.rd-doc`, which is a 680px column centred in a
       pane that on an iPad is nearly twice as wide. The hand writing on
       it rests to the RIGHT of that column — outside the layer, on
       ordinary scrollable page — so the browser read the palm as a
       scroll there, and a scroll beginning anywhere cancels the pen
       stroke in progress. That is the rest of the broken handwriting,
       and no amount of care inside the column could have fixed it.
       Every pointer in the pane is ours now. */
    pane.addEventListener('pointerdown', onDown);
    pane.addEventListener('pointermove', onMove);
    pane.addEventListener('pointerup', onUp);
    pane.addEventListener('pointercancel', onUp);
    /* NOT `pointerleave`. It fires whenever the nib crosses out of the
       layer's box — over an image, past the edge of the column — and
       ending the stroke there is the other half of why a circle came out
       as several arcs. Pointer capture means up and cancel arrive here
       wherever the pen finishes. */

    /* Re-measured on resize, because every mark's position is derived
       from where its block is NOW. Debounced — a rotation fires this
       many times. */
    let rs = null;
    const onResize = () => { clearTimeout(rs); rs = setTimeout(render, 120); };
    window.addEventListener('resize', onResize);
    const ro = window.ResizeObserver ? new ResizeObserver(onResize) : null;
    ro?.observe(article);

    return load(key).then(() => { render(); onState(); return marks; });
  }

  function unmount() {
    clearTimeout(saveTimer);
    if (dirty) save();
    cancelAnimationFrame(glideRaf); glideRaf = null; pan = null;
    marker = null; pending = null; loupe = null;
    drawing = null; live = null; penAt = 0;
    pointers.clear(); pinch = null;
    pane?.classList.remove('is-marking'); pane = null;
    article?.classList.remove('is-zooming');
    if (article) article.style.fontSize = '';
    zoom = 1;
    forgetGeometry();
    selStyle?.remove(); selStyle = null;
    layer?.remove(); layer = null;
    ink?.remove(); ink = null; svg = null;
    article = null; host = null; marks = []; doc = '';
  }

  /* ================= what the toolbar drives ================= */

  function setTool(t) {
    tool = t;
    /* Any stroke in the air is abandoned, not committed to the tool that
       has just been put down. */
    marker = null; pending = null;
    clearLive(); hideLoupe();
    forgetGeometry();
    /* The ink layer takes the pointer ONLY while a drawing tool is
       chosen. At every other moment it is transparent to it, so the text
       stays selectable for the highlighter and the page stays
       scrollable — which on an iPad is the difference between a document
       you can read and one you can only draw on. */
    if (ink) ink.className = 'an-ink-layer is-' + t;
    /* The pane stops interpreting touches itself the moment an
       instrument is picked up — anywhere in it, not only over the text
       column. Scrolling is then ours to do, which is what lets a palm
       rest on the margin without the page moving. */
    pane?.classList.toggle('is-marking', t !== 'read');
    pane?.classList.toggle('is-erase', t === 'erase');
    pointers.clear(); pinch = null;
    /* THE ERASER COULD NOT RUB OUT A HIGHLIGHT. Every mark is
       `pointer-events: none` so that it never gets in the way of reading
       — and `elementsFromPoint`, which is how the eraser finds what is
       under the nib, SKIPS such elements entirely. Ink was erasable
       because its layer is told to take the pointer; the highlights and
       the underlines were not, so the only way to remove one was to undo
       it, and only if it was the last thing done. They take the pointer
       while the eraser is chosen, and nothing else changes. */
    if (layer) layer.className = 'an-layer' + (t === 'erase' ? ' is-erase' : '');
    /* Set here as well as in the stylesheet, and deliberately. The rule
       there needs `:has()`; this needs nothing, and it is the difference
       between a pencil that writes and one that raises the Copy callout
       halfway through a word. In reading mode the text is selectable
       again, because then it is text to be read and copied. */
    if (article) {
      const off = t !== 'read' ? 'none' : '';
      article.style.userSelect = off;
      article.style.webkitUserSelect = off;
      article.style.webkitTouchCallout = off;
    }
    paintSelectionColour();
    /* In pen or eraser mode the layer takes the pointer; in reading and
       highlighting modes it must not, or text could not be selected. */
    onState();
  }
  const getTool = () => tool;
  const setHighlightColour = c => { hlColour = c; paintSelectionColour(); onState(); };
  const setUnderlineColour = c => { ulColour = c; paintSelectionColour(); onState(); };
  const setPenColour = c => { penColour = c; onState(); };
  const setPenWidth = w => { penWidth = w; onState(); };
  const colours = () => ({ hl: hlColour, ul: ulColour, pen: penColour, w: penWidth });
  const count = () => marks.length;
  const isDirty = () => dirty;

  function undo() {
    const last = marks[marks.length - 1];
    if (!last) return;
    /* A selection dragged over three paragraphs made three highlights in
       one action, so one undo takes all three back — otherwise undo
       would not match what the person did. */
    const group = marks.filter(m => m.at === last.at && m.kind === last.kind);
    marks = marks.filter(m => !group.includes(m));
    undone.push(group);
    render(); touch();
  }
  function redo() {
    const group = undone.pop();
    if (!group) return;
    marks.push(...group);
    render(); touch();
  }
  function clearAll() {
    if (!marks.length) return;
    undone.push(marks.slice());
    marks = [];
    render(); touch();
  }

  return { HIGHLIGHTS, UNDERLINES, PENS, WIDTHS,
    mount, unmount, render, save, load,
    markSelection, highlightSelection, underlineSelection,
    setTool, getTool, setHighlightColour, setUnderlineColour, setPenColour, setPenWidth,
    colours, count, isDirty, undo, redo, clearAll,
    setZoom, getZoom, zoomBy, ZOOM_MIN, ZOOM_MAX,
    _marks: () => marks, _locate: locate,
    _wordAt: wordAt, _wordsOf: wordsOf, _marker: () => marker };
})();
