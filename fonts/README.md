# Put your Quran font here

    fonts/quran.ttf

**Lowercase.** GitHub Pages is case-sensitive; Windows is not. A file committed
as `Quran.TTF` works on your laptop and 404s on the published site.

Android cannot use a font installed on the device — a browser will not expose
it to a web page. The file must be committed here and served with the app, or
the tablet falls back to a generic Arabic face.

## Committing it

Font files are binary, so check they actually went up:

    git add -f fonts/quran.ttf
    git commit -m "Add Quran font"
    git push

Then open `https://<user>.github.io/<repo>/fonts/quran.ttf` in a browser. If it
downloads, the site can see it. If you get a 404, it is not committed.

## Optional: WOFF2

Converting the TTF to `fonts/quran.woff2` roughly halves the download, which
matters on mobile. The app prefers it when both are present.

The app also tries several other spellings — `Quran.ttf`, `QURAN.TTF`,
`indopak.ttf` and a few more — and loads whichever answers. If none do, it
shows a red bar listing every path it tried with its status code.
