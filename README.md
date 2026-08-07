# نحوی مشق — Quran Nahw worksheet app

A small offline-first web app for نحوی ترکیب practice. Pick any range of Quranic
text, then either print it as a blank worksheet for S Pen handwriting, or type the
ترکیب directly into the browser and have it saved on the device.

---

## 0. Publishing to GitHub Pages

Push the whole folder, then in the repository go to **Settings → Pages** and
set the source to your branch, root folder. The site appears at
`https://<user>.github.io/<repo>/`.

Everything is relative-path, so it works from a subfolder with no changes.
`.nojekyll` is included so Pages serves the files as-is.

Three things trip people up:

1. **`fonts/quran.ttf` must be committed.** Android cannot use a font
   installed on the device. See `fonts/README.md`.
2. **`data/` must be committed.** The app reads JSON, not your database.
3. **Filenames are case-sensitive on Pages but not on Windows.** `Quran.TTF`
   works locally and 404s once published. Use lowercase.

To verify after pushing, open these two URLs directly:

    https://<user>.github.io/<repo>/fonts/quran.ttf
    https://<user>.github.io/<repo>/data/index.json

If either 404s, it was not committed. The app also shows a red bar naming
every font path it tried and the status code it got back.

On the tablet, open the site in Chrome and choose **Add to Home screen** to
install it. It then runs full-screen and works offline.

---

## 1. Run it locally

The app **must be served over HTTP**. Opening `index.html` by double-clicking it
will not work — service workers and `fetch()` are blocked on `file://`.

**Windows, quickest path:**

```
cd Documents\Quran Tarkeeb\quran-nahw
python -m http.server 8080
```

Then open `http://localhost:8080`. Or just double-click `run.bat`.

**To use it on the Galaxy Tab:** put the folder on any static host — GitHub Pages,
Netlify drop, or Cloudflare Pages all work and all are free. Once it's on HTTPS,
open it in Chrome or Samsung Internet on the tablet and choose
**Add to Home screen**. It then launches full-screen and works with no network.

---

## 2. Add the Quran font

The app looks for the font in this order:

1. `fonts/quran.woff2`
2. `fonts/quran.ttf`
3. a font named `AlQuran IndoPak by QuranWBW` installed on the system

So do either of these:

- Copy your TTF to `fonts/quran.ttf`, **or**
- Install it in Windows/Android as usual and leave `fonts/` empty.

For the tablet, option 1 is the reliable one — Android won't expose an installed
font to the browser. Converting the TTF to WOFF2 first will cut the download by
roughly half, but is optional.

Put your Urdu UI font at `fonts/urdu.ttf` the same way if you don't want the
system fallback.

---

## 3. Load the real Quranic text

The app ships with six short surahs of sample text in `demo/`. It is used only
when `data/` has no `index.json`, so **an update can never overwrite your
export**. It is standard imlā'ī orthography, **not** Indo-Pak — replace it
before doing real work. A yellow banner reminds you while demo data is loaded.

```
python tools\qul_export.py ^
    --words "path\to\indopak-words.db" ^
    --trans "path\to\jalandhry.db" ^
    --out data
```

Only `--words` is required. Add `--wbw path\to\urdu-wbw.db` once you have the
word-by-word Urdu meanings downloaded.

The exporter removes end-of-ayah markers **positionally** — the highest `word`
index in each ayah — never by looking at the glyph. It prints a sample of what it
cut and flags any surah whose ayah count doesn't match the Kufan count, so the
silent word-dropping problem can't recur unnoticed. Read that summary before
trusting the output.

### Waqf stripping is selective, deliberately

Only pause, section and sajdah signs are removed: U+06D6–U+06DE and
U+06E9–U+06EC. Everything else in that block is orthographic and is kept.

This matters more than it sounds. **U+06E1 is the IndoPak sukun** and appears
in nearly every word; U+06E4 madda, U+06E5 small waw and U+06E6 small yeh are
part of the spelling. Stripping the whole U+06D6–U+06ED block — the obvious
thing to write — quietly mangles the entire text.

The importer now prints a per-codepoint tally of exactly what it removed, so
you can confirm nothing structural went with it.

**If you exported with a build before this fix, re-export.** Your text is
missing its sukuns.

### Waqf marks stored as words

Some databases store a waqf sign as its own word row. Al-Baqarah 2:2 has seven
words and two ۛ (muʿānaqah) marks, so it arrives as nine tokens — and the two
marks draw as empty boxes.

The letter check removes them, and all three layers agree on the rule:
`qul_export.py` drops them, `morph_import.py` ignores them when counting and
indexing, and the app skips them when drawing.

The app also **renumbers the surviving words 1..n** rather than keeping their
raw positions. Morphology is keyed on word index, so a mark sitting at
position 5 would otherwise shift every later word out of alignment.
Renumbering makes an uncleaned export render exactly like a clean one, which
also means your saved answers stay attached to the right words when you
re-export.

### Two independent guards against ayah markers

A box on the sheet containing nothing but a number is an ayah-end marker that
your database stores as a word. Two separate checks now stop that:

1. **Positional** — the highest `word` index in each ayah is cut, without ever
   inspecting the glyph.
2. **Letter presence** — any remaining token containing no Arabic letter at all
   is removed and reported with its Unicode codepoints. A real Quranic word
   always has at least one letter; markers are digits, medallions or
   punctuation. This never asks *which* glyph a token is, so it cannot repeat
   the old mistake of dropping real words by glyph-sniffing.

The app applies the same letter check when drawing, so a sheet built from an
export that predates this still renders correctly. Word indices are preserved
when a marker is skipped, so saved answers and segmentation stay attached to
the right words.

After exporting, hard-refresh the browser once (Ctrl+Shift+R) so the service
worker picks up the new `index.json`.

---

## 4. Word segmentation (تقطیع) — optional, off by default

**Skip this whole section if you don't want it.** Segmentation is switched off
on a fresh install, needs a separate data import to work at all, and nothing
else in the app depends on it. The ayah-marker and waqf-mark fixes are
independent and always active.

Words can be broken into their grammatical parts — بِسْمِ shown as بِ (حرف جار)
plus سْمِ (اسم مجرور) — with each part getting its own analysis boxes.

The cuts are not guessed. They come from the Quranic Arabic Corpus, imported
once:

```
python tools\morph_import.py --morph quran-morphology.txt --data data
```

Get `quran-morphology.txt` from github.com/mustafa0x/quran-morphology — it is
the corpus already converted to Arabic script, which imports far more cleanly.
The original Buckwalter file from corpus.quran.com/download also works if you
add `--buckwalter`.

### Why the import prints an alignment report

The morphology is annotated over Uthmani text; your worksheets are IndoPak.
The two differ in orthography, so "cut after letter 2" in one is not
automatically letter 2 in the other. The importer therefore proves every
boundary against your actual text — anchoring segments from the left and from
the right — and emits only what it can verify. Anything it cannot prove is
dropped and reported rather than guessed.

Tested against all 42,807 multi-segment words with IndoPak letterforms
substituted, it resolves 99.99% fully; six words do not. Separately, 208
segments are elided pronouns (the dropped ي of رَبِّ) which have no letters
and so no boundary to draw — these are counted and skipped.

### Word counts must match, per ayah

The join between your text and the corpus is the word index. If your text
splits or joins a word differently in some ayah, every later index there
shifts and the morphology lands on the wrong words. The importer compares
the word count of each ayah before touching it and skips the whole ayah on
a mismatch, listing every one it skipped. It will not emit
plausible-looking nonsense.

### Inspecting a token you did not expect

When a box on the sheet shows something odd, dump the codepoints rather than
squint at the glyph:

```
python tools\peek.py --words "path\to\indopak-words.db" --ayah 1:7
python tools\peek.py --data data --ayah 1:7
```

It prints every token with its Unicode name, classifies each character as
letter / harakah / digit / mark, and says outright whether the token will be
kept or dropped. Run it against the database first — that is where the truth
is; the export can only inherit what the database holds.

It also reports how many ayahs the database holds for that surah, which is how
you catch a numbering shift.

Note that comparing Quranic text as strings is unreliable: sources differ in
combining-mark **order** (shadda before kasra, or after) while looking
identical. The aligner compares letter skeletons with the marks removed, so it
is unaffected — but do not expect two texts to match byte for byte.

### Checking a single ayah

```
python tools\morph_import.py --morph quran-morphology.txt --data data --explain 1:7
```

prints your word, the corpus segmentation, and the resulting cut for every
word in that ayah, plus both letter skeletons wherever a boundary could not
be proven. This is the tool for "why didn't this word break?"

Not every word breaks, and that is usually correct. In 1:7, six of nine
split; صِرَاطَ and غَيْرِ are single stems, and الَّذِينَ is an اسم موصول
that the corpus treats as one unit rather than ال + ذين.

Read the summary after importing. If a surah shows a high unresolved count,
that is a real signal about your text, not noise.

### Controls

In ترتیبات › تقطیع:

| Control | Effect |
|---|---|
| کلمات توڑ کر دکھائیں | Turns segmentation on or off. **Off by default** |
| ہر جزو کے اپنے خانے | Each part gets its own نوع/اعراب/ترکیب rows — matches real i'rab, taller cards |
| مشترک خانے | Parts are shown in the header, one set of boxes for the whole word — same page density as before |
| نوع پہلے سے لکھی ہو | Pre-fills نوع from the corpus tag. Leave off for blank practice sheets; turn on to check your work |

Answers on segments are stored separately from whole-word answers, so
switching between ہر جزو and مشترک never overwrites either set.

Attribution is required wherever this data appears — see `NOTICE.md`.

---

## 5. Across devices

One layout, four shapes. Nothing is a separate "mobile version" — the same
elements move.

| Width | What changes |
|---|---|
| **Phone** (≤640px) | Surah picker gets its own row; mode switch and پرنٹ move to a fixed bottom dock within thumb reach; ترتیبات opens as a full-height drawer with the page behind it locked |
| **Tablet portrait** (≤900px) | Sheet fills the width rather than pretending to be A4; jadwal scrolls sideways with the کلمہ column pinned in place |
| **Laptop** (≥900px) | True A4 preview — the sheet on screen is the exact width of the printed page |
| **Wide desktop** (≥1200px) | ترتیبات becomes a sticky side rail instead of a band that shoves the sheet down |

**صفحہ** in ترتیبات controls this directly: **A4** for print-accurate preview,
**اسکرین** to use the full window, or **خودکار** to let it pick. Printing is
always A4 regardless of what's on screen.

**تھیم** offers خودکار / روشن / تاریک. Dark mode follows the system setting by
default and is worth having for night study on an OLED tablet. Print output is
forced to black-on-white in every theme, so a dark screen never costs you ink or
legibility.

On first run the app also picks starting sizes from the device: smaller Quran
text and two cards per row on a phone, and a taller writing row when it detects
a stylus or finger input rather than a mouse. Every one of those is a slider you
can move afterwards, and your choices are what get remembered from then on.

Rotating the tablet or resizing the window re-evaluates all of this live — no
reload needed.

---

## 6. Using it

**Top bar** — surah, ayah range, پارہ jump, and the ہاتھ سے لکھیں / ٹائپ کریں switch.

**ترتیبات** opens the rest:

| Setting | What it does |
|---|---|
| تختی | One card per word with ruled writing space underneath |
| جدول | One table row per word, columns for each field |
| سطریں | The verse, then open ruled lines for free-form ترکیب |
| خانے | Which fields appear: نوع، صیغہ/وزن، اعراب، ترکیب/محل، مادہ، ترجمہ |
| لکھائی کی جگہ | Row height — raise it for S Pen, lower it for typing |
| ایک سطر میں کلمات | Cards per row, or خودکار to fit the page |

**ہاتھ سے لکھیں** always prints blank, even if you've typed answers before —
that's what makes it a worksheet. Switch to **ٹائپ کریں** to see and print your
saved answers.

### Worksheet → Samsung Notes

1. **پرنٹ / PDF** → in the print dialog choose *Save as PDF* → A4 portrait.
2. Turn **off** "Headers and footers" and set margins to *Default*.
3. Move the PDF to the tablet, open Samsung Notes → **Import PDF**, and annotate
   with the S Pen.

Everything on screen is already A4-width, so the print is what you see.

### Answers

Typing autosaves to the device after a short pause. Nothing is uploaded anywhere.

- **جوابات محفوظ کریں (JSON)** downloads a backup of every answer.
- **جوابات درآمد کریں** restores one, including onto a different device.
- **پورا قرآن آف لائن محفوظ کریں** pre-downloads all surah files so the app works
  with no connection at all.

Clearing the browser's site data will erase saved answers, so export a backup
before doing that.

---

## 7. Files

```
index.html            markup and controls
app.css               design system, screen and print layouts
app.js                data loading, IndexedDB, rendering, save/export
sw.js                 service worker — offline shell and data cache
manifest.json         install metadata
run.bat               starts a local server on Windows
data/                 YOUR export — never written to by an update
demo/                 bundled sample text, used only when data/ is empty
fonts/                quran.ttf / quran.woff2 (yours), urdu.ttf (optional)
icons/                app icons
tools/qul_export.py   QUL SQLite → data/
tools/morph_import.py QUL morphology → segment cuts
tools/peek.py         dump one ayah's raw codepoints
NOTICE.md             sources and attribution
```

The data format is deliberately plain, one file per surah:

```json
{"surah":78,"ar":"النبأ","en":"An-Naba","ayahs":40,
 "verses":[{"w":["عَمَّ","يَتَسَآءَلُونَ"],"t":"…","m":["کس چیز","پوچھتے ہیں"]}]}
```

`w` is words, `t` is the ayah translation, `m` is word-by-word meanings. All
optional except `w`, so partial data loads fine.
