/* phonologist engine: parse → layout → render (SVG / canvas)
 *
 * A frame is a vertical stack of rows, in the order they are written:
 *   tier   T: H L            elements joined by association lines
 *   grid   grid line 1: (x x) metrical / bracketed grid rows over a tier
 *   tree   tree: [ [.s s w ] ] metrical or prosodic tree over (or under) a tier
 */
(function (global) {
  'use strict';

  const OPENERS = '([{<';
  const CLOSERS = ')]}>';
  const BRACKETS = OPENERS + CLOSERS;

  // ---------------------------------------------------------------- escapes
  // \* \_ \( \) \[ \] \" \\ write the character itself (e.g. \*kata for a reconstructed form)

  const unesc = (s) => s.replace(/\\(.)/g, '$1');

  // ---------------------------------------------------------------- parse: tiers

  function parseElem(tok) {
    const e = { text: unesc(tok.text), star: false, circle: false, empty: false };
    if (tok.quoted) return e;
    let t = tok.text;
    // inline labelled bracket: [  ]  [_α  ]_α  [_α=id
    const b = t.match(/^([\[\]])(?:_([^=\s]+))?(?:=(\S+))?$/);
    if (b) return { isBracket: true, text: b[1], open: b[1] === '[', sub: b[2] || '', id: b[3] || '' };
    if (t === '_') { e.empty = true; e.text = ''; return e; }
    if (t.length > 1 && t[0] === '*') { e.star = true; t = t.slice(1); }
    const c = t.match(/^\((.+)\)$/);
    if (c) { e.circle = true; t = c[1]; }
    e.text = unesc(t);
    return e;
  }

  function tokenize(body) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|((?:\\.|\S)+)/g;
    let m;
    while ((m = re.exec(body))) {
      out.push(m[1] !== undefined ? { text: m[1], quoted: true } : { text: m[2] });
    }
    return out.map(parseElem);
  }

  // ---------------------------------------------------------------- parse: grid rows

  function parseGridRow(body) {
    const toks = body.trim().split(/\s+/).filter(Boolean);
    if (toks.length && toks.every((t) => /^\d+$/.test(t))) return { heights: toks.map(Number) };
    const units = [];
    for (const tok of toks) {
      let i = 0;
      while (i < tok.length) {
        const ch = tok[i];
        if (BRACKETS.includes(ch)) {
          let j = i + 1, sub = '';
          if (tok[j] === '_') {
            j++;
            const s = j;
            while (j < tok.length && !BRACKETS.includes(tok[j])) j++;
            sub = tok.slice(s, j);
          }
          units.push({ br: ch, sub, open: OPENERS.includes(ch) });
          i = j;
        } else {
          let j = i;
          while (j < tok.length && !BRACKETS.includes(tok[j])) j += tok[j] === '\\' ? 2 : 1;
          const raw = tok.slice(i, j);
          units.push({ mark: raw === '.' || raw === '_' ? '' : unesc(raw) });
          i = j;
        }
      }
    }
    const cols = [];
    let pending = [];
    for (const u of units) {
      if (u.mark !== undefined) {
        cols.push({ mark: u.mark, pre: pending, post: [] });
        pending = [];
      } else if (u.open) pending.push(u);
      else if (cols.length) cols[cols.length - 1].post.push(u);
      else pending.push(u);
    }
    if (pending.length && cols.length) cols[cols.length - 1].post.push(...pending);
    return { cols };
  }

  // ---------------------------------------------------------------- parse: trees

  function splitId(s) {
    const m = s.match(/^(.*?)(?:=([^=\s]+))?$/);
    return { label: unesc(m[1]), id: m[2] || '' };
  }

  function parseTree(body) {
    const toks = body.match(/\[|\]|[^\s\[\]]+/g) || [];
    let p = 0;
    function node() {
      p++;
      const n = { children: [], label: '', id: '' };
      const t = toks[p];
      if (t && t !== '[' && t !== ']' && t[0] === '.' && t.length > 1) { Object.assign(n, splitId(t.slice(1))); p++; }
      while (p < toks.length && toks[p] !== ']') {
        if (toks[p] === '[') n.children.push(node());
        else {
          const tk = toks[p++];
          n.children.push({ leaf: true, ...(tk === '.' || tk === '_' ? { label: '', id: '' } : splitId(tk)) });
        }
      }
      if (toks[p] !== ']') throw new Error('閉じる ] が足りません');
      p++;
      if (!n.children.length) throw new Error('中身のない [ ] があります');
      return n;
    }
    if (toks[0] !== '[') throw new Error('[ で始めてください');
    const root = node();
    if (p < toks.length) throw new Error('] のあとに余分な文字があります');
    return root;
  }

  function leavesOf(n, out = []) {
    if (n.leaf) out.push(n);
    else n.children.forEach((c) => leavesOf(c, out));
    return out;
  }

  // ---------------------------------------------------------------- parse: frames

  const LINK_RE = /^([^\d,@]*?)(\d+(?:,\d+)*)([-~.x])([^\d,@]*?)(\d+(?:,\d+)*)$/;
  const NODE_RE = /^([^\d,@]*?)(\d+(?:,\d+)*)([-~.x])@([^\s,]+(?:,[^\s,]+)*)$/;

  // relations between forms: written alone on a line between two frames
  const OP_RE = /^(<->|<=>|->|=>|<-|>>|↔|⇔|→|⇒|←|≫|>|<|≠|=|≡|≈|~|∼|〜)(?=\s|$)\s*(.*)$/;
  const OP_NORM = { '<->': '↔', '<=>': '⇔', '->': '→', '=>': '⇒', '<-': '←', '>>': '≫', '~': '∼', '〜': '∼' };
  const ARROWS = { '→': { dir: 1 }, '⇒': { dir: 1, double: true }, '←': { dir: -1 }, '↔': { dir: 2 }, '⇔': { dir: 2, double: true } };

  const isEmptyFrame = (f) => !f.rows.length && !f.label && !f.gloss && !f.linkLines.length;

  function newFrame(arrow) {
    return { tiers: [], rows: [], links: [], nodeLinks: [], linkLines: [], label: '', gloss: '', arrow: arrow || null, opts: new Set() };
  }

  function parse(src) {
    const lines = src.split(/\r?\n/);
    const frames = [];
    const errors = [];
    let cur = newFrame();
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      if (/^(-{3,}|\/\/)$/.test(line)) {
        if (!isEmptyFrame(cur)) frames.push(cur);
        cur = newFrame();
        cur.newRow = true;
        return;
      }
      const a = line.match(OP_RE);
      if (a) {
        const op = { sym: OP_NORM[a[1]] || a[1], text: a[2] };
        if (isEmptyFrame(cur)) cur.arrow = op;
        else { frames.push(cur); cur = newFrame(op); }
        return;
      }
      const m = line.match(/^([^:：]+?)\s*[:：]\s?(.*)$/);
      if (!m) { errors.push(`${i + 1} 行目は「名前: 内容」の形になっていません。`); return; }
      const key = m[1];
      const k = key.toLowerCase();
      const body = m[2];
      const where = `${i + 1} 行目`;
      if (k === 'label' || key === '番号') cur.label = body.trim();
      else if (k === 'gloss' || key === '語釈') cur.gloss = body.trim();
      else if (k === 'link' || key === '連結') cur.linkLines.push({ line: i, body });
      else if (k === 'form' || k === 'text' || key === '語形') cur.rows.push({ kind: 'text', text: unesc(body.trim()) });
      else if (k === 'option' || k === 'options' || key === '設定') body.split(/[\s,]+/).filter(Boolean).forEach((w) => cur.opts.add(w.toLowerCase()));
      else if (/^grid(\s|$)/i.test(key) || /^格子(\s|$)/.test(key)) {
        const label = key.replace(/^(grid|格子)\s*/i, '');
        const row = parseGridRow(body);
        const prev = cur.rows[cur.rows.length - 1];
        const block = prev && prev.kind === 'grid' && !prev.closed ? prev : { kind: 'grid', rows: [], line: i };
        if (block !== prev) cur.rows.push(block);
        if (row.heights) {
          const max = Math.max(...row.heights);
          for (let r = max; r >= 1; r--) block.rows.push({ label: r === max ? label : '', cols: row.heights.map((h) => ({ mark: h >= r ? 'x' : '', pre: [], post: [] })), line: i });
        } else block.rows.push({ label, cols: row.cols, line: i });
      } else if (/^tree(-below|\s+below)?$/i.test(key) || key === '樹形' || key === '樹形下') {
        try {
          const root = parseTree(body);
          cur.rows.push({ kind: 'tree', root, below: /below|下/.test(key), line: i });
        } catch (e) { errors.push(`${where}の樹形: ${e.message}`); }
      } else {
        const all = tokenize(body);
        const t = { name: key, line: i, all, elems: all.filter((e) => !e.isBracket) };
        cur.tiers.push(t);
        cur.rows.push({ kind: 'tier', tier: t, ti: cur.tiers.length - 1 });
      }
      // close an open grid block when anything else comes in between
      const last = cur.rows[cur.rows.length - 1];
      cur.rows.forEach((r) => { if (r.kind === 'grid' && r !== last) r.closed = true; });
    });
    frames.push(cur);
    frames.forEach((f) => { resolveStructures(f, errors); resolveLinks(f, errors); });
    return { frames, errors };
  }

  // attach grids and trees to the tier they stand on
  function resolveStructures(f, errors) {
    const R = f.rows;
    const tierIdx = (from, step) => {
      for (let j = from; j >= 0 && j < R.length; j += step) if (R[j].kind === 'tier') return R[j].ti;
      return -1;
    };
    f.nodes = new Map();
    R.forEach((r, j) => {
      if (r.kind === 'tier' || r.kind === 'text') return;
      let c;
      if (r.kind === 'tree' && r.below) { c = tierIdx(j - 1, -1); if (c < 0) c = tierIdx(j + 1, 1); }
      else { c = tierIdx(j + 1, 1); if (c < 0) { c = tierIdx(j - 1, -1); if (r.kind === 'tree') r.below = true; } }
      r.carrier = c;
      const where = `${r.line + 1} 行目`;
      if (c < 0) { errors.push(`${where}: 格子や樹形の下に置く層がありません。`); r.bad = true; return; }
      const n = f.tiers[c].elems.length;
      if (r.kind === 'grid') {
        for (const row of r.rows) {
          if (row.cols.length !== n) {
            errors.push(`${row.line + 1} 行目の格子は ${row.cols.length} 列ですが、${f.tiers[c].name} の層の要素は ${n} 個です。`);
            r.bad = true;
          }
        }
      } else {
        const leaves = leavesOf(r.root);
        if (leaves.length !== n) {
          errors.push(`${where}の樹形の葉は ${leaves.length} 個ですが、${f.tiers[c].name} の層の要素は ${n} 個です。`);
          r.bad = true;
        }
        const walk = (nd) => { if (nd.id) f.nodes.set(nd.id, { kind: 'tree', node: nd, row: r }); if (!nd.leaf) nd.children.forEach(walk); };
        walk(r.root);
      }
    });
    f.tiers.forEach((t) => t.all.forEach((e) => { if (e.isBracket && e.id) f.nodes.set(e.id, { kind: 'bracket', el: e, tier: t }); }));
  }

  function resolveLinks(f, errors) {
    const byName = new Map(f.tiers.map((t, i) => [t.name, i]));
    for (const ll of f.linkLines) {
      for (const tok of ll.body.split(/\s+/).filter(Boolean)) {
        const where = `${ll.line + 1} 行目`;
        const nm = tok.match(NODE_RE);
        if (nm) {
          const [, an, ai, st, ids] = nm;
          const ta = an ? byName.get(an) : 0;
          if (ta === undefined || !f.tiers[ta]) { errors.push(`${where}: 「${an || '1 層目'}」の層がありません。`); continue; }
          for (const x of ai.split(',')) {
            const ia = +x - 1;
            if (ia < 0 || ia >= f.tiers[ta].elems.length) { errors.push(`${where}: ${f.tiers[ta].name} の層に ${x} 番目の要素がありません。`); continue; }
            for (const id of ids.split(',')) {
              if (!f.nodes.has(id)) { errors.push(`${where}: @${id} という名前の節点や括弧がありません。`); continue; }
              const old = f.nodeLinks.find((l) => l.ta === ta && l.ia === ia && l.id === id);
              if (old) old.style = st; else f.nodeLinks.push({ ta, ia, id, style: st });
            }
          }
          continue;
        }
        const m = tok.match(LINK_RE);
        if (!m) { errors.push(`${where}の「${tok}」を連結として読めません。1-2 や T1-S2、1-@id のように書いてください。`); continue; }
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
            const ia = +x - 1, ib = +y - 1;
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
    if (f.nodeLinks.length) {
      const toks = f.nodeLinks.map((l) => `${l.ta === 0 ? '' : f.tiers[l.ta].name}${l.ia + 1}${l.style}@${l.id}`);
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

  // "*italic*" markup → runs; "\*" is a literal asterisk; a lone "*" with no partner stays literal
  function runsOf(text) {
    const runs = [];
    let buf = '', italic = false;
    const flush = () => { if (buf) runs.push({ text: buf, italic }); buf = ''; };
    const closerAfter = (i) => {
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === '*') return true;
      }
      return false;
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\' && i + 1 < text.length) { buf += text[++i]; continue; }
      if (c === '*' && (italic || closerAfter(i))) { flush(); italic = !italic; continue; }
      buf += c;
    }
    flush();
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

  const textItem = (x, y, size, text, italic) => ({ type: 'text', x, y, size, runs: [{ text, italic: !!italic }] });

  // a bracket glyph with an optional subscript label; returns its width
  function bracketBox(o, b, sub, S) {
    const g = measure(o, b, S, false);
    const s = sub ? measure(o, sub, S * 0.6, false) : { w: 0 };
    return { gw: g.w, sw: s.w, w: g.w + (sub ? s.w + S * 0.02 : 0) };
  }
  function bracketItems(o, x, base, b, sub, S) {
    const bx = bracketBox(o, b, sub, S);
    const out = [textItem(x, base, S, b)];
    if (sub) out.push(textItem(x + bx.gw + S * 0.02, base + S * 0.2, S * 0.6, sub));
    return out;
  }

  // ---------------------------------------------------------------- layout: one frame

  function layoutFrame(f, o) {
    const S = o.size;
    const gap = o.gap * S;
    const minGap = Math.max(gap * 0.5, S * 0.2);
    const T = f.tiers;
    const items = [];
    const hits = [];
    const pad = S * 0.12;
    const lw = o.lw;
    const brPad = S * 0.12;

    // ---- measure tier contents
    for (const t of T) {
      for (const e of t.all) {
        if (e.isBracket) { const b = bracketBox(o, e.text, e.sub, S); e.w = b.w; e.bw = b.w; const m = measure(o, e.text, S, false); e.asc = m.asc; e.desc = m.desc; continue; }
        if (e.empty) { e.w = S * 0.6; e.asc = S * 0.7; e.desc = 0; }
        else Object.assign(e, measure(o, e.text, S, false));
        // a reconstruction asterisk hangs to the left: lines meet the form itself
        e.pre = !e.empty && e.text.length > 1 && e.text[0] === '*' ? measure(o, '*', S, false).w : 0;
        e.bw = e.w + e.pre;
        if (e.circle) {
          e.ry = (e.asc + e.desc) / 2 + S * 0.2;
          e.rx = Math.max(e.w / 2 + S * 0.22, e.ry);
          e.bw = e.rx * 2;
        }
        e.x = undefined;
      }
      // bracket runs: width that has to fit before element i (index into elems)
      t.runs = [];
      let run = [];
      let k = 0;
      for (const e of t.all) {
        if (e.isBracket) run.push(e);
        else { t.runs[k++] = run; run = []; }
      }
      t.runs[k] = run; // trailing
      t.extra = t.runs.map((r) => r.reduce((s, e) => s + e.w + brPad, 0));
    }

    // grid marks can be wider than their column element (e.g. "*x"); widen columns
    const gridRows = f.rows.filter((r) => r.kind === 'grid' && !r.bad);
    for (const g of gridRows) {
      const t = T[g.carrier];
      for (const row of g.rows) {
        row.cols.forEach((c, i) => {
          const mw = c.mark ? measure(o, c.mark, S * 0.9, false).w : 0;
          const bw = [...c.pre, ...c.post].reduce((s, u) => s + bracketBox(o, u.br, u.sub, S * 0.9).w + brPad, 0);
          const e = t.elems[i];
          if (e) e.bw = Math.max(e.bw, mw);
          if (e && bw) t.extra[i] = Math.max(t.extra[i], bw * 0.6);
        });
      }
    }

    // ---- horizontal placement of tiers
    let base = 0;
    T.forEach((t, i) => { if (t.elems.length >= T[base].elems.length) base = i; });

    const between = (t, i) => t.extra[i] || 0; // brackets before element i
    if (T.length) {
      const t = T[base];
      let x = between(t, 0);
      t.elems.forEach((e, i) => {
        if (i > 0) x += gap + between(t, i);
        e.x = x + e.bw / 2;
        x += e.bw;
      });
    }
    const placed = new Set([base]);

    const nodeX = new Map(); // id -> x, filled once trees are laid out

    const placeTier = (ti, ref, withNodes) => {
      const t = T[ti];
      const els = t.elems;
      const sums = els.map(() => ({ s: 0, n: 0 }));
      for (const l of f.links) {
        let mine, other;
        if (l.ta === ti && placed.has(l.tb)) { mine = l.ia; other = T[l.tb].elems[l.ib]; }
        else if (l.tb === ti && placed.has(l.ta)) { mine = l.ib; other = T[l.ta].elems[l.ia]; }
        else continue;
        sums[mine].s += other.x; sums[mine].n++;
      }
      if (withNodes) {
        for (const l of f.nodeLinks) {
          if (l.ta !== ti || !nodeX.has(l.id)) continue;
          sums[l.ia].s += nodeX.get(l.id); sums[l.ia].n++;
        }
      }
      const def = [];
      els.forEach((e, i) => { if (sums[i].n) { e.x = sums[i].s / sums[i].n; def.push(i); } else e.x = undefined; });
      const step = (i) => (els[i - 1].bw + els[i].bw) / 2 + gap + between(t, i);
      if (!def.length) {
        const total = els.reduce((s, e) => s + e.bw, 0) + els.slice(1).reduce((s, e, i) => s + gap + between(t, i + 1), 0);
        const r = T[ref] ? T[ref].elems : [];
        const center = r.length ? (r[0].x + r[r.length - 1].x) / 2 : 0;
        let xx = center - total / 2;
        els.forEach((e, i) => { if (i > 0) xx += gap + between(t, i); e.x = xx + e.bw / 2; xx += e.bw; });
      } else {
        for (let i = def[0] - 1; i >= 0; i--) els[i].x = els[i + 1].x - step(i + 1);
        for (let i = def[def.length - 1] + 1; i < els.length; i++) els[i].x = els[i - 1].x + step(i);
        for (let k = 0; k + 1 < def.length; k++) {
          const a = def[k], b = def[k + 1];
          for (let i = a + 1; i < b; i++) els[i].x = els[a].x + (els[b].x - els[a].x) * (i - a) / (b - a);
        }
      }
      for (let i = 1; i < els.length; i++) {
        const min = els[i - 1].x + (els[i - 1].bw + els[i].bw) / 2 + minGap + between(t, i);
        if (els[i].x < min) els[i].x = min;
      }
      placed.add(ti);
    };
    for (let ti = base - 1; ti >= 0; ti--) placeTier(ti, ti + 1, false);
    for (let ti = base + 1; ti < T.length; ti++) placeTier(ti, ti - 1, false);

    // ---- trees: x positions (depend only on their carrier)
    const treeRows = f.rows.filter((r) => r.kind === 'tree' && !r.bad);
    const nodeLabelSize = S * 0.85;
    const computeTreeX = () => {
      for (const r of treeRows) {
        const leaves = leavesOf(r.root);
        leaves.forEach((lf, i) => { lf.x = T[r.carrier].elems[i].x; });
        const rec = (n) => {
          if (n.leaf) { n.h = 0; return; }
          n.children.forEach(rec);
          n.h = 1 + Math.max(...n.children.map((c) => c.h));
          n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
        };
        rec(r.root);
        const walk = (n) => { if (n.id) nodeX.set(n.id, n.x); if (!n.leaf) n.children.forEach(walk); };
        walk(r.root);
      }
    };
    computeTreeX();

    // ---- brackets inside tiers: attach to neighbouring elements
    const placeBrackets = () => {
      for (const t of T) {
        t.runs.forEach((run, i) => {
          if (!run.length) return;
          const prev = t.elems[i - 1], next = t.elems[i];
          const closers = run.filter((e) => !e.open), openers = run.filter((e) => e.open);
          if (!prev) openers.unshift(...closers.splice(0));
          if (!next) closers.push(...openers.splice(0));
          if (prev) { let cx = prev.x + prev.bw / 2 + brPad; for (const e of closers) { e.x = cx + e.w / 2; cx += e.w + brPad; } }
          if (next) { let cx = next.x - next.bw / 2 - brPad; for (let j = openers.length - 1; j >= 0; j--) { const e = openers[j]; cx -= e.w; e.x = cx + e.w / 2; cx -= brPad; } }
        });
        t.all.forEach((e) => { if (e.isBracket && e.id) nodeX.set(e.id, e.x); });
      }
    };
    placeBrackets();

    // second pass: tiers linked to tree nodes or brackets follow them
    const nodeTiers = new Set(f.nodeLinks.map((l) => l.ta));
    if (nodeTiers.size) {
      for (const ti of nodeTiers) { if (ti === base) continue; placed.delete(ti); placeTier(ti, ti === 0 ? 1 : ti - 1, true); }
      computeTreeX();
      placeBrackets();
    }

    // ---- vertical layout, row by row in written order
    const star = measure(o, '*', S * 0.75, false);
    const gridSize = S * 0.9;
    const gm = measure(o, 'x()', gridSize, false);
    const gridLines = f.opts.has('gridlines') || f.opts.has('lines');
    const rowGap = gridLines ? S * 0.8 : S * 0.16;
    const level = Math.max(S * 1.5, o.tier * S * 0.9);
    const nl = measure(o, 'swσωμFtAP', nodeLabelSize, false);

    const spacing = (a, b) => {
      if (a.kind === 'text' || b.kind === 'text') return S * 0.45;
      if (a.kind === 'tier' && b.kind === 'tier') return o.tier * S;
      if (a.kind === 'grid' || b.kind === 'grid') return gridLines ? S * 0.5 : S * 0.25;
      const tree = a.kind === 'tree' ? a : b, tier = a.kind === 'tier' ? a : b;
      if (tree.carrier === tier.ti) return S * 0.18; // a tree hugs the tier it stands on
      return o.tier * S * 0.8; // a tier whose tones link into the tree
    };

    let y = 0;
    f.rows.forEach((r, j) => {
      if (j > 0) y += spacing(f.rows[j - 1], r);
      if (r.kind === 'tier') {
        const t = r.tier;
        const real = t.elems.filter((e) => !e.empty);
        const src = real.length ? real : t.all;
        t.asc = Math.max(...src.map((e) => e.asc), S * 0.3);
        t.desc = Math.max(...src.map((e) => e.desc), 0);
        const circ = t.elems.filter((e) => e.circle);
        const extraUp = Math.max(0, ...circ.map((e) => e.ry - (e.asc + e.desc) / 2 + e.asc - t.asc));
        const extraDown = Math.max(0, ...circ.map((e) => e.ry - (e.asc + e.desc) / 2 + e.desc - t.desc));
        const starH = t.elems.some((e) => e.star) ? (star.asc + star.desc) + S * 0.15 : 0;
        t.top = y;
        t.base = y + starH + extraUp + t.asc;
        t.bottom = t.base + t.desc + extraDown;
        r.top = t.top; r.bottom = t.bottom;
        y = t.bottom;
      } else if (r.kind === 'text') {
        const m = measure(o, r.text || ' ', S, false);
        r.m = m;
        r.top = y;
        r.base = y + m.asc;
        y = r.base + m.desc;
        r.bottom = y;
      } else if (r.kind === 'grid') {
        r.top = y;
        r.rows.forEach((row, k) => {
          if (k > 0) y += rowGap;
          row.base = y + gm.asc;
          y = row.base + gm.desc;
        });
        r.bottom = y;
      } else if (r.kind === 'tree') {
        const leaves = r.bad ? [] : leavesOf(r.root);
        const leafLabels = leaves.some((l) => l.label);
        const H = r.bad ? 0 : r.root.h;
        r.leafLabels = leafLabels;
        const leafH = leafLabels ? nl.asc + nl.desc : 0;
        r.top = y;
        r.height = leafH + H * level + (r.root.label ? nl.asc : 0);
        y += r.height;
        r.bottom = y;
      }
    });
    const coreBottom = y;

    // ---- plain text rows, centred over the tiers
    {
      const xs = T.flatMap((t) => t.elems.map((e) => e.x));
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      for (const r of f.rows) if (r.kind === 'text' && r.text) items.push(textItem(cx - r.m.w / 2, r.base, S, r.text));
    }

    // ---- tier items
    T.forEach((t, ti) => {
      t.all.forEach((e) => {
        if (e.isBracket) { items.push(...bracketItems(o, e.x - e.w / 2, t.base, e.text, e.sub, S)); return; }
      });
      t.elems.forEach((e, ei) => {
        if (!e.empty) items.push(textItem(e.x - (e.w - e.pre) / 2 - e.pre, t.base, S, e.text));
        if (e.circle) {
          e.cy = t.base + (e.desc - e.asc) / 2;
          items.push({ type: 'ellipse', cx: e.x, cy: e.cy, rx: e.rx, ry: e.ry });
        }
        if (e.star) {
          const top = e.circle ? e.cy - e.ry : t.base - t.asc;
          const by = top - S * 0.1 - star.desc;
          e.starTop = by - star.asc;
          items.push(textItem(e.x - star.w / 2, by, S * 0.75, '*'));
        }
        hits.push({ t: ti, i: ei, x: e.x - e.bw / 2, y: t.base - t.asc, w: e.bw, h: t.asc + t.desc });
      });
    });

    const elTop = (t, e) => (e.star ? e.starTop - pad * 1.6 : e.circle ? e.cy - e.ry - pad * 0.6 : t.base - t.asc - pad);
    const elBottom = (t, e) => (e.circle ? e.cy + e.ry + pad * 0.6 : t.base + t.desc + pad);

    const pushLine = (x1, y1, x2, y2, style, w) => {
      let dash = null;
      if (style === '~') dash = [S * 0.16, S * 0.11];
      else if (style === '.') dash = [0.01, Math.max(w * 2.6, S * 0.1)];
      items.push({ type: 'line', x1, y1, x2, y2, dash, w, link: true });
      if (style === 'x') {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const half = S * 0.21, off = S * 0.075;
        items.push({ type: 'line', x1: mx - half, y1: my - off, x2: mx + half, y2: my - off, w, link: true });
        items.push({ type: 'line', x1: mx - half, y1: my + off, x2: mx + half, y2: my + off, w, link: true });
      }
    };

    // tier-to-tier links
    for (const l of f.links) {
      const A = T[l.ta], B = T[l.tb];
      const ea = A.elems[l.ia], eb = B.elems[l.ib];
      const aAbove = A.base <= B.base;
      const [U, eu, D, ed] = aAbove ? [A, ea, B, eb] : [B, eb, A, ea];
      pushLine(eu.x, elBottom(U, eu), ed.x, elTop(D, ed), l.style, lw);
    }

    // ---- grid items
    const labelsRight = f.opts.has('labels-right') || f.opts.has('right');
    for (const g of gridRows) {
      const t = T[g.carrier];
      const xs = t.elems.map((e) => e.x);
      const left = Math.min(...xs.map((x, i) => x - t.elems[i].bw / 2)) - S * 0.5;
      let right = Math.max(...xs.map((x, i) => x + t.elems[i].bw / 2)) + S * 0.5;
      g.rows.forEach((row, k) => {
        row.cols.forEach((c, i) => {
          const x = xs[i];
          const m = c.mark ? measure(o, c.mark, gridSize, false) : measure(o, 'x', gridSize, false);
          c.x = x; c.top = row.base - gm.asc; c.bottom = row.base + gm.desc;
          if (c.mark) items.push(textItem(x - m.w / 2, row.base, gridSize, c.mark));
          let cx = x - m.w / 2 - S * 0.03;
          for (let j = c.pre.length - 1; j >= 0; j--) {
            const u = c.pre[j];
            const bb = bracketBox(o, u.br, u.sub, gridSize);
            cx -= bb.w;
            items.push(...bracketItems(o, cx, row.base, u.br, u.sub, gridSize));
            cx -= S * 0.03;
          }
          cx = x + m.w / 2 + S * 0.03;
          for (const u of c.post) {
            const bb = bracketBox(o, u.br, u.sub, gridSize);
            items.push(...bracketItems(o, cx, row.base, u.br, u.sub, gridSize));
            cx += bb.w + S * 0.03;
            right = Math.max(right, cx + S * 0.3);
          }
        });
        if (row.label) {
          const lm = measure(o, row.label, S * 0.7, false);
          const lx = labelsRight ? right + S * 0.4 : left - lm.w - S * 0.2;
          items.push(textItem(lx, row.base, S * 0.7, row.label));
        }
      });
      if (gridLines) {
        const below = g.rows[g.rows.length - 1];
        // between grid rows
        for (let k = 0; k + 1 < g.rows.length; k++) {
          g.rows[k].cols.forEach((c, i) => {
            const d = g.rows[k + 1].cols[i];
            if (c.mark && d.mark) pushLine(c.x, c.bottom + pad * 0.6, d.x, d.top - pad * 0.6, '-', lw * 0.85);
          });
        }
        // from the lowest row to the carrier elements
        const gIdx = f.rows.indexOf(g);
        const carrierRow = f.rows.findIndex((r) => r.kind === 'tier' && r.ti === g.carrier);
        below.cols.forEach((c, i) => {
          if (!c.mark) return;
          const e = t.elems[i];
          if (carrierRow > gIdx) pushLine(c.x, c.bottom + pad * 0.6, e.x, elTop(t, e), '-', lw * 0.85);
          else pushLine(c.x, c.top - pad * 0.6, e.x, elBottom(t, e), '-', lw * 0.85);
        });
      }
    }

    // ---- tree items
    const nodeAnchor = new Map(); // id -> {x, top, bottom}
    for (const r of treeRows) {
      const t = T[r.carrier];
      const leafH = r.leafLabels ? nl.asc + nl.desc : 0;
      // y of a node at height h (centre of its label)
      const yAt = (h) => (r.below ? r.top + leafH + h * level : r.bottom - leafH - h * level);
      const leafBase = r.below ? r.top + nl.asc : r.bottom - nl.desc;
      const draw = (n) => {
        if (n.leaf) {
          if (n.label) {
            const m = measure(o, n.label, nodeLabelSize, false);
            items.push(textItem(n.x - m.w / 2, leafBase, nodeLabelSize, n.label));
            n.top = leafBase - m.asc - pad * 0.7; n.bottom = leafBase + m.desc + pad * 0.7;
          } else {
            const e = t.elems[leavesOf(r.root).indexOf(n)];
            n.top = r.below ? elBottom(t, e) : elTop(t, e);
            n.bottom = n.top;
            if (r.below) { n.top = elBottom(t, e); n.bottom = n.top; } else { n.top = elTop(t, e); n.bottom = n.top; }
          }
        } else {
          const cy = yAt(n.h);
          if (n.label) {
            const m = measure(o, n.label, nodeLabelSize, false);
            const bl = cy + (m.asc - m.desc) / 2;
            items.push(textItem(n.x - m.w / 2, bl, nodeLabelSize, n.label));
            n.top = bl - m.asc - pad * 0.7; n.bottom = bl + m.desc + pad * 0.7;
          } else { n.top = cy; n.bottom = cy; }
          n.children.forEach(draw);
          for (const c of n.children) {
            if (r.below) pushLine(n.x, n.top, c.x, c.bottom, '-', lw);
            else pushLine(n.x, n.bottom, c.x, c.top, '-', lw);
          }
        }
        if (n.id) nodeAnchor.set(n.id, { x: n.x, top: n.top, bottom: n.bottom });
      };
      draw(r.root);
    }
    for (const t of T) for (const e of t.all) {
      if (e.isBracket && e.id) nodeAnchor.set(e.id, { x: e.x, top: t.base - e.asc - pad, bottom: t.base + Math.max(e.desc, S * 0.25) + pad });
    }

    // tone (or any tier element) linked to a tree node or a bracket
    for (const l of f.nodeLinks) {
      const t = T[l.ta], e = t.elems[l.ia], a = nodeAnchor.get(l.id);
      if (!a) continue;
      if (t.base < a.top) pushLine(e.x, elBottom(t, e), a.x, a.top, l.style, lw);
      else pushLine(e.x, elTop(t, e), a.x, a.bottom, l.style, lw);
    }

    const b = bounds(items, o);
    for (const h of hits) { b.x0 = Math.min(b.x0, h.x); b.x1 = Math.max(b.x1, h.x + h.w); }
    return { items, hits, x0: isFinite(b.x0) ? b.x0 : 0, x1: isFinite(b.x1) ? b.x1 : 0, coreBottom };
  }

  function bounds(items, o) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
    for (const it of items) {
      if (it.type === 'line') grow(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2));
      else if (it.type === 'ellipse') grow(it.cx - it.rx, it.cy - it.ry, it.cx + it.rx, it.cy + it.ry);
      else if (it.type === 'poly') for (const [px, py] of it.pts) grow(px, py, px, py);
      else if (it.type === 'rect') grow(it.x, it.y, it.x + it.w, it.y + it.h);
      else {
        const m = measureRuns(o, it.runs.map((r) => ({ ...r })), it.size);
        grow(it.x, it.y - m.asc, it.x + m.w, it.y + m.desc);
      }
    }
    return { x0, y0, x1, y1 };
  }

  function shift(items, dx, dy) {
    for (const it of items) {
      if (it.type === 'line') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
      else if (it.type === 'ellipse') { it.cx += dx; it.cy += dy; }
      else if (it.type === 'poly') { it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]); }
      else { it.x += dx; it.y += dy; }  // text and rect
    }
  }

  // ---------------------------------------------------------------- layout: all frames

  // a relation between two forms: an arrow or a symbol such as > = ≠, with an optional caption above
  function drawOp(o, items, op, x, mid) {
    const S = o.size;
    const sym = op && op.sym ? op.sym : '→';
    const cap = op && op.text ? runsOf(op.text) : null;
    const capSize = S * 0.6;
    const cm = cap ? measureRuns(o, cap, capSize) : { w: 0 };
    const A = ARROWS[sym];
    if (A) {
      const len = Math.max(S * 1.5, cm.w + S * 0.5);
      const ax0 = x + S * 0.7, ax1 = ax0 + len;
      const head = S * 0.28;
      const headAt = (tip, d) => items.push({ type: 'poly', pts: [[tip, mid], [tip - d * head, mid - head * 0.42], [tip - d * head * 0.78, mid], [tip - d * head, mid + head * 0.42]] });
      const l0 = A.dir === -1 || A.dir === 2 ? ax0 + head * 0.5 : ax0;
      const l1 = A.dir === 1 || A.dir === 2 ? ax1 - head * 0.5 : ax1;
      const offs = A.double ? [-S * 0.07, S * 0.07] : [0];
      for (const off of offs) items.push({ type: 'line', x1: l0, y1: mid + off, x2: l1, y2: mid + off, w: o.lw });
      if (A.dir === 1 || A.dir === 2) headAt(ax1, 1);
      if (A.dir === -1 || A.dir === 2) headAt(ax0, -1);
      if (cap) items.push({ type: 'text', x: (ax0 + ax1) / 2 - cm.w / 2, y: mid - S * 0.3, size: capSize, runs: cap });
      return ax1 + S * 0.7;
    }
    const gs = S * 1.05;
    const g = measure(o, sym, gs, false);
    const w = Math.max(g.w + S * 1.2, cm.w + S * 0.6);
    const cx = x + S * 0.2 + w / 2;
    items.push(textItem(cx - g.w / 2, mid + (g.asc - g.desc) / 2, gs, sym));
    if (cap) items.push({ type: 'text', x: cx - cm.w / 2, y: mid - g.asc / 2 - S * 0.3, size: capSize, runs: cap });
    return x + S * 0.4 + w;
  }

  function layoutRow(frames, o, items, hits) {
    const S = o.size;
    const L = frames.map(({ f }) => layoutFrame(f, o));
    const coreH = Math.max(...L.map((l) => l.coreBottom));
    const mid = coreH / 2;
    const glossSize = S * 0.85;
    let glossAsc = 0;
    const glossRuns = frames.map(({ f }) => {
      if (!f.gloss) return null;
      const runs = runsOf(f.gloss);
      const m = measureRuns(o, runs, glossSize);
      glossAsc = Math.max(glossAsc, m.asc);
      return { runs, m };
    });
    const lowest = Math.max(coreH, ...L.map((l) => bounds(l.items, o).y1));
    const glossY = lowest + S * 0.7 + glossAsc;

    let x = 0;
    frames.forEach(({ f, fi }, k) => {
      const lay = L[k];
      if (k > 0 || f.arrow) x = drawOp(o, items, f.arrow, k > 0 ? x : x - S * 0.5, mid);
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
        right = Math.max(right, gx + g.m.w);
      }
      x = right;
    });
  }

  function layout(parsed, o) {
    const S = o.size;
    const frames = parsed.frames.map((f, fi) => ({ f, fi })).filter(({ f }) => f.rows.length);
    const items = [];
    const hits = [];
    if (!frames.length) return { items, hits, width: 0, height: 0, empty: true };

    // split into rows at "---"
    const rows = [];
    frames.forEach((fr, k) => {
      if (k === 0 || fr.f.newRow) rows.push([]);
      rows[rows.length - 1].push(fr);
    });

    let y = 0;
    rows.forEach((row) => {
      const ri = [], rh = [];
      layoutRow(row, o, ri, rh);
      const rb = bounds(ri, o);
      for (const h of rh) { rb.y0 = Math.min(rb.y0, h.y); rb.y1 = Math.max(rb.y1, h.y + h.h); }
      const dy = y - rb.y0;
      shift(ri, 0, dy);
      for (const h of rh) h.y += dy;
      items.push(...ri);
      hits.push(...rh);
      y = rb.y1 + dy + S * 0.9;
    });

    const b = bounds(items, o);
    for (const h of hits) { b.x0 = Math.min(b.x0, h.x); b.y0 = Math.min(b.y0, h.y); b.x1 = Math.max(b.x1, h.x + h.w); b.y1 = Math.max(b.y1, h.y + h.h); }
    const M = Math.round(S * 0.5);
    const dx = M - b.x0, dy = M - b.y0;
    shift(items, dx, dy);
    for (const h of hits) { h.x += dx; h.y += dy; }
    return { items, hits, width: Math.ceil(b.x1 - b.x0 + 2 * M), height: Math.ceil(b.y1 - b.y0 + 2 * M) };
  }

  // ---------------------------------------------------------------- render

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => +v.toFixed(2);

  // item types: text {x,y,size,runs,color?} · line {x1,y1,x2,y2,w,dash?,color?,link?}
  //             ellipse {cx,cy,rx,ry,fill?,stroke?} · poly {pts,color?} · rect {x,y,w,h,fill?,stroke?,sw?}
  function toSVG(lay, o, extra = {}) {
    const W = lay.width, H = lay.height;
    const ink = o.ink, line = extra.lineColor || ink;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    if (extra.fontCSS) s += `<defs><style>${extra.fontCSS}</style></defs>`;
    if (!o.transparent && !extra.noBackground) s += `<rect width="${W}" height="${H}" fill="${o.bg || '#ffffff'}"/>`;
    s += `<g font-family="${esc(o.family)}" fill="${ink}">`;
    for (const it of lay.items) {
      if (it.type === 'text') {
        s += `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${n(it.size)}"${it.color ? ` fill="${it.color}"` : ''} xml:space="preserve">`;
        for (const r of it.runs) s += r.italic ? `<tspan font-style="italic">${esc(r.text)}</tspan>` : esc(r.text);
        s += '</text>';
      } else if (it.type === 'line') {
        const c = it.color || (it.link ? line : ink);
        s += `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${c}" stroke-width="${n(it.w)}" stroke-linecap="${it.cap || 'round'}"${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`;
      } else if (it.type === 'ellipse') {
        const fill = it.fill ? (it.fill === true ? ink : it.fill) : 'none';
        const stroke = it.stroke === false ? 'none' : ink;
        s += `<ellipse cx="${n(it.cx)}" cy="${n(it.cy)}" rx="${n(it.rx)}" ry="${n(it.ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(it.sw || o.lw)}"${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`;
      } else if (it.type === 'poly') {
        s += `<polygon points="${it.pts.map(([x, y]) => n(x) + ',' + n(y)).join(' ')}" fill="${it.color || ink}"/>`;
      } else if (it.type === 'rect') {
        const fill = it.fill ? (it.fill === true ? ink : it.fill) : 'none';
        const stroke = it.stroke ? (it.stroke === true ? ink : it.stroke) : 'none';
        s += `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${fill}" stroke="${stroke}"${it.stroke ? ` stroke-width="${n(it.sw || o.lw)}"` : ''}/>`;
      }
    }
    s += '</g>';
    if (extra.hits && lay.hits && lay.hits.length) {
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
    g.lineCap = 'round';
    for (const it of lay.items) {
      if (it.type === 'text') {
        let x = it.x;
        g.textBaseline = 'alphabetic';
        g.fillStyle = it.color || o.ink;
        for (const r of it.runs) {
          g.font = fontStr(o, it.size, r.italic);
          g.fillText(r.text, x, it.y);
          x += g.measureText(r.text).width;
        }
      } else if (it.type === 'line') {
        g.strokeStyle = it.color || o.ink;
        g.lineCap = it.cap || 'round';
        g.lineWidth = it.w;
        g.setLineDash(it.dash || []);
        g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke();
        g.setLineDash([]);
        g.lineCap = 'round';
      } else if (it.type === 'ellipse') {
        g.beginPath(); g.ellipse(it.cx, it.cy, it.rx, it.ry, 0, 0, Math.PI * 2);
        if (it.fill) { g.fillStyle = it.fill === true ? o.ink : it.fill; g.fill(); }
        if (it.stroke !== false) { g.strokeStyle = o.ink; g.lineWidth = it.sw || o.lw; g.setLineDash(it.dash || []); g.stroke(); g.setLineDash([]); }
      } else if (it.type === 'poly') {
        g.fillStyle = it.color || o.ink;
        g.beginPath();
        it.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath(); g.fill();
      } else if (it.type === 'rect') {
        if (it.fill) { g.fillStyle = it.fill === true ? o.ink : it.fill; g.fillRect(it.x, it.y, it.w, it.h); }
        if (it.stroke) { g.strokeStyle = it.stroke === true ? o.ink : it.stroke; g.lineWidth = it.sw || o.lw; g.strokeRect(it.x, it.y, it.w, it.h); }
      }
    }
    return c;
  }

  function textOf(parsed) {
    let s = '*()[]{}<>x';
    for (const f of parsed.frames) {
      s += f.label + f.gloss + (f.arrow ? (f.arrow.sym || '') + (f.arrow.text || '') : '');
      for (const t of f.tiers) for (const e of t.all) s += e.text + (e.sub || '');
      for (const r of f.rows) {
        if (r.kind === 'text') s += r.text;
        if (r.kind === 'grid') for (const row of r.rows) { s += row.label; for (const c of row.cols) s += c.mark + [...c.pre, ...c.post].map((u) => u.sub).join(''); }
        if (r.kind === 'tree') { const w = (nd) => { s += nd.label; if (!nd.leaf) nd.children.forEach(w); }; w(r.root); }
      }
    }
    return s;
  }

  // finish a layout: frame everything with a margin and report the size
  function finish(items, hits, o) {
    const b = bounds(items, o);
    for (const h of hits) { b.x0 = Math.min(b.x0, h.x); b.y0 = Math.min(b.y0, h.y); b.x1 = Math.max(b.x1, h.x + h.w); b.y1 = Math.max(b.y1, h.y + h.h); }
    if (!isFinite(b.x0)) return { items, hits, width: 0, height: 0, empty: true };
    const M = Math.round(o.size * 0.5);
    const dx = M - b.x0, dy = M - b.y0;
    shift(items, dx, dy);
    for (const h of hits) { h.x += dx; h.y += dy; }
    return { items, hits, width: Math.ceil(b.x1 - b.x0 + 2 * M), height: Math.ceil(b.y1 - b.y0 + 2 * M) };
  }

  global.Autoseg = { parse, layout, toSVG, toCanvas, crossings, serializeLinks, textOf, runsOf };
  global.PhonoKit = { measure, measureRuns, runsOf, textItem, bounds, shift, finish, unesc, fontStr };
})(window);
