/* phonologist: Optimality Theory tableaux (classic, Harmonic Grammar, MaxEnt, comparative) */
(function (global) {
  'use strict';
  const K = global.PhonoKit;

  const TYPES = { ot: 'ot', hg: 'hg', maxent: 'maxent', me: 'maxent', comparative: 'comparative', ct: 'comparative', erc: 'comparative' };

  function parseCell(raw) {
    const s = raw.trim();
    if (!s) return { n: 0 };
    if (/^-?\d+(\.\d+)?$/.test(s)) return { n: Math.abs(+s) };
    if (/^\*+$/.test(s)) return { n: s.length };
    if (/^\**!\**$/.test(s)) return { n: (s.match(/\*/g) || []).length, manual: s };
    const t = K.unesc(s);
    return { n: [...t.replace(/[!\s]/g, '')].length, text: t, manual: s.includes('!') ? t : undefined };
  }

  function parse(src) {
    const errors = [];
    const T = { input: '', cons: [], seps: [], weights: null, type: null, cands: [], intended: null, opts: new Set(), caption: '' };
    src.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([^:：|]+?)\s*[:：]\s?(.*)$/);
      const where = `${i + 1} 行目`;
      if (!m) { errors.push(`${where}は「名前: 内容」の形になっていません。`); return; }
      const k = m[1].trim().toLowerCase(), key = m[1].trim(), body = m[2];
      if (k === 'input' || key === '入力') T.input = K.unesc(body.trim());
      else if (k === 'constraints' || k === 'con' || key === '制約') {
        // ">>" ranks, "," leaves two neighbours unranked
        const parts = body.split(/(>>|≫|,|、)/);
        let sep = null;
        for (const p of parts) {
          if (p === '>>' || p === '≫') sep = 'solid';
          else if (p === ',' || p === '、') sep = 'dash';
          else if (p.trim()) { if (T.cons.length) T.seps.push(sep || 'solid'); T.cons.push({ name: K.unesc(p.trim()) }); sep = null; }
        }
      } else if (k === 'weights' || k === 'weight' || key === '重み') {
        T.weights = body.split(/[\s,]+/).filter(Boolean).map(Number);
        if (T.weights.some(isNaN)) { errors.push(`${where}: 重みは数で書いてください。`); T.weights = null; }
      } else if (k === 'type' || key === '種類') {
        const t = TYPES[body.trim().toLowerCase()];
        if (!t) errors.push(`${where}: 種類は ot / hg / maxent / comparative のどれかです。`);
        else T.type = t;
      } else if (k === 'intended' || k === 'winner' || key === '勝者') T.intended = body.trim();
      else if (k === 'option' || k === 'options' || key === '設定') body.split(/[\s,]+/).filter(Boolean).forEach((w) => T.opts.add(w.toLowerCase()));
      else if (k === 'caption' || k === 'gloss' || key === '注') T.caption = body.trim();
      else if (k === 'cand' || k === 'c' || k === 'candidate' || key === '候補') {
        const [main, obs] = body.split('||');
        const cells = main.split('|');
        const form = K.unesc(cells.shift().trim());
        T.cands.push({ form, cells: cells.map(parseCell), obs: obs !== undefined && obs.trim() !== '' ? +obs : null, line: i });
      } else errors.push(`${where}: 「${key}」は分かりません。input、constraints、cand などで書き始めてください。`);
    });
    const n = T.cons.length;
    for (const c of T.cands) {
      if (c.cells.length > n) errors.push(`${c.line + 1} 行目の候補 ${c.form} は欄が ${c.cells.length} 個あり、制約の数 ${n} より多くなっています。`);
      while (c.cells.length < n) c.cells.push({ n: 0 });
      c.cells.length = n;
    }
    if (T.weights && T.weights.length !== n) errors.push(`重みが ${T.weights.length} 個ありますが、制約は ${n} 個です。`);
    if (!T.type) T.type = T.weights ? 'hg' : 'ot';
    if ((T.type === 'hg' || T.type === 'maxent') && !T.weights) errors.push('hg と maxent には weights: の行が必要です。');
    // intended winner: a letter, a number or the form itself
    if (T.intended) {
      const s = T.intended;
      let idx = -1;
      if (/^[a-z]$/i.test(s)) idx = s.toLowerCase().charCodeAt(0) - 97;
      else if (/^\d+$/.test(s)) idx = +s - 1;
      else idx = T.cands.findIndex((c) => c.form === s);
      if (idx < 0 || idx >= T.cands.length) { errors.push(`想定する勝者「${s}」が候補の中にありません。`); T.intendedIdx = -1; }
      else T.intendedIdx = idx;
    } else T.intendedIdx = -1;
    evaluate(T, errors);
    return { T, errors };
  }

  // ---------------------------------------------------------------- evaluation

  function strataOf(T) {
    const st = [];
    T.cons.forEach((c, j) => { if (j === 0 || T.seps[j - 1] === 'solid') st.push([]); st[st.length - 1].push(j); });
    return st;
  }

  function evaluate(T, errors) {
    const C = T.cands, n = T.cons.length;
    T.strata = strataOf(T);
    T.stratumOf = [];
    T.strata.forEach((s, si) => s.forEach((j) => { T.stratumOf[j] = si; }));
    if (!C.length) { T.winners = []; return; }
    const v = (c, j) => c.cells[j].n;

    // strict domination over strata (violations in one stratum are pooled)
    let alive = C.map((_, i) => i);
    let decisive = -1;
    C.forEach((c) => { c.fatal = null; });
    T.strata.forEach((s, si) => {
      const score = (i) => s.reduce((a, j) => a + v(C[i], j), 0);
      const best = Math.min(...alive.map(score));
      const colMin = s.map((j) => Math.min(...alive.map((i) => v(C[i], j))));
      const out = alive.filter((i) => score(i) > best);
      for (const i of out) {
        let col = s.find((j, k) => v(C[i], j) > colMin[k]);
        if (col === undefined) col = s.find((j) => v(C[i], j) > 0);
        C[i].fatal = { si, col, min: colMin[s.indexOf(col)] };
      }
      if (out.length) decisive = si;
      alive = alive.filter((i) => score(i) === best);
    });
    T.otWinners = alive;
    T.decisive = decisive;

    // manual "!" marks override where shading starts
    T.manual = C.some((c) => c.cells.some((x) => x.manual));
    if (T.manual) {
      C.forEach((c) => {
        const j = c.cells.findIndex((x) => x.manual);
        c.fatal = j >= 0 ? { si: T.stratumOf[j], col: j, manual: true } : null;
      });
    }

    // weighted grammars
    if (T.weights && T.weights.length === n) {
      C.forEach((c) => { c.H = c.cells.reduce((a, x, j) => a + T.weights[j] * x.n, 0); });
      const minH = Math.min(...C.map((c) => c.H));
      T.hgWinners = C.map((c, i) => (c.H === minH ? i : -1)).filter((i) => i >= 0);
      const Z = C.reduce((a, c) => a + Math.exp(-c.H), 0);
      C.forEach((c) => { c.P = Math.exp(-c.H) / Z; });
    }

    T.winners = T.type === 'hg' || T.type === 'maxent' ? (T.hgWinners || []) : T.otWinners;

    // comparative rows: winner ~ each loser
    if (T.type === 'comparative') {
      const w = T.intendedIdx >= 0 ? T.intendedIdx : T.otWinners[0];
      T.ercWinner = w;
      T.ercs = C.map((c, i) => i).filter((i) => i !== w).map((i) => ({
        loser: i,
        cells: T.cons.map((_, j) => (v(C[w], j) < v(C[i], j) ? 'W' : v(C[w], j) > v(C[i], j) ? 'L' : '')),
      }));
      // with this ranking, every L must be dominated by some W
      for (const e of T.ercs) {
        const firstW = e.cells.findIndex((x) => x === 'W');
        const firstL = e.cells.findIndex((x) => x === 'L');
        const sw = firstW >= 0 ? T.stratumOf[firstW] : Infinity, sl = firstL >= 0 ? T.stratumOf[firstL] : Infinity;
        if (firstL >= 0 && !(sw < sl)) errors.push(`${C[w].form} ~ ${C[e.loser].form} の行で、L より上に W がありません。この順位では ${C[w].form} が勝ちません。`);
        if (firstW < 0 && firstL < 0) errors.push(`${C[w].form} と ${C[e.loser].form} は違反が同じで、区別できません。`);
      }
    }
  }

  // ---------------------------------------------------------------- drawing helpers

  // constraint names in small capitals (lower-case letters drawn as smaller capitals)
  function scRuns(o, text, size, on) {
    const parts = [];
    if (!on) { const m = K.measure(o, text, size, false); return { w: m.w, parts: [{ text, size, dx: 0 }], asc: m.asc }; }
    let w = 0, asc = 0;
    const re = /([a-zà-ÿ]+)|([^a-zà-ÿ]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const small = !!m[1];
      const t = small ? m[1].toUpperCase() : m[2];
      const sz = small ? size * 0.78 : size;
      const mm = K.measure(o, t, sz, false);
      parts.push({ text: t, size: sz, dx: w });
      w += mm.w; asc = Math.max(asc, mm.asc);
    }
    return { w, parts, asc };
  }
  const pushSC = (items, sc, x, y) => { for (const p of sc.parts) items.push(K.textItem(x + p.dx, y, p.size, p.text)); };

  const fmt = (x, d) => {
    if (Number.isInteger(x)) return String(x);
    return x.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
  };
  const minus = (s) => s.replace(/^-/, '−');

  // ---------------------------------------------------------------- layout

  function layout(parsed, o) {
    const { T } = parsed;
    const S = o.size;
    const ts = S * 0.72;
    const items = [];
    if (!T.cons.length && !T.cands.length) return { items, hits: [], width: 0, height: 0, empty: true };
    const lw = o.lw;
    const shade = '#d7d9de';
    const sc = !T.opts.has('no-smallcaps');
    const letters = !T.opts.has('no-letters');
    const numbers = T.opts.has('numbers') || T.type === 'hg' || T.type === 'maxent';
    const doShade = !T.opts.has('no-shade') && (T.type === 'ot');
    const padX = ts * 0.55;
    const rowH = ts * 1.8;
    const C = T.cands;
    const comparative = T.type === 'comparative';

    // hands: ☞ on the winner(s) or on the intended winner; a frowning face on a wrong winner
    const hand = new Map();
    if (!comparative && !(T.type === 'maxent' && !T.opts.has('hand'))) {
      if (T.intendedIdx >= 0) {
        hand.set(T.intendedIdx, '☞');
        for (const w of T.winners) if (w !== T.intendedIdx) hand.set(w, '☹');
      } else for (const w of T.winners) hand.set(w, '☞');
    }

    // first column
    const rows = comparative
      ? (T.ercs || []).map((e) => ({ text: `${C[T.ercWinner].form} ~ ${C[e.loser].form}`, letter: letters ? String.fromCharCode(97 + e.loser) + '.' : '', erc: e }))
      : C.map((c, i) => ({ text: c.form, letter: letters ? String.fromCharCode(97 + i) + '.' : '', cand: c, i }));
    const handW = hand.size ? K.measure(o, '☞', ts, false).w + ts * 0.3 : 0;
    const letterW = letters ? Math.max(0, ...rows.map((r) => K.measure(o, r.letter, ts, false).w)) + ts * 0.3 : 0;
    const formW = Math.max(0, ...rows.map((r) => K.measure(o, r.text, ts, false).w));
    const inputW = K.measure(o, T.input || ' ', ts, false).w;
    const col0 = Math.max(handW + letterW + formW, inputW) + padX * 2;

    // constraint columns
    const wts = T.weights && T.weights.length === T.cons.length ? T.weights : null;
    const showW = wts && (T.type === 'hg' || T.type === 'maxent');
    const cellText = (c, j) => {
      const x = c.cells[j];
      if (x.text !== undefined) return x.text;
      if (x.manual) return numbers ? `${x.n}!` : x.manual;
      if (!x.n) return '';
      if (T.type === 'hg' && !T.opts.has('positive')) return minus(String(-x.n));
      if (numbers) return String(x.n);
      let s = '*'.repeat(x.n);
      if (!T.manual && T.type === 'ot' && c.fatal && c.fatal.col === j) s = '*'.repeat(c.fatal.min + 1) + '!' + '*'.repeat(Math.max(0, x.n - c.fatal.min - 1));
      return s;
    };
    const names = T.cons.map((c) => scRuns(o, c.name, ts, sc));
    const colW = T.cons.map((c, j) => {
      let w = names[j].w;
      if (showW) w = Math.max(w, K.measure(o, 'w = ' + fmt(wts[j], 2), ts * 0.8, false).w);
      for (const r of rows) {
        const t = comparative ? r.erc.cells[j] : cellText(r.cand, j);
        w = Math.max(w, K.measure(o, t || ' ', ts, false).w);
      }
      return Math.max(w + padX * 2, ts * 2.4);
    });

    // extra columns on the right
    const extras = [];
    if (T.type === 'hg' && wts) extras.push({ head: 'H', fn: (c) => minus(fmt(T.opts.has('positive') ? c.H : -c.H, 2)) });
    if (T.type === 'maxent' && wts) {
      extras.push({ head: 'H', fn: (c) => fmt(c.H, 2) });
      extras.push({ head: 'P', fn: (c) => c.P.toFixed(3) });
      if (C.some((c) => c.obs !== null)) extras.push({ head: 'Obs', fn: (c) => (c.obs === null ? '' : fmt(c.obs, 3)) });
    }
    for (const e of extras) {
      e.w = Math.max(K.measure(o, e.head, ts, false).w, ...C.map((c) => K.measure(o, e.fn(c), ts, false).w)) + padX * 2;
    }

    // vertical metrics
    const headH = rowH * (showW ? 1.6 : 1.15);
    const dbl = ts * 0.16;
    const top0 = headH + dbl;
    const totalH = top0 + rows.length * rowH;
    const xs = [0, col0 + dbl];
    colW.forEach((w) => xs.push(xs[xs.length - 1] + w));
    let xr = xs[xs.length - 1];
    const extraX = [];
    for (const e of extras) { xr += extraX.length ? 0 : dbl; extraX.push(xr); xr += e.w; }
    const totalW = xr;

    // shading first (OT): after the fatal stratum, and after the decisive stratum for the winner
    if (doShade && !comparative) {
      rows.forEach((r, ri) => {
        const c = r.cand;
        let from = null;
        if (c.fatal) from = c.fatal.si + 1;
        else if (T.winners.includes(r.i) && T.decisive >= 0) from = T.decisive + 1;
        if (from === null) return;
        T.cons.forEach((_, j) => {
          if (T.stratumOf[j] >= from) items.push({ type: 'rect', x: xs[j + 1], y: top0 + ri * rowH, w: colW[j], h: rowH, fill: shade });
        });
      });
    }

    const H = (x1, x2, y, dash) => items.push({ type: 'line', x1, y1: y, x2, y2: y, w: lw, dash: dash || null, cap: 'butt' });
    const V = (x, y1, y2, dash) => items.push({ type: 'line', x1: x, y1, x2: x, y2, w: lw, dash: dash || null, cap: 'butt' });
    // frame and rules
    items.push({ type: 'rect', x: 0, y: 0, w: totalW, h: totalH, stroke: true, sw: lw });
    H(0, totalW, headH); H(0, totalW, headH + dbl);
    rows.forEach((_, ri) => { if (ri > 0) H(0, totalW, top0 + ri * rowH); });
    V(col0, 0, totalH); V(col0 + dbl, 0, totalH);
    T.cons.forEach((_, j) => {
      if (j === 0) return;
      const dashed = T.seps[j - 1] === 'dash';
      V(xs[j], 0, totalH, dashed ? [ts * 0.28, ts * 0.2] : null);
    });
    extras.forEach((e, k) => { if (k === 0) { V(extraX[0] - dbl, 0, totalH); V(extraX[0], 0, totalH); } else V(extraX[k], 0, totalH); });

    // header
    const mid = (y0, h, size, t) => { const m = K.measure(o, t || 'x', size, false); return y0 + h / 2 + (m.asc - m.desc) / 2; };
    items.push(K.textItem(padX, mid(0, headH, ts, T.input), ts, comparative && !T.input ? 'W ~ L' : T.input));
    T.cons.forEach((c, j) => {
      const nm = names[j];
      const cx = xs[j + 1] + colW[j] / 2;
      if (showW) {
        pushSC(items, nm, cx - nm.w / 2, headH * 0.42 + nm.asc / 2);
        const wt = 'w = ' + fmt(wts[j], 2);
        const m = K.measure(o, wt, ts * 0.8, false);
        items.push(K.textItem(cx - m.w / 2, headH * 0.8 + m.asc / 2, ts * 0.8, wt));
      } else pushSC(items, nm, cx - nm.w / 2, mid(0, headH, ts, c.name));
    });
    extras.forEach((e, k) => {
      const m = K.measure(o, e.head, ts, false);
      items.push(K.textItem(extraX[k] + e.w / 2 - m.w / 2, mid(0, headH, ts, e.head), ts, e.head));
    });

    // rows
    rows.forEach((r, ri) => {
      const y0 = top0 + ri * rowH;
      let x = padX;
      const h = r.cand ? hand.get(r.i) : null;
      if (h) items.push(K.textItem(x, mid(y0, rowH, ts, h), ts, h));
      x += handW;
      if (r.letter) items.push(K.textItem(x, mid(y0, rowH, ts, r.letter), ts, r.letter));
      x += letterW;
      items.push(K.textItem(x, mid(y0, rowH, ts, r.text), ts, r.text));
      T.cons.forEach((_, j) => {
        const t = comparative ? r.erc.cells[j] : cellText(r.cand, j);
        if (!t) return;
        const m = K.measure(o, t, ts, false);
        items.push(K.textItem(xs[j + 1] + colW[j] / 2 - m.w / 2, mid(y0, rowH, ts, t), ts, t));
      });
      extras.forEach((e, k) => {
        const t = e.fn(r.cand);
        const m = K.measure(o, t, ts, false);
        items.push(K.textItem(extraX[k] + e.w - padX - m.w, mid(y0, rowH, ts, t), ts, t));
      });
    });

    if (T.caption) {
      const runs = K.runsOf(T.caption);
      const m = K.measureRuns(o, runs, ts);
      items.push({ type: 'text', x: totalW / 2 - m.w / 2, y: totalH + ts * 1.2 + m.asc, size: ts, runs });
    }
    return K.finish(items, [], o);
  }

  function textOf(parsed) {
    const T = parsed.T;
    let s = '☞☹*!0123456789.−-~ WLwHPObs=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' + T.input + T.caption;
    for (const c of T.cons) s += c.name + c.name.toUpperCase();
    for (const c of T.cands) { s += c.form; for (const x of c.cells) if (x.text) s += x.text; }
    return s;
  }

  global.Tableau = { parse, layout, textOf };
})(window);
