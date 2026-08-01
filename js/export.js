/* ============================================================
   نحوِ قرآن — PDF export
   The browser's own print engine lays pages out differently on
   Android than on desktop, which is how verses ended up sliced.
   So we build the PDF ourselves: capture the sheet, cut it only
   at the block boundaries paginate() chose, and place each piece
   on its own page. Identical output on every device.
   ============================================================ */
'use strict';

window.Exporter = (function () {

  const MM_PER_PX = 25.4 / 96;
  let libs = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(src));
      document.head.appendChild(s);
    });
  }

  async function ensureLibs() {
    if (libs) return libs;
    if (!window.html2canvas) await loadScript('vendor/html2canvas.min.js');
    if (!window.jspdf) await loadScript('vendor/jspdf.min.js');
    libs = { h2c: window.html2canvas, jsPDF: window.jspdf.jsPDF };
    return libs;
  }

  /* Blocks grouped per page, using the breaks paginate() already chose. */
  function pageGroups(sheet) {
    const groups = [];
    let cur = [];
    for (const el of sheet.children) {
      if (el.classList.contains('pagemark')) continue;
      if (el.classList.contains('pbreak') && cur.length) { groups.push(cur); cur = []; }
      cur.push(el);
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  /* cloneNode gives an empty canvas — the bitmap has to be copied over,
     or every pen stroke vanishes from the export. */
  function copyCanvases(srcEls, dstRoot) {
    const src = srcEls.flatMap((el) => [...el.querySelectorAll('canvas')]);
    const dst = [...dstRoot.querySelectorAll('canvas')];
    dst.forEach((c, i) => {
      const o = src[i];
      if (!o || !o.width || !o.height) return;
      c.width = o.width; c.height = o.height;
      c.style.width = o.style.width; c.style.height = o.style.height;
      try { c.getContext('2d').drawImage(o, 0, 0); } catch (_) {}
    });
  }

  async function build({ paper, orient, onStep, scale = 2.5 }) {
    const { h2c, jsPDF } = await ensureLibs();
    const sheet = document.querySelector('#sheet');
    const groups = pageGroups(sheet);
    const wPx = Math.round(sheet.getBoundingClientRect().width);
    const padPx = parseFloat(getComputedStyle(sheet).paddingLeft) || 0;
    const innerPx = wPx - padPx * 2;

    const pdf = new jsPDF({
      unit: 'mm', format: paper.toLowerCase(),
      orientation: orient === 'landscape' ? 'l' : 'p', compress: true,
    });
    const drawW = pdf.internal.pageSize.getWidth() - 24;   // 12mm each side
    const maxH = pdf.internal.pageSize.getHeight() - 24;

    // Off-screen stage, exactly the width of the printable area.
    const holder = document.createElement('div');
    holder.className = 'export-holder';
    const page = document.createElement('div');
    page.className = 'sheet export-page';
    page.style.width = innerPx + 'px';
    holder.appendChild(page);
    document.body.appendChild(holder);
    document.body.classList.add('exporting');

    try {
      for (let i = 0; i < groups.length; i++) {
        onStep?.(`Rendering page ${i + 1} of ${groups.length}…`);
        page.innerHTML = '';
        for (const el of groups[i]) {
          const c = el.cloneNode(true);
          c.classList.remove('pbreak');
          page.appendChild(c);
        }
        copyCanvases(groups[i], page);
        await new Promise((r) => requestAnimationFrame(r));

        const canvas = await h2c(page, {
          backgroundColor: '#ffffff', scale, useCORS: true, logging: false,
          width: innerPx, windowWidth: innerPx,
          height: Math.ceil(page.getBoundingClientRect().height),
        });

        let hMm = (canvas.height / canvas.width) * drawW;
        let w = drawW;
        if (hMm > maxH) { w = drawW * (maxH / hMm); hMm = maxH; }

        if (i > 0) pdf.addPage();
        const usePng = groups.length <= 40;
        pdf.addImage(
          usePng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92),
          usePng ? 'PNG' : 'JPEG',
          12 + (drawW - w) / 2, 12, w, hMm, undefined, 'FAST');
        canvas.width = canvas.height = 0;
      }

      onStep?.('Finishing…');
      return { blob: pdf.output('blob'), pages: groups.length };
    } finally {
      document.body.classList.remove('exporting');
      holder.remove();
    }
  }

  function filename(ref) {
    return `nahw-${ref.replace(/[^0-9a-zA-Z]+/g, '-')}.pdf`;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* Hands the PDF to the Android/iOS share sheet, where Samsung Notes,
     OneNote, Drive and the rest show up as targets. */
  function canShare() {
    try {
      return !!(navigator.canShare && navigator.canShare({
        files: [new File([new Blob(['x'], { type: 'application/pdf' })],
                         'a.pdf', { type: 'application/pdf' })],
      }));
    } catch (_) { return false; }
  }

  async function share(blob, name) {
    const file = new File([blob], name, { type: 'application/pdf' });
    await navigator.share({ files: [file], title: name });
  }

  return { build, download, share, canShare, filename };
})();
