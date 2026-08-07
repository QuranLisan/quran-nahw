# Upload these

Into the repository root, replacing what is there:

    index.html
    app.css
    app.js
    sw.js

Into `tools/`:

    tools/morph_import.py

The `demo/` files here are only the sample morphology, refreshed for the new
format. Upload them only if you are still using the sample text.

Then clear Chrome's cached files on the tab and reopen the site.

## Lines layout

The ayah is now centred above the ruled lines, along with its reference and
translation.

## Colour by word type

Settings › Show › **Colour by word type**. Off by default.

    green   ism
    red     fi'l
    blue    harf

It applies to the cards, the table, the full ayah line, and to each part
separately when word splitting is on — so بِ shows blue and سْمِ green.

**This needs the morphology import.** The colours are the corpus's
classification, not a guess:

    python tools\morph_import.py --morph quran-morphology.txt --data data

Without it the setting does nothing and the sheet stays black. Get
`quran-morphology.txt` from github.com/mustafa0x/quran-morphology.

A word's category ignores its prefixes, which is what a student would expect:
بِسْمِ is ism despite the بِ, and عَلَيْهِمْ is harf despite the pronoun on
the end.
