/* ============================================================
   نحوِ قرآن — worksheet builder
   ============================================================ */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

/* Pause/waqf signs only. IndoPak orthographic marks — madda U+06E4,
   the silent-letter zeros U+06DF/U+06E0, sukun U+06E1 — are deliberately
   NOT in this set: removing them would corrupt the text. */
const PAUSE = /[\u06d6-\u06de\u06e2\u06e9]/g;
const stripWaqf = (w) => (S.noWaqf ? w.replace(PAUSE, '') : w);

/* ---------- paper sizes, px at 96dpi ---------- */
const PAPER = {
  A4: [793.7, 1122.5],
  Letter: [816, 1056],
  A5: [559.4, 793.7],
};
const MARGIN_MM = 12;

/* ---------- persisted note store (IndexedDB) ---------- */
const Notes = (() => {
  const cache = new Map();

  const open = () => QN.openDB();

  return {
    async load() {
      try {
        const db = await open();
        await new Promise((res) => {
          const st = db.transaction('notes').objectStore('notes');
          const req = st.openCursor();
          req.onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return res();
            if (!String(c.key).startsWith('draw:')) cache.set(c.key, c.value);
            c.continue();
          };
          req.onerror = () => res();
        });
      } catch (_) { /* private mode / no IDB — stay in memory */ }
    },
    get: (k) => cache.get(k) || '',
    async set(k, v) {
      v ? cache.set(k, v) : cache.delete(k);
      try {
        const db = await open();
        const st = db.transaction('notes', 'readwrite').objectStore('notes');
        v ? st.put(v, k) : st.delete(k);
      } catch (_) { /* ignore */ }
    },
    all: () => Object.fromEntries(cache),
    count: () => cache.size,
  };
})();

/* ---------- state ---------- */
const S = {
  s1: 1, a1: 1, s2: 1, a2: 7,
  layout: 'grid',
  mode: 'hand',
  fontSize: 30,
  lines: 3,
  colMeaning: true,
  showNums: true,
  noWaqf: true,
  onePer: false,
  fitPage: true,
  cols: 4,
  paper: 'A4',
  orient: 'portrait',
};

const SETTINGS_KEY = 'quran-nahw:settings';
const saveSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (_) {}
};
const loadSettings = () => {
  try { Object.assign(S, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch (_) {}
};

/* ---------- data ---------- */
let INDEX = null;
let BUNDLE = null;
const surahCache = new Map();

async function getSurah(n) {
  if (BUNDLE) {
    const d = BUNDLE.text[n];
    if (!d) throw new Error('missing');
    return d;
  }
  if (surahCache.has(n)) return surahCache.get(n);
  const p = fetch(`data/surah/${String(n).padStart(3, '0')}.json`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  surahCache.set(n, p);
  return p;
}

/* ---------- render ---------- */

function ruled(n, cls = '') {
  return `<div class="rules ${cls}">${'<div class="rl"></div>'.repeat(n)}</div>`;
}

function editable(key, ph, cls = '') {
  return `<div class="te ${cls}" contenteditable="plaintext-only" spellcheck="false"
    data-k="${esc(key)}" data-ph="${esc(ph)}">${esc(Notes.get(key))}</div>`;
}

function ayahHead(s, n) {
  const num = S.showNums
    ? `<span class="ayah-no">(${ar(n)})</span>` : '';
  return `<div class="ayah-head">${num}
    <span class="ayah-tag">${s}:${n}</span></div>`;
}

function fullAyah(words, n) {
  const num = S.showNums ? `<span class="num">(${ar(n)})</span>` : '';
  return `<div class="ayah-full">${words.map((w) => esc(stripWaqf(w))).join(' ')} ${num}</div>`;
}

function renderAyah(s, a) {
  const { n, w } = a;
  const typing = S.mode === 'type';
  const inkable = S.mode === 'draw';
  let body = '';

  if (S.layout === 'grid') {
    body = '<div class="wgrid">' + w.map((word, i) => `
      <div class="wcell-wrap"><div class="wcell">
        <div class="idx">${i + 1}</div>
        <div class="w">${esc(stripWaqf(word))}</div>
        ${typing ? editable(`${s}:${n}:${i}:note`, '')
                 : ruled(S.lines)}
      </div></div>`).join('') + '</div>';

  } else if (S.layout === 'table') {
    const head = `<tr><th>#</th><th>Word</th><th>Sarf</th>
      <th>I'rab</th>${S.colMeaning ? '<th>Meaning</th>' : ''}</tr>`;
    const rows = w.map((word, i) => `
      <tr>
        <td class="c-num">${i + 1}</td>
        <td class="c-word">${esc(stripWaqf(word))}</td>
        <td>${typing ? editable(`${s}:${n}:${i}:sarf`, '') : ''}</td>
        <td>${typing ? editable(`${s}:${n}:${i}:nahw`, '') : ''}</td>
        ${S.colMeaning ? `<td class="c-mani">${
          a.m?.[i] ? esc(a.m[i])
          : (typing ? editable(`${s}:${n}:${i}:mani`, '') : '')
        }</td>` : ''}
      </tr>`).join('');
    body = fullAyah(w, n) +
      `<table class="tarkeeb"><thead>${head}</thead><tbody>${rows}</tbody></table>`;

  } else if (S.layout === 'lines') {
    body = fullAyah(w, n) +
      (typing ? editable(`${s}:${n}:0:prose`, '', 'big')
              : ruled(Math.max(3, S.lines * 2)));

  } else { /* tree */
    const h = Math.max(150, S.lines * 72);
    body = fullAyah(w, n) + (typing
      ? editable(`${s}:${n}:0:prose`, '', 'big')
      : `<div class="field-box" style="height:${h}px">
           <svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%"
             fill="url(#dotgrid)"></rect></svg></div>`);
  }

  return `<section class="ayah${inkable ? ' inkable' : ''}"`
    + (inkable ? ` data-key="${s}:${n}"` : '')
    + `><div class="ayah-inner">${ayahHead(s, n)}${body}</div></section>`;
}

async function render() {
  const sheet = $('#sheet');

  if (!INDEX) {
    sheet.className = 'sheet';
    QN.mountImporter(sheet, (b) => adoptBundle(b));
    return;
  }

  const picked = [];
  for (let s = S.s1; s <= S.s2; s++) {
    let data;
    try { data = await getSurah(s); }
    catch (e) {
      sheet.innerHTML = `<div class="empty"><p>Surah ${s} wasn't found.</p>
        <p><code>data/surah/${String(s).padStart(3, '0')}.json</code></p></div>`;
      return;
    }
    const lo = s === S.s1 ? S.a1 : 1;
    const hi = s === S.s2 ? S.a2 : Infinity;
    const ayahs = data.ayahs.filter((a) => a.n >= lo && a.n <= hi);
    if (ayahs.length) picked.push({ s, name: data.name, ayahs });
  }

  if (!picked.length) {
    sheet.innerHTML = '<div class="empty"><p>No ayat in that range.</p></div>';
    return;
  }

  const first = picked[0];
  const last = picked[picked.length - 1];
  const ref = `${first.s}:${first.ayahs[0].n} – ${last.s}:${last.ayahs.at(-1).n}`;
  const kinds = { grid: 'Word boxes', table: 'Table', lines: 'Lines', tree: 'Diagram' };
  const total = picked.reduce((t, p) => t + p.ayahs.length, 0);

  const dots = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs><pattern id="dotgrid" width="17" height="17" patternUnits="userSpaceOnUse">
      <circle cx="1.2" cy="1.2" r=".9" fill="#d3d8df"></circle>
    </pattern></defs></svg>`;

  const head = `<div class="jadwal"><div class="jadwal-in">
      <div class="sheet-head">
        <div class="sheet-title">${esc(picked.length > 1
          ? `${first.name} — ${last.name}` : first.name)}</div>
        <div class="sheet-ref">${ref}</div>
      </div>
      <div class="sheet-kind">${kinds[S.layout]} — ${total} ${total === 1 ? 'ayah' : 'ayat'}</div>
    </div></div>`;

  const multi = picked.length > 1;
  const body = picked.map((p) => {
    const mark = multi
      ? `<div class="surah-mark"><span class="nm">${esc(p.name)}</span>
           <span class="no">${p.s}</span></div>` : '';
    return mark + p.ayahs.map((a) => renderAyah(p.s, a)).join('');
  }).join('');

  sheet.className = `sheet ${S.mode}`;
  sheet.innerHTML = dots + head + body;

  if (S.onePer) {
    const blocks = sheet.querySelectorAll('.ayah');
    blocks.forEach((b, i) => { if (i < blocks.length - 1) b.classList.add('brk'); });
  }

  fitBlocks();

  if (S.mode === 'draw') Draw.attach(sheet); else Draw.detach();

  $('#status').textContent = S.mode === 'draw'
    ? `${total} ayat · ${Draw.count()} inked`
    : `${total} ayat · ${Notes.count()} notes saved`;
}

function fillSelectors() {
  if (!INDEX) return;
  $('#surah').innerHTML = INDEX.surahs.map((s) =>
    `<option value="${s.n}">${s.n}. ${esc(s.name)}${s.tr ? ' · ' + esc(s.tr) : ''}</option>`).join('');
  $('#juz').innerHTML = '<option value="">—</option>' +
    INDEX.juz.map((j) => `<option value="${j.n}">Juz ${j.n}${j.name ? ' · ' + esc(j.name) : ''}</option>`).join('');
  $('#surah').value = S.s1;
  clampRange();
}

function adoptBundle(b) {
  BUNDLE = b;
  INDEX = { surahs: b.surahs, juz: b.juz };
  if (!INDEX.surahs.some((x) => x.n === S.s1)) { S.s1 = S.s2 = 1; S.a1 = 1; S.a2 = 7; }
  $('#scriptNote').textContent = b.script ? 'Script: ' + b.script : 'Imported text';
  fillSelectors();
  refresh();
}

/* ---------- page geometry ---------- */
function pageContentPx() {
  const [pw, ph] = PAPER[S.paper];
  const H = S.orient === 'landscape' ? pw : ph;
  return H - 2 * (MARGIN_MM * 96 / 25.4);
}

/* An ayah taller than the page cannot be kept whole, so it gets scaled
   down to fit instead of being sliced across two sheets. */
function fitBlocks() {
  const max = pageContentPx() - 2;
  for (const el of $('#sheet').querySelectorAll('.ayah')) {
    const inner = el.querySelector('.ayah-inner');
    if (!inner) continue;
    inner.style.transform = ''; inner.style.width = ''; el.style.height = '';
    if (!S.fitPage) continue;
    const h = inner.getBoundingClientRect().height;
    if (h > max) {
      const k = max / h;
      inner.style.transformOrigin = 'top right';
      inner.style.transform = `scale(${k})`;
      inner.style.width = (100 / k) + '%';
      el.style.height = max + 'px';
    }
  }
}
function applyPaper() {
  const [w, h] = PAPER[S.paper];
  const width = S.orient === 'landscape' ? h : w;
  document.documentElement.style.setProperty('--sheet-w', `${Math.round(width)}px`);
  document.documentElement.style.setProperty('--sheet-pad', `${MARGIN_MM}mm`);
  $('#pageStyle').textContent =
    `@page { size: ${S.paper} ${S.orient}; margin: ${MARGIN_MM}mm; }`;
}

function applyFont() {
  document.documentElement.style.setProperty('--fs', `${S.fontSize}px`);
  document.documentElement.style.setProperty('--cols', S.cols);
  document.documentElement.style.setProperty(
    '--rowh', `${Math.max(44, S.lines * 24)}px`);
}

/* ---------- controls ---------- */

function setRadio(groupId, value) {
  $(`#${groupId}`).querySelectorAll('[role="radio"]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.v === value)));
}

function syncConditional() {
  document.querySelectorAll('[data-for]').forEach((el) => {
    el.classList.toggle('off', !el.dataset.for.split(' ').includes(S.layout));
  });
  $('#saveNotes').hidden = S.mode !== 'type';
  $('#penbar').hidden = S.mode !== 'draw';
  document.body.classList.toggle('drawing', S.mode === 'draw');
}

function surahAyahCount(n) {
  return INDEX?.surahs.find((x) => x.n === n)?.ayahs || 1;
}

function clampRange() {
  const max = surahAyahCount(S.s1);
  $('#from').max = max; $('#to').max = max;
  S.a1 = Math.min(Math.max(1, S.a1), max);
  S.a2 = Math.min(Math.max(S.a1, S.a2), max);
  $('#from').value = S.a1;
  $('#to').value = S.a2;
}

function noteRange() {
  const el = $('#rangeNote');
  if (S.s1 !== S.s2) {
    el.textContent = `${S.s1}:${S.a1} to ${S.s2}:${S.a2} — spans several surahs`;
  } else {
    const n = S.a2 - S.a1 + 1;
    el.textContent = `${n} ${n === 1 ? 'ayah' : 'ayat'} selected`;
  }
}

async function refresh({ paper = false, font = false } = {}) {
  if (paper) applyPaper();
  if (font) applyFont();
  syncConditional();
  noteRange();
  saveSettings();
  await render();
}

function wire() {
  $('#panelToggle').addEventListener('click', (e) => {
    const shell = document.querySelector('.shell');
    shell.classList.toggle('collapsed');
    e.currentTarget.setAttribute('aria-expanded',
      String(!shell.classList.contains('collapsed')));
  });

  $('#surah').addEventListener('change', (e) => {
    S.s1 = S.s2 = +e.target.value;
    S.a1 = 1; S.a2 = Math.min(7, surahAyahCount(S.s1));
    $('#juz').value = '';
    clampRange(); refresh();
  });

  $('#from').addEventListener('change', (e) => {
    S.s2 = S.s1; S.a1 = +e.target.value || 1;
    if (S.a2 < S.a1) S.a2 = S.a1;
    $('#juz').value = ''; clampRange(); refresh();
  });

  $('#to').addEventListener('change', (e) => {
    S.s2 = S.s1; S.a2 = +e.target.value || 1;
    if (S.a2 < S.a1) S.a1 = S.a2;
    $('#juz').value = ''; clampRange(); refresh();
  });

  $('#wholeSurah').addEventListener('click', () => {
    S.s2 = S.s1; S.a1 = 1; S.a2 = surahAyahCount(S.s1);
    $('#juz').value = ''; clampRange(); refresh();
  });

  $('#juz').addEventListener('change', (e) => {
    const j = INDEX.juz.find((x) => x.n === +e.target.value);
    if (!j) return;
    [S.s1, S.a1] = j.from; [S.s2, S.a2] = j.to;
    $('#surah').value = S.s1;
    $('#from').value = S.a1; $('#to').value = S.a2;
    refresh();
  });

  $('#layout').addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]'); if (!b) return;
    S.layout = b.dataset.v; setRadio('layout', S.layout); refresh();
  });

  $('#mode').addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]'); if (!b) return;
    S.mode = b.dataset.v; setRadio('mode', S.mode); refresh();
  });

  $('#fontSize').addEventListener('input', (e) => {
    S.fontSize = +e.target.value; $('#fsOut').textContent = S.fontSize;
    applyFont(); saveSettings();
  });

  $('#lines').addEventListener('input', (e) => {
    S.lines = +e.target.value; $('#lnOut').textContent = S.lines; applyFont();
  });
  $('#lines').addEventListener('change', () => refresh());

  $('#cols').addEventListener('input', (e) => {
    S.cols = +e.target.value; $('#colsOut').textContent = S.cols; applyFont();
  });
  $('#cols').addEventListener('change', () => refresh());

  for (const id of ['colMeaning', 'showNums', 'onePer', 'noWaqf', 'fitPage']) {
    $(`#${id}`).addEventListener('change', (e) => {
      S[id] = e.target.checked; refresh();
    });
  }

  $('#paper').addEventListener('change', (e) => {
    S.paper = e.target.value; refresh({ paper: true });
  });
  $('#orient').addEventListener('change', (e) => {
    S.orient = e.target.value; refresh({ paper: true });
  });

  /* ---------- pen toolbar ---------- */
  const press = (group, el) => {
    group.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === el)));
  };

  $('#penColors').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    Draw.setTool({ color: b.dataset.c, eraser: false });
    press($('#penColors'), b);
    $('#penEraser').setAttribute('aria-pressed', 'false');
  });

  $('#penSizes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    Draw.setTool({ size: +b.dataset.s });
    press($('#penSizes'), b);
  });

  /* Ayah-step navigation. Works while scroll is locked, because
     overflow:hidden still allows programmatic scrolling. */
  let navIdx = 0;
  function stepAyah(dir) {
    const stage = document.querySelector('.stage');
    const blocks = [...$('#sheet').querySelectorAll('.ayah')];
    if (!blocks.length) return;
    // Re-sync to whatever is on screen, in case the person scrolled by hand.
    const top = stage.getBoundingClientRect().top + 8;
    let seen = blocks.findIndex((b) => b.getBoundingClientRect().bottom > top);
    if (seen !== -1) navIdx = seen;
    navIdx = Math.min(Math.max(0, navIdx + dir), blocks.length - 1);
    blocks[navIdx].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  $('#penPrev').addEventListener('click', () => stepAyah(-1));
  $('#penNext').addEventListener('click', () => stepAyah(1));

  $('#penLock').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Unlock scroll' : 'Lock scroll';
    Draw.setLocked(on);
    $('#status').textContent = on ? 'scroll locked' : 'scroll unlocked';
  });

  $('#penEraser').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    Draw.setTool({ eraser: on });
  });

  $('#penUndo').addEventListener('click', () => {
    if (!Draw.undo()) $('#status').textContent = 'nothing to undo';
  });

  $('#penClear').addEventListener('click', () => {
    const n = Draw.clearVisible($('#sheet'));
    $('#status').textContent = n ? `cleared ${n} ayat` : 'nothing to clear';
  });

  document.addEventListener('draw:saved', () => {
    if (S.mode === 'draw') $('#status').textContent = `saved · ${Draw.count()} inked`;
  });

  /* Ink must be on the page before the print snapshot is taken. */
  window.addEventListener('beforeprint', () => {
    Draw.mountAll($('#sheet'));
    Draw.repaintAll();
  });

  $('#printBtn').addEventListener('click', async () => {
    fitBlocks();
    if (S.mode === 'draw') {
      await Draw.flush();
      Draw.mountAll($('#sheet'));
      Draw.repaintAll();
    }
    window.print();
  });

  /* typing: debounced write-through */
  let t = null;
  $('#sheet').addEventListener('input', (e) => {
    const el = e.target.closest('.te'); if (!el) return;
    clearTimeout(t);
    t = setTimeout(() => {
      Notes.set(el.dataset.k, el.textContent.trim());
      $('#status').textContent = `saved · ${Notes.count()} notes`;
    }, 350);
  });

  $('#saveNotes').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Notes.all(), null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nahw-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#reimport').addEventListener('click', () => {
    INDEX = null; BUNDLE = null; render();
  });

  $('#exportData').addEventListener('click', () => {
    if (BUNDLE) QN.download(BUNDLE);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') { /* let browser print */ }
  });
}

/* ---------- boot ---------- */
(async function init() {
  loadSettings();
  await Notes.load();
  await Draw.load();

  let stored = null;
  try { stored = await QN.loadBundle(); } catch (_) {}

  if (stored && stored.text) {
    BUNDLE = stored;
    INDEX = { surahs: stored.surahs, juz: stored.juz };
  } else {
    try {
      const r = await fetch('data/quran-data.json');
      if (r.ok) {
        BUNDLE = await r.json();
        INDEX = { surahs: BUNDLE.surahs, juz: BUNDLE.juz };
      }
    } catch (_) {}
  }

  if (!INDEX) {
    try {
      INDEX = await fetch('data/index.json').then((r) => {
        if (!r.ok) throw new Error(r.status); return r.json();
      });
    } catch (_) { INDEX = null; }
  }

  if (BUNDLE?.script) $('#scriptNote').textContent = 'Script: ' + BUNDLE.script;
  fillSelectors();

  $('#fontSize').value = S.fontSize; $('#fsOut').textContent = S.fontSize;
  $('#lines').value = S.lines; $('#lnOut').textContent = S.lines;
  $('#colMeaning').checked = S.colMeaning;
  $('#showNums').checked = S.showNums;
  $('#onePer').checked = S.onePer;
  $('#fitPage').checked = S.fitPage;
  $('#cols').value = S.cols;
  $('#colsOut').textContent = S.cols;
  $('#noWaqf').checked = S.noWaqf;
  $('#paper').value = S.paper;
  $('#orient').value = S.orient;
  setRadio('layout', S.layout);
  setRadio('mode', S.mode);

  wire();
  applyPaper();
  applyFont();
  await refresh();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
