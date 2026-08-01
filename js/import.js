/* ============================================================
   نحوِ قرآن — in-browser QUL importer
   Reads the QUL word-by-word SQLite file with sql.js, applies the
   same rules as tools/build_data.py, and keeps the result in
   IndexedDB so the app works offline with no build step.
   ============================================================ */
'use strict';

window.QN = (function () {

  const WAQF = /[\u06d6-\u06ed]/g;
  const DIGITS = /^[\u0660-\u0669\u06f0-\u06f9\s]+$/;

  const SURAH_NAMES = ['الفاتحة','البقرة','آل عمران','النساء','المائدة','الأنعام',
    'الأعراف','الأنفال','التوبة','يونس','هود','يوسف','الرعد','إبراهيم','الحجر',
    'النحل','الإسراء','الكهف','مريم','طه','الأنبياء','الحج','المؤمنون','النور',
    'الفرقان','الشعراء','النمل','القصص','العنكبوت','الروم','لقمان','السجدة',
    'الأحزاب','سبأ','فاطر','يس','الصافات','ص','الزمر','غافر','فصلت','الشورى',
    'الزخرف','الدخان','الجاثية','الأحقاف','محمد','الفتح','الحجرات','ق','الذاريات',
    'الطور','النجم','القمر','الرحمن','الواقعة','الحديد','المجادلة','الحشر',
    'الممتحنة','الصف','الجمعة','المنافقون','التغابن','الطلاق','التحريم','الملك',
    'القلم','الحاقة','المعارج','نوح','الجن','المزمل','المدثر','القيامة','الإنسان',
    'المرسلات','النبأ','النازعات','عبس','التكوير','الانفطار','المطففين','الانشقاق',
    'البروج','الطارق','الأعلى','الغاشية','الفجر','البلد','الشمس','الليل','الضحى',
    'الشرح','التين','العلق','القدر','البينة','الزلزلة','العاديات','القارعة',
    'التكاثر','العصر','الهمزة','الفيل','قريش','الماعون','الكوثر','الكافرون',
    'النصر','المسد','الإخلاص','الفلق','الناس'];

  const JUZ_STARTS = [[1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],
    [7,88],[8,41],[9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],
    [25,21],[27,56],[29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],
    [58,1],[67,1],[78,1]];

  /* ---------- shared IndexedDB ---------- */
  let dbp = null;
  function openDB() {
    return (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('quran-nahw', 2);
      r.onupgradeneeded = (e) => {
        const db = r.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes');
        if (!db.objectStoreNames.contains('text')) db.createObjectStore('text');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }

  async function idbGet(store, key) {
    const db = await openDB();
    return new Promise((res) => {
      const rq = db.transaction(store).objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(undefined);
    });
  }

  async function idbPut(store, key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  /* ---------- sql.js, loaded only when needed ---------- */
  let sqlPromise = null;
  function loadSql() {
    return (sqlPromise ||= new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/sql-wasm.js';
      s.onload = () => initSqlJs({ locateFile: () => 'vendor/sql-wasm.wasm' })
        .then(res, rej);
      s.onerror = () => rej(new Error('sql-wasm.js لوڈ نہیں ہوا'));
      document.head.appendChild(s);
    }));
  }

  /* ---------- parse ---------- */
  async function parse(file, onStep) {
    onStep?.('Starting sql.js…');
    const SQL = await loadSql();

    onStep?.('Reading the file…');
    const buf = new Uint8Array(await file.arrayBuffer());
    const db = new SQL.Database(buf);

    // Find the word-by-word table.
    const names = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    let table = null, present = [];
    for (const row of (names[0]?.values || [])) {
      const t = row[0];
      present.push(t);
      const cols = (db.exec(`PRAGMA table_info("${t}")`)[0]?.values || [])
        .map((c) => String(c[1]).toLowerCase());
      if (['surah', 'ayah', 'word', 'text'].every((c) => cols.includes(c))) {
        table = t; break;
      }
    }
    if (!table) {
      db.close();
      throw new Error('No table with surah/ayah/word/text columns. Found: ' +
        present.join(', '));
    }

    onStep?.(`Table ${table} — extracting words…`);
    const stmt = db.prepare(
      `SELECT surah, ayah, word, text FROM "${table}" ORDER BY surah, ayah, word`);

    const verses = new Map();
    let rows = 0;
    while (stmt.step()) {
      const [s, a, , t] = stmt.get();
      const key = s * 10000 + a;
      let v = verses.get(key);
      if (!v) verses.set(key, v = { s: +s, a: +a, t: [] });
      const clean = String(t || '').replace(WAQF, '').trim();
      if (clean) v.t.push(clean);
      rows++;
    }
    stmt.free();
    db.close();

    if (!rows) throw new Error('That table is empty.');

    onStep?.('Assembling ayat…');
    const text = {};
    const surahs = [];
    let kept = 0, odd = 0;

    for (const v of verses.values()) {
      // Positional rule: last token of a verse is the ayah marker.
      const marker = v.t[v.t.length - 1];
      let words = v.t.slice(0, -1);
      if (!words.length) words = v.t;
      if (marker && !DIGITS.test(marker)) odd++;
      kept += words.length;
      (text[v.s] ||= { surah: v.s, name: SURAH_NAMES[v.s - 1], ayahs: [] })
        .ayahs.push({ n: v.a, w: words });
    }

    for (let s = 1; s <= 114; s++) {
      if (!text[s]) continue;
      text[s].ayahs.sort((x, y) => x.n - y.n);
      surahs.push({ n: s, name: text[s].name, ayahs: text[s].ayahs.length });
    }

    const juz = JUZ_STARTS.map(([s, a], i) => {
      let es, ea;
      if (i + 1 < JUZ_STARTS.length) {
        const [ns, na] = JUZ_STARTS[i + 1];
        if (na === 1) {
          es = ns - 1;
          ea = surahs.find((x) => x.n === es)?.ayahs || 1;
        } else { es = ns; ea = na - 1; }
      } else {
        es = 114; ea = surahs.find((x) => x.n === 114)?.ayahs || 6;
      }
      return { n: i + 1, from: [s, a], to: [es, ea] };
    });

    return { surahs, juz, text, stats: { rows, kept, odd, table } };
  }

  /* ---------- store ---------- */
  const saveBundle = (b) => idbPut('text', 'bundle',
    { surahs: b.surahs, juz: b.juz, text: b.text, at: Date.now() });
  const loadBundle = () => idbGet('text', 'bundle');

  /* ---------- import UI ---------- */
  function mountImporter(host, onDone) {
    host.innerHTML = `
      <div class="import">
        <h2>Import Quranic text</h2>
        <p class="im-lead">Choose your QUL word-by-word SQLite file. It's read
          on this device — nothing is uploaded anywhere.</p>
        <label class="im-drop" tabindex="0">
          <input type="file" accept=".db,.sqlite,.sqlite3" hidden>
          <span class="im-icon" aria-hidden="true">⤓</span>
          <span class="im-cta">Choose file</span>
          <span class="im-hint">or drop it here — <code>.db</code></span>
        </label>
        <p class="im-status" role="status"></p>
        <details class="im-help">
          <summary>Where do I get the file?</summary>
          <p><code>qul.tarteel.ai</code> → Resources → Word by Word →
            script&nbsp;#59 (Indo-Pak) → download the SQLite. That's the script
            matching font&nbsp;#242.</p>
          <p>With Python installed,
            <code>python tools/build_data.py your.db</code> does the same job
            without the browser.</p>
        </details>
      </div>`;

    const drop = host.querySelector('.im-drop');
    const input = host.querySelector('input[type=file]');
    const status = host.querySelector('.im-status');
    const say = (m, cls = '') => { status.textContent = m; status.className = 'im-status ' + cls; };

    async function handle(file) {
      if (!file) return;
      drop.classList.add('busy');
      try {
        const b = await parse(file, say);
        say('Saving…');
        await saveBundle(b);
        const { rows, kept, odd, table } = b.stats;
        say(`Done — ${b.surahs.length} surahs, ${kept.toLocaleString('en')} words` +
            (odd ? ` (${odd} verse-final tokens weren't plain digits)` : ''), 'ok');
        setTimeout(() => onDone(b), 500);
      } catch (e) {
        say("Couldn't import: " + e.message, 'bad');
      } finally {
        drop.classList.remove('busy');
      }
    }

    input.addEventListener('change', (e) => handle(e.target.files[0]));
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));
  }

  /* ---------- export a single JSON bundle (for the repo / other devices) --- */
  function download(bundle) {
    const blob = new Blob([JSON.stringify({
      surahs: bundle.surahs, juz: bundle.juz, text: bundle.text,
    })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quran-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return { openDB, idbGet, idbPut, parse, saveBundle, loadBundle,
           mountImporter, download };
})();
