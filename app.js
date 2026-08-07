/* نحوی مشق — Quran Nahw worksheet app
   Offline-first. All state lives in IndexedDB. No network needed after first load. */

'use strict';

/* ------------------------------------------------------------------ config */

const COLUMNS = [
  { id: 'noo',     label: 'Type',      on: true },
  { id: 'sighah',  label: 'Form',      on: true },
  { id: 'irab',    label: "I'rab",     on: true, irab: true },
  { id: 'tarkeeb', label: 'Structure', on: true },
  { id: 'madda',   label: 'Root',      on: false },
  { id: 'tarjuma', label: 'Meaning',   on: false },
];

const AR_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const toArabicDigits = n => String(n).replace(/\d/g, d => AR_DIGITS[+d]);
const pad3 = n => String(n).padStart(3, '0');

/* ------------------------------------------------------------------ idb */

const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('nahw', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('notes'))  db.createObjectStore('notes',  { keyPath: 'k' });
      if (!db.objectStoreNames.contains('surahs')) db.createObjectStore('surahs', { keyPath: 'surah' });
      if (!db.objectStoreNames.contains('prefs'))  db.createObjectStore('prefs',  { keyPath: 'k' });
      if (!db.objectStoreNames.contains('morph'))  db.createObjectStore('morph',  { keyPath: 'surah' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));

  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  };

  return {
    get:  (s, k) => tx(s, 'readonly',  st => st.get(k)),
    put:  (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del:  (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    all:  (s)    => tx(s, 'readonly',  st => st.getAll()),
    clear:(s)    => tx(s, 'readwrite', st => st.clear()),
  };
})();

/* ------------------------------------------------------------------ state */

const S = {
  index: null,
  surah: 1,
  from: 1,
  to: 7,
  mode: 'hand',          // hand | type
  layout: 'takhti',      // takhti | jadwal | satrain
  cols: COLUMNS.filter(c => c.on).map(c => c.id),
  translation: false,
  wordMeaning: false,
  ref: true,
  verseLine: true,
  guides: true,
  labels: false,        // field names printed inside the boxes
  qsize: 34,
  boxh: 34,
  perRow: 0,
  taqti: false,         // draw morphological segment boundaries — off by default
  segBoxes: 'own',      // own | shared — boxes per segment, or one set per word
  showPos: false,       // prefill نوع from the corpus tag
  paper: 'auto',        // auto | a4 | fit
  theme: 'auto',        // auto | light | dark
  notes: new Map(),
};

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* Some embedded webviews ship without matchMedia. Degrade instead of dying. */
const mq = q => (typeof matchMedia === 'function'
  ? matchMedia(q)
  : { matches: false, addEventListener() {}, removeEventListener() {} });

const status = msg => { $('#status').textContent = msg || ''; };
const notice = msg => {
  const n = $('#notice');
  n.textContent = msg || '';
  n.hidden = !msg;
};

/* ------------------------------------------------------------------ font */

/* The Quran font can arrive two ways: served from fonts/ next to index.html,
   or installed on the operating system. Android only ever honours the first.
   Falling back silently means studying the wrong letterforms, so say so. */
const FONT_NAMES = ['Quran IndoPak', 'AlQuran IndoPak by QuranWBW', 'Al Qalam Quran'];

async function checkFont() {
  const box = $('#fontNotice');
  if (!box || !document.fonts || typeof document.fonts.check !== 'function') return;
  try {
    await Promise.all(FONT_NAMES.map(f =>
      document.fonts.load(`30px "${f}"`, 'بسم').catch(() => {})));
    if (document.fonts.ready) await document.fonts.ready;
    const found = FONT_NAMES.find(f => document.fonts.check(`30px "${f}"`));
    if (found) { box.hidden = true; return; }
    box.textContent =
      'Quran font not loaded — the text below is in a fallback face, not IndoPak. ' +
      'Put your font file at fonts/quran.ttf (or fonts/quran.woff2) next to index.html. ' +
      'On Android a font installed on the device cannot be used; it must be served with the app.';
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

/* ------------------------------------------------------------------ data */

/* Your export lives in data/. The bundled sample lives in demo/ and is only
   reached when data/ is absent, so an update can never overwrite your text. */
let DATA_DIR = 'data';

async function loadIndex() {
  for (const dir of ['data', 'demo']) {
    const res = await fetch(`${dir}/index.json`, { cache: 'no-cache' }).catch(() => null);
    if (res && res.ok) {
      DATA_DIR = dir;
      const idx = await res.json();
      idx.demo = (dir === 'demo');
      await DB.put('prefs', { k: 'index', v: idx });
      return idx;
    }
  }
  const cached = await DB.get('prefs', 'index');
  if (cached) { DATA_DIR = cached.v.demo ? 'demo' : 'data'; return cached.v; }
  throw new Error('data/index.json not found');
}

async function loadSurah(n) {
  const cached = await DB.get('surahs', n);
  if (cached) return cached;
  const res = await fetch(`${DATA_DIR}/surah-${pad3(n)}.json`).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json();
  await DB.put('surahs', data);
  return data;
}

async function loadMorph(n) {
  const cached = await DB.get('morph', n);
  if (cached) return cached;
  if (!S.index.morph || !S.index.morph.surahs.includes(n)) return null;
  const res = await fetch(`${DATA_DIR}/morph-${pad3(n)}.json`).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json();
  await DB.put('morph', data);
  return data;
}

/* An ayah marker stored as a word has no Arabic letters — digits or a
   medallion glyph only. Skip it, but keep the original index so note keys
   and morphology alignment stay put. */
const HAS_LETTER = /[\u0620-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06EE-\u06EF\u06FA-\u06FF]/;

function realWords(verse) {
  const out = [];
  for (const t of verse.w) {
    // Renumber sequentially rather than keeping the raw position. A database
    // that stores waqf marks as word rows shifts every later index, and
    // morphology is keyed on word index. Numbering the real words 1..n makes
    // dirty data render exactly like a clean export — so segmentation lands
    // correctly and saved answers survive a re-export.
    if (HAS_LETTER.test(t)) out.push({ t, i: out.length + 1 });
  }
  return out;
}

/* ------------------------------------------------------------------ تقطیع */

/* A cut may only fall between clusters — a base letter keeps its own
   diacritics, so بِ never loses its kasra to the next segment. */
const COMBINING = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;

function clusters(word) {
  const out = [];
  for (const ch of word) {
    if (out.length && COMBINING.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/* Returns [{t, pos}] — one entry per segment, or a single entry when the
   word is not split. Cuts come from the morphology import; nothing here
   guesses a boundary. */
function segmentsOf(a, w, word) {
  const rec = S.morph && S.morph.segs[`${a}:${w}`];
  if (!S.taqti || !rec || !rec.c.length) return [{ t: word, pos: '' }];
  const cl = clusters(word);
  const pts = [0, ...rec.c.filter(c => c > 0 && c < cl.length), cl.length];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push({ t: cl.slice(pts[i], pts[i + 1]).join(''), pos: (rec.p || [])[i] || '' });
  }
  return out.length > 1 ? out : [{ t: word, pos: '' }];
}

/* ------------------------------------------------------------------ notes */

const noteKey = (s, a, w) => `${s}:${a}:${w}`;

async function loadNotesForRange() {
  const all = await DB.all('notes');
  S.notes = new Map(all.map(r => [r.k, r]));
}

let saveTimer;
const dirty = new Set();

function queueSave(key, field, value) {
  const rec = S.notes.get(key) || { k: key };
  rec[field] = value;
  rec.at = Date.now();
  S.notes.set(key, rec);
  dirty.add(key);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

async function flush() {
  if (!dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  for (const k of keys) {
    const rec = S.notes.get(k);
    if (rec) await DB.put('notes', rec);
  }
  status('Saved · ' + new Date().toLocaleTimeString());
}

// don't lose the last keystroke on tab close or app switch
addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
addEventListener('pagehide', flush);

/* ------------------------------------------------------------------ render */

function makeEditable(node) {
  node.setAttribute('contenteditable', 'true');
  node.setAttribute('spellcheck', 'false');
  node.setAttribute('role', 'textbox');
  node.setAttribute('aria-label', node.dataset.f);
}

function activeCols() {
  return COLUMNS.filter(c => S.cols.includes(c.id));
}

function render(data) {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  sheet.style.setProperty('--q-size', S.qsize + 'px');
  sheet.style.setProperty('--box-h', S.boxh + 'px');
  sheet.classList.toggle('is-guides', S.guides);

  if (!data) {
    const box = el('div', 'sheet__empty');
    box.append(
      el('p', null, 'No text loaded for this surah.'),
      el('p', null, 'Run tools/qul_export.py to build the data/ folder.')
    );
    sheet.append(box);
    return;
  }

  const meta = S.index.surahs.find(s => s.n === S.surah);
  const head = el('header', 'sheet__head');
  const title = el('h1', 'sheet__title');
  title.textContent = meta ? `Surah ${meta.en}` : 'Worksheet';
  head.append(
    title,
    el('span', 'sheet__range', `${S.surah}:${S.from}–${S.to}`)
  );
  sheet.append(head);

  for (let a = S.from; a <= S.to; a++) {
    const verse = data.verses[a - 1];
    if (!verse) continue;
    sheet.append(buildAyah(a, verse));
  }

  if (S.mode === 'type') applyNotes();
}

function buildAyah(a, verse) {
  const wrap = el('section', 'ayah');
  wrap.dataset.ayah = a;

  if (S.ref || S.translation) {
    const bar = el('div', 'ayah__bar');
    if (S.ref) bar.append(el('span', 'ayah__no', `${S.surah}:${a}`));
    if (S.translation && verse.t) bar.append(el('span', 'ayah__trans', verse.t));
    wrap.append(bar);
  }

  if (S.verseLine) {
    const line = el('p', 'verseline');
    line.textContent = realWords(verse).map(x => x.t).join(' ') + ' ';
    const num = el('span', 'verseline__num', `(${toArabicDigits(a)})`);
    line.append(num);
    wrap.append(line);
  }

  if (S.layout === 'takhti')  wrap.append(buildTakhti(a, verse));
  if (S.layout === 'jadwal')  wrap.append(buildJadwal(a, verse));
  if (S.layout === 'satrain') wrap.append(buildSatrain(a, verse));

  return wrap;
}

function buildTakhti(a, verse) {
  const grid = el('div', 'takhti');
  grid.style.gridTemplateColumns = S.perRow > 0
    ? `repeat(${S.perRow}, minmax(0, 1fr))`
    : 'repeat(auto-fill, minmax(150px, 1fr))';
  grid.style.display = 'grid';
  grid.style.gap = '9px';

  realWords(verse).forEach(({ t: word, i: w }) => {
    const segs = segmentsOf(a, w, word);
    const split = segs.length > 1;
    const card = el('article', 'card' + (split ? ' card--split' : ''));

    const head = el('div', 'card__word');
    if (split && S.segBoxes === 'shared') {
      segs.forEach(sg => head.append(el('span', 'part', sg.t)));
    } else {
      head.textContent = word;
    }
    card.append(head);

    if (S.ref) card.append(el('span', 'card__ref', `${S.surah}:${a}:${w}`));
    if (S.wordMeaning) card.append(el('div', 'card__meaning', (verse.m && verse.m[w - 1]) || ''));

    const slotsFor = key => {
      const box = el('div', 'card__slots');
      activeCols().forEach(c => {
        const slot = el('div', 'slot' + (c.irab ? ' slot--irab' : ''));
        if (S.labels) slot.append(el('span', 'slot__tag', c.label));
        const write = el('div', 'slot__write');
        write.dataset.k = key;
        write.dataset.f = c.id;
        write.dataset.ph = '';
        if (S.mode === 'type') makeEditable(write);
        slot.append(write);
        box.append(slot);
      });
      return box;
    };

    if (split && S.segBoxes === 'own') {
      segs.forEach((sg, si) => {
        const part = el('div', 'seg');
        const t = el('div', 'seg__text', sg.t);
        if (S.showPos && sg.pos) t.append(el('span', 'seg__pos', sg.pos));
        part.append(t, slotsFor(noteKey(S.surah, a, w) + '#' + si));
        card.append(part);
      });
    } else {
      card.append(slotsFor(noteKey(S.surah, a, w)));
    }
    grid.append(card);
  });
  return grid;
}

function buildJadwal(a, verse) {
  const table = el('table', 'jadwal');
  const cols = activeCols();

  if (S.labels) {
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', null, 'Word'));
    if (S.ref) hr.append(el('th', null, 'Ref'));
    if (S.wordMeaning) hr.append(el('th', null, 'Meaning'));
    cols.forEach(c => hr.append(el('th', c.irab ? 'is-irab' : null, c.label)));
    thead.append(hr);
    table.append(thead);
  }

  const tbody = el('tbody');
  realWords(verse).forEach(({ t: word, i: w }) => {
    const segs = segmentsOf(a, w, word);
    const split = segs.length > 1;
    const rows = (split && S.segBoxes === 'own')
      ? segs.map((sg, si) => ({ text: sg.t, pos: sg.pos, ref: `${S.surah}:${a}:${w}-${si + 1}`,
                                key: noteKey(S.surah, a, w) + '#' + si }))
      : [{ text: null, segs, ref: `${S.surah}:${a}:${w}`, key: noteKey(S.surah, a, w) }];

    rows.forEach((row, ri) => {
      const tr = el('tr', ri ? 'row--cont' : null);
      const wc = el('td', 'cell--word');
      if (row.text != null) {
        wc.textContent = row.text;
        if (S.showPos && row.pos) wc.append(el('span', 'seg__pos', row.pos));
      } else if (split) {
        row.segs.forEach(sg => wc.append(el('span', 'part', sg.t)));
      } else {
        wc.textContent = word;
      }
      tr.append(wc);
      if (S.ref) tr.append(el('td', 'cell--ref', row.ref));
      if (S.wordMeaning) tr.append(el('td', 'cell--meaning', ri ? '' : ((verse.m && verse.m[w - 1]) || '')));
      cols.forEach(c => {
        const td = el('td', 'cell--write' + (c.irab ? ' cell--irab' : ''));
        td.dataset.k = row.key;
        td.dataset.f = c.id;
        td.dataset.ph = '';
        if (S.mode === 'type') makeEditable(td);
        tr.append(td);
      });
      tbody.append(tr);
    });
  });
  table.append(tbody);
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  return wrap;
}

function buildSatrain(a, verse) {
  const box = el('div', 'satrain__lines');
  box.style.minHeight = (S.boxh * 4) + 'px';
  box.dataset.k = noteKey(S.surah, a, 0);
  box.dataset.f = 'free';
  box.dataset.ph = '';
  if (S.mode === 'type') makeEditable(box);
  return box;
}

function applyNotes() {
  $$('#sheet [data-k]').forEach(node => {
    const rec = S.notes.get(node.dataset.k);
    const v = rec && rec[node.dataset.f];
    if (v) node.textContent = v;
  });
}

/* ------------------------------------------------------------------ flow */

async function refresh() {
  clearTimeout(saveTimer);
  await flush();
  const meta = S.index.surahs.find(s => s.n === S.surah);
  const max = meta ? meta.ayahs : 1;
  $('#from').max = max;
  $('#to').max = max;
  S.from = Math.min(Math.max(1, S.from), max);
  S.to   = Math.min(Math.max(S.from, S.to), max);
  $('#from').value = S.from;
  $('#to').value = S.to;

  status('Loading…');
  const data = await loadSurah(S.surah);
  S.morph = await loadMorph(S.surah);
  const attr = $('#morphAttr');
  if (attr) {
    attr.textContent = S.morph
      ? (S.index.morph && S.index.morph.source) || ''
      : 'No splitting data for this surah. Optional — run tools/morph_import.py if you want it.';
  }
  if (!data) {
    notice(`No text for surah ${S.surah}. Run tools/qul_export.py to build data/.`);
  } else if (S.index.demo || data.demo) {
    notice('Showing bundled sample text. Export your own into data/ to replace it.');
  } else {
    notice('');
  }
  render(data);
  const words = data ? countWords(data) : 0;
  status(words ? `${S.to - S.from + 1} ayahs · ${words} words` : '');
  savePrefs();
}

function countWords(data) {
  let n = 0;
  for (let a = S.from; a <= S.to; a++) {
    const v = data.verses[a - 1];
    if (v) n += realWords(v).length;
  }
  return n;
}

/* ------------------------------------------------------------------ prefs */

const PREF_KEYS = ['surah','from','to','mode','layout','cols','translation','wordMeaning',
  'ref','verseLine','guides','labels','qsize','boxh','perRow','paper','theme',
  'taqti','segBoxes','showPos'];

function savePrefs() {
  const v = {};
  PREF_KEYS.forEach(k => v[k] = S[k]);
  DB.put('prefs', { k: 'ui', v }).catch(() => {});
}

async function restorePrefs() {
  const rec = await DB.get('prefs', 'ui').catch(() => null);
  if (!rec || !rec.v) return false;
  PREF_KEYS.forEach(k => { if (rec.v[k] !== undefined) S[k] = rec.v[k]; });
  return true;
}

/* First run only: start from sizes that suit the device it was opened on.
   Everything here stays user-overridable from ترتیبات. */
function deviceDefaults() {
  const w = window.innerWidth;
  if (w < 640)       { S.qsize = 26; S.boxh = 30; S.perRow = 2; }
  else if (w < 1024) { S.qsize = 30; S.perRow = 3; }
  if (mq('(pointer: coarse)').matches) S.boxh = Math.max(S.boxh, 44);
}

/* ------------------------------------------------------------------ device */

function effectivePaper() {
  if (S.paper !== 'auto') return S.paper;
  // A4 preview is only honest when 210mm plus margins genuinely fits
  return mq('(min-width: 900px)').matches ? 'a4' : 'fit';
}

function applyPaper() {
  const eff = effectivePaper();
  const stage = document.querySelector('.stage');
  if (stage) stage.dataset.paper = eff;
  const note = $('#paperNote');
  if (note) note.textContent = eff === 'a4'
    ? 'Sheet is exactly A4 wide — what you see is what prints.'
    : 'Sheet fills the window. Printing is still A4.';
}

function effectiveTheme() {
  if (S.theme !== 'auto') return S.theme;
  return mq('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const eff = effectiveTheme();
  document.documentElement.dataset.theme = eff;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = eff === 'dark' ? '#0b0e13' : '#191d26';
}

const isPhone = () => mq('(max-width: 640px)').matches;

function setSettings(open) {
  const p = $('#settings');
  p.hidden = !open;
  $('#settingsToggle').setAttribute('aria-expanded', String(open));
  document.body.style.overflow = (open && isPhone()) ? 'hidden' : '';
  if (open) p.scrollTop = 0;
}

/* ------------------------------------------------------------------ ui wiring */

function buildControls() {
  const sel = $('#surah');
  S.index.surahs.forEach(s => {
    const o = el('option', null, `${s.n}. ${s.ar}${s.en ? ' — ' + s.en : ''}`);
    o.value = s.n;
    sel.append(o);
  });
  sel.value = S.surah;

  const juz = $('#juz');
  juz.append(Object.assign(el('option', null, '—'), { value: '' }));
  (S.index.juz || []).forEach(j => {
    const o = el('option', null, `Juz ${j.n}`);
    o.value = j.n;
    juz.append(o);
  });

  const chips = $('#cols');
  COLUMNS.forEach(c => {
    const lab = el('label', 'chip');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    cb.checked = S.cols.includes(c.id);
    cb.addEventListener('change', () => {
      S.cols = $$('#cols input:checked').map(i => i.value);
      refresh();
    });
    lab.append(cb, el('span', null, c.label));
    chips.append(lab);
  });

  $('#optTranslation').checked = S.translation;
  $('#optWordMeaning').checked = S.wordMeaning;
  $('#optRef').checked = S.ref;
  $('#optVerseLine').checked = S.verseLine;
  $('#optGuides').checked = S.guides;
  $('#optLabels').checked = S.labels;
  $('#optTaqti').checked = S.taqti;
  $('#optShowPos').checked = S.showPos;
  $('#qsize').value = S.qsize;  $('#qsizeVal').textContent = S.qsize;
  $('#boxh').value = S.boxh;    $('#boxhVal').textContent = S.boxh;
  $('#perRow').value = S.perRow;
  $('#perRowVal').textContent = S.perRow || 'Auto';

  $$('.seg__btn[data-mode]').forEach(b => b.classList.toggle('is-on', b.dataset.mode === S.mode));
  $$('.seg__btn[data-layout]').forEach(b => b.classList.toggle('is-on', b.dataset.layout === S.layout));
  $$('.seg__btn[data-paper]').forEach(b => b.classList.toggle('is-on', b.dataset.paper === S.paper));
  $$('.seg__btn[data-theme]').forEach(b => b.classList.toggle('is-on', b.dataset.theme === S.theme));
  $$('.seg__btn[data-segboxes]').forEach(b => b.classList.toggle('is-on', b.dataset.segboxes === S.segBoxes));
}

function wire() {
  $('#surah').addEventListener('change', e => {
    S.surah = +e.target.value;
    const meta = S.index.surahs.find(s => s.n === S.surah);
    S.from = 1;
    S.to = Math.min(meta ? meta.ayahs : 1, 10);
    refresh();
  });

  $('#from').addEventListener('change', e => { S.from = +e.target.value || 1; refresh(); });
  $('#to').addEventListener('change',   e => { S.to   = +e.target.value || 1; refresh(); });

  $('#wholeSurah').addEventListener('click', () => {
    const meta = S.index.surahs.find(s => s.n === S.surah);
    S.from = 1;
    S.to = meta ? meta.ayahs : 1;
    refresh();
  });

  $('#juz').addEventListener('change', e => {
    const n = +e.target.value;
    if (!n) return;
    const list = S.index.juz;
    const start = list.find(j => j.n === n);
    const next = list.find(j => j.n === n + 1);
    S.surah = start.s;
    S.from = start.a;
    const meta = S.index.surahs.find(s => s.n === S.surah);
    S.to = (next && next.s === start.s) ? next.a - 1 : (meta ? meta.ayahs : start.a);
    $('#surah').value = S.surah;
    refresh();
  });

  $$('.seg__btn[data-mode]').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    $$('.seg__btn[data-mode]').forEach(x => x.classList.toggle('is-on', x === b));
    refresh();
  }));

  $$('.seg__btn[data-layout]').forEach(b => b.addEventListener('click', () => {
    S.layout = b.dataset.layout;
    $$('.seg__btn[data-layout]').forEach(x => x.classList.toggle('is-on', x === b));
    $('#layoutNote').textContent = ({
      takhti: 'One card per word, with writing space beneath.',
      jadwal: 'One table row per word, one column per field.',
      satrain: 'The ayah, then open ruled lines.',
    })[S.layout];
    refresh();
  }));

  const bind = (id, key) => $(id).addEventListener('change', e => {
    S[key] = e.target.checked;
    refresh();
  });
  bind('#optTranslation', 'translation');
  bind('#optWordMeaning', 'wordMeaning');
  bind('#optRef', 'ref');
  bind('#optVerseLine', 'verseLine');
  bind('#optGuides', 'guides');
  bind('#optLabels', 'labels');
  bind('#optTaqti', 'taqti');
  bind('#optShowPos', 'showPos');

  $$('.seg__btn[data-segboxes]').forEach(b => b.addEventListener('click', () => {
    S.segBoxes = b.dataset.segboxes;
    $$('.seg__btn[data-segboxes]').forEach(x => x.classList.toggle('is-on', x === b));
    refresh();
  }));

  const slide = (id, key, out, fmt) => $(id).addEventListener('input', e => {
    S[key] = +e.target.value;
    $(out).textContent = fmt ? fmt(S[key]) : S[key];
    const sheet = $('#sheet');
    sheet.style.setProperty('--q-size', S.qsize + 'px');
    sheet.style.setProperty('--box-h', S.boxh + 'px');
    if (key === 'perRow') refresh(); else savePrefs();
  });
  slide('#qsize', 'qsize', '#qsizeVal');
  slide('#boxh', 'boxh', '#boxhVal');
  slide('#perRow', 'perRow', '#perRowVal', v => v || 'Auto');

  $$('.seg__btn[data-paper]').forEach(b => b.addEventListener('click', () => {
    S.paper = b.dataset.paper;
    $$('.seg__btn[data-paper]').forEach(x => x.classList.toggle('is-on', x === b));
    applyPaper();
    savePrefs();
  }));

  $$('.seg__btn[data-theme]').forEach(b => b.addEventListener('click', () => {
    S.theme = b.dataset.theme;
    $$('.seg__btn[data-theme]').forEach(x => x.classList.toggle('is-on', x === b));
    applyTheme();
    savePrefs();
  }));

  $('#settingsToggle').addEventListener('click', () => setSettings($('#settings').hidden));
  $('#settingsClose').addEventListener('click', () => setSettings(false));
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#settings').hidden) setSettings(false);
  });

  // viewport can change without a reload: rotation, window resize, split screen
  mq('(min-width: 900px)').addEventListener('change', applyPaper);
  mq('(max-width: 640px)').addEventListener('change', () => {
    if (!$('#settings').hidden) setSettings(true);
  });
  mq('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.theme === 'auto') applyTheme();
  });

  $('#print').addEventListener('click', () => window.print());

  $('#sheet').addEventListener('input', e => {
    const n = e.target.closest('[data-k]');
    if (!n) return;
    queueSave(n.dataset.k, n.dataset.f, n.textContent.trim());
  });

  $('#exportJson').addEventListener('click', async () => {
    const all = await DB.all('notes');
    const blob = new Blob([JSON.stringify({ app: 'nahw', at: Date.now(), notes: all }, null, 1)],
                          { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nahw-answers-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#importJson').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      for (const r of (data.notes || [])) await DB.put('notes', r);
      await loadNotesForRange();
      refresh();
      status(`Imported ${(data.notes || []).length} entries`);
    } catch { status('Could not read that file'); }
    e.target.value = '';
  });

  $('#clearRange').addEventListener('click', async () => {
    if (!confirm(`Clear answers for surah ${S.surah}, ayahs ${S.from}–${S.to}?`)) return;
    for (const [k] of S.notes) {
      const [s, a] = k.split(':').map(Number);
      if (s === S.surah && a >= S.from && a <= S.to) {
        await DB.del('notes', k);
        S.notes.delete(k);
      }
    }
    refresh();
    status('Cleared');
  });

  $('#cacheAll').addEventListener('click', async () => {
    let ok = 0;
    for (const s of S.index.surahs) {
      status(`Saving offline… ${s.n} / ${S.index.surahs.length}`);
      const d = await loadSurah(s.n);
      await loadMorph(s.n);
      if (d) ok++;
    }
    status(`${ok} surahs available offline`);
  });
}

/* ------------------------------------------------------------------ boot */

(async function boot() {
  try {
    const hadPrefs = await restorePrefs();
    if (!hadPrefs) deviceDefaults();
    applyTheme();
    applyPaper();
    S.index = await loadIndex();
    await loadNotesForRange();
    buildControls();
    wire();
    await refresh();
    checkFont();
  } catch (err) {
    $('#sheet').innerHTML = '';
    const box = el('div', 'sheet__empty');
    box.append(
      el('p', null, 'The app could not start.'),
      el('p', null, String(err.message || err)),
      el('p', null, 'Serve it over http — opening the file directly will not work.')
    );
    $('#sheet').append(box);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
