# Why the text stayed black

The colour comes from `data/morph-*.json`. The files on your site were built by
the earlier importer, which only recorded where to cut words — it had no word
categories, because colouring did not exist yet. The app found the files, used
them for splitting, and had nothing to colour with.

# Upload these

Into `data/`, replacing what is there:

    data/morph-001.json
    data/morph-103.json
    data/morph-108.json
    data/morph-112.json
    data/morph-113.json
    data/morph-114.json

Into the repository root, replacing what is there:

    app.js
    sw.js

Then clear Chrome's cached files on the tab and reopen the site.

Turn on Settings › Show › **Colour by word type**.

## Two things app.js now does better

It says so when a morphology file is too old to carry colours, instead of
leaving you to guess why nothing happened.

It also looks for `morph-*.json` even when `index.json` does not list it. The
old behaviour trusted the index, so a file sitting right there could be ignored.

## When you re-export your own text

These six files match the sample text currently in your `data/` folder. Once
you export your own IndoPak text, regenerate them:

    python tools\morph_import.py --morph quran-morphology.txt --data data
