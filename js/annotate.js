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
   draws, a `touch` is left alone and the page scrolls under it, and the
   palm resting on the glass is a touch. Nothing needs turning on and
   nothing needs turning off between writing a note and scrolling to the
   next question.

   A mouse draws too, because a laptop has no pencil and the feature
   should not be an iPad feature.

   Pressure is read where the hardware reports it (`e.pressure`), so a
   Pencil gives a line that thickens as it is pressed. A mouse reports a
   constant 0.5 and gets a constant line, which is correct rather than a
   fallback.

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
  let tool = 'read';            // read | hl | pen | erase
  let hlColour = HIGHLIGHTS[0].c;
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

  /* ================= highlights ================= */

  /**
   * Turn the current selection into a highlight. Returns false when
   * there is nothing to highlight or it spans blocks we cannot anchor
   * — a highlight that only half-exists is worse than none.
   */
  function highlightSelection(colour) {
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
      made.push({ id: uid(), kind: 'hl', key, start: s, end: e, c: colour || hlColour,
        /* The quoted text travels with the mark so a scheme that has
           been edited since can be checked rather than silently
           highlighting the wrong words. */
        quote: text.slice(s, e).slice(0, 120), at: Date.now() });
    }
    if (!made.length) return false;
    marks.push(...made);
    sel.removeAllRanges();
    render();
    touch();
    return true;
  }

  /** Paint every highlight for one block, over the top of its text. */
  function paintHighlights() {
    article.querySelectorAll('.an-hl').forEach(n => n.remove());
    const byKey = {};
    marks.filter(m => m.kind === 'hl').forEach(m => (byKey[m.key] = byKey[m.key] || []).push(m));
    Object.keys(byKey).forEach(key => {
      const el = blockOf(key);
      if (!el) return;
      const text = textOf(el);
      byKey[key].forEach(m => {
        if (m.start >= text.length) return;                  // the text has changed under it
        const rects = rangeRects(el, m.start, Math.min(m.end, text.length));
        rects.forEach(r => {
          const box = document.createElement('span');
          box.className = 'an-hl';
          box.dataset.mark = m.id;
          box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${m.c}`;
          layer.appendChild(box);
        });
      });
    });
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
  let layer = null, ink = null, svg = null, drawing = null;

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
  function inkPath(m) {
    const el = blockOf(m.key);
    if (!el) return '';
    const r = el.getBoundingClientRect();
    const base = article.getBoundingClientRect();
    const ox = r.left - base.left, oy = r.top - base.top;
    return m.pts.map(([fx, fy], i) =>
      `${i ? 'L' : 'M'}${(ox + fx * r.width).toFixed(1)},${(oy + fy * r.height).toFixed(1)}`).join(' ');
  }

  function paintInk() {
    if (!svg) return;
    const base = article.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${base.width} ${article.scrollHeight}`);
    svg.style.width = base.width + 'px';
    svg.style.height = article.scrollHeight + 'px';
    svg.innerHTML = marks.filter(m => m.kind === 'ink').map(m => {
      const d = inkPath(m);
      if (!d) return '';
      return `<path d="${d}" data-mark="${m.id}" fill="none" stroke="${esc(m.c)}"
        stroke-width="${m.w}" stroke-linecap="round" stroke-linejoin="round"
        ${m.hl ? 'stroke-opacity=".38"' : ''}/>`;
    }).join('');
  }

  /* ================= drawing ================= */

  function onDown(e) {
    if (tool !== 'pen' && tool !== 'erase') return;
    /* THE PLATFORM'S OWN RULE. A finger is for scrolling, always — which
       also means the palm resting on the glass is ignored for free. */
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    if (tool === 'erase') { eraseAt(e.clientX, e.clientY); return; }
    const a = inkAnchor(e.clientX, e.clientY);
    if (!a) return;
    drawing = { id: uid(), kind: 'ink', key: a.key, c: penColour, w: penWidth,
      pts: [[a.fx, a.fy]], at: Date.now() };
    marks.push(drawing);
    /* Capture keeps the stroke coming to this layer even when the pencil
       leaves it mid-line. It THROWS rather than returning false when the
       pointer id is not one the browser is tracking — which happens with
       synthetic events and has been seen on iPadOS — and an exception
       here would abandon the stroke that has just been started. */
    try { ink.setPointerCapture?.(e.pointerId); } catch {}
  }

  function onMove(e) {
    if (!drawing) {
      if (tool === 'erase' && e.buttons && e.pointerType !== 'touch') eraseAt(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    const el = blockOf(drawing.key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / Math.max(1, r.width);
    const fy = (e.clientY - r.top) / Math.max(1, r.height);
    const last = drawing.pts[drawing.pts.length - 1];
    /* Points closer than a pixel add nothing but bytes. */
    if (Math.abs(fx - last[0]) * r.width < 1 && Math.abs(fy - last[1]) * r.height < 1) return;
    drawing.pts.push([round(fx), round(fy)]);
    /* A Pencil reports real pressure; a mouse reports 0.5 and gets a
       constant line, which is right rather than a fallback. */
    if (e.pointerType === 'pen' && e.pressure > 0) {
      drawing.w = Math.max(penWidth * 0.45, Math.min(penWidth * 1.7, penWidth * (0.5 + e.pressure)));
    }
    paintInk();
  }

  function onUp() {
    if (!drawing) return;
    /* A dot is a tap, not a stroke — usually the pencil being put down.
       Two points or fewer and it is dropped rather than left as a speck
       nobody can see to erase. */
    if (drawing.pts.length < 2) marks = marks.filter(m => m !== drawing);
    drawing = null;
    undone.length = 0;
    paintInk(); touch();
  }

  const round = n => Math.round(n * 10000) / 10000;

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
    paintHighlights();
    paintInk();
  }

  /**
   * Attach to a document. `art` is the element whose `[data-an]` blocks
   * are annotatable; `scroller` is what scrolls, so repaints can follow
   * a resize rather than a scroll (the marks are inside the article, so
   * scrolling moves them for free).
   */
  function mount(art, scroller, key, onChange) {
    article = art; host = scroller || art; onState = onChange || (() => {});
    tool = 'read';
    layer = document.createElement('div');
    layer.className = 'an-layer';
    ink = document.createElement('div');
    ink.className = 'an-ink-layer';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'an-ink');
    ink.appendChild(svg);
    article.appendChild(layer);
    article.appendChild(ink);

    ink.addEventListener('pointerdown', onDown);
    ink.addEventListener('pointermove', onMove);
    ink.addEventListener('pointerup', onUp);
    ink.addEventListener('pointercancel', onUp);
    ink.addEventListener('pointerleave', onUp);

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
    layer?.remove(); layer = null;
    ink?.remove(); ink = null; svg = null;
    article = null; host = null; marks = []; doc = '';
  }

  /* ================= what the toolbar drives ================= */

  function setTool(t) {
    tool = t;
    /* The ink layer takes the pointer ONLY while a drawing tool is
       chosen. At every other moment it is transparent to it, so the text
       stays selectable for the highlighter and the page stays
       scrollable — which on an iPad is the difference between a document
       you can read and one you can only draw on. */
    if (ink) ink.className = 'an-ink-layer is-' + t;
    /* In pen or eraser mode the layer takes the pointer; in reading and
       highlighting modes it must not, or text could not be selected. */
    onState();
  }
  const getTool = () => tool;
  const setHighlightColour = c => { hlColour = c; onState(); };
  const setPenColour = c => { penColour = c; onState(); };
  const setPenWidth = w => { penWidth = w; onState(); };
  const colours = () => ({ hl: hlColour, pen: penColour, w: penWidth });
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

  return { HIGHLIGHTS, PENS, WIDTHS,
    mount, unmount, render, save, load,
    highlightSelection, setTool, getTool, setHighlightColour, setPenColour, setPenWidth,
    colours, count, isDirty, undo, redo, clearAll,
    _marks: () => marks, _locate: locate };
})();
