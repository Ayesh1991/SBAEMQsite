/* qr.js — a code you can point a phone at, and a camera that reads one.

   WHY THIS IS WRITTEN OUT RATHER THAN INSTALLED

   A QR code is the shortest path between two screens. You are sitting a
   station on an iPad with Claude in voice mode; the recording, the clock
   and the marking belong on the phone in your hand. Typing a station's
   name into a second device costs thirty seconds and breaks the spell of
   a timed station. Pointing a camera at the iPad costs two.

   Everything here is ours, on purpose:

     • The ENCODER is 250 lines and has no dependency, so a code renders
       with the aeroplane mode on, in a hospital basement, on the first
       paint of a page that has not finished loading its CDN scripts.

     • The DECODER is here for one reason: iOS Safari has no
       BarcodeDetector. The phone most likely to be scanning an iPad is
       an iPhone, and a scanner that works everywhere except on the
       device the whole idea is built around is not a scanner. Where the
       browser DOES have BarcodeDetector we use it — it is faster and it
       is the platform's own — and ours is the fallback.

     • And the code we draw is a plain https URL, which means the phone's
       OWN camera app reads it without AUREUM being open at all. That is
       the real mechanism; the in-page scanner is the convenience for
       when you are already here.

   ON MAKING IT PRETTY

   The panel around a code can be as futuristic as it likes. The code
   itself cannot: it is dark modules on a light ground with a four-module
   quiet zone, because that is what every scanner in the world is built
   to read, and a code that photographs beautifully and scans nine times
   in ten is worse than no code at all. So the brackets, the sweep and
   the glow are drawn AROUND a canonical symbol, never on top of one. */

const QR = (() => {
  'use strict';

  /* ================= GF(256), the arithmetic under everything =================
     Reed–Solomon lives in a field of 256 elements with 0x11D as its
     primitive polynomial. Log and antilog tables turn multiplication into
     addition, which is the whole trick. */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  const div = (a, b) => (!a) ? 0 : EXP[LOG[a] + 255 - LOG[b]];

  /* The generator polynomial for n error-correction codewords:
     (x - α⁰)(x - α¹)…(x - αⁿ⁻¹), built up one root at a time. */
  const genPoly = n => {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  };
  const remainder = (data, n) => {
    const g = genPoly(n), res = new Uint8Array(data.length + n);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const f = res[i]; if (!f) continue;
      for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], f);
    }
    return Array.from(res.slice(data.length));
  };

  /* ================= the version tables =================
     Per version (1–10) and correction level: error-correction codewords
     per block, then the two block groups as [count, data codewords].
     Versions past 10 are not here because nothing we encode is longer
     than a URL; version 10-M already holds 213 bytes. */
  const TBL = {
    L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
        [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
    M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
        [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    Q: [[13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16],
        [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
    H: [[17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12],
        [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]]
  };
  const ECBITS = { L: 1, M: 0, Q: 3, H: 2 };
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => ((r >> 1) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
  ];

  const formatBits = (ecl, mask) => {
    const data = (ECBITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10 | rem) ^ 0x5412) & 0x7fff;
  };
  const versionBits = v => {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (v << 12 | rem) & 0x3ffff;
  };

  /* ================= the frame =================
     Everything about a symbol that does not depend on what it says:
     finders, separators, timing, alignment, the always-dark module, the
     reserved format strip and (from version 7) the version blocks.

     Written once and used by BOTH halves of this file. The decoder has
     to walk the identical geometry the encoder wrote, and the surest way
     for two routines to agree about where the data modules are is for
     there to be one routine. */
  function frame(ver) {
    const size = 17 + 4 * ver;
    const m = [], fn = [];
    for (let r = 0; r < size; r++) { m.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }
    const set = (r, c, v) => { if (r < 0 || c < 0 || r >= size || c >= size) return; m[r][c] = v ? 1 : 0; fn[r][c] = 1; };

    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(r0 + r, c0 + c, ring || core);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const cen = ALIGN[ver - 1];
    for (const r0 of cen) for (const c0 of cen) {
      if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === size - 7) || (r0 === size - 7 && c0 === 6)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++)
        set(r0 + r, c0 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
    set(size - 8, 8, 1);                                    // the always-dark module
    const hold = (r, c) => { if (!fn[r][c]) { fn[r][c] = 1; m[r][c] = 0; } };
    for (let i = 0; i <= 8; i++) { hold(8, i); hold(i, 8); }
    for (let i = 0; i < 8; i++) { hold(8, size - 1 - i); hold(size - 1 - i, 8); }
    if (ver >= 7) {
      const vb = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = (vb >>> (17 - i)) & 1, a = size - 11 + (17 - i) % 3, b = Math.floor((17 - i) / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    return { size, m, fn };
  }

  /* Two columns at a time, up then down, skipping the timing column — the
     standard snake. The visitor is called for every data module in the
     order the standard puts bits into them. */
  function walk(size, fn, visit) {
    let dir = -1, row = size - 1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let i = 0; i < 2; i++) { const c = col - i; if (!fn[row][c]) visit(row, c); }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  /* ================= encoding =================
     Byte mode only. Everything AUREUM puts in a code is a URL, and a URL
     in alphanumeric mode would have to be shouted in capitals. */
  function encode(text, level, force) {
    const bytes = new TextEncoder().encode(String(text));
    const ecl = TBL[level] ? level : 'M';

    let ver = 0, spec = null, words = 0;
    for (let i = 0; i < 10; i++) {
      const s = TBL[ecl][i], data = s[1] * s[2] + s[3] * s[4];
      if (bytes.length * 8 + 4 + (i < 9 ? 8 : 16) <= data * 8) { ver = i + 1; spec = s; words = data; break; }
    }
    if (!ver) throw new Error('That is too long for a code this size.');

    /* --- the bit stream --- */
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4);                                   // byte mode
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const cap = words * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);      // terminator
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    const PAD = [0xEC, 0x11];
    for (let i = 0; data.length < words; i++) data.push(PAD[i % 2]);

    /* --- blocks, their check words, and the interleave --- */
    const blocks = [], checks = [];
    let p = 0;
    for (let i = 0; i < spec[1]; i++) { blocks.push(data.slice(p, p + spec[2])); p += spec[2]; }
    for (let i = 0; i < spec[3]; i++) { blocks.push(data.slice(p, p + spec[4])); p += spec[4]; }
    blocks.forEach(b => checks.push(remainder(b, spec[0])));
    const stream = [];
    const widest = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < widest; i++) blocks.forEach(b => { if (i < b.length) stream.push(b[i]); });
    for (let i = 0; i < spec[0]; i++) checks.forEach(c => stream.push(c[i]));

    /* --- the symbol --- */
    const { size, m, fn } = frame(ver);
    let bit = 0;
    walk(size, fn, (r, c) => {
      m[r][c] = (bit < stream.length * 8) ? (stream[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
      bit++;
    });

    /* --- the mask, chosen by the penalty rules rather than by taste --- */
    let best = null, bestScore = Infinity, bestMask = 0;
    for (let k = 0; k < 8; k++) {
      if (force != null && k !== force) continue;      // test seam: pin the mask
      const t = m.map(r => Uint8Array.from(r));
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!fn[r][c] && MASKS[k](r, c)) t[r][c] ^= 1;
      /* The fifteen format bits are laid down MOST significant first,
         starting at (8,0) and at the bottom of column 8. Getting this
         backwards produces a symbol that looks perfect and decodes as
         the wrong correction level — which is to say, not at all.

         The second copy is SEVEN modules up column 8 and then EIGHT
         along row 8 — not eight and seven. Eight and seven writes over
         the always-dark module at (size−8, 8) and leaves one real
         format module unwritten, which every decoder then repairs out of
         the first copy. It reads perfectly and is still wrong, so it
         survives every test that only asks "does it scan". */
      const fb = formatBits(ecl, k);
      for (let i = 0; i < 15; i++) {
        const b = (fb >>> (14 - i)) & 1;
        if (i < 6) t[8][i] = b; else if (i < 8) t[8][i + 1] = b;
        else if (i === 8) t[7][8] = b; else t[14 - i][8] = b;
        if (i < 7) t[size - 1 - i][8] = b; else t[8][size - 8 + (i - 7)] = b;
      }
      const s = penalty(t, size);
      if (s < bestScore) { bestScore = s; best = t; bestMask = k; }
    }
    return { size, ver, ecl, mask: bestMask, modules: best, at: (r, c) => !!best[r][c] };
  }

  /* The four penalty rules, exactly as the standard states them. They are
     not decoration: a badly masked symbol is one a phone gives up on. */
  function penalty(m, size) {
    let score = 0;
    const line = arr => {
      let run = 1, s = 0;
      for (let i = 1; i <= arr.length; i++) {
        if (i < arr.length && arr[i] === arr[i - 1]) { run++; continue; }
        if (run >= 5) s += 3 + (run - 5);                    // rule 1
        run = 1;
      }
      /* Rule 3 — the finder-lookalike. The run is padded with light on
         both sides because the pattern counts at the edge of the symbol
         too, where the quiet zone supplies the four light modules. */
      const str = '0000' + arr.join('') + '0000';
      for (let i = 0; i + 11 <= str.length; i++) {
        const w = str.slice(i, i + 11);
        if (w === '00001011101' || w === '10111010000') s += 40;
      }
      return s;
    };
    for (let r = 0; r < size; r++) score += line(Array.from(m[r]));
    for (let c = 0; c < size; c++) { const col = []; for (let r = 0; r < size; r++) col.push(m[r][c]); score += line(col); }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    const pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ================= drawing =================
     One SVG, no images, no canvas — it scales to any size, prints at the
     printer's resolution, and costs nothing to redraw when the thing it
     points at changes. */
  function svg(text, opts) {
    const o = opts || {};
    const code = encode(text, o.level || 'M');
    const quiet = o.quiet == null ? 4 : o.quiet;
    const n = code.size + quiet * 2;
    const dark = o.dark || '#0b1020';
    const light = o.light || '#ffffff';
    const r = o.round == null ? 0.16 : o.round;      // gentle: scanners are unbothered, eyes are not

    let path = '';
    for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) {
      if (!code.modules[y][x]) continue;
      const px = x + quiet, py = y + quiet;
      path += r
        ? `M${px + r},${py}h${1 - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${1 - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(1 - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}v${-(1 - 2 * r)}a${r},${r} 0 0 1 ${r},${-r}z`
        : `M${px},${py}h1v1h-1z`;
    }
    return `<svg class="qc-svg" viewBox="0 0 ${n} ${n}" width="100%" height="100%" role="img" shape-rendering="geometricPrecision"
      aria-label="${esc(o.alt || 'QR code')}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${n}" height="${n}" fill="${light}"/>
      <path d="${path}" fill="${dark}"/>
    </svg>`;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ================= reading a symbol back =================

     Reed–Solomon in reverse: syndromes, Berlekamp–Massey for the error
     locator, Chien for where the errors are and Forney for what they
     should have been. It is the part that makes a code survive a thumb
     over one corner and a reflection off an iPad, and it is the reason a
     decoder cannot be a few lines of pattern matching. */
  const polyEval = (p, x) => { let y = p[0]; for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i]; return y; };
  const polyScale = (p, x) => p.map(v => mul(v, x));
  const polyAdd = (a, b) => {
    const r = new Array(Math.max(a.length, b.length)).fill(0);
    for (let i = 0; i < a.length; i++) r[i + r.length - a.length] ^= a[i];
    for (let i = 0; i < b.length; i++) r[i + r.length - b.length] ^= b[i];
    return r;
  };
  const polyMul = (a, b) => {
    const r = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] ^= mul(a[i], b[j]);
    return r;
  };

  function locator(synd, nsym) {
    let err = [1], old = [1];
    const shift = synd.length - nsym;
    for (let i = 0; i < nsym; i++) {
      const K = i + shift;
      let delta = synd[K];
      for (let j = 1; j < err.length; j++) delta ^= mul(err[err.length - 1 - j], synd[K - j]);
      old = old.concat([0]);
      if (delta) {
        if (old.length > err.length) { const ne = polyScale(old, delta); old = polyScale(err, div(1, delta)); err = ne; }
        err = polyAdd(err, polyScale(old, delta));
      }
    }
    while (err.length && err[0] === 0) err.shift();
    return err;
  }
  /* Chien: Λ(x) = Π(1 − Xₖx), so its roots are the INVERSES of the error
     locations — α^(255−k), not α^k. Searching the positive exponents finds
     a locator of the right degree and no roots at all, which looks exactly
     like uncorrectable damage and is the easiest way to have working
     arithmetic and a decoder that never repairs anything. */
  function positions(err, n) {
    const found = [];
    for (let p = 0; p < n; p++) {
      const coef = (n - 1 - p) % 255;
      if (polyEval(err, EXP[(255 - coef) % 255]) === 0) found.push(p);
    }
    return found.length === err.length - 1 ? found : null;
  }
  /* One block of data + check words, corrected in place. Returns just the
     data words, or null when the damage is past what the level can carry —
     which is the honest answer, and better than a plausible wrong string. */
  function correctBlock(block, nsym) {
    const synd = [0];
    let broken = false;
    for (let i = 0; i < nsym; i++) { const s = polyEval(block, EXP[i]); synd.push(s); if (s) broken = true; }
    if (!broken) return block.slice(0, block.length - nsym);
    const err = locator(synd, nsym);
    if (err.length - 1 > nsym / 2) return null;
    const pos = positions(err, block.length);
    if (!pos) return null;
    const fixed = forney(block, synd, pos);
    if (!fixed) return null;
    for (let i = 0; i < nsym; i++) if (polyEval(fixed, EXP[i])) return null;   // prove it, do not hope
    return fixed.slice(0, fixed.length - nsym);
  }

  /* Forney: how wrong each found position was. */
  function forney(msg, synd, pos) {
    const coef = pos.map(p => msg.length - 1 - p);
    let loc = [1];
    for (const p of coef) loc = polyMul(loc, [mul(EXP[p % 255], 1), 1]);
    const rsyn = synd.slice().reverse();
    let ev = polyMul(rsyn, loc);
    ev = ev.slice(ev.length - loc.length);          // Ω(x), to as many terms as there are errors
    const out = msg.slice();
    const xs = coef.map(p => EXP[p % 255]);
    for (let i = 0; i < xs.length; i++) {
      const xinv = div(1, xs[i]);
      let prime = 1;
      for (let j = 0; j < xs.length; j++) if (j !== i) prime = mul(prime, 1 ^ mul(xinv, xs[j]));
      if (!prime) return null;
      const y = mul(xs[i], polyEval(ev, xinv));
      out[pos[i]] ^= div(y, prime);
    }
    return out;
  }

  /* ---------- a sampled grid of light and dark, turned back into text ---------- */
  function decodeMatrix(get, size) {
    const ver = (size - 17) / 4;
    if (!Number.isInteger(ver) || ver < 1 || ver > 10) return null;
    const { fn } = frame(ver);
    const bit = (r, c) => (get(r, c) ? 1 : 0);

    /* Both copies of the format, and the nearest legal value to each. The
       15 bits carry their own BCH code, so a corner that was blurred is
       recoverable — and if neither copy is within three bits of anything
       legal, this is not a symbol we are looking at. */
    let a = 0, b = 0;
    for (let i = 0; i < 15; i++) {
      const p = (i < 6) ? bit(8, i) : (i < 8) ? bit(8, i + 1) : (i === 8) ? bit(7, 8) : bit(14 - i, 8);
      const q = (i < 7) ? bit(size - 1 - i, 8) : bit(8, size - 8 + (i - 7));
      a = (a << 1) | p; b = (b << 1) | q;
    }
    let ecl = null, mask = -1, bestD = 99;
    for (const lv of ['L', 'M', 'Q', 'H']) for (let k = 0; k < 8; k++) {
      const f = formatBits(lv, k);
      for (const v of [a, b]) {
        let d = 0, x = f ^ v;
        while (x) { d += x & 1; x >>>= 1; }
        if (d < bestD) { bestD = d; ecl = lv; mask = k; }
      }
    }
    if (bestD > 3 || !ecl) return null;

    const bits = [];
    walk(size, fn, (r, c) => bits.push(bit(r, c) ^ (MASKS[mask](r, c) ? 1 : 0)));
    const words = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      let w = 0; for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
      words.push(w);
    }

    /* De-interleave, exactly reversing the encoder. */
    const spec = TBL[ecl][ver - 1], nsym = spec[0], lens = [];
    for (let i = 0; i < spec[1]; i++) lens.push(spec[2]);
    for (let i = 0; i < spec[3]; i++) lens.push(spec[4]);
    if (words.length < lens.reduce((s, l) => s + l, 0) + nsym * lens.length) return null;
    const blocks = lens.map(l => new Array(l)), checks = lens.map(() => []);
    let p = 0;
    const widest = Math.max(...lens);
    for (let i = 0; i < widest; i++) for (let bIdx = 0; bIdx < blocks.length; bIdx++) if (i < lens[bIdx]) blocks[bIdx][i] = words[p++];
    for (let i = 0; i < nsym; i++) for (let bIdx = 0; bIdx < blocks.length; bIdx++) checks[bIdx].push(words[p++]);

    const data = [];
    for (let i = 0; i < blocks.length; i++) {
      const ok = correctBlock(blocks[i].concat(checks[i]), nsym);
      if (!ok) return null;
      data.push(...ok);
    }
    const text = readSegments(data, ver);
    return text == null ? null : { text, ver, ecl, mask };
  }

  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function readSegments(data, ver) {
    let at = 0;
    const room = data.length * 8;
    const take = n => {
      if (at + n > room) return -1;
      let v = 0;
      for (let i = 0; i < n; i++) { v = (v << 1) | ((data[at >> 3] >> (7 - (at & 7))) & 1); at++; }
      return v;
    };
    let out = '';
    const bytes = [];
    const flush = () => { if (bytes.length) { out += new TextDecoder().decode(Uint8Array.from(bytes)); bytes.length = 0; } };
    for (;;) {
      const mode = take(4);
      if (mode <= 0) break;                                     // terminator, or nothing left
      if (mode === 4) {                                         // byte
        const n = take(ver <= 9 ? 8 : 16); if (n < 0) return null;
        for (let i = 0; i < n; i++) { const v = take(8); if (v < 0) return null; bytes.push(v); }
      } else if (mode === 1) {                                  // numeric
        flush();
        let n = take(ver <= 9 ? 10 : (ver <= 26 ? 12 : 14)); if (n < 0) return null;
        while (n >= 3) { const v = take(10); if (v < 0) return null; out += String(v).padStart(3, '0'); n -= 3; }
        if (n === 2) { const v = take(7); if (v < 0) return null; out += String(v).padStart(2, '0'); }
        else if (n === 1) { const v = take(4); if (v < 0) return null; out += String(v); }
      } else if (mode === 2) {                                  // alphanumeric
        flush();
        let n = take(ver <= 9 ? 9 : (ver <= 26 ? 11 : 13)); if (n < 0) return null;
        while (n >= 2) { const v = take(11); if (v < 0) return null; out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        if (n === 1) { const v = take(6); if (v < 0) return null; out += ALNUM[v]; }
      } else if (mode === 7) {                                  // ECI — we read UTF-8 regardless
        const v = take(8); if (v < 0) return null;
        if (v >= 0xC0) take(16); else if (v >= 0x80) take(8);
      } else return null;                                       // structured append, FNC1: not ours
    }
    flush();
    return out;
  }

  /* ================= finding a symbol in a photograph =================

     A camera frame is not a matrix. Between the two there is a threshold
     that has to cope with a bright iPad and a dim room in the same
     picture, three finder patterns to recognise, and a perspective to
     undo because nobody holds a phone square to a screen.

     The order is the same one every reader uses: threshold in blocks,
     hunt the 1:1:3:1:1 signature along rows, verify each candidate down
     its own column, cluster what survives, work out which corner is
     which, find the alignment pattern to pin the fourth corner, then
     sample the grid through the transform those four corners define. */

  /* Block threshold. A single global cut-off loses the dim half of any
     unevenly lit frame; averaging over 8×8 blocks, and over each block's
     neighbours, follows the light across the picture. */
  function binarize(grey, w, h) {
    const B = 8, bw = Math.max(1, Math.ceil(w / B)), bh = Math.max(1, Math.ceil(h / B));
    const avg = new Float32Array(bw * bh), lo = new Float32Array(bw * bh), hi = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sum = 0, n = 0, mn = 255, mx = 0;
      const y1 = Math.min(h, by * B + B), x1 = Math.min(w, bx * B + B);
      for (let y = by * B; y < y1; y++) for (let x = bx * B; x < x1; x++) {
        const v = grey[y * w + x]; sum += v; n++;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      const i = by * bw + bx;
      avg[i] = n ? sum / n : 128; lo[i] = mn; hi[i] = mx;
    }
    /* A block with almost no contrast is entirely paper OR entirely ink,
       and its own average cannot tell you which. Half its darkest pixel
       is the right cut for paper; for ink it is catastrophic — it turns
       the middle of every finder white — so where the block is darker
       than its neighbourhood, the neighbourhood decides instead. */
    const bp = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const i = by * bw + bx;
      if (hi[i] - lo[i] > 24) { bp[i] = avg[i]; continue; }
      let t = lo[i] / 2;
      if (by > 0 && bx > 0) {
        const nb = (bp[(by - 1) * bw + bx] + 2 * bp[by * bw + bx - 1] + bp[(by - 1) * bw + bx - 1]) / 4;
        if (lo[i] < nb) t = nb;
      }
      bp[i] = t;
    }
    const out = new Uint8Array(w * h);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = by + dy, xx = bx + dx;
        if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
        sum += bp[yy * bw + xx]; n++;
      }
      const t = sum / n;
      const y1 = Math.min(h, by * B + B), x1 = Math.min(w, bx * B + B);
      for (let y = by * B; y < y1; y++) for (let x = bx * B; x < x1; x++)
        out[y * w + x] = grey[y * w + x] < t ? 1 : 0;
    }
    return out;
  }

  /* Run-length encode one line, then slide a five-run window over it. A
     finder is a dark run, a light run, a dark run three times as wide,
     and the mirror of the first two. */
  function scanLine(read, len) {
    const runs = [];
    let cur = read(0), start = 0;
    for (let i = 1; i <= len; i++) {
      const v = i < len ? read(i) : -1;
      if (v !== cur) { runs.push({ at: start, n: i - start, dark: cur === 1 }); cur = v; start = i; }
    }
    return runs;
  }
  function ratioAt(runs, i) {
    if (!runs[i] || !runs[i].dark || i + 4 >= runs.length) return 0;
    const s = [runs[i].n, runs[i + 1].n, runs[i + 2].n, runs[i + 3].n, runs[i + 4].n];
    const total = s[0] + s[1] + s[2] + s[3] + s[4];
    if (total < 7) return 0;
    const mod = total / 7, tol = mod * 0.6;
    if (Math.abs(mod - s[0]) >= tol || Math.abs(mod - s[1]) >= tol ||
        Math.abs(3 * mod - s[2]) >= 3 * tol || Math.abs(mod - s[3]) >= tol || Math.abs(mod - s[4]) >= tol) return 0;
    return mod;
  }

  function findFinders(bin, w, h) {
    const hits = [];
    const step = Math.max(1, Math.floor(h / 240));
    for (let y = 0; y < h; y += step) {
      const runs = scanLine(x => bin[y * w + x], w);
      for (let i = 0; i < runs.length; i++) {
        const mod = ratioAt(runs, i);
        if (!mod) continue;
        const cx = runs[i + 2].at + runs[i + 2].n / 2;
        const v = downCheck(bin, w, h, Math.round(cx), y, mod);
        if (v) hits.push(v);
      }
    }
    /* Cluster: every row across a finder produces a hit, and they are all
       the same finder. */
    const groups = [];
    for (const p of hits) {
      const g = groups.find(q => Math.abs(q.x - p.x) < q.mod * 2 && Math.abs(q.y - p.y) < q.mod * 2);
      if (g) { g.x = (g.x * g.n + p.x) / (g.n + 1); g.y = (g.y * g.n + p.y) / (g.n + 1); g.mod = (g.mod * g.n + p.mod) / (g.n + 1); g.n++; }
      else groups.push({ x: p.x, y: p.y, mod: p.mod, n: 1 });
    }
    return groups.filter(g => g.n >= 2).sort((a, b) => b.n - a.n);
  }

  /* Confirm a row hit by walking the same ratio down its column, and take
     the vertical centre from that walk — a horizontal scan alone cannot
     tell a finder from a run of text. */
  function downCheck(bin, w, h, x, y, mod) {
    if (x < 0 || x >= w) return null;
    const runs = scanLine(yy => bin[yy * w + x], h);
    let at = runs.findIndex(r => y >= r.at && y < r.at + r.n);
    if (at < 0) return null;
    for (const i of [at - 2, at, at - 4]) {
      if (i < 0) continue;
      const m = ratioAt(runs, i);
      if (!m || Math.abs(m - mod) > mod * 0.7) continue;
      const cy = runs[i + 2].at + runs[i + 2].n / 2;
      if (Math.abs(cy - y) > mod * 2.5) continue;
      return { x, y: cy, mod: (m + mod) / 2 };
    }
    return null;
  }

  /* An alignment pattern is a smaller signature — dark, light, dark — and
     it only has to be found near where the other three say it should be.
     Two things matter and both were learned the hard way: a candidate has
     to hold up DOWN its column as well as along its row, and when several
     survive, the one nearest the estimate is the one meant, not the first
     one the scan happens to reach. */
  function findAlignment(bin, w, h, ex, ey, mod) {
    const r = Math.ceil(mod * 5);
    /* A line through the CENTRE of an alignment pattern crosses five
       one-module runs: dark ring, light ring, dark centre, light ring,
       dark ring. The middle three are the reliable ones — the outer two
       can merge with whatever data module happens to sit beside them —
       so those are measured and the outer two only have to be dark.

       Matching three runs instead of five, which is the obvious thing to
       write, finds the pattern one module to the left of where it is.
       Under perspective that is enough to bend the whole grid. */
    const quintet = (runs, i) => {
      if (i < 0 || i + 4 >= runs.length || !runs[i].dark) return 0;
      const inner = [runs[i + 1].n, runs[i + 2].n, runs[i + 3].n];
      for (const v of inner) if (Math.abs(v - mod) > mod * 0.65) return 0;
      if (runs[i].n < mod * 0.4 || runs[i + 4].n < mod * 0.4) return 0;
      return (inner[0] + inner[1] + inner[2]) / 3;
    };
    /* Every survivor, nearest the estimate first. The estimate is affine
       and the picture may not be, so under a real tilt the true pattern
       can be six modules from where three finders say it should be —
       while a run of data modules two modules away looks just like one.
       Guessing between them is not necessary: hand the caller the short
       list and let the error correction pick. */
    const seen = [];
    for (let dy = -r; dy <= r; dy++) {
      const y = Math.round(ey + dy);
      if (y < 0 || y >= h) continue;
      const runs = scanLine(x => bin[y * w + x], w);
      for (let i = 0; i < runs.length; i++) {
        if (!quintet(runs, i)) continue;
        const cx = runs[i + 2].at + runs[i + 2].n / 2;
        if (Math.abs(cx - ex) > r) continue;
        const col = scanLine(yy => bin[yy * w + Math.round(cx)], h);
        const at = col.findIndex(run => y >= run.at && y < run.at + run.n);
        if (at < 2 || !quintet(col, at - 2)) continue;      // and it holds up downwards too
        const cy = col[at].at + col[at].n / 2;
        if (Math.abs(cy - ey) > r) continue;
        if (seen.some(s => Math.abs(s.x - cx) < mod && Math.abs(s.y - cy) < mod)) continue;
        seen.push({ x: cx, y: cy, d: Math.hypot(cx - ex, cy - ey) });
      }
    }
    return seen.sort((a, b) => a.d - b.d).slice(0, 3);
  }

  /* The unit square onto four points, and its inverse — enough to undo the
     angle a phone is held at. */
  function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (!den) return null;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
  }
  const matMul = (a, b) => [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
  const adjugate = m => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
  function quadToQuad(src, dst) {
    const s = squareToQuad(...src), d = squareToQuad(...dst);
    if (!s || !d) return null;
    return matMul(d, adjugate(s));
  }
  const apply = (m, x, y) => {
    const den = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / den, (m[3] * x + m[4] * y + m[5]) / den];
  };

  /* A cross rather than a 3×3 block. The diagonals of a block sit at
     0.35 of a module from the centre and, on a small code where a module
     is four pixels, they land in the neighbour — measurably worse. */
  const SAMPLES = [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25]];

  /* ---------- the whole way from pixels to a string ---------- */
  function readImage(rgba, w, h) {
    const grey = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < grey.length; i++, p += 4)
      grey[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    for (const invert of [false, true]) {
      const bin = binarize(grey, w, h);
      if (invert) for (let i = 0; i < bin.length; i++) bin[i] ^= 1;
      const got = readBinary(bin, w, h);
      if (got) return got;
    }
    return null;
  }

  function readBinary(bin, w, h) {
    const found = findFinders(bin, w, h);
    if (found.length < 3) return null;
    /* More than three candidates happens all the time — a logo, a window
       frame, the corner of another card. Rather than trust the ranking,
       try every triple of the strongest five, best-supported first. */
    const top = found.slice(0, 5), tries = [];
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) for (let k = j + 1; k < top.length; k++)
      tries.push([top[i], top[j], top[k]]);
    tries.sort((a, b) => (b[0].n + b[1].n + b[2].n) - (a[0].n + a[1].n + a[2].n));
    for (const three of tries) {
      const got = readTriple(bin, w, h, three);
      if (got) return got;
    }
    return null;
  }

  function readTriple(bin, w, h, pts) {
    const [p, q, r] = pts;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const pq = d(p, q), qr = d(q, r), rp = d(r, p);
    let tl, b1, b2;
    if (qr >= pq && qr >= rp) { tl = p; b1 = q; b2 = r; }
    else if (rp >= pq && rp >= qr) { tl = q; b1 = p; b2 = r; }
    else { tl = r; b1 = p; b2 = q; }
    const cross = (b1.x - tl.x) * (b2.y - tl.y) - (b1.y - tl.y) * (b2.x - tl.x);
    const tr = cross > 0 ? b1 : b2, bl = cross > 0 ? b2 : b1;

    const mod = (tl.mod + tr.mod + bl.mod) / 3;
    if (!(mod > 0.7)) return null;

    /* HOW BIG IS THE SYMBOL?

       The obvious answer — the distance between two finder centres over
       the module size — is only as good as the module size, and that is
       measured along the scan rows. Turn the phone 45° and a horizontal
       cut across a finder is √2 too wide, so the estimate is a fifth too
       small and every module afterwards is sampled in the wrong place.
       Perspective does the same thing more gently.

       There are only ten legal dimensions. Rather than trust one number,
       try the nearest few in order and let the format's BCH check and
       Reed–Solomon say which was right — they are already there, and
       they cannot be fooled by a plausible-looking wrong answer. */
    const raw = (d(tl, tr) / mod + d(tl, bl) / mod) / 2 + 7;
    const dims = [];
    for (let x = 21; x <= 57; x += 4) dims.push(x);
    dims.sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw));
    for (const dim of dims.slice(0, 4)) {
      const got = readAt(bin, w, h, tl, tr, bl, mod, dim);
      if (got) return got;
    }
    return null;
  }

  function readAt(bin, w, h, tl, tr, bl, mod, dim) {

    /* The fourth corner. With an alignment pattern it is measured; without
       one (version 1 has none) it is the parallelogram's opposite corner,
       which is exact when there is no perspective and close when there is
       little. */
    /* Two ways to pin the fourth corner, and no reason to bet on one:
       the measured alignment pattern (right when the phone is at an
       angle) and the parallelogram's opposite corner (right when it is
       not, and the only option at version 1). Try both and let the
       Reed–Solomon check say which was correct. */
    const brX = tr.x - tl.x + bl.x, brY = tr.y - tl.y + bl.y;
    const plans = [];
    if (dim > 21) {
      const k = 1 - 3 / (dim - 7);
      for (const al of findAlignment(bin, w, h, tl.x + k * (brX - tl.x), tl.y + k * (brY - tl.y), mod))
        plans.push([[3.5, 3.5, dim - 3.5, 3.5, dim - 6.5, dim - 6.5, 3.5, dim - 3.5],
                    [tl.x, tl.y, tr.x, tr.y, al.x, al.y, bl.x, bl.y]]);
    }
    plans.push([[3.5, 3.5, dim - 3.5, 3.5, dim - 3.5, dim - 3.5, 3.5, dim - 3.5],
                [tl.x, tl.y, tr.x, tr.y, brX, brY, bl.x, bl.y]]);

    for (const [src, dst] of plans) {
      const T = quadToQuad(src, dst);
      if (!T) continue;
      /* Sample five points per module and take the majority: one pixel is
         a hostage to noise, and five cost nothing. */
      const grid = [];
      let off = false;
      for (let row = 0; row < dim && !off; row++) {
        const line = new Uint8Array(dim);
        for (let col = 0; col < dim; col++) {
          let dark = 0, seen = 0;
          for (const [ox, oy] of SAMPLES) {
            const [x, y] = apply(T, col + 0.5 + ox, row + 0.5 + oy);
            const xi = Math.round(x), yi = Math.round(y);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
            seen++; dark += bin[yi * w + xi];
          }
          if (!seen) { off = true; break; }
          line[col] = dark * 2 > seen ? 1 : 0;
        }
        grid.push(line);
      }
      if (off) continue;
      const got = decodeMatrix((row, col) => grid[row][col], dim);
      if (got) return got;
    }
    return null;
  }

  /* ================= what a code points at =================

     Always an absolute https URL of a hash route, for one reason: the
     phone's own camera app has to be able to open it. A short opaque
     token would be tidier and would be useless in exactly the situation
     this feature exists for.

     Reading one back does the opposite journey and keeps only the hash.
     A code made on the preview deployment therefore still works when it
     is scanned from the production one — the station id is the same, and
     insisting on the host would only strand people. */
  const linkTo = hash => location.origin + location.pathname + (hash.startsWith('#') ? hash : '#' + hash);

  function routeOf(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (s.startsWith('#/')) return s;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hash && u.hash.startsWith('#/') ? u.hash : null;
  }

  /* A human-readable name for where a scanned code goes, so nobody is
     asked to follow a link they cannot read. */
  function describe(hash) {
    const h = String(hash || '');
    if (/^#\/osce\/station\/[^?]+\?[^]*\bai=1\b/.test(h)) return { what: 'OSCE in AI', icon: '✦' };
    if (/^#\/osce\/station\//.test(h)) return { what: 'An OSCE station', icon: '▶' };
    if (/^#\/osce\/ai\//.test(h)) return { what: 'An OSCE in AI session', icon: '✦' };
    if (/^#\/osce\/mark\//.test(h)) return { what: 'A marking sheet', icon: '✍️' };
    if (/^#\/osce\/real/.test(h)) return { what: 'A real station', icon: '🎧' };
    if (/^#\/cases\//.test(h)) return { what: 'A case', icon: '🧩' };
    if (/^#\/osce/.test(h)) return { what: 'The OSCE stations', icon: '▤' };
    return { what: 'A page in AUREUM', icon: '↗' };
  }

  /* ================= drawing the panel =================
     `card` is the small one that lives inside a dialog or beside the
     start button; `show` is the same code big enough to read across a
     desk. Both put the URL in text underneath, because a code nobody can
     scan should still be a link somebody can type. */
  function card(opts) {
    const o = opts || {};
    const url = o.url || linkTo(o.hash || '#/');
    let art = '';
    try { art = svg(url, { level: o.level || 'M', alt: o.alt || o.title || 'QR code' }); }
    catch { return ''; }
    /* The sweep is a child of the CARD, not of the plate, and the plate
       is painted over it. So the line runs behind the code and appears
       on either side of it — the effect without a bright bar lying
       across the modules at the moment somebody points a camera. */
    return `<div class="qc-card ${o.small ? 'is-small' : ''}" data-qc-url="${esc(url)}">
      <span class="qc-sweep" aria-hidden="true"></span>
      <div class="qc-plate">
        ${art}
        <span class="qc-bracket qc-tl" aria-hidden="true"></span><span class="qc-bracket qc-tr" aria-hidden="true"></span>
        <span class="qc-bracket qc-bl" aria-hidden="true"></span><span class="qc-bracket qc-br" aria-hidden="true"></span>
      </div>
      <div class="qc-say">
        <p class="qc-kicker">${esc(o.kicker || 'SCAN TO CONTINUE ON ANOTHER DEVICE')}</p>
        ${o.title ? `<p class="qc-title">${esc(o.title)}</p>` : ''}
        ${o.note ? `<p class="qc-note">${esc(o.note)}</p>` : ''}
        <button type="button" class="qc-copy" data-qc-copy>Copy the link</button>
      </div>
    </div>`;
  }

  /* Wire the copy buttons inside any host that contains cards. Idempotent:
     calling it twice does not double-fire. */
  function wire(host) {
    if (!host || host.__qcWired) return;
    host.__qcWired = true;
    host.addEventListener('click', async e => {
      const b = e.target.closest('[data-qc-copy]'); if (!b) return;
      const url = b.closest('[data-qc-url]')?.dataset.qcUrl; if (!url) return;
      const was = b.textContent;
      try { await navigator.clipboard.writeText(url); b.textContent = '✓ copied'; }
      catch { b.textContent = url; b.classList.add('is-bare'); return; }
      setTimeout(() => { b.textContent = was; }, 1800);
    });
  }

  function show(opts) {
    const o = opts || {};
    const url = o.url || linkTo(o.hash || '#/');
    document.querySelector('.qc-veil')?.remove();
    const el = document.createElement('div');
    el.className = 'qc-veil';
    el.innerHTML = `<div class="qc-veil-back" data-qc-x></div>
      <div class="qc-big" role="dialog" aria-modal="true" aria-label="${esc(o.title || 'QR code')}">
        <button class="qc-x" data-qc-x aria-label="Close">✕</button>
        ${card(Object.assign({}, o, { url }))}
        <p class="qc-url">${esc(url)}</p>
      </div>`;
    document.body.appendChild(el);
    wire(el);
    const shut = () => { el.remove(); window.removeEventListener('hashchange', shut); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') shut(); };
    el.querySelectorAll('[data-qc-x]').forEach(b => b.addEventListener('click', shut));
    window.addEventListener('hashchange', shut);
    document.addEventListener('keydown', key);
    return shut;
  }

  /* ================= the camera =================

     Three doors, tried in order, and the third is never locked:
       1. BarcodeDetector, where the browser has it
       2. the decoder above, on frames drawn to a canvas
       3. a box to paste or type the link into

     A scanner that can only fail one way is a scanner people stop
     trusting; this one always ends somewhere. */
  let detector = null, detectorTried = false;
  async function getDetector() {
    if (detectorTried) return detector;
    detectorTried = true;
    try {
      if (typeof BarcodeDetector === 'undefined') return null;
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats || !formats.includes('qr_code')) return null;
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch { detector = null; }
    return detector;
  }

  function scan(opts) {
    const o = opts || {};
    document.querySelector('.qc-scan')?.remove();
    const el = document.createElement('div');
    el.className = 'qc-scan';
    el.innerHTML = `
      <video class="qc-cam" playsinline muted autoplay></video>
      <div class="qc-shade" aria-hidden="true"></div>
      <div class="qc-reticle" aria-hidden="true">
        <span class="qc-r-tl"></span><span class="qc-r-tr"></span><span class="qc-r-bl"></span><span class="qc-r-br"></span>
        <span class="qc-r-line"></span>
      </div>
      <div class="qc-scan-head">
        <p class="qc-kicker">SCAN</p>
        <h3>Point it at a code</h3>
        <button class="qc-x" data-qc-x aria-label="Close">✕</button>
      </div>
      <div class="qc-scan-foot">
        <p class="qc-state" id="qc-state">Asking for the camera…</p>
        <div class="qc-hit" id="qc-hit" hidden></div>
        <details class="qc-manual">
          <summary>No camera? Paste the link instead</summary>
          <div class="qc-manual-row">
            <input type="text" id="qc-manual" placeholder="https://…#/osce/station/…" autocomplete="off" spellcheck="false">
            <button class="btn btn-gold btn-sm" id="qc-manual-go">Open</button>
          </div>
        </details>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('qc-scanning');

    const video = el.querySelector('.qc-cam');
    const state = el.querySelector('#qc-state');
    const hit = el.querySelector('#qc-hit');
    const canvas = document.createElement('canvas');
    let stream = null, raf = 0, stopped = false, busy = false, last = 0;

    const shut = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach(t => t.stop()); } catch {}
      el.remove();
      document.body.classList.remove('qc-scanning');
      window.removeEventListener('hashchange', shut);
      document.removeEventListener('keydown', key);
    };
    const key = e => { if (e.key === 'Escape') shut(); };
    el.querySelectorAll('[data-qc-x]').forEach(b => b.addEventListener('click', shut));
    window.addEventListener('hashchange', shut);
    document.addEventListener('keydown', key);

    /* A hit freezes the picture and says where it goes. One tap opens it —
       a scanner that navigates on its own is a scanner that takes you
       somewhere you did not choose when a poster walks past the lens. */
    const landed = text => {
      const hash = routeOf(text);
      if (!hash) {
        state.textContent = 'That code is not an AUREUM link.';
        state.className = 'qc-state is-bad';
        setTimeout(() => { if (!stopped) { state.textContent = 'Point it at a code'; state.className = 'qc-state'; } }, 2200);
        return false;
      }
      cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach(t => t.stop()); } catch {}
      try { navigator.vibrate?.(60); } catch {}
      const d = describe(hash);
      el.classList.add('is-hit');
      state.hidden = true;
      hit.hidden = false;
      hit.innerHTML = `<p class="qc-hit-what"><span>${esc(d.icon)}</span> ${esc(d.what)}</p>
        <p class="qc-hit-url">${esc(hash)}</p>
        <div class="qc-hit-acts">
          <button class="btn btn-primary" id="qc-go">Open it →</button>
          <button class="btn btn-ghost" id="qc-again">Scan another</button>
        </div>`;
      hit.querySelector('#qc-go').addEventListener('click', () => {
        shut();
        if (location.hash === hash) { try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch {} }
        location.hash = hash;
        if (o.onOpen) try { o.onOpen(hash); } catch {}
      });
      hit.querySelector('#qc-again').addEventListener('click', () => { shut(); scan(o); });
      return true;
    };

    el.querySelector('#qc-manual-go').addEventListener('click', () => {
      const v = el.querySelector('#qc-manual').value;
      if (!landed(v)) return;
    });

    const tick = async () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const now = Date.now();
      if (busy || now - last < 110) return;                 // ~9 looks a second is plenty
      if (!video.videoWidth) return;
      busy = true; last = now;
      try {
        const det = await getDetector();
        if (det) {
          const found = await det.detect(video);
          if (found && found.length && found[0].rawValue) { if (landed(found[0].rawValue)) return; }
        } else {
          const W = 480, H = Math.round(W * video.videoHeight / video.videoWidth) || 360;
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, W, H);
          const px = ctx.getImageData(0, 0, W, H);
          const got = readImage(px.data, W, H);
          if (got && got.text) { if (landed(got.text)) return; }
        }
      } catch { /* one bad frame is not an error; the next one is 110ms away */ }
      finally { busy = false; }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        state.textContent = 'Point it at a code';
        raf = requestAnimationFrame(tick);
      } catch (err) {
        el.classList.add('is-nocam');
        state.className = 'qc-state is-bad';
        state.textContent = /NotAllowedError|Permission/i.test(String(err && err.name))
          ? 'The camera was blocked. Allow it in the address bar, or paste the link below.'
          : 'No camera here. Paste the link below instead — or use the phone’s own camera app on the code.';
        el.querySelector('.qc-manual').open = true;
      }
    })();

    return shut;
  }

  const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>
      <rect x="7" y="7" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/>
      <path d="M13 7h4v4M7 17h4v-4"/></svg>`;

  return { encode, svg, penalty, frame, walk, decodeMatrix, readImage, binarize,
    card, show, wire, scan, linkTo, routeOf, describe, ICON,
    // test seam: the geometry, so a test can paint a symbol through the
    // same perspective a phone would see it through
    quadToQuad, apply,
    _gf: { mul, div, EXP, LOG, remainder, genPoly }, _tbl: TBL, _align: ALIGN, _masks: MASKS, _fmt: formatBits, _ver: versionBits };
})();
