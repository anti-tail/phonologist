(function () {
  'use strict';
  const A = window.Autoseg;
  const $ = (s) => document.querySelector(s);

  const LATIN = [
    { name: 'Charis SIL', fallback: 'serif' },
    { name: 'Gentium Book Plus', fallback: 'serif' },
    { name: 'Noto Serif', fallback: 'serif' },
    { name: 'Noto Sans', fallback: 'sans-serif' },
    { name: 'Times New Roman', fallback: 'serif', system: true, label: 'Times New Roman（端末のフォント）' },
  ];
  const JA = [
    { name: 'Noto Serif JP', label: 'Noto Serif JP（明朝）' },
    { name: 'Shippori Mincho', label: 'しっぽり明朝' },
    { name: 'BIZ UDPMincho', label: 'BIZ UDP明朝' },
    { name: 'Klee One', label: 'クレー（教科書体ふう）' },
    { name: 'Noto Sans JP', label: 'Noto Sans JP（ゴシック）' },
    { name: 'BIZ UDPGothic', label: 'BIZ UDPゴシック' },
  ];

  const EXAMPLES = [
    {
      title: '東京方言の頭高型',
      src: `# 1 層目が音調、2 層目が拍
T: H L
S: *い の ち
link: 1-1 2-2,3
gloss: 命 *inoti*`,
    },
    {
      title: '語頭の低下と平板型',
      src: `label: (a)
T: H
S: さ く ら が
link: 1-1,2,3,4
-> 語頭低下
T: L H
S: さ く ら が
link: 1-1 2-2,3,4`,
    },
    {
      title: '中高型 こころ',
      src: `T: L H L
S: こ *こ ろ
link: 1-1 2-2 3-3
gloss: 心`,
    },
    {
      title: '音調の広がり',
      src: `T: L H
S: ba la ma
link: 1-1 2-2
->
T: L H
S: ba la ma
link: 1-1 2-2 2~3`,
    },
    {
      title: '切断と浮遊音調',
      src: `T: H L (H)
S: a ma ta
link: 1-1 1x2 2~2 2-3
gloss: H の切断と、どこにもつながらない H`,
    },
    {
      title: '再建形',
      src: `# \\* と書くとアステリスクがそのまま出ます
label: (1)
T: H L
S: \\*ka ta
link: 1-1 2-2
gloss: \\*kata *shoulder*`,
    },
    {
      title: '変化の過程',
      src: `# 五十嵐 (2023) の書き方にならった例。> は音変化、= は合流、--- で次の段へ
label: HL類
T: H L M
S: σ σ
link: 1-1 2-1 3-2
> 語頭単調化
T: H L M
S: σ σ
link: 1-1 2-2 3-2
---
label: L類
form: *∅.LM
>
form: *∅.LH
gloss: cf. 杵築 i.nu「犬」
---
label: H類
form: *H.M
=
form: *H.M`,
    },
    {
      title: '3 層の表示',
      src: `T: H L
μ: μ μ μ
S: ka n ta
link: 1-1 2-2,3
link: μ1-S1 μ2-S2 μ3-S3`,
    },
    {
      title: '括弧つき格子 Halle & Idsardi 式',
      src: `# gridlines で列を縦線で結び、labels-right で行の名前を右に置く
option: gridlines labels-right
grid line 2: x . . . . .
grid line 1: (x . x . x .)
grid line 0: (x x) (x x) (x x)
S: pa ta ka ma na sa`,
    },
    {
      title: '格子を列の高さで書く',
      src: `grid: 2 1 3 1
S: A la ba ma`,
    },
    {
      title: '格子と s/w の樹形 Liberman & Prince 式',
      src: `grid: 2 1 3 1
S: Mis si ssip pi
tree-below: [ [.w s w ] [.s s w ] ]`,
    },
    {
      title: '韻律範疇の樹形',
      src: `tree: [.ω [.F . . ] [.F . . ] ]
S: ア メ リ カ`,
    },
    {
      title: '格子と声調層',
      src: `grid: 1 2 1
S: こ *こ ろ
T: L H L
link: 1-1 2-2 3-3
gloss: 心`,
    },
    {
      title: '括弧つき範疇と声調の多重連結',
      src: `# Lα を最初の拍と α の左括弧の両方に、L% を ι の右括弧につなぐ
S: [_ι [_α=ap は *し が ]_α ]_ι=ip
T: Lα H* L L%
link: 1-1 2-2 3-3
link: T1-@ap T4-@ip
gloss: 橋が`,
    },
    {
      title: '樹形の節点に音調をつなぐ',
      src: `T: %L H-
tree: [.AP=ap [.ω . . . . ] ]
S: さ く ら が
link: T1-@ap T2-@ap`,
    },
  ];

  const DEFAULTS = { latin: 'Charis SIL', ja: 'Noto Serif JP', size: 30, tier: 1.7, gap: 0.9, lw: 1.3, ink: '#1b1e23', transparent: false, scale: 4, embed: true };

  // ---------------------------------------------------------------- state

  const el = {
    src: $('#src'), preview: $('#preview'), notices: $('#notices'), status: $('#status'), sheet: $('#sheet'),
    latin: $('#opt-latin'), ja: $('#opt-ja'), size: $('#opt-size'), tier: $('#opt-tier'), gap: $('#opt-gap'), lw: $('#opt-lw'),
    ink: $('#opt-ink'), transparent: $('#opt-transparent'), scale: $('#opt-scale'), embed: $('#opt-embed'), examples: $('#examples'),
  };

  for (const f of LATIN) el.latin.add(new Option(f.label || f.name, f.name));
  for (const f of JA) el.ja.add(new Option(f.label, f.name));
  EXAMPLES.forEach((ex, i) => el.examples.add(new Option(ex.title, String(i))));

  function familyOf(o) {
    const lat = LATIN.find((f) => f.name === o.latin) || LATIN[0];
    return `"${lat.name}", "${o.ja}", ${lat.fallback}`;
  }

  function readOptions() {
    const o = {
      latin: el.latin.value, ja: el.ja.value,
      size: +el.size.value, tier: +el.tier.value, gap: +el.gap.value, lw: +el.lw.value,
      ink: el.ink.value, transparent: el.transparent.checked, scale: +el.scale.value, embed: el.embed.checked,
    };
    o.family = familyOf(o);
    return o;
  }

  function writeOptions(o) {
    el.latin.value = o.latin; el.ja.value = o.ja;
    el.size.value = o.size; el.tier.value = o.tier; el.gap.value = o.gap; el.lw.value = o.lw;
    el.ink.value = o.ink; el.transparent.checked = !!o.transparent; el.scale.value = String(o.scale); el.embed.checked = o.embed !== false;
    showOutputs();
  }

  function showOutputs() {
    $('#out-size').textContent = el.size.value + ' px';
    $('#out-tier').textContent = (+el.tier.value).toFixed(1);
    $('#out-gap').textContent = (+el.gap.value).toFixed(2);
    $('#out-lw').textContent = (+el.lw.value).toFixed(1) + ' px';
  }

  // share link / local storage
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

  function loadInitial() {
    let state = null;
    if (location.hash.startsWith('#d=')) {
      try { state = JSON.parse(b64d(location.hash.slice(3))); } catch (e) { /* ignore broken link */ }
      history.replaceState(null, '', location.href.split('#')[0]);
    }
    if (!state) {
      try { state = JSON.parse(localStorage.getItem('phonologist') || 'null'); } catch (e) { state = null; }
    }
    writeOptions({ ...DEFAULTS, ...(state && state.o) });
    el.src.value = state && typeof state.src === 'string' ? state.src : EXAMPLES[0].src;
  }

  function save() {
    const { family, ...o } = readOptions();
    try { localStorage.setItem('phonologist', JSON.stringify({ src: el.src.value, o })); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------- fonts

  const fontCSSURL = $('#font-css').href;
  let fontCSSText = null;

  async function ensureFonts(o, text) {
    const names = [o.latin, o.ja].filter((nm) => !(LATIN.find((f) => f.name === nm) || {}).system);
    const jobs = [];
    for (const nm of names) {
      jobs.push(document.fonts.load(`${o.size}px "${nm}"`, text));
      jobs.push(document.fonts.load(`italic ${o.size}px "${nm}"`, text));
    }
    await Promise.all(jobs.map((p) => p.catch(() => null)));
  }

  function rangeHits(range, cps) {
    for (const part of range.split(',')) {
      const p = part.trim().replace(/^U\+/i, '');
      let lo, hi;
      if (p.includes('-')) { const [a, b] = p.split('-'); lo = parseInt(a, 16); hi = parseInt(b, 16); }
      else if (p.includes('?')) { lo = parseInt(p.replace(/\?/g, '0'), 16); hi = parseInt(p.replace(/\?/g, 'F'), 16); }
      else { lo = hi = parseInt(p, 16); }
      for (const c of cps) if (c >= lo && c <= hi) return true;
    }
    return false;
  }

  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  async function embeddedFontCSS(o, text, usesItalic) {
    if (!fontCSSText) fontCSSText = await fetch(fontCSSURL).then((r) => r.text());
    const cps = new Set([...text].map((c) => c.codePointAt(0)));
    const want = new Set([o.latin, o.ja]);
    const blocks = fontCSSText.match(/@font-face\s*\{[^}]*\}/g) || [];
    const picked = blocks.filter((b) => {
      const fam = (b.match(/font-family:\s*['"]([^'"]+)['"]/) || [])[1];
      if (!want.has(fam)) return false;
      const style = (b.match(/font-style:\s*(\w+)/) || [])[1];
      if (style === 'italic' && !usesItalic) return false;
      const ur = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
      return !ur || rangeHits(ur, cps);
    });
    const out = [];
    for (const b of picked) {
      const url = (b.match(/url\(([^)]+)\)/) || [])[1];
      if (!url) continue;
      const data = await fetch(url.replace(/['"]/g, '')).then((r) => r.blob()).then(blobToDataURL);
      out.push(b.replace(/url\([^)]+\)/, `url(${data})`));
    }
    return out.join('\n');
  }

  // ---------------------------------------------------------------- render

  let current = null; // { parsed, lay, o }
  let selected = null; // { f, t, i }
  let renderSeq = 0;

  async function render() {
    const seq = ++renderSeq;
    const o = readOptions();
    const parsed = A.parse(el.src.value);
    await ensureFonts(o, A.textOf(parsed));
    if (seq !== renderSeq) return;
    const lay = A.layout(parsed, o);
    current = { parsed, lay, o };

    if (selected) {
      const f = parsed.frames[selected.f];
      if (!f || !f.tiers[selected.t] || !f.tiers[selected.t].elems[selected.i]) selected = null;
    }

    if (lay.empty) {
      el.preview.innerHTML = '<p class="empty">左の欄に層を書くと、ここに図が出ます。</p>';
    } else {
      el.preview.innerHTML = A.toSVG(lay, o, { hits: true, noBackground: true });
      markSelection();
    }
    el.sheet.classList.toggle('transparent', o.transparent);
    showNotices(parsed);
    save();
  }

  function showNotices(parsed) {
    const msgs = parsed.errors.map((m) => ({ kind: 'error', m }));
    parsed.frames.forEach((f) => {
      for (const [p, q] of A.crossings(f)) {
        const nm = (l) => `${f.tiers[l.ta].name}${l.ia + 1}–${f.tiers[l.tb].name}${l.ib + 1}`;
        msgs.push({ kind: 'note', m: `${nm(p)} と ${nm(q)} の連結線が交差しています。` });
      }
    });
    el.notices.innerHTML = msgs.map((x) => `<p class="${x.kind}">${x.m.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
  }

  function markSelection() {
    el.preview.querySelectorAll('.hit.selected').forEach((r) => r.classList.remove('selected'));
    if (!selected) return;
    const r = el.preview.querySelector(`.hit[data-f="${selected.f}"][data-t="${selected.t}"][data-i="${selected.i}"]`);
    if (r) r.classList.add('selected');
  }

  // click two elements to cycle the link between them
  const CYCLE = [null, '-', '~', 'x'];
  el.preview.addEventListener('click', (ev) => {
    const r = ev.target.closest('.hit');
    if (!r) { selected = null; markSelection(); return; }
    const hit = { f: +r.dataset.f, t: +r.dataset.t, i: +r.dataset.i };
    if (!selected || selected.f !== hit.f || selected.t === hit.t) {
      selected = (selected && selected.f === hit.f && selected.t === hit.t && selected.i === hit.i) ? null : hit;
      markSelection();
      return;
    }
    let a = selected, b = hit;
    if (a.t > b.t) [a, b] = [b, a];
    const f = current.parsed.frames[hit.f];
    const idx = f.links.findIndex((l) => l.ta === a.t && l.ia === a.i && l.tb === b.t && l.ib === b.i);
    const now = idx >= 0 ? f.links[idx].style : null;
    const next = CYCLE[(Math.max(0, CYCLE.indexOf(now)) + 1) % CYCLE.length];
    if (idx >= 0 && !next) f.links.splice(idx, 1);
    else if (idx >= 0) f.links[idx].style = next;
    else f.links.push({ ta: a.t, ia: a.i, tb: b.t, ib: b.i, style: '-' });
    rewriteLinks(f);
    render();
  });

  function rewriteLinks(f) {
    const lines = el.src.value.split(/\r?\n/);
    const remove = new Set(f.linkLines.map((l) => l.line));
    const insertAt = f.linkLines.length ? f.linkLines[0].line : Math.max(...f.tiers.map((t) => t.line)) + 1;
    const fresh = A.serializeLinks(f);
    const out = [];
    lines.forEach((l, i) => {
      if (i === insertAt) out.push(...fresh);
      if (!remove.has(i)) out.push(l);
    });
    if (insertAt >= lines.length) out.push(...fresh);
    el.src.value = out.join('\n');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected) { selected = null; markSelection(); }
  });

  // ---------------------------------------------------------------- export

  function flash(msg) {
    el.status.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { el.status.textContent = ''; }, 4000);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function baseName() {
    const f = current && current.parsed.frames.find((x) => x.tiers.length);
    const t = f && f.tiers[f.tiers.length - 1].elems.map((e) => e.text).join('');
    const clean = (t || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 24);
    return 'phonologist-' + (clean || 'diagram');
  }

  async function pngBlob() {
    await render();
    if (!current || current.lay.empty) throw new Error('図がありません。');
    const c = A.toCanvas(current.lay, current.o, current.o.scale);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG を作れませんでした。'))), 'image/png'));
  }

  $('#dl-png').addEventListener('click', async () => {
    try { download(await pngBlob(), baseName() + '.png'); flash('PNG を保存しました。'); }
    catch (e) { flash(e.message); }
  });

  $('#copy-png').addEventListener('click', async () => {
    try {
      const blob = await pngBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('PNG をクリップボードにコピーしました。');
    } catch (e) {
      flash('このブラウザでは画像をコピーできませんでした。PNG を保存してお使いください。');
    }
  });

  $('#dl-svg').addEventListener('click', async () => {
    await render();
    if (!current || current.lay.empty) { flash('図がありません。'); return; }
    const { lay, o, parsed } = current;
    let fontCSS = '';
    const lat = LATIN.find((f) => f.name === o.latin) || {};
    if (o.embed) {
      try {
        const usesItalic = lay.items.some((it) => it.runs && it.runs.some((r) => r.italic));
        flash('フォントを埋め込んでいます…');
        fontCSS = await embeddedFontCSS(o, A.textOf(parsed), usesItalic);
      } catch (e) {
        flash('フォントを埋め込めなかったため、フォント名だけを指定して保存しました。');
      }
    }
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + A.toSVG(lay, o, { fontCSS });
    download(new Blob([svg], { type: 'image/svg+xml' }), baseName() + '.svg');
    flash(o.embed && fontCSS ? 'SVG を保存しました。' + (lat.system ? ' 端末のフォントは埋め込んでいません。' : '') : 'SVG を保存しました。');
  });

  $('#copy-link').addEventListener('click', async () => {
    const { family, ...o } = readOptions();
    const url = location.href.split('#')[0] + '#d=' + b64e(JSON.stringify({ src: el.src.value, o }));
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); flash('この図を開くリンクをコピーしました。'); }
    catch (e) { flash('リンクをアドレス欄に入れました。そこからコピーしてください。'); }
  });

  // ---------------------------------------------------------------- wiring

  let timer;
  el.src.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  for (const k of ['latin', 'ja', 'size', 'tier', 'gap', 'lw', 'ink', 'transparent', 'scale', 'embed']) {
    el[k].addEventListener('input', () => { showOutputs(); render(); });
  }
  el.examples.addEventListener('change', () => {
    const ex = EXAMPLES[+el.examples.value];
    if (ex) { el.src.value = ex.src; selected = null; render(); }
    el.examples.value = '';
  });

  // logo: the site name drawn by the engine itself
  async function drawLogo() {
    const o = { ...DEFAULTS, latin: 'Charis SIL', ja: 'Noto Serif JP', size: 22, tier: 1.15, gap: 0.12, lw: 1.4, ink: '#1b1e23', transparent: true };
    o.family = familyOf(o);
    const parsed = A.parse('T: L H L\nS: pho no lo gist\nlink: 1-1 2-2 2~3 3-4');
    await ensureFonts(o, 'phonologistHL');
    const lay = A.layout(parsed, o);
    $('#logo').innerHTML = A.toSVG(lay, o, { lineColor: '#2d4a9c', noBackground: true });
  }

  loadInitial();
  render();
  drawLogo();
  document.fonts.ready.then(() => { render(); drawLogo(); });
})();
