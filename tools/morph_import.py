#!/usr/bin/env python3
"""
morph_import.py — turn a Quranic morphology file into segment cuts for the app.

  python tools/morph_import.py --morph quran-morphology.txt --data data

Source
------
Expects the Arabic-script morphology file, one segment per line:

    1:1:1:1 <TAB> بِ      <TAB> P <TAB> P|PREF|LEM:ب
    1:1:1:2 <TAB> سْمِ    <TAB> N <TAB> ROOT:سمو|LEM:اسْم|M|GEN

from github.com/mustafa0x/quran-morphology, itself derived from the Quranic
Arabic Corpus 0.4 (Kais Dukes, GNU GPL, corpus.quran.com). Attribution is
required wherever the data is displayed — the app shows it in ترتیبات.

The original Buckwalter file (quranic-corpus-morphology-0.4.txt) also works;
pass --buckwalter to transliterate it on the way in.

Why alignment is needed
-----------------------
The morphology is annotated over Uthmani text. Your worksheets use IndoPak.
The two differ in orthography — alef wasla, superscript alef, extra alifs —
so a cut at "letter 2 of the Uthmani form" is not automatically letter 2 of
the IndoPak form.

This script therefore never trusts a cut it cannot prove. For each word it
anchors segments from the left and from the right against the actual IndoPak
letters, and emits only the boundaries that matched. A word whose middle
cannot be verified keeps the cuts that were confirmed and drops the rest.
Nothing is guessed. The summary prints exactly what was resolved and what
was not, per surah.
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

COMBINING = re.compile(r'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]')

# Same rule the exporter and the app use: a real word has at least one letter.
# Databases that store waqf marks as word rows would otherwise shift every
# later index in the ayah and break alignment.
HAS_LETTER = re.compile(
    r'[\u0620-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06EE-\u06EF\u06FA-\u06FF]')


def real_words(verse):
    return [t for t in verse['w'] if HAS_LETTER.search(t)]

# skeleton normalisation — only for MATCHING, never for output
NORM = str.maketrans({
    '\u0671': '\u0627',  # alef wasla  ٱ -> ا
    '\u0622': '\u0627',  # alef madda  آ -> ا
    '\u0623': '\u0627',  # alef hamza above
    '\u0625': '\u0627',  # alef hamza below
    '\u0649': '\u064A',  # alef maqsura ى -> ي
    '\u06CC': '\u064A',  # farsi yeh
    '\u0629': '\u0647',  # teh marbuta ة -> ه
    '\u06C0': '\u0647',
    '\u06A9': '\u0643',  # Urdu kaf   ک -> ك
    '\u06AA': '\u0643',
    '\u06C1': '\u0647',  # heh goal   ہ -> ه
    '\u06C2': '\u0647',
    '\u06C3': '\u0647',
    '\u06BE': '\u0647',  # heh doachashmee ھ -> ه
    '\u06D2': '\u064A',  # yeh barree ے -> ي
    '\u06D3': '\u064A',
    '\u0624': '\u0648',  # waw hamza  ؤ -> و
    '\u0626': '\u064A',  # yeh hamza  ئ -> ي
})

BUCKWALTER = {
    "'": 'ء', '|': 'آ', '>': 'أ', '&': 'ؤ', '<': 'إ', '}': 'ئ', 'A': 'ا',
    'b': 'ب', 'p': 'ة', 't': 'ت', 'v': 'ث', 'j': 'ج', 'H': 'ح', 'x': 'خ',
    'd': 'د', '*': 'ذ', 'r': 'ر', 'z': 'ز', 's': 'س', '$': 'ش', 'S': 'ص',
    'D': 'ض', 'T': 'ط', 'Z': 'ظ', 'E': 'ع', 'g': 'غ', '_': 'ـ', 'f': 'ف',
    'q': 'ق', 'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'h': 'ه', 'w': 'و',
    'Y': 'ى', 'y': 'ي', 'F': 'ً', 'N': 'ٌ', 'K': 'ٍ', 'a': 'َ', 'u': 'ُ',
    'i': 'ِ', '~': 'ّ', 'o': 'ْ', '^': 'ٓ', '#': 'ٔ', '`': 'ٰ', '{': 'ٱ',
}

# corpus tag -> the Urdu term a Nahw student would write. Terminology only;
# the grammatical judgement is the corpus's, not this script's.
POS_UR = {
    'DET':      'حرفِ تعریف',
    'P':        'حرف جار',
    'CONJ':     'حرف عطف',
    'REM':      'حرف استیناف',
    'NEG':      'حرف نفی',
    'EMPH':     'حرف تاکید',
    'INTG':     'حرف استفہام',
    'COND':     'حرف شرط',
    'ACC':      'حرف نصب',
    'FUT':      'حرف استقبال',
    'VOC':      'حرف ندا',
    'PRON':     'ضمیر',
    'DEM':      'اسم اشارہ',
    'REL':      'اسم موصول',
    'PN':       'اسم علم',
    'ADJ':      'صفت',
    'N':        'اسم',
    'V':        'فعل',
    'PERF':     'فعل ماضی',
    'IMPF':     'فعل مضارع',
    'IMPV':     'فعل امر',
}


def clusters(word):
    """Base letter plus its own diacritics — the unit a cut can fall between."""
    out = []
    for ch in word:
        if out and COMBINING.match(ch):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def skeleton(word):
    return COMBINING.sub('', word).translate(NORM)


def from_buckwalter(s):
    return ''.join(BUCKWALTER.get(c, c) for c in s)


def read_morph(path, buckwalter=False):
    words = defaultdict(list)                  # (s,a,w) -> [(form, tag, feats)]
    bad, elided = 0, [0]
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) < 3:
                continue
            loc = parts[0].strip().strip('()')
            try:
                s, a, w, _seg = (int(x) for x in loc.split(':'))
            except ValueError:
                bad += 1
                continue
            form = parts[1].strip()
            if buckwalter:
                form = from_buckwalter(form)
            if not form:
                # elided segments (e.g. the dropped ي of رَبِّ) have no letters,
                # so there is no boundary to draw. Counted, not aligned.
                elided[0] += 1
                continue
            tag = parts[2].strip()
            feats = parts[3] if len(parts) > 3 else ''
            words[(s, a, w)].append((form, tag, feats))
    if bad:
        print(f'  skipped {bad} unparseable lines')
    if elided[0]:
        print(f'  {elided[0]} zero-width segments (elided pronouns) — no cut possible')
    return words


def label(tag, feats):
    toks = [t for t in feats.split('|') if ':' not in t]
    for key in ('DET', 'PRON', 'DEM', 'REL', 'PN', 'ADJ',
                'CONJ', 'REM', 'NEG', 'EMPH', 'INTG', 'COND', 'ACC', 'FUT', 'VOC',
                'PERF', 'IMPF', 'IMPV'):
        if key in toks:
            if key == 'PRON' and 'PREF' not in toks and tag == 'P':
                return POS_UR['PRON']
            return POS_UR[key]
    return POS_UR.get(tag, tag)


def align(indopak, segments):
    """
    Return (cuts, status). cuts are cluster indices in `indopak` where a
    boundary was PROVEN. Anchors from both ends; never invents a boundary.
    """
    cl = clusters(indopak)
    skel = [skeleton(c) for c in cl]
    n = len(segments)
    if n < 2:
        return [], 'single'

    seg_skels = [[skeleton(c) for c in clusters(f)] for f, _, _ in segments]

    # left anchor
    left, i = [], 0
    for k in range(n - 1):
        ss = seg_skels[k]
        if ss and skel[i:i + len(ss)] == ss:
            i += len(ss)
            left.append(i)
        else:
            break

    # right anchor
    right, j = [], len(cl)
    for k in range(n - 1, len(left), -1):
        ss = seg_skels[k]
        if ss and skel[j - len(ss):j] == ss:
            j -= len(ss)
            right.append(j)
        else:
            break

    cuts = sorted({c for c in left + right if 0 < c < len(cl)})
    if len(cuts) == n - 1:
        status = 'full'
    elif cuts:
        status = 'partial'
    else:
        status = 'none'
    return cuts, status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--morph', required=True)
    ap.add_argument('--data', default='data', help='folder holding surah-NNN.json')
    ap.add_argument('--buckwalter', action='store_true',
                    help='source is the original Buckwalter corpus file')
    ap.add_argument('--report', help='write unresolved words to this file')
    ap.add_argument('--explain', metavar='S:A',
                    help='print a word-by-word breakdown for one ayah, e.g. 1:7')
    args = ap.parse_args()

    data = Path(args.data)
    if not (data / 'index.json').exists():
        sys.exit(f'{data}/index.json not found — run qul_export.py first.')

    print('Reading morphology…')
    morph = read_morph(args.morph, args.buckwalter)
    print(f'  {len(morph)} words, {sum(len(v) for v in morph.values())} segments')

    tally = {'full': 0, 'partial': 0, 'none': 0, 'single': 0, 'missing': 0, 'ayah_skip': 0}
    unresolved, per_surah, skipped_ayahs = [], [], []

    if args.explain:
        es, ea = (int(x) for x in args.explain.split(':'))
        sp = data / f'surah-{es:03d}.json'
        if not sp.exists():
            sys.exit(f'{sp} not found')
        verse = json.loads(sp.read_text(encoding='utf-8'))['verses'][ea - 1]
        stored = len(verse['w'])
        verse = {'w': real_words(verse)}
        corpus_n = sum(1 for k in morph if k[0] == es and k[1] == ea)
        if stored != len(verse['w']):
            print(f'\n  note: {stored - len(verse["w"])} stored tokens have no Arabic '
                  f'letter (waqf marks / ayah markers) and were ignored.')
        print(f'\n{es}:{ea} — your text has {len(verse["w"])} words, '
              f'the corpus has {corpus_n}')
        if corpus_n != len(verse['w']):
            print('  WORD COUNTS DIFFER — this whole ayah will be skipped.')
            print('  Your text splits or joins a word differently from the corpus.')
        for wi, word in enumerate(verse['w'], start=1):
            segs = morph.get((es, ea, wi))
            if not segs:
                print(f'  {wi}. {word}\n       not in the morphology file')
                continue
            cuts, status = align(word, segs)
            joined = ' + '.join(f for f, _, _ in segs)
            cl = clusters(word)
            shown = ' | '.join(
                ''.join(cl[a:b]) for a, b in
                zip([0] + cuts, cuts + [len(cl)])) if cuts else word
            mark = {'full': 'ok', 'partial': 'PARTIAL', 'none': 'UNPROVEN',
                    'single': 'one segment'}[status]
            print(f'  {wi}. {word}')
            print(f'       corpus : {joined}')
            print(f'       result : {shown}   [{mark}]')
            if status in ('partial', 'none'):
                print(f'       corpus skeleton : {[skeleton(c) for f,_,_ in segs for c in clusters(f)]}')
                print(f'       your skeleton   : {[skeleton(c) for c in cl]}')
        return

    for path in sorted(data.glob('surah-*.json')):
        surah = json.loads(path.read_text(encoding='utf-8'))
        s = surah['surah']
        out, local = {}, {'full': 0, 'partial': 0, 'none': 0, 'split': 0}

        for ai, verse in enumerate(surah['verses'], start=1):
            # Word indices are the join key. If your text splits or joins a word
            # differently from the corpus, every later index in the ayah shifts
            # and the morphology lands on the wrong words. Refuse the whole ayah
            # rather than emit plausible-looking nonsense.
            mine = real_words(verse)
            corpus_n = sum(1 for k in morph if k[0] == s and k[1] == ai)
            if corpus_n and corpus_n != len(mine):
                skipped_ayahs.append((s, ai, len(mine), corpus_n))
                tally['ayah_skip'] += len(mine)
                continue

            for wi, word in enumerate(mine, start=1):
                segs = morph.get((s, ai, wi))
                if not segs:
                    tally['missing'] += 1
                    continue
                cuts, status = align(word, segs)
                tally[status] += 1
                if status in local:
                    local[status] += 1
                if not cuts:
                    continue
                local['split'] += 1
                out[f'{ai}:{wi}'] = {
                    'c': cuts,
                    'p': [label(t, f) for _, t, f in segs],
                    'v': status == 'full',
                }
                if status == 'partial':
                    unresolved.append(
                        f'{s}:{ai}:{wi}\t{word}\t' + ' + '.join(f for f, _, _ in segs))

        if out:
            (data / f'morph-{s:03d}.json').write_text(
                json.dumps({'surah': s, 'segs': out},
                           ensure_ascii=False, separators=(',', ':')),
                encoding='utf-8')
        total = local['full'] + local['partial'] + local['none']
        if total:
            per_surah.append((s, local, total))

    idx_path = data / 'index.json'
    idx = json.loads(idx_path.read_text(encoding='utf-8'))
    idx['morph'] = {
        'source': 'Quranic Arabic Corpus 0.4 — Kais Dukes (GNU GPL), corpus.quran.com',
        'surahs': sorted(int(p.stem.split('-')[1]) for p in data.glob('morph-*.json')),
    }
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding='utf-8')

    graded = tally['full'] + tally['partial'] + tally['none']
    print(f'\nMulti-segment words examined: {graded}')
    if graded:
        for k, name in (('full', 'every boundary proven'),
                        ('partial', 'some boundaries proven'),
                        ('none', 'nothing could be proven')):
            print(f'  {name:<26} {tally[k]:>7}  ({100*tally[k]/graded:.1f}%)')
    print(f'  single-segment words       {tally["single"]:>7}')
    print(f'  words absent from morphology{tally["missing"]:>6}')
    print(f'  words in skipped ayahs     {tally["ayah_skip"]:>7}')

    if skipped_ayahs:
        print(f'\n{len(skipped_ayahs)} ayahs skipped — word count differs from the corpus.')
        print('Your text splits or joins a word differently there, so the word')
        print('indices would not line up. Inspect with --explain S:A')
        for s_, a_, mine, theirs in skipped_ayahs[:12]:
            print(f'  {s_}:{a_}  your text {mine} words, corpus {theirs}')
        if len(skipped_ayahs) > 12:
            print(f'  … and {len(skipped_ayahs) - 12} more')

    weak = [(s, l, t) for s, l, t in per_surah if l['none'] + l['partial'] > t * 0.1]
    if weak:
        print('\nSurahs where over 10% did not fully resolve — check these:')
        for s, l, t in weak[:15]:
            print(f'  surah {s:>3}: {l["full"]}/{t} full, {l["partial"]} partial, {l["none"]} none')

    if args.report and unresolved:
        Path(args.report).write_text('\n'.join(unresolved), encoding='utf-8')
        print(f'\n{len(unresolved)} partially-resolved words written to {args.report}')

    print('\nAttribution is required. The app displays it under ترتیبات › تقطیع.')


if __name__ == '__main__':
    sys.exit(main())
