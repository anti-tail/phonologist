/* phonologist: vowel charts (IPA quadrilateral, plain/simple/rectangle/triangle, formant plot) */
(function (global) {
  'use strict';
  const K = global.PhonoKit;

  // IPA chart positions: h = height (0 close … 1 open), b = backness (0 front … 1 back)
  // r: rounded; nodot: written without a dot on the IPA chart
  const IPA = {
    i: [0, 0, 0], y: [0, 0, 1], ɨ: [0, 0.5, 0], ʉ: [0, 0.5, 1], ɯ: [0, 1, 0], u: [0, 1, 1],
    ɪ: [1 / 6, 0.25, 0, 1], ʏ: [1 / 6, 0.25, 1, 1], ʊ: [1 / 6, 0.75, 1, 1],
    e: [1 / 3, 0, 0], ø: [1 / 3, 0, 1], ɘ: [1 / 3, 0.5, 0], ɵ: [1 / 3, 0.5, 1], ɤ: [1 / 3, 1, 0], o: [1 / 3, 1, 1],
    ə: [0.5, 0.5, 0, 1],
    ɛ: [2 / 3, 0, 0], œ: [2 / 3, 0, 1], ɜ: [2 / 3, 0.5, 0], ɞ: [2 / 3, 0.5, 1], ʌ: [2 / 3, 1, 0], ɔ: [2 / 3, 1, 1],
    æ: [5 / 6, 0, 0, 1], ɐ: [5 / 6, 0.5, 0, 1],
    a: [1, 0, 0], ɶ: [1, 0, 1], ɑ: [1, 1, 0], ɒ: [1, 1, 1],
  };

  const HEIGHT = {
    close: 0, 'near-close': 1 / 6, 'close-mid': 1 / 3, mid: 0.5, 'open-mid': 2 / 3, 'near-open': 5 / 6, open: 1,
    high: 0, 'mid-high': 1 / 3, 'mid-low': 2 / 3, low: 1,
    狭: 0, 準狭: 1 / 6, 半狭: 1 / 3, 中: 0.5, 半広: 2 / 3, 準広: 5 / 6, 広: 1,
  };
  const BACK = {
    front: 0, 'near-front': 0.25, central: 0.5, 'near-back': 0.75, back: 1,
    前舌: 0, 準前舌: 0.25, 中舌: 0.5, 準後舌: 0.75, 後舌: 1,
  };
  const ROUND = { rounded: 1, unrounded: 0, 円唇: 1, 非円唇: 0, 平唇: 0 };

  const SHAPES = ['ipa', 'plain', 'simple', 'rectangle', 'triangle', 'formant'];

  // IPA diacritics that move a vowel on the chart (combining and spacing forms)
  const STEP_H = 0.1, STEP_B = 0.12;
  const DIACRITICS = {
    '\u031D': (p) => { p.h -= STEP_H; }, '\u02D4': (p) => { p.h -= STEP_H; },   // raised  e̝ e˔
    '\u031E': (p) => { p.h += STEP_H; }, '\u02D5': (p) => { p.h += STEP_H; },   // lowered e̞ e˕
    '\u031F': (p) => { p.b -= STEP_B; }, '\u02D6': (p) => { p.b -= STEP_B; },   // advanced ɯ̟ ɯ˖
    '\u0320': (p) => { p.b += STEP_B; }, '\u02D7': (p) => { p.b += STEP_B; },   // retracted i̠ i˗
    '\u0308': (p) => { p.b += (0.5 - p.b) * 0.5; },                              // centralized ë
    '\u033D': (p) => { p.b += (0.5 - p.b) * 0.5; p.h += (0.5 - p.h) * 0.5; },    // mid-centralized e̽
  };
  const clamp = (x) => Math.max(0, Math.min(1, x));

  // split a symbol into its base letter and the diacritics that move it
  function analyse(sym) {
    const d = sym.normalize('NFD');
    const base = IPA[sym] ? sym : d[0];
    const marks = [...(IPA[sym] ? '' : d.slice(1))].filter((c) => DIACRITICS[c]);
    return { base, marks };
  }
  function applyMarks(p, marks) {
    for (const m of marks) DIACRITICS[m](p);
    p.h = clamp(p.h); p.b = clamp(p.b);
  }

  function parse(src) {
    const errors = [];
    const P = { shape: 'ipa', vowels: [], arrows: [], opts: new Set(), title: '', caption: '' };
    const byKey = new Map();
    const add = (v) => { const k = v.sym; if (byKey.has(k)) Object.assign(byKey.get(k), v); else { byKey.set(k, v); P.vowels.push(v); } };
    src.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([^:：]+?)\s*[:：]\s?(.*)$/);
      const where = `${i + 1} 行目`;
      if (!m) { errors.push(`${where}は「名前: 内容」の形になっていません。`); return; }
      const key = K.unesc(m[1].trim()), k = key.toLowerCase(), body = m[2].trim();
      if (k === 'chart' || k === 'shape' || key === '図') {
        const s = body.toLowerCase();
        if (!SHAPES.includes(s)) errors.push(`${where}: 図の形は ${SHAPES.join(' / ')} のどれかです。`);
        else P.shape = s;
      } else if (k === 'option' || k === 'options' || key === '設定') body.split(/[\s,]+/).filter(Boolean).forEach((w) => P.opts.add(w.toLowerCase()));
      else if (k === 'title' || key === '題') P.title = body;
      else if (k === 'caption' || k === 'gloss' || key === '注') P.caption = body;
      else if (k === 'vowels' || key === '母音') {
        for (const sym of body.split(/\s+/).filter(Boolean).map(K.unesc)) {
          const { base, marks } = analyse(sym);
          const pos = IPA[base];
          if (!pos) { errors.push(`${where}: 「${sym}」の位置が分かりません。「${sym}: close-mid central」のように書いてください。`); continue; }
          const v = { sym, h: pos[0], b: pos[1], r: pos[2], nodot: !!pos[3], fromIPA: true };
          applyMarks(v, marks);
          add(v);
        }
      } else if (k === 'arrow' || k === 'arrows' || k === 'path' || k === 'shift' || key === '矢印') {
        const toks = body.split(/\s+/).filter(Boolean);
        for (let j = 0; j + 2 < toks.length; j += 2) {
          const kind = toks[j + 1];
          if (!['>', '~>', '-', '->', '→'].includes(kind)) { errors.push(`${where}: 矢印は a > e、a ~> e、a - e のように書いてください。`); break; }
          P.arrows.push({ from: K.unesc(toks[j]), to: K.unesc(toks[j + 2]), kind: kind === '~>' ? 'dash' : kind === '-' ? 'line' : 'arrow', line: i });
        }
      } else {
        // a vowel with its own position: words, "h b" in 0–1, or "F1 F2" in Hz
        const words = body.split(/[\s,]+/).filter(Boolean);
        const tweaks = [];
        const isNum = (w) => /^-?\d+(\.\d+)?%?$/.test(w);
        const num = (w) => (w.endsWith('%') ? parseFloat(w) / 100 : parseFloat(w));
        const nums = words.filter(isNum).map(num);
        const v = { sym: key };
        let exact = false;
        if (nums.length >= 2) {
          if (nums[0] > 2 || nums[1] > 2) { v.f1 = nums[0]; v.f2 = nums[1]; }
          else { v.h = nums[0]; v.b = nums[1]; exact = true; }
        }
        for (const w of words) {
          const lw = w.toLowerCase();
          const tw = lw.match(/^([hb]|高さ|前後)([=+-])(\d*\.?\d+)(%?)$/);
          if (tw) {
            const axis = tw[1] === 'h' || tw[1] === '高さ' ? 'h' : 'b';
            const val = parseFloat(tw[3]) / (tw[4] ? 100 : 1);
            tweaks.push([axis, tw[2], val]);
            continue;
          }
          if (isNum(w)) continue;
          if (lw in HEIGHT || w in HEIGHT) v.h = HEIGHT[lw] ?? HEIGHT[w];
          else if (lw in BACK || w in BACK) v.b = BACK[lw] ?? BACK[w];
          else if (lw in ROUND || w in ROUND) v.r = ROUND[lw] ?? ROUND[w];
          else if (lw === 'dot') v.dot = true;
          else if (lw === 'nodot') v.nodot = true;
          else errors.push(`${where}: 「${w}」が分かりません。close / close-mid / front / back / rounded や h+0.05 などで書いてください。`);
        }
        const { base, marks } = analyse(key);
        const ipa = IPA[base];
        if (v.h === undefined && ipa) v.h = ipa[0];
        if (v.b === undefined && ipa) v.b = ipa[1];
        if (v.r === undefined && ipa && v.f1 === undefined) v.r = ipa[2];
        if (v.f1 === undefined && (v.h === undefined || v.b === undefined)) { errors.push(`${where}: 「${key}」の高さと前後の位置が足りません。`); return; }
        // diacritics move a vowel from its named cell, but not from a position given in numbers
        if (v.f1 === undefined && !exact) applyMarks(v, marks);
        for (const [axis, op, val] of tweaks) {
          if (v.f1 !== undefined) { errors.push(`${where}: フォルマント図では h や b での調整は使えません。`); break; }
          if (op === '=') v[axis] = val; else if (op === '+') v[axis] += val; else v[axis] -= val;
          v[axis] = clamp(v[axis]);
        }
        add(v);
      }
    });
    for (const a of P.arrows) {
      for (const s of [a.from, a.to]) if (!byKey.has(s)) errors.push(`${a.line + 1} 行目: 矢印の「${s}」が母音の中にありません。`);
    }
    P.byKey = byKey;
    return { P, errors };
  }

  // ---------------------------------------------------------------- layout

  function niceStep(range, target) {
    const raw = range / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function layout(parsed, o) {
    const { P } = parsed;
    const S = o.size;
    const items = [];
    const lw = o.lw;
    const ja = P.opts.has('ja') || P.opts.has('日本語');
    const labels = !P.opts.has('no-labels');
    const three = P.opts.has('three');
    const symSize = S;
    const labSize = S * 0.55;
    const muted = o.ink;

    if (P.shape === 'formant') return layoutFormant(parsed, o);

    const u = S * 2.3;
    const W = 4 * u, H = 3 * u;
    let pt;
    if (P.shape === 'rectangle') pt = (h, b) => [b * W, h * H];
    else if (P.shape === 'triangle') pt = (h, b) => { const half = (1 - h) * W / 2; return [W / 2 + (b - 0.5) * 2 * half, h * H]; };
    else pt = (h, b) => { const xl = h * W / 2; return [xl + b * (W - xl), h * H]; };

    const L = (a, b, dash) => items.push({ type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: lw, dash: dash || null });
    // a faint guide grid for reading fine positions: every 1/12 of the height, every 1/8 of the depth
    if (P.opts.has('fine')) {
      const faint = '#d3d7de';
      const G = (a, b2, strong) => items.push({ type: 'line', x1: a[0], y1: a[1], x2: b2[0], y2: b2[1], w: lw * (strong ? 0.55 : 0.35), color: faint });
      for (let k = 1; k < 12; k++) G(pt(k / 12, 0), pt(k / 12, 1), k % 2 === 0);
      for (let k = 1; k < 8; k++) G(pt(0, k / 8), pt(1, k / 8), k % 2 === 0);
    }
    const levels = three ? [0.5] : [1 / 3, 2 / 3];
    // outline
    if (P.shape === 'triangle') { L(pt(0, 0), pt(0, 1)); L(pt(0, 0), pt(1, 0.5)); L(pt(0, 1), pt(1, 0.5)); }
    else { L(pt(0, 0), pt(0, 1)); L(pt(0, 1), pt(1, 1)); L(pt(1, 1), pt(1, 0)); L(pt(1, 0), pt(0, 0)); }
    if (P.shape !== 'plain') {
      for (const h of levels) L(pt(h, 0), pt(h, 1));
      if (P.shape === 'ipa' || P.shape === 'rectangle' || P.shape === 'triangle') L(pt(0, 0.5), pt(1, 0.5));
    }

    // axis labels
    if (labels) {
      const back = ja ? ['前舌', '中舌', '後舌'] : ['Front', 'Central', 'Back'];
      const heights = three
        ? (ja ? [[0, '狭'], [0.5, '中'], [1, '広']] : [[0, 'Close'], [0.5, 'Mid'], [1, 'Open']])
        : (ja ? [[0, '狭'], [1 / 3, '半狭'], [2 / 3, '半広'], [1, '広']] : [[0, 'Close'], [1 / 3, 'Close-mid'], [2 / 3, 'Open-mid'], [1, 'Open']]);
      [0, 0.5, 1].forEach((b, i) => {
        const [x, y] = pt(0, b);
        const m = K.measure(o, back[i], labSize, false);
        items.push({ ...K.textItem(x - m.w / 2, y - S * 0.95, labSize, back[i]), color: muted });
      });
      for (const [h, t] of heights) {
        const [x, y] = pt(h, 0);
        const m = K.measure(o, t, labSize, false);
        items.push({ ...K.textItem(x - m.w - S * 1.35, y + (m.asc - m.desc) / 2, labSize, t), color: muted });
      }
    }

    // vowels: a dot where IPA puts one; unrounded to the left, rounded to the right
    const pos = new Map();
    const cell = new Map();
    const placed = P.vowels.filter((v) => v.h !== undefined && v.b !== undefined);
    for (const v of placed) { const key = v.h.toFixed(3) + ',' + v.b.toFixed(3); if (!cell.has(key)) cell.set(key, []); cell.get(key).push(v); }
    const dotR = S * 0.085;
    const forceDots = P.opts.has('dots'), noDots = P.opts.has('no-dots');
    for (const v of placed) {
      const [x, y] = pt(v.h, v.b);
      const key = v.h.toFixed(3) + ',' + v.b.toFixed(3);
      const mates = cell.get(key);
      const m = K.measure(o, v.sym, symSize, false);
      const hasR = v.r !== undefined;
      const dot = !noDots && (v.dot || forceDots || (hasR && !v.nodot));
      if (dot && !items.some((it) => it.dotKey === key)) items.push({ type: 'ellipse', cx: x, cy: y, rx: dotR, ry: dotR, fill: true, stroke: false, dotKey: key });
      // the symbol sits beside its dot with a small, constant gap
      const gapX = S * 0.2;
      let tx;
      if (!dot || !hasR) tx = x - m.w / 2;
      else if (v.r) tx = x + gapX;
      else tx = x - gapX - m.w;
      if (!dot && hasR && mates.length > 1) tx = v.r ? x + gapX * 0.6 : x - gapX * 0.6 - m.w;
      items.push(K.textItem(tx, y + (m.asc - m.desc) / 2, symSize, v.sym));
      pos.set(v.sym, { x, y, tx, w: m.w, dot });
    }

    drawArrows(P, items, pos, o);
    caption(P, items, o, W);
    return K.finish(items, [], o);
  }

  function drawArrows(P, items, pos, o) {
    const S = o.size;
    for (const a of P.arrows) {
      const A = pos.get(a.from), B = pos.get(a.to);
      if (!A || !B) continue;
      // start and end at the symbols (their centres), trimmed so the line clears the letters
      const ax = A.dot ? A.x : A.tx + A.w / 2, ay = A.y;
      const bx = B.dot ? B.x : B.tx + B.w / 2, by = B.y;
      const d = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / d, uy = (by - ay) / d;
      const trim = S * 0.42;
      const x1 = ax + ux * trim, y1 = ay + uy * trim, x2 = bx - ux * trim, y2 = by - uy * trim;
      const head = S * 0.26;
      const tipped = a.kind !== 'line';
      items.push({ type: 'line', x1, y1, x2: tipped ? x2 - ux * head * 0.6 : x2, y2: tipped ? y2 - uy * head * 0.6 : y2, w: o.lw, dash: a.kind === 'dash' ? [S * 0.16, S * 0.11] : null, link: true });
      if (tipped) {
        const px = -uy, py = ux;
        items.push({ type: 'poly', pts: [[x2, y2], [x2 - ux * head + px * head * 0.42, y2 - uy * head + py * head * 0.42], [x2 - ux * head * 0.78, y2 - uy * head * 0.78], [x2 - ux * head - px * head * 0.42, y2 - uy * head - py * head * 0.42]] });
      }
    }
  }

  function caption(P, items, o, W) {
    const S = o.size;
    if (P.title) {
      const runs = K.runsOf(P.title);
      const m = K.measureRuns(o, runs, S * 0.8);
      items.push({ type: 'text', x: W / 2 - m.w / 2, y: -S * 1.9, size: S * 0.8, runs });
    }
    if (P.caption) {
      const b = K.bounds(items, o);
      const runs = K.runsOf(P.caption);
      const m = K.measureRuns(o, runs, S * 0.75);
      items.push({ type: 'text', x: (b.x0 + b.x1) / 2 - m.w / 2, y: b.y1 + S * 0.8 + m.asc, size: S * 0.75, runs });
    }
  }

  // ---------------------------------------------------------------- formant plot (F2 to the left, F1 downwards)

  const bark = (f) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);

  function layoutFormant(parsed, o) {
    const { P } = parsed;
    const S = o.size;
    const items = [];
    const pts = P.vowels.filter((v) => v.f1 !== undefined);
    const useBark = P.opts.has('bark');
    const tr = useBark ? bark : (f) => f;
    const f1s = pts.map((v) => v.f1), f2s = pts.map((v) => v.f2);
    let f1lo = Math.min(...f1s, 250), f1hi = Math.max(...f1s, 800), f2lo = Math.min(...f2s, 700), f2hi = Math.max(...f2s, 2400);
    const s1 = niceStep(f1hi - f1lo, 5), s2 = niceStep(f2hi - f2lo, 5);
    f1lo = Math.floor((f1lo - s1 * 0.3) / s1) * s1; f1hi = Math.ceil((f1hi + s1 * 0.3) / s1) * s1;
    f2lo = Math.floor((f2lo - s2 * 0.3) / s2) * s2; f2hi = Math.ceil((f2hi + s2 * 0.3) / s2) * s2;
    const W = S * 11, H = S * 8;
    const X = (f2) => (tr(f2hi) - tr(f2)) / (tr(f2hi) - tr(f2lo)) * W;
    const Y = (f1) => (tr(f1) - tr(f1lo)) / (tr(f1hi) - tr(f1lo)) * H;
    const grid = '#c9ced6';
    const lab = S * 0.5;
    // frame
    items.push({ type: 'rect', x: 0, y: 0, w: W, h: H, stroke: true, sw: o.lw });
    for (let f = Math.ceil(f2lo / s2) * s2; f <= f2hi + 1e-6; f += s2) {
      const x = X(f);
      if (x > 0.5 && x < W - 0.5) items.push({ type: 'line', x1: x, y1: 0, x2: x, y2: H, w: o.lw * 0.5, color: grid });
      const t = String(Math.round(f)), m = K.measure(o, t, lab, false);
      items.push(K.textItem(x - m.w / 2, -S * 0.3, lab, t));
    }
    for (let f = Math.ceil(f1lo / s1) * s1; f <= f1hi + 1e-6; f += s1) {
      const y = Y(f);
      if (y > 0.5 && y < H - 0.5) items.push({ type: 'line', x1: 0, y1: y, x2: W, y2: y, w: o.lw * 0.5, color: grid });
      const t = String(Math.round(f)), m = K.measure(o, t, lab, false);
      items.push(K.textItem(W + S * 0.3, y + (m.asc - m.desc) / 2, lab, t));
    }
    const t2 = useBark ? 'F2 (Hz, Bark 尺度)' : 'F2 (Hz)', t1 = 'F1 (Hz)';
    const m2 = K.measure(o, t2, lab * 1.1, false), m1 = K.measure(o, t1, lab * 1.1, false);
    items.push(K.textItem(W / 2 - m2.w / 2, -S * 1.15, lab * 1.1, t2));
    items.push(K.textItem(W + S * 0.3, H + S * 0.9, lab * 1.1, t1));
    void m1;

    const pos = new Map();
    const r = S * 0.08;
    for (const v of pts) {
      const x = X(v.f2), y = Y(v.f1);
      items.push({ type: 'ellipse', cx: x, cy: y, rx: r, ry: r, fill: true, stroke: false });
      const m = K.measure(o, v.sym, S, false);
      const tx = x + S * 0.2;
      items.push(K.textItem(tx, y - S * 0.15, S, v.sym));
      pos.set(v.sym, { x, y, tx, w: m.w, dot: true });
    }
    drawArrows(P, items, pos, o);
    caption(P, items, o, W);
    return K.finish(items, [], o);
  }

  function textOf(parsed) {
    const P = parsed.P;
    return 'FrontCentralBackCloseOpenmid-0123456789前舌中舌後舌狭半広()HzBark尺度' + P.title + P.caption + P.vowels.map((v) => v.sym).join('');
  }

  global.Vowel = { parse, layout, textOf };
})(window);
