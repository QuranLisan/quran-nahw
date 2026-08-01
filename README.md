# Quran Nahw — Worksheet App

A progressive web app that turns any range of Quranic text into a worksheet —
either blank for handwriting with the S Pen, or with typing fields that save
locally and persist between sessions.

Works offline once installed. No server, no account, no build step.

---

## Setup

Nothing to install. Serve the folder and open it:

```
python -m http.server 8000
```

The Quranic text and its matching font are already bundled — 6,236 ayahs,
82,635 words, ready on first load. A service worker needs `https://` or
`localhost`, so don't open `index.html` straight off the disk.

### What's bundled

**Text:** Indo-Pak (Madinah) v9.6.1 — the Naskh Nastaleeq IndoPak text used on
Quran.com and QuranWBW.com.

**Font:** AlQuran-IndoPak-by-QuranWBW v4.2.2 (`.woff2` + `.ttf`), the font this
text requires. The text is *not* plain Unicode — it uses private-use codepoints
for ligatures and ayah icons, so it renders correctly **only** with this font.
The two ship together for that reason.

Both by **Ayman Siddiqui and R. Siddiqua**, for QuranWBW.com and Quran.com,
released for Sadaqa-e-Jaria. Their terms require credits to travel with the
files: `fonts/CREDITS-AND-TERMS.txt` is the original notice, and the app shows
a credit line in the panel. Don't sell it or strip the attribution.

Surah names, verse counts, and all 30 juz boundaries come from QuranWBW's
`quranMeta.js` rather than being typed by hand.

### Using your own QUL text instead

The bundled text is the **Madinah** IndoPak variant. If you want **Hanafi
(QUL script #59)** — the one paired with font #242 — it isn't published
anywhere I could reach, so import it yourself: panel → **Import QUL file** →
pick your `.db`. It parses in the browser via sql.js (bundled in `vendor/`),
nothing uploads, and it replaces the bundled text permanently.

Swap the font too if you do: drop your TTF in as `fonts/quran-indopak.ttf` and
delete `quran-indopak.woff2` so the browser stops preferring it.

## Putting it on the Galaxy Tab

Push the folder to a GitHub repo, then **Settings → Pages → Deploy from branch
→ main / (root)**. You get an HTTPS URL in a minute or two.

On the tab: open that URL in Chrome → menu → **Add to Home screen**. It
installs as a standalone app and caches the text, font, and code on first load
— about 2 MB total — so it works with no signal from then on.

---

## The S Pen workflow

1. Pick your range and layout, leave mode on **لکھائی**.
2. **پرنٹ / PDF** → in Chrome's print dialog choose **Save as PDF**.
   Set margins to *Default*; the app already sets the page size and margin.
3. Open the PDF in Samsung Notes and write on it.

Print to paper works identically — same dialog, pick your printer.

---

## The four layouts

| | | |
|---|---|---|
| **Word boxes** | each word in its own box with ruled space beneath | word-level صرفی/نحوی drill |
| **Table** | table: # \| کلمہ \| تحلیلِ صرفی \| ترکیبِ نحوی \| معنی | systematic full-ayah analysis |
| **Lines** | full ayah, then ruled lines | continuous prose ترکیب |
| **Diagram** | full ayah, then a dot-grid field | drawing tarkeeb trees |

## Three ways to work

The **Paper / Pen / Type** switch applies to all four layouts.

**Paper** leaves the space blank. Print or save as PDF and write on it in
Samsung Notes. Unchanged from before.

**Pen** puts a drawing canvas over each ayah so you can write directly in the
app with the S Pen. A toolbar appears at the bottom: four colours (red first,
since that's the usual i'rab ink), three nib widths, eraser, undo, and clear.

Pen and mouse draw; a finger scrolls the page instead, so your palm won't leave
marks. Pressure is picked up from the S Pen, so strokes thicken naturally.

**Lock scroll** freezes the page completely — nothing shifts under your hand
mid-word. While it's locked, the **▲ ▼** buttons step one ayah at a time, so
you never have to unlock just to move on.

Strokes are stored as points rather than pixels, keyed per ayah. That means
they scale with the page, print at full resolution instead of looking like a
screenshot, and survive a paper-size change. **پرنٹ / PDF** works exactly as
before and now includes your handwriting.

Canvases mount only as you scroll near them — a Juz 30 sheet is 564 ayah
blocks and mounting them all at once would grind the tablet to a halt.

**Type** turns the blanks into text fields, saved as you type.
**Save notes** exports everything as JSON for backup.

The interface is English and left-to-right; the worksheet itself stays
right-to-left, so the Arabic and the table columns read in the correct order.
Ayah numbers render in Arial inside parentheses — the same trick as the Word
documents, so the Quran font's `calt` never swaps them for medallion glyphs.

---

## Adding word-by-word Urdu meanings later

When you have the QUL meanings download, add an `m` array to each ayah object
alongside `w`, with one entry per word:

```json
{"n": 1, "w": ["بِسْمِ", "ٱللَّهِ"], "m": ["نام سے", "اللہ کے"]}
```

The معنی column fills automatically when `m` is present and stays blank when it
isn't. No other change needed.

---

## Files

```
index.html              shell
css/app.css             all styling, including @media print
js/app.js               state, rendering, note storage
js/import.js            in-browser QUL SQLite importer
vendor/sql-wasm.*       sql.js (MIT) — reads SQLite in the browser
sw.js                   offline cache  ← bump CACHE after any edit
manifest.webmanifest    install metadata
tools/build_data.py     optional: QUL SQLite → JSON without the browser
data/                   optional: quran-data.json or surah/*.json
fonts/                  your TTF goes here
```

---

## Notes

- **Changes not showing up?** The service worker is serving the old copy. Bump
  the `CACHE` constant at the top of `sw.js`.
- **Ruled lines too faint or too dark?** One value controls every writing
  guide: `--rule-write` at the top of `css/app.css` (currently `#dadee4`).
  Lower the number for darker, raise it for fainter. Cell outlines and table
  borders use `--rule` and are deliberately separate, so structure stays
  readable when the guides go pale.
- **Where does imported text live?** IndexedDB, database `quran-nahw`, store
  `text`, key `bundle`. It takes priority over the bundled
  `data/quran-data.json`. To go back to the bundled text, clear that key from
  DevTools → Application → IndexedDB.
- **Remove pause marks** removes pause signs (U+06D6–U+06DE, U+06E2, U+06E9)
  at render time only — the stored text is untouched, so it's reversible. It
  deliberately keeps madda U+06E4, the silent-letter zeros U+06DF/U+06E0, and
  sukun U+06E1: those are IndoPak orthography, not pause marks, and stripping
  the whole U+06D6–U+06ED block the way the Word pipeline does would corrupt
  this text.
- **Juz boundaries and surah names** for the bundled text come from QuranWBW's
  metadata. `js/import.js` and `tools/build_data.py` carry their own hardcoded
  copies for imported databases; edit `JUZ_STARTS` / `SURAH_NAMES` there if
  needed.
- Settings (layout, paper, font size) persist in localStorage. Notes live in
  IndexedDB, keyed `surah:ayah:wordIndex:field`, and are per-device — export
  the JSON if you want them on both laptop and tablet.
