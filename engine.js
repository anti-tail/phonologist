/* phonologist engine: parse → layout → render (SVG / canvas) */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- parse

  function parseElem(tok) {
    const e = { text: tok.text, star: false, circle: false, empty: false };
    if (tok.quoted) return e;
    let t = tok.text;
    if (t === '_') { e.empty = true; e.text = ''; return e; }
    if (t.length > 1 && t[0] === '*') { e.star = true; t = t.slice(1); }
    const c = t.match(/^\((.+)\)$/);
    if (c) { e.circle = true; t = c[1]; }
    e.text = t;
    return e;
  }

  function tokenize(body) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(body))) {
      out.push(m[1] !== undefined ? { text: m[1], quoted: true } : { text: m[2] });
    }
    return out.map(parseElem);
  }

  const LINK_RE = /^([^\d,]*?)(\d+(?:,\d+)*)([-~.x])([^\d,]*?)(\d+(?:,\d+)*)$/;

  function newFrame(arrow) {
    return { tiers: [], links: [], linkLines: [], label: '', gloss: '', arrow: arrow || null };
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const frames = [];
    const errors = [];
    let cur = newFrame();
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const a = line.match(/^(->|→|=>|⇒)\s*(.*)$/);
      if (a) {
        frames.push(cur);
        cur = newFrame({ double: a[1] === '=>' || a[1] === '⇒', text: a[2] });
        return;
      }
      const m = line.match(/^([^:：]+?)\s*[:：]\s?(.*)$/);
      if (!m) { errors.push(`${i + 1} 行目は「名前: 内容」の形になっていません。`); return; }
      const key = m[1];
      const k = key.toLowerCase();
      const body = m[2];
      if (k === 'label' || key === '番号') cur.label = body.trim();
      else if (k === 'gloss' || key === '語釈') cur.gloss = body.trim();
      else if (k === 'link' || key === '連結') cur.linkLines.push({ line: i, body });
      else cur.tiers.push({ name: key, line: i, elems: tokenize(body) });
    });
    frames.push(cur);
    frames.forEach((f) => resolveLinks(f, errors));
    return { frames, errors };
  }

  function resolveLinks(f, errors) {
    const byName = new Map(f.tiers.map((t, i) => [t.name, i]));
    for (const ll of f.linkLines) {
      for (const tok of ll.body.split(/\s+/).filter(Boolean)) {
        const m = tok.match(LINK_RE);
        const where = `${ll.line + 1} 行目`;
        if (!m) { errors.push(`${where}の「${tok}」を連結として読めません。1-2 や T1-S2 のように書いてください。`); continue; }
        const [, an, ai, st, bn, bi] = m;
        let ta, tb;
        if (!an && !bn) { ta = 0; tb = 1; }
        else {
          ta = an ? byName.get(an) : 0;
          tb = bn ? byName.get(bn) : 1;
          if (ta === undefined) { errors.push(`${where}: 「${an}」という名前の層がありません。`); continue; }
          if (tb === undefined) { errors.push(`${where}: 「${bn}」という名前の層がありません。`); continue; }
        }
        if (ta === tb) { errors.push(`${where}の「${tok}」は同じ層どうしをつないでいます。`); continue; }
        if (!f.tiers[ta] || !f.tiers[tb]) { errors.push(`${where}: 連結するには層が 2 つ以上必要です。`); continue; }
        for (const x of ai.split(',')) {
          for (const y of bi.split(',')) {
            let ia = +x - 1, ib = +y - 1;
            if (ia < 0 || ia >= f.tiers[ta].elems.length) { errors.push(`${where}: ${f.tiers[ta].name} の層に ${x} 番目の要素がありません。`); continue; }
            if (ib < 0 || ib >= f.tiers[tb].elems.length) { errors.push(`${where}: ${f.tiers[tb].name} の層に ${y} 番目の要素がありません。`); continue; }
            let A = { t: ta, i: ia }, B = { t: tb, i: ib };
            if (A.t > B.t) [A, B] = [B, A];
            const old = f.links.find((l) => l.ta === A.t && l.ia === A.i && l.tb === B.t && l.ib === B.i);
            if (old) old.style = st;
            else f.links.push({ ta: A.t, ia: A.i, tb: B.t, ib: B.i, style: st });
          }
        }
      }
    }
  }

  function crossings(f) {
    const out = [];
    const L = f.links.filter((l) => l.style !== 'x');
    for (let a = 0; a < L.length; a++) {
      for (let b = a + 1; b < L.length; b++) {
        const p = L[a], q = L[b];
        if (p.ta !== q.ta || p.tb !== q.tb) continue;
        if ((p.ia - q.ia) * (p.ib - q.ib) < 0) out.push([p, q]);
      }
    }
    return out;
  }

  function serializeLinks(f) {
    const groups = new Map();
    for (const l of f.links) {
      const k = l.ta + ':' + l.tb;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    const lines = [];
    const keys = [...groups.keys()].sort((a, b) => {
      const [a1, a2] = a.split(':').map(Number), [b1, b2] = b.split(':').map(Number);
      return a1 - b1 || a2 - b2;
    });
    for (const k of keys) {
      const ls = groups.get(k).slice().sort((p, q) => p.ia - q.ia || p.ib - q.ib);
      const short = ls[0].ta === 0 && ls[0].tb === 1;
      const na = short ? '' : f.tiers[ls[0].ta].name;
      const nb = short ? '' : f.tiers[ls[0].tb].name;
      const toks = [];
      let i = 0;
      while (i < ls.length) {
        let j = i;
        const targets = [ls[i].ib + 1];
        while (j + 1 < ls.length && ls[j + 1].ia === ls[i].ia && ls[j + 1].style === ls[i].style) { j++; targets.push(ls[j].ib + 1); }
        toks.push(`${na}${ls[i].ia + 1}${ls[i].style}${nb}${targets.join(',')}`);
        i = j + 1;
      }
      lines.push('link: ' + toks.join(' '));
    }
    return lines;
  }

  // ---------------------------------------------------------------- measure

  const mctx = document.createElement('canvas').getContext('2d');

  function fontStr(o, size, italic) {
    return `${italic ? 'italic ' : ''}${size}px ${o.family}`;
  }

  function measure(o, text, size, italic) {
    mctx.font = fontStr(o, size, italic);
    const m = mctx.measureText(text);
    return { w: m.width, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
  }

  // "*italic*" markup → runs
  function runsOf(text) {
    const runs = [];
    const re = /\*([^*]+)\*/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index), italic: false });
      runs.push({ text: m[1], italic: true });
      last = re.lastIndex;
    }
    if (last < text.length) runs.push({ text: text.slice(last), italic: false });
    return runs;
  }

  function measureRuns(o, runs, size) {
    let w = 0, asc = 0, desc = 0;
    for (const r of runs) {
      const m = measure(o, r.text, size, r.italic);
      r.w = m.w; w += m.w; asc = Math.max(asc, m.asc); desc = Math.max(desc, m.desc);
    }
    return { w, asc, desc };
  }

  // ---------------------------------------------------------------- layout

  function layoutFrame(f, o) {
    const S = o.size;
    const gap = o.gap * S;
    const minGap = Math.max(gap * 0.5, S * 0.2);
    const T = f.tiers;
    const items = [];
    const hits = [];

    // measure elements
    for (const t of T) {
      for (const e of t.elems) {
        if (e.empty) { e.w = S * 0.6; e.asc = S * 0.7; e.desc = 0; }
        else { Object.assign(e, measure(o, e.text, S, false)); }
        e.bw = e.w;
        if (e.circle) {
          e.ry = (e.asc + e.desc) / 2 + S * 0.2;
          e.rx = Math.max(e.w / 2 + S * 0.22, e.ry);
          e.bw = e.rx * 2;
        }
        e.x = undefined;
      }
    }

    // base tier: the one with most elements (the lower one on ties)
    let base = 0;
    T.forEach((t, i) => { if (t.elems.length >= T[base].elems.length) base = i; });

    let x = 0;
    T[base].elems.forEach((e, i) => {
      if (i > 0) x += gap;
      e.x = x + e.bw / 2;
      x += e.bw;
    });
    const placed = new Set([base]);

    const placeTier = (ti, ref) => {
      const els = T[ti].elems;
      const sums = els.map(() => ({ s: 0, n: 0 }));
      for (const l of f.links) {
        let mine, other;
        if (l.ta === ti && placed.has(l.tb)) { mine = l.ia; other = T[l.tb].elems[l.ib]; }
        else if (l.tb === ti && placed.has(l.ta)) { mine = l.ib; other = T[l.ta].elems[l.ia]; }
        else continue;
        sums[mine].s += other.x; sums[mine].n++;
      }
      const def = [];
      els.forEach((e, i) => { if (sums[i].n) { e.x = sums[i].s / sums[i].n; def.push(i); } });
      const step = (a, b) => (a.bw + b.bw) / 2 + gap;
      if (!def.length) {
        const total = els.reduce((s, e) => s + e.bw, 0) + gap * Math.max(0, els.length - 1);
        const r = T[ref].elems;
        const center = r.length ? (r[0].x + r[r.length - 1].x) / 2 : 0;
        let xx = center - total / 2;
        els.forEach((e) => { e.x = xx + e.bw / 2; xx += e.bw + gap; });
      } else {
        for (let i = def[0] - 1; i >= 0; i--) els[i].x = els[i + 1].x - step(els[i], els[i + 1]);
        for (let i = def[def.length - 1] + 1; i < els.length; i++) els[i].x = els[i - 1].x + step(els[i - 1], els[i]);
        for (let k = 0; k + 1 < def.length; k++) {
          const a = def[k], b = def[k + 1];
          for (let i = a + 1; i < b; i++) els[i].x = els[a].x + (els[b].x - els[a].x) * (i - a) / (b - a);
        }
      }
      for (let i = 1; i < els.length; i++) {
        const min = els[i - 1].x + (els[i - 1].bw + els[i].bw) / 2 + minGap;
        if (els[i].x < min) els[i].x = min;
      }
      placed.add(ti);
    };
    for (let ti = base - 1; ti >= 0; ti--) placeTier(ti, ti + 1);
    for (let ti = base + 1; ti < T.length; ti++) placeTier(ti, ti - 1);

    // vertical
    const star = measure(o, '*', S * 0.75, false);
    let y = 0;
    for (const t of T) {
      const real = t.elems.filter((e) => !e.empty);
      const src = real.length ? real : t.elems;
      t.asc = Math.max(...src.map((e) => e.asc), S * 0.3);
      t.desc = Math.max(...src.map((e) => e.desc), 0);
      const circ = t.elems.filter((e) => e.circle);
      const extraUp = Math.max(0, ...circ.map((e) => e.ry - (e.asc + e.desc) / 2 + e.asc - t.asc));
      const extraDown = Math.max(0, ...circ.map((e) => e.ry - (e.asc + e.desc) / 2 + e.desc - t.desc));
      const starH = t.elems.some((e) => e.star) ? (star.asc + star.desc) + S * 0.15 : 0;
      t.top = y;
      t.base = y + starH + extraUp + t.asc;
      t.bottom = t.base + t.desc + extraDown;
      y = t.bottom + o.tier * S;
    }
    const coreBottom = T.length ? T[T.length - 1].bottom : 0;

    // items
    const pad = S * 0.12;
    T.forEach((t, ti) => {
      t.elems.forEach((e, ei) => {
        if (!e.empty) items.push({ type: 'text', x: e.x - e.w / 2, y: t.base, size: S, runs: [{ text: e.text, italic: false, w: e.w }] });
        if (e.circle) {
          e.cy = t.base + (e.desc - e.asc) / 2;
          items.push({ type: 'ellipse', cx: e.x, cy: e.cy, rx: e.rx, ry: e.ry });
        }
        if (e.star) {
          const top = e.circle ? e.cy - e.ry : t.base - t.asc;
          const by = top - S * 0.1 - star.desc;
          e.starTop = by - star.asc;
          items.push({ type: 'text', x: e.x - star.w / 2, y: by, size: S * 0.75, runs: [{ text: '*', italic: false, w: star.w }] });
        }
        hits.push({ t: ti, i: ei, x: e.x - e.bw / 2, y: t.base - t.asc, w: e.bw, h: t.asc + t.desc });
      });
    });

    const lw = o.lw;
    for (const l of f.links) {
      const A = T[l.ta], B = T[l.tb];
      const ea = A.elems[l.ia], eb = B.elems[l.ib];
      const x1 = ea.x, x2 = eb.x;
      const y1 = ea.circle ? ea.cy + ea.ry + pad * 0.6 : A.base + A.desc + pad;
      let y2 = eb.circle ? eb.cy - eb.ry - pad * 0.6 : B.base - B.asc - pad;
      if (eb.star) y2 = eb.starTop - pad * 1.6;
      let dash = null;
      if (l.style === '~') dash = [S * 0.16, S * 0.11];
      else if (l.style === '.') dash = [0.01, Math.max(lw * 2.6, S * 0.1)];
      items.push({ type: 'line', x1, y1, x2, y2, dash, w: lw, link: true });
      if (l.style === 'x') {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const half = S * 0.21, off = S * 0.075;
        items.push({ type: 'line', x1: mx - half, y1: my - off, x2: mx + half, y2: my - off, w: lw, link: true });
        items.push({ type: 'line', x1: mx - half, y1: my + off, x2: mx + half, y2: my + off, w: lw, link: true });
      }
    }

    // bbox
    let x0 = Infinity, x1 = -Infinity;
    for (const t of T) for (const e of t.elems) { x0 = Math.min(x0, e.x - e.bw / 2); x1 = Math.max(x1, e.x + e.bw / 2); }
    if (!isFinite(x0)) { x0 = 0; x1 = 0; }
    return { items, hits, x0, x1, coreBottom };
  }

  function shift(items, dx, dy) {
    for (const it of items) {
      if (it.type === 'line') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
      else if (it.type === 'ellipse') { it.cx += dx; it.cy += dy; }
      else if (it.type === 'poly') { it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]); }
      else { it.x += dx; it.y += dy; }
    }
  }

  function layout(parsed, o) {
    const S = o.size;
    const frames = parsed.frames.map((f, fi) => ({ f, fi })).filter(({ f }) => f.tiers.length);
    const items = [];
    const hits = [];
    if (!frames.length) return { items, hits, width: 0, height: 0, empty: true };

    const L = frames.map(({ f }) => layoutFrame(f, o));
    const coreH = Math.max(...L.map((l) => l.coreBottom));
    const mid = coreH / 2;
    const anyGloss = frames.some(({ f }) => f.gloss);
    const glossSize = S * 0.85;
    let glossAsc = 0;
    const glossRuns = frames.map(({ f }) => {
      if (!f.gloss) return null;
      const runs = runsOf(f.gloss);
      const m = measureRuns(o, runs, glossSize);
      glossAsc = Math.max(glossAsc, m.asc);
      return { runs, m };
    });
    const glossY = coreH + S * 0.95 + glossAsc;

    let x = 0;
    frames.forEach(({ f, fi }, k) => {
      const lay = L[k];
      if (k > 0) {
        const arrow = f.arrow || {};
        const cap = arrow.text ? runsOf(arrow.text) : null;
        const capSize = S * 0.6;
        const cm = cap ? measureRuns(o, cap, capSize) : { w: 0 };
        const len = Math.max(S * 1.5, cm.w + S * 0.5);
        const ax0 = x + S * 0.7, ax1 = ax0 + len;
        const head = S * 0.28;
        if (arrow.double) {
          const off = S * 0.07;
          items.push({ type: 'line', x1: ax0, y1: mid - off, x2: ax1 - head * 0.6, y2: mid - off, w: o.lw });
          items.push({ type: 'line', x1: ax0, y1: mid + off, x2: ax1 - head * 0.6, y2: mid + off, w: o.lw });
        } else {
          items.push({ type: 'line', x1: ax0, y1: mid, x2: ax1 - head * 0.5, y2: mid, w: o.lw });
        }
        items.push({ type: 'poly', pts: [[ax1, mid], [ax1 - head, mid - head * 0.42], [ax1 - head * 0.78, mid], [ax1 - head, mid + head * 0.42]] });
        if (cap) items.push({ type: 'text', x: (ax0 + ax1) / 2 - cm.w / 2, y: mid - S * 0.3, size: capSize, runs: cap });
        x = ax1 + S * 0.7;
      }
      if (f.label) {
        const runs = runsOf(f.label);
        const m = measureRuns(o, runs, S);
        items.push({ type: 'text', x, y: mid + (m.asc - m.desc) / 2, size: S, runs });
        x += m.w + S * 0.7;
      }
      const dx = x - lay.x0;
      shift(lay.items, dx, 0);
      items.push(...lay.items);
      for (const h of lay.hits) hits.push({ ...h, x: h.x + dx, f: fi });
      const center = (lay.x0 + lay.x1) / 2 + dx;
      let right = lay.x1 + dx;
      const g = glossRuns[k];
      if (g) {
        const gx = center - g.m.w / 2;
        items.push({ type: 'text', x: gx, y: glossY, size: glossSize, runs: g.runs });
        if (gx < 0) { /* handled by bbox */ }
        right = Math.max(right, gx + g.m.w);
      }
      x = right;
    });

    // bbox over everything
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const grow = (a, b, c, d) => { bx0 = Math.min(bx0, a); by0 = Math.min(by0, b); bx1 = Math.max(bx1, c); by1 = Math.max(by1, d); };
    for (const it of items) {
      if (it.type === 'line') grow(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2));
      else if (it.type === 'ellipse') grow(it.cx - it.rx, it.cy - it.ry, it.cx + it.rx, it.cy + it.ry);
      else if (it.type === 'poly') for (const [px, py] of it.pts) grow(px, py, px, py);
      else {
        const m = measureRuns(o, it.runs.map((r) => ({ ...r })), it.size);
        grow(it.x, it.y - m.asc, it.x + m.w, it.y + m.desc);
      }
    }
    for (const h of hits) grow(h.x, h.y, h.x + h.w, h.y + h.h);
    const M = Math.round(S * 0.5);
    const dx = M - bx0, dy = M - by0;
    shift(items, dx, dy);
    for (const h of hits) { h.x += dx; h.y += dy; }
    return { items, hits, width: Math.ceil(bx1 - bx0 + 2 * M), height: Math.ceil(by1 - by0 + 2 * M), anyGloss };
  }

  // ---------------------------------------------------------------- render

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => +v.toFixed(2);

  function toSVG(lay, o, extra = {}) {
    const W = lay.width, H = lay.height;
    const ink = o.ink, line = extra.lineColor || ink;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    if (extra.fontCSS) s += `<defs><style>${extra.fontCSS}</style></defs>`;
    if (!o.transparent && !extra.noBackground) s += `<rect width="${W}" height="${H}" fill="${o.bg || '#ffffff'}"/>`;
    s += `<g font-family="${esc(o.family)}" fill="${ink}">`;
    for (const it of lay.items) {
      if (it.type === 'text') {
        s += `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${n(it.size)}" xml:space="preserve">`;
        for (const r of it.runs) s += r.italic ? `<tspan font-style="italic">${esc(r.text)}</tspan>` : esc(r.text);
        s += '</text>';
      } else if (it.type === 'line') {
        const c = it.link ? line : ink;
        s += `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${c}" stroke-width="${n(it.w)}" stroke-linecap="round"${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`;
      } else if (it.type === 'ellipse') {
        s += `<ellipse cx="${n(it.cx)}" cy="${n(it.cy)}" rx="${n(it.rx)}" ry="${n(it.ry)}" fill="none" stroke="${ink}" stroke-width="${n(o.lw)}"/>`;
      } else if (it.type === 'poly') {
        s += `<polygon points="${it.pts.map(([x, y]) => n(x) + ',' + n(y)).join(' ')}" fill="${ink}"/>`;
      }
    }
    s += '</g>';
    if (extra.hits) {
      s += '<g class="hits">';
      for (const h of lay.hits) {
        s += `<rect class="hit" data-f="${h.f}" data-t="${h.t}" data-i="${h.i}" x="${n(h.x - 3)}" y="${n(h.y - 3)}" width="${n(h.w + 6)}" height="${n(h.h + 6)}" rx="3"/>`;
      }
      s += '</g>';
    }
    return s + '</svg>';
  }

  function toCanvas(lay, o, scale) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(lay.width * scale);
    c.height = Math.ceil(lay.height * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    if (!o.transparent) { g.fillStyle = o.bg || '#ffffff'; g.fillRect(0, 0, lay.width, lay.height); }
    g.fillStyle = o.ink; g.strokeStyle = o.ink; g.lineCap = 'round';
    for (const it of lay.items) {
      if (it.type === 'text') {
        let x = it.x;
        g.textBaseline = 'alphabetic';
        for (const r of it.runs) {
          g.font = fontStr(o, it.size, r.italic);
          g.fillText(r.text, x, it.y);
          x += g.measureText(r.text).width;
        }
      } else if (it.type === 'line') {
        g.lineWidth = it.w;
        g.setLineDash(it.dash || []);
        g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke();
        g.setLineDash([]);
      } else if (it.type === 'ellipse') {
        g.lineWidth = o.lw;
        g.beginPath(); g.ellipse(it.cx, it.cy, it.rx, it.ry, 0, 0, Math.PI * 2); g.stroke();
      } else if (it.type === 'poly') {
        g.beginPath();
        it.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath(); g.fill();
      }
    }
    return c;
  }

  function textOf(parsed) {
    let s = '*';
    for (const f of parsed.frames) {
      s += f.label + f.gloss + (f.arrow && f.arrow.text ? f.arrow.text : '');
      for (const t of f.tiers) for (const e of t.elems) s += e.text;
    }
    return s;
  }

  global.Autoseg = { parse, layout, toSVG, toCanvas, crossings, serializeLinks, textOf, runsOf };
})(window);
