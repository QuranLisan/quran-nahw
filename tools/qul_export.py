#!/usr/bin/env python3
"""
qul_export.py — build the app's data/ folder from QUL SQLite databases.

  python tools/qul_export.py --words  path/to/indopak-words.db \
                             --trans  path/to/jalandhry.db \
                             --wbw    path/to/urdu-word-by-word.db \
                             --out    data

Only --words is required.

Ayah markers
------------
In QUL word-by-word tables the end-of-ayah marker is stored as the LAST word
row of each ayah. It is removed POSITIONALLY (highest `word` index per ayah),
never by inspecting the glyph — glyph-sniffing silently drops genuine Quranic
words. Every removal is counted and a sample is printed so you can eyeball it.
Pass --keep-markers to leave them in.
"""

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# Pause, section and sajdah signs — safe to remove from a worksheet.
#   06D6-06DC  small high waqf ligatures (ۖ ۗ ۘ ۙ ۚ ۛ ۜ)
#   06DD       end of ayah          06DE  start of rub el hizb
#   06E9       place of sajdah      06EA-06EC  empty-centre waqf stops
#
# Everything else in the 06Dx-06Ex block is ORTHOGRAPHIC and must survive.
# The IndoPak sukun is U+06E1 and appears in nearly every word; U+06E4 madda,
# U+06E5 small waw and U+06E6 small yeh are part of the spelling. Removing the
# whole 06D6-06ED block silently mangles the entire text.
WAQF = re.compile(r'[\u06D6-\u06DE\u06E9-\u06EC]')
TATWEEL_ONLY = re.compile(r'^[\s\u0640]*$')

# A genuine Quranic word contains at least one Arabic LETTER. Ayah markers are
# digits, medallion glyphs or punctuation and contain none. This is a second,
# independent guard behind the positional marker cut — it never inspects WHICH
# glyph a token is, only whether the token has any letters at all, so it cannot
# repeat the old mistake of dropping real words by glyph-sniffing.
HAS_LETTER = re.compile(
    r'[\u0620-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06EE-\u06EF\u06FA-\u06FF]')

# Kufan ayah counts — used only to cross-check what the DB actually contains.
AYAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,
    98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,
    89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,
    52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,
    8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6]

NAMES_AR = ["الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف",
    "الأنفال","التوبة","يونس","هود","يوسف","الرعد","إبراهيم","الحجر","النحل",
    "الإسراء","الكهف","مريم","طه","الأنبياء","الحج","المؤمنون","النور","الفرقان",
    "الشعراء","النمل","القصص","العنكبوت","الروم","لقمان","السجدة","الأحزاب","سبأ",
    "فاطر","يس","الصافات","ص","الزمر","غافر","فصلت","الشورى","الزخرف","الدخان",
    "الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق","الذاريات","الطور","النجم",
    "القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة","الصف",
    "الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة",
    "المعارج","نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ",
    "النازعات","عبس","التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق",
    "الأعلى","الغاشية","الفجر","البلد","الشمس","الليل","الضحى","الشرح","التين",
    "العلق","القدر","البينة","الزلزلة","العاديات","القارعة","التكاثر","العصر",
    "الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر","المسد","الإخلاص",
    "الفلق","الناس"]

NAMES_EN = ["Al-Fatihah","Al-Baqarah","Aal-Imran","An-Nisa","Al-Maidah","Al-Anam",
    "Al-Araf","Al-Anfal","At-Tawbah","Yunus","Hud","Yusuf","Ar-Rad","Ibrahim",
    "Al-Hijr","An-Nahl","Al-Isra","Al-Kahf","Maryam","Ta-Ha","Al-Anbiya","Al-Hajj",
    "Al-Muminun","An-Nur","Al-Furqan","Ash-Shuara","An-Naml","Al-Qasas",
    "Al-Ankabut","Ar-Rum","Luqman","As-Sajdah","Al-Ahzab","Saba","Fatir","Ya-Sin",
    "As-Saffat","Sad","Az-Zumar","Ghafir","Fussilat","Ash-Shura","Az-Zukhruf",
    "Ad-Dukhan","Al-Jathiyah","Al-Ahqaf","Muhammad","Al-Fath","Al-Hujurat","Qaf",
    "Adh-Dhariyat","At-Tur","An-Najm","Al-Qamar","Ar-Rahman","Al-Waqiah","Al-Hadid",
    "Al-Mujadila","Al-Hashr","Al-Mumtahanah","As-Saff","Al-Jumuah","Al-Munafiqun",
    "At-Taghabun","At-Talaq","At-Tahrim","Al-Mulk","Al-Qalam","Al-Haqqah",
    "Al-Maarij","Nuh","Al-Jinn","Al-Muzzammil","Al-Muddaththir","Al-Qiyamah",
    "Al-Insan","Al-Mursalat","An-Naba","An-Naziat","Abasa","At-Takwir","Al-Infitar",
    "Al-Mutaffifin","Al-Inshiqaq","Al-Buruj","At-Tariq","Al-Ala","Al-Ghashiyah",
    "Al-Fajr","Al-Balad","Ash-Shams","Al-Layl","Ad-Duha","Ash-Sharh","At-Tin",
    "Al-Alaq","Al-Qadr","Al-Bayyinah","Az-Zalzalah","Al-Adiyat","Al-Qariah",
    "At-Takathur","Al-Asr","Al-Humazah","Al-Fil","Quraysh","Al-Maun","Al-Kawthar",
    "Al-Kafirun","An-Nasr","Al-Masad","Al-Ikhlas","Al-Falaq","An-Nas"]

JUZ = [(1,1,1),(2,2,142),(3,2,253),(4,3,93),(5,4,24),(6,4,148),(7,5,82),(8,6,111),
    (9,7,88),(10,8,41),(11,9,93),(12,11,6),(13,12,53),(14,15,1),(15,17,1),
    (16,18,75),(17,21,1),(18,23,1),(19,25,21),(20,27,56),(21,29,46),(22,33,31),
    (23,36,28),(24,39,32),(25,41,47),(26,46,1),(27,51,31),(28,58,1),(29,67,1),
    (30,78,1)]


def find_word_table(con):
    """Return (table, colmap) for the first table exposing surah/ayah/word/text."""
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tables:
        cols = {r[1].lower(): r[1] for r in con.execute(f'PRAGMA table_info("{t}")')}
        text = cols.get('text') or cols.get('word_text') or cols.get('qpc_uthmani_hafs')
        if not text:
            continue
        if {'surah', 'ayah', 'word'} <= cols.keys():
            return t, {'surah': cols['surah'], 'ayah': cols['ayah'],
                       'word': cols['word'], 'text': text}
        if 'location' in cols:
            return t, {'location': cols['location'], 'text': text}
    raise SystemExit('No word table found. Inspect the DB in DB Browser and '
                     'pass the right file to --words.')


def read_words(path):
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    table, c = find_word_table(con)
    print(f'  table: {table}  columns: {list(c.values())}')
    out = defaultdict(dict)              # surah -> ayah -> {word_idx: text}
    if 'location' in c:
        q = f'SELECT "{c["location"]}", "{c["text"]}" FROM "{table}"'
        for loc, txt in con.execute(q):
            try:
                s, a, w = (int(x) for x in str(loc).split(':')[:3])
            except ValueError:
                continue
            out[s].setdefault(a, {})[w] = txt or ''
    else:
        q = (f'SELECT "{c["surah"]}", "{c["ayah"]}", "{c["word"]}", "{c["text"]}" '
             f'FROM "{table}"')
        for s, a, w, txt in con.execute(q):
            out[int(s)].setdefault(int(a), {})[int(w)] = txt or ''
    con.close()
    return out


def read_verse_texts(path):
    """Optional translation DB: verse_key or (surah, ayah) plus a text column."""
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tables:
        cols = {r[1].lower(): r[1] for r in con.execute(f'PRAGMA table_info("{t}")')}
        text = cols.get('text') or cols.get('translation')
        if not text:
            continue
        res = {}
        if {'sura', 'aya'} <= cols.keys():
            q = f'SELECT "{cols["sura"]}","{cols["aya"]}","{text}" FROM "{t}"'
            for s, a, v in con.execute(q):
                res[(int(s), int(a))] = v
        elif {'surah', 'ayah'} <= cols.keys():
            q = f'SELECT "{cols["surah"]}","{cols["ayah"]}","{text}" FROM "{t}"'
            for s, a, v in con.execute(q):
                res[(int(s), int(a))] = v
        elif 'verse_key' in cols:
            q = f'SELECT "{cols["verse_key"]}","{text}" FROM "{t}"'
            for k, v in con.execute(q):
                s, a = (int(x) for x in str(k).split(':')[:2])
                res[(s, a)] = v
        if res:
            print(f'  table: {t}  rows: {len(res)}')
            con.close()
            return res
    con.close()
    print('  no usable translation table found — skipping')
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--words', required=True, help='QUL word-by-word SQLite DB')
    ap.add_argument('--trans', help='ayah translation SQLite DB (e.g. Jalandhry)')
    ap.add_argument('--wbw', help='word-by-word meanings SQLite DB (Urdu)')
    ap.add_argument('--out', default='data')
    ap.add_argument('--keep-waqf', action='store_true')
    ap.add_argument('--keep-markers', action='store_true')
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print('Reading Quranic text…')
    words = read_words(args.words)

    wbw = {}
    if args.wbw:
        print('Reading word-by-word meanings…')
        wbw = read_words(args.wbw)

    trans = {}
    if args.trans:
        print('Reading translation…')
        trans = read_verse_texts(args.trans)

    dropped, samples, empties, mismatch = 0, [], 0, []
    letterless, letterless_samples = 0, []
    stripped_marks = defaultdict(int)
    surah_meta = []

    for s in sorted(words):
        verses, ayah_nums = [], sorted(words[s])
        for a in ayah_nums:
            idx = sorted(words[s][a])
            if not args.keep_markers and len(idx) > 1:
                marker = idx[-1]
                if len(samples) < 8:
                    samples.append(f'{s}:{a}:{marker} → {words[s][a][marker]!r}')
                idx = idx[:-1]
                dropped += 1

            ws = []
            for i in idx:
                t = words[s][a][i] or ''
                if not args.keep_waqf:
                    for ch in WAQF.findall(t):
                        stripped_marks[ch] += 1
                    t = WAQF.sub('', t)
                t = t.strip()
                if TATWEEL_ONLY.match(t):
                    empties += 1
                    continue
                if not HAS_LETTER.search(t):
                    letterless += 1
                    if len(letterless_samples) < 8:
                        letterless_samples.append(
                            f'{s}:{a}:{i}  {t!r}  ' +
                            ' '.join(f'U+{ord(c):04X}' for c in t))
                    continue
                ws.append(t)

            v = {'w': ws}
            if (s, a) in trans:
                v['t'] = str(trans[(s, a)]).strip()
            if wbw.get(s, {}).get(a):
                mi = sorted(wbw[s][a])
                if not args.keep_markers and len(mi) > 1:
                    mi = mi[:-1]
                v['m'] = [str(wbw[s][a][i] or '').strip() for i in mi]
            verses.append(v)

        expected = AYAH_COUNTS[s - 1] if s <= 114 else None
        if expected and len(verses) != expected:
            mismatch.append(f'  surah {s}: DB has {len(verses)}, expected {expected}')

        name_ar = NAMES_AR[s - 1] if s <= 114 else str(s)
        name_en = NAMES_EN[s - 1] if s <= 114 else str(s)
        payload = {'surah': s, 'ar': name_ar, 'en': name_en,
                   'ayahs': len(verses), 'verses': verses}
        (out / f'surah-{s:03d}.json').write_text(
            json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
            encoding='utf-8')
        surah_meta.append({'n': s, 'ar': name_ar, 'en': name_en, 'ayahs': len(verses)})

    index = {'version': 1,
             'built': __import__('datetime').date.today().isoformat(),
             'surahs': surah_meta,
             'juz': [{'n': n, 's': s, 'a': a} for n, s, a in JUZ]}
    (out / 'index.json').write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')

    total = sum(len(v['w']) for s in surah_meta
                for v in json.loads((out / f'surah-{s["n"]:03d}.json')
                                    .read_text(encoding='utf-8'))['verses'])

    print(f'\nWrote {len(surah_meta)} surah files to {out}/')
    print(f'  words kept        : {total}')
    print(f'  ayah markers cut  : {dropped}')
    print(f'  blank rows skipped: {empties}')
    if stripped_marks:
        import unicodedata
        print('\n  Pause / section marks removed (orthographic marks were kept):')
        for ch, cnt in sorted(stripped_marks.items(), key=lambda x: -x[1]):
            print(f'    U+{ord(ch):04X} x{cnt:<6} {unicodedata.name(ch, "?")}')

    if letterless:
        print(f'\n  {letterless} tokens contained no Arabic letter and were removed.')
        print('  These are ayah markers your database stores as words. Samples:')
        for x in letterless_samples:
            print('    ' + x)

    if samples:
        print('  sample of what was cut as a marker — these should all be')
        print('  end-of-ayah glyphs, NOT real words:')
        for x in samples:
            print('    ' + x)
    if mismatch:
        print('\nAyah-count mismatches (check before using):')
        print('\n'.join(mismatch))
    if total and abs(total - 77430) > 2000:
        print(f'\nHeads up: full Quran is ~77,430 words. Got {total}. '
              f'If you exported the whole Quran, something is off.')


if __name__ == '__main__':
    sys.exit(main())
