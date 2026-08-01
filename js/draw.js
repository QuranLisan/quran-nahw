/* ============================================================
   نحوِ قرآن — drawing layer
   A vector canvas per ayah block. Strokes are stored as points,
   not pixels, so they survive paper-size changes and print at
   full resolution. Canvases mount lazily — a Juz-30 sheet has
   500+ blocks and we never want 500 live canvases at once.
   ============================================================ */
'use strict';

window.Draw = (function () {

  const strokes = new Map();   // key -> [stroke]
  const live = new Map();      // key -> {el, canvas, ctx, ro}
  const dirty = new Set();
  let tool = { color: '#b3261e', size: 2.2, eraser: false };
  let io = null;
  let saveTimer = null;

  const DPR = () => Math.min(3, Math.max(2, window.devicePixelRatio || 1));

  /* ---------- persistence ---------- */

  async function load() {
    try {
      const db = await QN.openDB();
      await new Promise((res) => {
        const req = db.transaction('notes').objectStore('notes').openCursor();
        req.onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return res();
          if (typeof c.key === 'string' && c.key.startsWith('draw:')) {
            strokes.set(c.key.slice(5), c.value || []);
          }
          c.continue();
        };
        req.onerror = () => res();
      });
    } catch (_) { /* no IDB — session only */ }
  }

  function queueSave(key) {
    dirty.add(key);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }

  async function flush() {
    const keys = [...dirty]; dirty.clear();
    for (const k of keys) {
      const v = strokes.get(k);
      try {
        if (v && v.length) await QN.idbPut('notes', 'draw:' + k, v);
        else {
          const db = await QN.openDB();
          db.transaction('notes', 'readwrite').objectStore('notes')
            .delete('draw:' + k);
          strokes.delete(k);
        }
      } catch (_) { /* ignore */ }
    }
    document.dispatchEvent(new CustomEvent('draw:saved'));
  }

  /* ---------- painting ---------- */

  /* x and y scale against their own axis. The block reflows between
     screen and print, and a single width-derived factor would drag
     strokes off the bottom of the canvas. */
  function paintStroke(ctx, st, sx, sy) {
    const p = st.p;
    if (!p.length) return;
    const lw = (st.s * (sx + sy)) / 2;
    ctx.strokeStyle = st.c;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0] * sx, p[0][1] * sy, lw / 2, 0, 6.2832);
      ctx.fillStyle = st.c; ctx.fill();
      return;
    }
    // Quadratic through midpoints: the raw points are a jagged polyline,
    // and drawing them segment-by-segment is what makes a stroke look
    // like it was assembled out of dashes.
    let px = p[0][0] * sx, py = p[0][1] * sy;
    for (let i = 1; i < p.length; i++) {
      const cx = p[i][0] * sx, cy = p[i][1] * sy;
      const mx = (px + cx) / 2, my = (py + cy) / 2;
      ctx.beginPath();
      ctx.lineWidth = lw * (0.45 + 0.55 * (p[i][2] || 0.5));
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px, py, mx, my);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      px = cx; py = cy;
    }
  }

  function repaint(key) {
    const m = live.get(key);
    if (!m) return;
    const { canvas, ctx } = m;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const d = DPR();
    const w = canvas.width / d, h = canvas.height / d;
    for (const st of (strokes.get(key) || [])) {
      paintStroke(ctx, st, (w / (st.w || w)) * d, (h / (st.h || h)) * d);
    }
  }

  function sizeCanvas(key) {
    const m = live.get(key);
    if (!m) return;
    const r = m.el.getBoundingClientRect();
    const d = DPR();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (m.canvas.width === w * d && m.canvas.height === h * d) return;
    m.canvas.width = w * d;
    m.canvas.height = h * d;
    m.canvas.style.width = w + 'px';
    m.canvas.style.height = h + 'px';
    repaint(key);
  }

  /* ---------- input ---------- */

  function wire(key, canvas) {
    let cur = null, last = null, lastMid = [0, 0], smooth = 0.5;

    const pt = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top,
              e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.55];
    };

    const eraseAt = (x, y) => {
      const list = strokes.get(key) || [];
      const d = DPR();
      const w = canvas.width / d, h = canvas.height / d;
      const R = 13;
      const keep = list.filter((st) => {
        const sx = w / (st.w || w), sy = h / (st.h || h);
        return !st.p.some(([px, py]) =>
          Math.hypot(px * sx - x, py * sy - y) < R);
      });
      if (keep.length !== list.length) {
        strokes.set(key, keep); repaint(key); queueSave(key);
      }
    };

    canvas.addEventListener('pointerdown', (e) => {
      // Palm rejection: pen and mouse draw, finger does not.
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (tool.eraser) { eraseAt(p[0], p[1]); cur = 'erase'; return; }
      const dd = DPR();
      cur = { c: tool.color, s: tool.size,
              w: canvas.width / dd, h: canvas.height / dd,
              t: Date.now(), p: [p] };
      last = p;
      smooth = p[2];
      lastMid = [p[0] * dd, p[1] * dd];
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!cur) return;
      e.preventDefault();
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (cur === 'erase') {
        for (const ev of pts) { const p = pt(ev); eraseAt(p[0], p[1]); }
        return;
      }
      const m = live.get(key); if (!m) return;
      const d = DPR();
      m.ctx.strokeStyle = cur.c; m.ctx.lineCap = 'round'; m.ctx.lineJoin = 'round';
      for (const ev of pts) {
        const p = pt(ev);
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.1) continue;
        // low-pass the pressure so the line doesn't pulse
        smooth = smooth * 0.68 + p[2] * 0.32;
        p[2] = smooth;
        cur.p.push(p);
        const mx = ((last[0] + p[0]) / 2) * d, my = ((last[1] + p[1]) / 2) * d;
        m.ctx.beginPath();
        m.ctx.lineWidth = cur.s * d * (0.45 + 0.55 * smooth);
        m.ctx.moveTo(lastMid[0], lastMid[1]);
        m.ctx.quadraticCurveTo(last[0] * d, last[1] * d, mx, my);
        m.ctx.stroke();
        lastMid = [mx, my];
        last = p;
      }
    });

    const end = () => {
      if (cur && cur !== 'erase' && cur.p.length) {
        const list = strokes.get(key) || [];
        list.push(cur); strokes.set(key, list); queueSave(key);
      }
      cur = null; last = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  /* ---------- mount / unmount ---------- */

  function mount(el) {
    const key = el.dataset.key;
    if (!key || live.has(key)) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'ink';
    canvas.style.touchAction = locked ? 'none' : 'pan-y';
    el.appendChild(canvas);
    // NOTE: deliberately NOT desynchronized. On a transparent overlay it
    // gets promoted to its own compositing layer, which flashes black on
    // some Android GPUs during scroll.
    live.set(key, { el, canvas, ctx: canvas.getContext('2d') });
    sizeCanvas(key);
    wire(key, canvas);
    const ro = new ResizeObserver(() => sizeCanvas(key));
    ro.observe(el);
    live.get(key).ro = ro;
  }

  function unmount(key) {
    const m = live.get(key);
    if (!m) return;
    m.ro?.disconnect();
    m.canvas.remove();
    live.delete(key);
  }

  function detach() {
    io?.disconnect(); io = null;
    for (const k of [...live.keys()]) unmount(k);
  }

  /* Attach to every block in the sheet. Blocks mount when they scroll
     near the viewport; blocks that already hold ink mount immediately
     so nothing is invisible while scrolling fast or printing. */
  function attach(root) {
    detach();
    const blocks = [...root.querySelectorAll('[data-key]')];
    io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) mount(en.target);
    }, { rootMargin: '900px 0px' });
    for (const el of blocks) {
      if (strokes.has(el.dataset.key)) mount(el);
      io.observe(el);
    }
  }

  function mountAll(root) {
    for (const el of root.querySelectorAll('[data-key]')) {
      if (strokes.has(el.dataset.key)) mount(el);
    }
  }

  /* ---------- public ---------- */

  function repaintAll() { for (const k of live.keys()) { sizeCanvas(k); repaint(k); } }
  if (window.matchMedia) {
    try { window.matchMedia('print').addEventListener('change', repaintAll); }
    catch (_) { /* older browser */ }
  }

  let locked = false;
  function setLocked(on) {
    locked = !!on;
    document.body.classList.toggle('penlock', locked);
    for (const { canvas } of live.values()) {
      canvas.style.touchAction = locked ? 'none' : 'pan-y';
    }
  }

  return {
    load, attach, detach, mountAll, flush, repaintAll,
    setLocked, isLocked: () => locked,
    setTool: (t) => Object.assign(tool, t),
    getTool: () => ({ ...tool }),
    undo() {
      // Undo the most recently drawn stroke anywhere on the sheet.
      let best = null, bestT = -1;
      for (const [k, list] of strokes) {
        const st = list[list.length - 1];
        if (st && (st.t || 0) >= bestT) { best = k; bestT = st.t || 0; }
      }
      if (!best) return false;
      strokes.get(best).pop();
      repaint(best); queueSave(best);
      return true;
    },
    clearVisible(root) {
      let n = 0;
      for (const el of root.querySelectorAll('[data-key]')) {
        const k = el.dataset.key;
        if (strokes.has(k)) { strokes.delete(k); repaint(k); queueSave(k); n++; }
      }
      return n;
    },
    count: () => strokes.size,
    hasInk: (key) => strokes.has(key),
  };
})();
