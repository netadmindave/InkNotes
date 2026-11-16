/* app.js — InkNotes UI controller */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const A = window.Android;

  /* ---------------- storage ---------------- */
  const store = A ? {
    ids: () => { try { return JSON.parse(A.listNotes()); } catch (e) { return []; } },
    load: (id) => A.load(id),
    save: (id, json) => A.save(id, json),
    remove: (id) => A.remove(id),
    getPref: (k) => A.getPref(k),
    setPref: (k, v) => A.setPref(k, v),
    readAsset: (p) => A.readAsset(p)
  } : {
    ids: () => Object.keys(localStorage).filter(k => k.startsWith('note:')).map(k => k.slice(5)),
    load: (id) => localStorage.getItem('note:' + id) || '',
    save: (id, json) => { localStorage.setItem('note:' + id, json); return true; },
    remove: (id) => localStorage.removeItem('note:' + id),
    getPref: (k) => localStorage.getItem('pref:' + k) || '',
    setPref: (k, v) => localStorage.setItem('pref:' + k, v),
    readAsset: (p) => { const x = new XMLHttpRequest(); x.open('GET', p.replace(/^www\//, ''), false); x.send(); return x.responseText; }
  };

  const toast = (m) => A ? A.toast(m) : console.log('[toast]', m);

  /* ---------------- prefs ---------------- */
  const prefs = {
    font: store.getPref('font') || 'caveat',
    paper: store.getPref('paper') || 'lined',
    handMath: store.getPref('handMath') !== '0',
    autoMath: store.getPref('autoMath') !== '0',
    size: store.getPref('size') || 'letter',
    // no S Pen (e.g. Pixel) → one finger writes; with a pen, fingers scroll by default
    fingerDraws: (() => { const v = store.getPref('fingerDraws'); if (v) return v === '1'; try { return !(A && A.hasStylus && A.hasStylus()); } catch (e) { return true; } })(),
    lock: store.getPref('lock') === '1',
    mode: store.getPref('mode') || 'text',
    inkColor: store.getPref('inkColor') || '#1d3557',
    inkSize: parseFloat(store.getPref('inkSize2') || '2.5'),
    lastNote: store.getPref('lastNote') || ''
  };
  let userDict = new Set();
  try { userDict = new Set(JSON.parse(store.getPref('userDict') || '[]')); } catch (e) { }
  const setPref = (k, v) => { prefs[k] = v; store.setPref(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); };

  const FONTS = [['caveat', 'Caveat', 'Caveat'], ['kalam', 'Kalam', 'Kalam'], ['patrick', 'Patrick Hand', 'Patrick'], ['shadows', 'Shadows Into Light', 'Shadows']];
  const PAPERS = [['lined', 'Lined'], ['grid', 'Grid'], ['dot', 'Dots'], ['plain', 'Plain']];
  const INK_COLORS = ['#1d3557', '#111111', '#c2410c', '#2f7d32', '#7b2cbf', '#f5c518'];
  const SIZES = { letter: { w: 816, h: 1056, label: 'Letter 8.5×11', css: '8.5in 11in' }, a4: { w: 794, h: 1123, label: 'A4', css: '210mm 297mm' } };
  const MARGIN = { t: 80, b: 56, l: 96, r: 56 };
  const pageDim = () => SIZES[(note && note.size) || prefs.size] || SIZES.letter;
  const contentW = () => pageDim().w - MARGIN.l - MARGIN.r;
  const contentH = () => pageDim().h - MARGIN.t - MARGIN.b;

  function applyBodyClasses() {
    document.body.classList.remove(...FONTS.map(f => 'font-' + f[0]));
    document.body.classList.add('font-' + prefs.font);
    document.body.classList.toggle('handmath', prefs.handMath);
  }

  /* ---------------- notes ---------------- */
  let index = [];        // [{id,title,updated,preview,text}]
  let note = null;       // current note object
  const uid = (p) => (p || 'b') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function previewOf(n) {
    const t = n.blocks.map(b => b.type === 'text' ? b.src : b.type === 'math' ? b.src : '').join(' ').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function loadIndex() {
    index = [];
    for (const id of store.ids()) {
      try {
        const n = JSON.parse(store.load(id));
        index.push({ id, title: n.title || 'Untitled', updated: n.updated || 0, preview: previewOf(n), text: ((n.title || '') + ' ' + previewOf(n)).toLowerCase() });
      } catch (e) { }
    }
    index.sort((a, b) => b.updated - a.updated);
  }

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const ul = $('#noteList');
    ul.innerHTML = '';
    for (const it of index) {
      if (q && !it.text.includes(q)) continue;
      const li = document.createElement('li');
      if (note && it.id === note.id) li.className = 'on';
      li.innerHTML = '<div class="t"></div><div class="s"></div>';
      li.firstChild.textContent = it.title || 'Untitled';
      li.lastChild.textContent = fmtDate(it.updated) + (it.preview ? ' · ' + it.preview : '');
      li.onclick = () => { openNote(it.id); document.body.classList.remove('drawer'); };
      ul.appendChild(li);
    }
  }

  function fmtDate(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!note) return;
    note.updated = Date.now();
    store.save(note.id, JSON.stringify(note));
    const it = index.find(i => i.id === note.id);
    const entry = { id: note.id, title: note.title || 'Untitled', updated: note.updated, preview: previewOf(note) };
    entry.text = (entry.title + ' ' + entry.preview).toLowerCase();
    if (it) Object.assign(it, entry); else index.unshift(entry);
    index.sort((a, b) => b.updated - a.updated);
    renderList();
    $('#meta').textContent = 'Edited ' + fmtDate(note.updated);
  }

  function newNote(blocks, title) {
    finishEdit();
    if (note) saveNow();
    note = { id: uid('n'), title: title || '', created: Date.now(), updated: Date.now(), paper: prefs.paper, size: prefs.size, blocks: blocks || [] };
    store.save(note.id, JSON.stringify(note));
    loadIndex();
    showNote();
    return note;
  }

  function openNote(id) {
    finishEdit();
    if (note) saveNow();
    try { note = JSON.parse(store.load(id)); } catch (e) { note = null; }
    if (!note) return;
    note.id = id;
    note.blocks = note.blocks || [];
    note.size = note.size || 'letter';
    showNote();
  }

  function showNote() {
    setPref('lastNote', note.id);
    $('#title').value = note.title || '';
    $('#meta').textContent = note.updated ? 'Edited ' + fmtDate(note.updated) : '';
    history = [snapshot()]; hIdx = 0; updateUndo();
    userZoom = 1;
    applyZoom();
    renderBlocks();
    renderList();
    $('#scroller').scrollTop = 0;
  }

  /* ---------------- undo / redo ---------------- */
  let history = [], hIdx = 0;
  const snapshot = () => JSON.stringify({ title: note.title, blocks: note.blocks, paper: note.paper, size: note.size });
  function commit() {
    if (!note) return;
    const s = snapshot();
    if (history[hIdx] === s) return;
    history = history.slice(0, hIdx + 1);
    history.push(s);
    if (history.length > 80) history.shift();
    hIdx = history.length - 1;
    updateUndo();
    scheduleSave();
  }
  function restore(s) {
    const o = JSON.parse(s);
    note.title = o.title; note.blocks = o.blocks; note.paper = o.paper; note.size = o.size || note.size;
    $('#title').value = note.title || '';
    applyZoom();
    renderBlocks();
    scheduleSave();
    updateUndo();
  }
  function undo() { finishEdit(); if (hIdx > 0) restore(history[--hIdx]); }
  function redo() { finishEdit(); if (hIdx < history.length - 1) restore(history[++hIdx]); }
  function updateUndo() { $('#btnUndo').disabled = hIdx <= 0; $('#btnRedo').disabled = hIdx >= history.length - 1; }

  /* ---------------- block rendering ---------------- */
  const pagesEl = $('#pages');
  let editing = null;  // {id, el, type, detach}

  function blockById(id) { return note.blocks.find(b => b.id === id); }
  function blockIndex(id) { return note.blocks.findIndex(b => b.id === id); }

  function renderBlocks() {
    editing = null;
    hideBars();
    layout(note.blocks.map(b => b.type === 'break' ? null : viewEl(b)));
  }
  /** Re-paginate using the existing block elements (after something changed height). */
  function relayout() {
    if (editing) return;
    layout(note.blocks.map(b => b.type === 'break' ? null : (pagesEl.querySelector('.block[data-id="' + b.id + '"]') || viewEl(b))));
  }

  /* ---------------- pages ---------------- */
  function layout(els) {
    const d = pageDim(), CH = contentH();
    const sc = $('#scroller'), keepTop = sc.scrollTop, keepLeft = sc.scrollLeft;
    const z = pagesEl.style.zoom;
    pagesEl.style.zoom = 1;                       // measure in page units
    const header = $('#noteHead');
    pagesEl.innerHTML = '';
    $('#pageStyle').textContent = '@page { size: ' + d.css + '; margin: 0; }';
    let sheet, content, pageBlocks, pageNo = 0;
    const newSheet = (breakId) => {
      sheet = document.createElement('div');
      sheet.className = 'sheet paper-' + (note.paper || prefs.paper);
      sheet.style.width = d.w + 'px';
      sheet.style.minHeight = d.h + 'px';
      content = document.createElement('div');
      content.className = 'content';
      content.style.minHeight = CH + 'px';
      sheet.appendChild(content);
      const num = document.createElement('div');
      num.className = 'pnum'; num.textContent = String(++pageNo);
      sheet.appendChild(num);
      pagesEl.appendChild(sheet);
      sheet._breakId = breakId || null;
      pageBlocks = [];
      if (pageNo === 1) content.appendChild(header);
    };
    const closeSheet = (at) => {
      const pad = document.createElement('div');
      pad.className = 'pad';
      pad._at = at;
      pad._last = pageBlocks[pageBlocks.length - 1] || null;
      content.appendChild(pad);
      if (!pageBlocks.length && sheet._breakId) {
        const rm = document.createElement('button');
        rm.className = 'pill rmpage'; rm.textContent = 'Remove blank page';
        const bid = sheet._breakId;
        rm.onclick = () => { const i = blockIndex(bid); if (i >= 0) { note.blocks.splice(i, 1); renderBlocks(); commit(); } };
        pad.appendChild(rm);
      }
    };
    newSheet();
    note.blocks.forEach((b, i) => {
      if (b.type === 'break') { closeSheet(i); newSheet(b.id); return; }
      const el = els[i];
      content.appendChild(el);
      let bottom = el.offsetTop + el.offsetHeight;
      if (bottom > CH && (pageBlocks.length || pageNo === 1 && el.offsetTop > 140)) {
        closeSheet(i); newSheet();
        content.appendChild(el);
        bottom = el.offsetTop + el.offsetHeight;
      }
      if (b.type === 'ink') {
        const k = (b.w || contentW()) / contentW();
        el._maxH = Math.max(80, (CH - el.offsetTop) * k);
        el._h0 = b.h;
      }
      el._page = pageNo;
      pageBlocks.push(b);
    });
    closeSheet(note.blocks.length);
    const add = document.createElement('button');
    add.id = 'addPage'; add.className = 'pill'; add.textContent = '＋ Add page';
    add.onclick = () => addPage(true);
    pagesEl.appendChild(add);
    pagesEl.style.zoom = z;
    sc.scrollTop = keepTop; sc.scrollLeft = keepLeft;
  }

  function addPage(scroll) {
    finishEdit();
    note.blocks.push({ id: uid(), type: 'break' });
    renderBlocks();
    commit();
    if (scroll) { const sh = $$('.sheet', pagesEl).pop(); sh && sh.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  /* ---------------- zoom ---------------- */
  let userZoom = 1, curZoom = 1;
  function fitZoom() {
    const sc = $('#scroller');
    const avail = sc.clientWidth - (sc.clientWidth < 700 ? 8 : 40);
    return Math.max(0.2, Math.min(1.6, avail / pageDim().w));
  }
  function applyZoom() {
    curZoom = fitZoom() * userZoom;
    pagesEl.style.zoom = curZoom;
  }

  function viewEl(b) {
    const el = document.createElement('div');
    el.className = 'block ' + b.type;
    el.dataset.id = b.id;
    if (b.type === 'text') {
      const h = document.createElement('div');
      h.className = 'hand';
      const misspelt = Cleanup.ready ? Cleanup.misspeltWords(b.src, userDict, prefs.autoMath) : null;
      h.innerHTML = MathText.renderText(b.src, { autoMath: prefs.autoMath, misspelt });
      el.appendChild(h);
    } else if (b.type === 'math') {
      const d = document.createElement('div');
      d.className = 'disp';
      const r = MathText.renderMath(b.src, true);
      if (!b.src.trim()) d.classList.add('empty');
      d.innerHTML = r.html;
      el.appendChild(d);
    } else if (b.type === 'ink') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.appendChild(svg);
      const sel = inkSel && inkSel.id === b.id ? inkSel.idx : null;
      Ink.render(svg, b, sel);
      el._svg = svg;
      el._ink = Ink.session(svg, b, {
        onChange: () => {
          lastInkId = b.id;
          if (inkSel && inkSel.id === b.id) { inkSel = null; rerenderBlock(b.id); }
          afterInk(b);
        },
        onSelect: (idx) => { if (idx.length) selectInk(b.id, new Set(idx), true); else clearInkSel(); },
        maxH: () => { const cur = pagesEl.querySelector('.block[data-id="' + b.id + '"]'); return (cur && cur._maxH) || 1e9; }
      });
      if (inkSel && inkSel.id === b.id) { el.classList.add('selected'); el.appendChild(inkActions(b)); }
    }
    el.addEventListener('click', (e) => {
      if (b.type === 'ink') return;
      if (editing && editing.id === b.id) return;
      const cb = e.target.closest('.cb');
      if (cb && b.type === 'text') { toggleCheck(b, +cb.dataset.line); e.stopPropagation(); return; }
      startEdit(b.id, { caret: 'end' });
    });
    return el;
  }

  function rerenderBlock(id) {
    const b = blockById(id);
    const old = pagesEl.querySelector('.block[data-id="' + id + '"]');
    if (!b) { old && old.remove(); return; }
    const el = viewEl(b);
    if (old) { el._maxH = old._maxH; el._h0 = old._h0; el._page = old._page; old.replaceWith(el); }
    else relayout();
    return el;
  }

  function toggleCheck(b, lineIdx) {
    const lines = b.src.split('\n');
    lines[lineIdx] = lines[lineIdx].replace(/\[( |x|X)\]/, (m, c) => c === ' ' ? '[x]' : '[ ]');
    b.src = lines.join('\n');
    rerenderBlock(b.id);
    commit();
  }

  /* ---------------- editing ---------------- */
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  function actionsStrip(b) {
    const a = document.createElement('div');
    a.className = 'actions';
    const btn = (label, title, fn, cls) => {
      const x = document.createElement('button');
      x.textContent = label; x.title = title; if (cls) x.className = cls;
      x.addEventListener('pointerdown', e => e.preventDefault());
      x.addEventListener('click', e => { e.stopPropagation(); fn(); });
      a.appendChild(x);
    };
    btn('↑', 'Move up', () => moveBlock(b.id, -1));
    btn('↓', 'Move down', () => moveBlock(b.id, 1));
    if (b.type !== 'ink') btn(b.type === 'text' ? '→ ∑' : '→ Aa', 'Convert', () => convertBlock(b.id));
    btn('Delete', 'Delete block', () => deleteBlock(b.id), 'danger');
    return a;
  }

  function startEdit(id, opts) {
    opts = opts || {};
    if (editing && editing.id === id) return;
    finishEdit();
    const b = blockById(id);
    if (!b) return;
    if (b.type === 'ink') { selectInk(id, null, true); return; }
    clearInkSel();
    const old = pagesEl.querySelector('.block[data-id="' + id + '"]');
    const el = document.createElement('div');
    el.className = 'block ' + b.type + ' editing';
    el.dataset.id = id;
    el.appendChild(actionsStrip(b));
    old.replaceWith(el);
    editing = { id, el, type: b.type, before: JSON.stringify(b) };

    if (b.type === 'text' || b.type === 'math') {
      const ta = document.createElement('textarea');
      ta.value = b.src;
      ta.rows = 1;
      ta.spellcheck = b.type === 'text';
      ta.setAttribute('autocapitalize', b.type === 'text' ? 'sentences' : 'off');
      ta.setAttribute('autocorrect', b.type === 'text' ? 'on' : 'off');
      ta.setAttribute('autocomplete', 'off');
      if (b.type === 'math') ta.placeholder = 'Type a formula, e.g.  int_0^oo e^(-x^2) dx = sqrt(pi)/2';
      else ta.placeholder = 'Write here…';
      el.appendChild(ta);
      let prev = null;
      if (b.type === 'math') {
        prev = document.createElement('div');
        prev.className = 'disp';
        el.appendChild(prev);
        const err = document.createElement('div');
        err.className = 'err';
        el.appendChild(err);
      }
      const update = () => {
        b.src = ta.value;
        autoGrow(ta);
        if (prev) {
          const r = MathText.renderMath(b.src, true);
          prev.innerHTML = r.html;
          prev.classList.toggle('empty', !b.src.trim());
          el.querySelector('.err').textContent = r.ok ? '' : r.err;
        }
        scheduleSave();
        clearTimeout(editing && editing.commitTimer);
        if (editing) editing.commitTimer = setTimeout(commit, 1500);
      };
      ta.addEventListener('input', update);
      ta.addEventListener('keydown', (e) => onEditorKey(e, b, ta));
      editing.ta = ta;
      update();
      ta.focus({ preventScroll: true });
      const pos = opts.caret === 'start' ? 0 : typeof opts.caret === 'number' ? opts.caret : ta.value.length;
      ta.setSelectionRange(pos, pos);
      requestAnimationFrame(() => { autoGrow(ta); ensureVisible(el); });
      if (b.type === 'math') showMathbar();
    }
    setModeUI(b.type === 'math' ? 'math' : 'text');
  }

  function ensureVisible(el) {
    const sc = $('#scroller'), r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    if (r.top < sr.top + 50) sc.scrollTop += r.top - sr.top - 60;
    else if (r.bottom > sr.bottom - 40) sc.scrollTop += Math.min(r.top - sr.top - 60, r.bottom - sr.bottom + 80);
  }

  function finishEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    clearTimeout(ed.commitTimer);
    if (ed.detach) ed.detach();
    const b = blockById(ed.id);
    hideBars();
    if (b && (b.type === 'text' || b.type === 'math') && !b.src.trim()) {
      note.blocks.splice(blockIndex(b.id), 1);
      ed.el.remove();
    } else if (b && b.type === 'ink' && !(b.strokes || []).length) {
      note.blocks.splice(blockIndex(b.id), 1);
      ed.el.remove();
    } else if (b) {
      if (b.type === 'math') b.src = b.src.trim();
      const el = viewEl(b);
      ed.el.replaceWith(el);
    }
    commit();
    setModeUI(prefs.mode);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    relayout();
  }

  /** After a stroke: save, re-paginate if the area grew, and start a fresh page when the last one fills up. */
  function afterInk(b) {
    commit();
    const el = pagesEl.querySelector('.block[data-id="' + b.id + '"]');
    if (!el) return;
    const last = note.blocks[note.blocks.length - 1];
    if (last === b && el._maxH && b.h >= el._maxH - 30) { note.blocks.push({ id: uid(), type: 'break' }); relayout(); commit(); return; }
    if (b.h !== el._h0) relayout();
  }

  /* ---------------- ink selection ---------------- */
  let inkSel = null;      // {id, idx: Set|null}  (null idx = whole area)
  let lastInkId = null;
  function selectInk(id, idx, keep) {
    finishEdit();
    const prev = inkSel && inkSel.id;
    if (!keep && inkSel && inkSel.id === id && !inkSel.idx && !idx) { inkSel = null; rerenderBlock(id); return; }
    inkSel = { id, idx: idx || null };
    lastInkId = id;
    if (prev && prev !== id) rerenderBlock(prev);
    rerenderBlock(id);
  }
  function clearInkSel() {
    if (!inkSel) return;
    const id = inkSel.id;
    inkSel = null;
    rerenderBlock(id);
  }
  function inkActions(b) {
    const a = document.createElement('div');
    a.className = 'actions';
    const idx = inkSel && inkSel.idx;
    const btn = (label, fn, cls) => {
      const x = document.createElement('button');
      x.textContent = label; if (cls) x.className = cls;
      x.addEventListener('pointerdown', e => e.stopPropagation());
      x.addEventListener('click', e => { e.stopPropagation(); fn(); });
      a.appendChild(x);
    };
    btn('⇄ Convert', () => convertInk(b.id, idx));
    btn('Smooth', () => { Ink.smooth(b, idx); rerenderBlock(b.id); commit(); });
    if (idx) {
      btn('Delete', () => { b.strokes = b.strokes.filter((_, i) => !idx.has(i)); inkSel = null; if (!b.strokes.length) deleteBlock(b.id); else { rerenderBlock(b.id); commit(); } }, 'danger');
    } else {
      btn('↑', () => moveBlock(b.id, -1));
      btn('↓', () => moveBlock(b.id, 1));
      btn('Taller', () => { b.h += 200; rerenderBlock(b.id); relayout(); commit(); });
      btn('Delete', () => { inkSel = null; deleteBlock(b.id); }, 'danger');
    }
    btn('✕', () => clearInkSel());
    return a;
  }

  function insertBlock(type, afterId, src) {
    return insertAt(type, afterId ? blockIndex(afterId) + 1 : note.blocks.length, src);
  }
  function insertAt(type, i, src) {
    const b = { id: uid(), type, src: src || '' };
    if (type === 'ink') { b.src = undefined; b.strokes = []; b.w = contentW(); b.h = 200; }
    i = Math.max(0, Math.min(i, note.blocks.length));
    note.blocks.splice(i, 0, b);
    renderBlocks();
    return b;
  }

  function onEditorKey(e, b, ta) {
    if (b.type === 'math' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // finish formula, continue in text
      const id = b.id, i = blockIndex(id);
      finishEdit();
      setMode('text', true);
      const nb = insertAt('text', blockById(id) ? i + 1 : i);
      startEdit(nb.id);
      return;
    }
    if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const i = blockIndex(b.id);
      const prev = note.blocks[i - 1];
      if (!ta.value) {
        e.preventDefault();
        finishEdit();               // removes the empty block
        if (prev && prev.type !== 'ink') startEdit(prev.id, { caret: 'end' });
      } else if (prev && prev.type === 'text' && b.type === 'text') {
        e.preventDefault();          // merge into previous text block
        const pos = prev.src.length + (prev.src ? 1 : 0);
        prev.src = prev.src ? prev.src + '\n' + b.src : b.src;
        b.src = '';
        finishEdit();
        rerenderBlock(prev.id);
        startEdit(prev.id, { caret: pos });
      }
    }
  }

  function moveBlock(id, dir) {
    const i = blockIndex(id), j = i + dir;
    if (j < 0 || j >= note.blocks.length) return;
    finishEdit();
    const [b] = note.blocks.splice(i, 1);
    note.blocks.splice(j, 0, b);
    renderBlocks();
    commit();
    startEdit(id);
  }

  function convertBlock(id) {
    const b = blockById(id);
    if (!b) return;
    if (editing) { editing.detach && editing.detach(); }
    b.type = b.type === 'text' ? 'math' : 'text';
    editing = null;
    const old = pagesEl.querySelector('.block[data-id="' + id + '"]');
    old.replaceWith(viewEl(b));
    hideBars();
    commit();
    startEdit(id);
  }

  function deleteBlock(id) {
    const i = blockIndex(id);
    if (i < 0) return;
    if (editing && editing.id === id) { editing.detach && editing.detach(); editing = null; hideBars(); }
    if (inkSel && inkSel.id === id) inkSel = null;
    note.blocks.splice(i, 1);
    const el = pagesEl.querySelector('.block[data-id="' + id + '"]');
    el && el.remove();
    relayout();
    commit();
    toast('Block deleted — ↶ to undo');
  }

  /* ---------------- mode switch (Text ⇄ Math) ---------------- */
  function setModeUI(m) { $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === m)); }

  function setMode(m, quiet) {
    setPref('mode', m);
    setModeUI(m);
    if (quiet || !editing || m === 'auto') return;
    const b = blockById(editing.id);
    if (!b || b.type === m || b.type === 'ink') return;
    if (b.type === 'text' && m === 'math') {
      const ta = editing.ta, pos = ta.selectionStart;
      const before = b.src.slice(0, pos).replace(/\s+$/, ''), after = b.src.slice(pos).replace(/^\s+/, '');
      if (!before.trim() && !after.trim()) { convertBlock(b.id); return; }
      const id = b.id, i = blockIndex(id);
      b.src = before;
      finishEdit();                                   // drops the block if nothing came before the cursor
      const mb = insertAt('math', blockById(id) ? i + 1 : i);
      if (after.trim()) insertBlock('text', mb.id, after);
      startEdit(mb.id);
    } else if (b.type === 'math' && m === 'text') {
      const id = b.id, i = blockIndex(id);
      finishEdit();
      const nb = insertAt('text', blockById(id) ? i + 1 : i);
      startEdit(nb.id);
    }
  }

  /* ---------------- bars ---------------- */
  const MATH_KEYS = [
    ['a⁄b', '()/()', 4], ['xⁿ', '^()', 1], ['xₙ', '_()', 1], ['√', 'sqrt()', 1], ['ⁿ√', 'root()()', 3],
    ['∫', 'int_()^() ', 6], ['∑', 'sum_(n=1)^N ', 0], ['∏', 'prod_(n=1)^N ', 0], ['lim', 'lim_(x->) ', 2],
    ['d/dx', '(d)/(dx) ', 0], ['∂', 'del ', 0], ['∇', 'grad ', 0], ['∞', 'oo ', 0], ['±', '+- ', 0], ['×', 'xx ', 0], ['·', '* ', 0],
    ['≤', '<= ', 0], ['≥', '>= ', 0], ['≠', '!= ', 0], ['≈', '~~ ', 0], ['→', '-> ', 0], ['°', 'deg ', 0],
    ['α', 'alpha ', 0], ['β', 'beta ', 0], ['γ', 'gamma ', 0], ['δ', 'delta ', 0], ['Δ', 'Delta ', 0], ['ε', 'epsilon ', 0],
    ['θ', 'theta ', 0], ['λ', 'lambda ', 0], ['μ', 'mu ', 0], ['ν', 'nu ', 0], ['π', 'pi ', 0], ['ρ', 'rho ', 0], ['σ', 'sigma ', 0],
    ['τ', 'tau ', 0], ['φ', 'phi ', 0], ['ω', 'omega ', 0], ['Ω', 'Omega ', 0],
    ['v⃗', 'vec ', 0], ['x̂', 'hat ', 0], ['x̄', 'bar ', 0], ['|x|', 'abs()', 1], ['[ ]', '[[,],[,]]', 8], ['( )', '()', 1]
  ];
  function buildMathbar() {
    const bar = $('#mathbar');
    for (const [label, ins, back] of MATH_KEYS) {
      const x = document.createElement('button');
      x.textContent = label;
      x.addEventListener('pointerdown', e => e.preventDefault());
      x.addEventListener('click', () => {
        if (!editing || !editing.ta) return;
        const ta = editing.ta, s = ta.selectionStart, e = ta.selectionEnd;
        let text = ins;
        const sel = ta.value.slice(s, e);
        let caret;
        if (sel && /\(\)/.test(ins)) { // wrap selection in the first ()
          text = ins.replace('()', '(' + sel + ')');
          caret = s + text.length;
        } else caret = s + text.length - back;
        ta.setRangeText(text, s, e, 'end');
        ta.setSelectionRange(caret, caret);
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      });
      bar.appendChild(x);
    }
  }
  function buildPenbar() {
    Ink.tool.color = prefs.inkColor; Ink.tool.size = prefs.inkSize;
    $('#btnFinger').onclick = () => { setPref('fingerDraws', !prefs.fingerDraws); syncTools(); toast(prefs.fingerDraws ? 'One finger writes · two fingers scroll' : (prefs.lock ? 'Fingers: two to move the page' : 'One finger scrolls')); };
    $('#btnLock').onclick = () => { setPref('lock', !prefs.lock); syncTools(); toast(prefs.lock ? 'Page locked: use two fingers to move it' : 'Page unlocked'); };
    const sw = $('#penbar .swatches');
    for (const c of INK_COLORS) {
      const x = document.createElement('button');
      x.className = 'swatch' + (c === prefs.inkColor ? ' on' : '');
      x.style.background = c;
      x.onclick = () => {
        setPref('inkColor', c); Ink.tool.color = c;
        $$('.swatch').forEach(s => s.classList.toggle('on', s === x));
        if (Ink.tool.kind === 'eraser' || Ink.tool.kind === 'lasso') { Ink.tool.kind = 'pen'; syncTools(); }
      };
      sw.appendChild(x);
    }
    $$('#penbar .tool[data-tool]').forEach(t => t.onclick = () => { Ink.tool.kind = t.dataset.tool; syncTools(); });
    $$('#penbar .size').forEach(t => {
      t.classList.toggle('on', parseFloat(t.dataset.size) === prefs.inkSize);
      t.onclick = () => { setPref('inkSize2', parseFloat(t.dataset.size)); prefs.inkSize = parseFloat(t.dataset.size); Ink.tool.size = prefs.inkSize; $$('#penbar .size').forEach(s => s.classList.toggle('on', s === t)); };
    });
    syncTools();
  }
  const HINTS = { pen: 'Write anywhere on the page', pencil: 'Pencil', hl: 'Highlighter — draws under your writing',
    eraser: 'Erase whole strokes (or hold the S Pen button any time)', lasso: 'Circle strokes to select, then Convert' };
  function syncTools() {
    $$('#penbar .tool[data-tool]').forEach(t => t.classList.toggle('on', t.dataset.tool === Ink.tool.kind));
    $('#btnFinger').classList.toggle('on', prefs.fingerDraws);
    $('#btnLock').classList.toggle('on', prefs.lock);
    $('#btnLock').disabled = false;
    const fingers = prefs.fingerDraws ? ' · 1 finger writes, 2 scroll' : prefs.lock ? ' · 2 fingers move the page' : ' · fingers scroll';
    $('#inkHint').textContent = (HINTS[Ink.tool.kind] || '') + fingers;
  }
  function showMathbar() { $('#mathbar').hidden = false; }
  function hideBars() { $('#mathbar').hidden = true; }

  /* ---------------- clean up ---------------- */
  function ensureSpell() {
    if (!Cleanup.ready) Cleanup.loadSpell(store.readAsset);
  }

  function cleanUp() {
    if (!note) return;
    finishEdit();
    inkSel = null;
    ensureSpell();
    const all = [];
    const unknown = new Map();
    let inkN = 0;
    for (const b of note.blocks) {
      if (b.type === 'text') {
        const r = Cleanup.cleanText(b.src, { userDict, autoMath: prefs.autoMath });
        b.src = r.text;
        all.push(...r.changes);
        for (const [w, s] of r.unknown) unknown.set(w, s);
      } else if (b.type === 'math') {
        const t = b.src.replace(/[ \t]{2,}/g, ' ').trim();
        if (t !== b.src) { b.src = t; }
      } else if (b.type === 'ink') {
        inkN += Ink.smooth(b) ? 1 : 0;
      }
    }
    if (note.title) {
      const t = note.title.trim().replace(/\s{2,}/g, ' ');
      const t2 = t ? t[0].toUpperCase() + t.slice(1) : t;
      if (t2 !== note.title) { note.title = t2; $('#title').value = t2; }
    }
    renderBlocks();
    commit();
    showReport(all, unknown, inkN);
  }

  function showReport(changes, unknown, inkN) {
    const rep = $('#report');
    const items = [];
    const seen = new Map();
    for (const c of changes) {
      const k = c.kind === 'spacing' ? 'spacing' : c.from + '→' + c.to;
      seen.set(k, (seen.get(k) || 0) + 1);
      if (seen.get(k) === 1) items.push(c);
    }
    let h = '<h4>✨ ' + (items.length || inkN ? 'Cleaned up' : 'Already tidy') + '</h4>';
    if (items.length) {
      h += '<div>' + items.map(c => {
        if (c.kind === 'spacing') return '<span class="chg">spacing &amp; punctuation</span>';
        const n = seen.get(c.from + '→' + c.to);
        return '<span class="chg"><s>' + MathText.escapeHtml(c.from) + '</s> → ' + MathText.escapeHtml(c.to) + (n > 1 ? ' ×' + n : '') + '</span>';
      }).join('') + '</div>';
    }
    if (inkN) h += '<div><span class="chg">smoothed ' + inkN + ' ink area' + (inkN > 1 ? 's' : '') + '</span></div>';
    if (unknown.size) {
      h += '<h4 style="margin-top:10px">Not sure about these</h4><div>';
      for (const [w, sug] of unknown) {
        h += '<span class="unk" data-w="' + MathText.escapeHtml(w) + '"><b>' + MathText.escapeHtml(w) + '</b>' +
          sug.map(s => '<button data-fix="' + MathText.escapeHtml(s) + '">' + MathText.escapeHtml(s) + '</button>').join('') +
          '<button data-add="1">＋ dictionary</button></span>';
      }
      h += '</div>';
    }
    h += '<div class="bar"><button class="pill" id="repUndo">Undo</button><button class="pill primary" id="repOk">OK</button></div>';
    rep.innerHTML = h;
    rep.hidden = false;
    $('#repOk').onclick = () => { rep.hidden = true; };
    $('#repUndo').onclick = () => { rep.hidden = true; undo(); };
    $$('.unk', rep).forEach(span => {
      const w = span.dataset.w;
      span.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.add) {
          userDict.add(w.toLowerCase());
          store.setPref('userDict', JSON.stringify([...userDict]));
        } else {
          const fix = btn.dataset.fix;
          const rep2 = w[0] === w[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
          for (const b of note.blocks) if (b.type === 'text') b.src = Cleanup.replaceWord(b.src, w, rep2);
          commit();
        }
        span.remove();
        renderBlocks();
      });
    });
  }

  /* ---------------- input: pen, finger, two fingers ----------------
   * Pen (or mouse): always writes in ink areas and empty page space.
   * One finger: writes when "finger draws" is on; otherwise scrolls (or, with 🔒, does nothing but tap).
   * Two fingers: always scroll and pinch-zoom.
   */
  const touches = new Map();
  let g = null;                 // current gesture
  // palm rejection: while the S Pen is down or hovering (and shortly after), touches are ignored
  const ignored = new Set();
  let penDown = false, lastPen = -1e9;
  const PEN_GRACE = 700;        // ms after the pen leaves during which touches are still ignored
  const PALM_SIZE = 34;         // contact wider/taller than this (CSS px) is a palm, not a fingertip
  const isPalm = (e) => (e.width || 0) > PALM_SIZE || (e.height || 0) > PALM_SIZE;
  function cancelTouchGesture() {
    if (g && g.type === 'fdraw' && g.sess) { g.sess.cancel(); dropEmptyInk(g.sess); }
    touches.forEach((_, id) => ignored.add(id));
    touches.clear();
    if (g && g.type !== 'draw') g = null;
    Ink.stopFling();
  }
  let suppressClickUntil = 0, suppressTouchClickUntil = 0;

  const NATIVE = 'button, .actions, .modal, #report, label, select, input[type=checkbox], .rmpage, #addPage';
  const drawTarget = (t) => t.closest('.block.ink') || t.closest('.pad');

  /** Start a stroke for pointer event e on an ink area or empty page space. Returns the session or null. */
  function beginDraw(e, target) {
    finishEdit();
    if (inkSel && !(target.closest && target.closest('.block.ink.selected'))) clearInkSel();
    let el = target.closest('.block.ink');
    if (!el) {
      const pad = target.closest('.pad');
      if (!pad) return null;
      const pr = pad.getBoundingClientRect();
      const scale = pr.width / pad.offsetWidth || curZoom;            // screen px per page px
      const yIn = (e.clientY - pr.top) / scale;                        // page px below the last block
      const padH = pad.offsetHeight;
      const last = pad._last;
      if (last && last.type === 'ink') {
        el = pagesEl.querySelector('.block[data-id="' + last.id + '"]');
        const k = last.w / contentW();
        last.h = Math.min(el._maxH || 1e9, Math.ceil((el.offsetHeight + yIn + 140) * k));
        Ink.setup(el._svg, last);
      } else {
        const nb = { id: uid(), type: 'ink', strokes: [], w: contentW(), h: Math.max(120, Math.min(padH, Math.ceil(yIn + 140))) };
        note.blocks.splice(pad._at, 0, nb);
        renderBlocks();
        el = pagesEl.querySelector('.block[data-id="' + nb.id + '"]');
      }
    }
    if (!el || !el._ink) return null;
    el._ink.start(e);
    return el._ink;
  }

  function dropEmptyInk(sess) {
    if (sess && sess.block && !sess.block.strokes.length) {
      const i = blockIndex(sess.block.id);
      if (i >= 0) { note.blocks.splice(i, 1); renderBlocks(); }
    }
  }

  function typeAtPad(pad) {
    finishEdit();
    clearInkSel();
    const type = prefs.mode === 'math' ? 'math' : 'text';
    const b = insertAt(type, pad._at);
    startEdit(b.id);
  }

  function wireGestures() {
    const sc = $('#scroller');
    // any pen activity (including hover) arms palm rejection
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'pen') lastPen = performance.now(); }, true);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') { penDown = true; lastPen = performance.now(); cancelTouchGesture(); }
    }, true);
    const penUp = (e) => { if (e.pointerType === 'pen') { penDown = false; lastPen = performance.now(); } };
    window.addEventListener('pointerup', penUp, true);
    window.addEventListener('pointercancel', penUp, true);

    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        const penNear = penDown || performance.now() - lastPen < PEN_GRACE || !!(A && A.penNear && A.penNear());
        if (penNear || isPalm(e) || ignored.has(e.pointerId)) {
          ignored.add(e.pointerId);
          suppressTouchClickUntil = Date.now() + 1500;
          if (!e.target.closest(NATIVE)) e.preventDefault();
          return;
        }
      }
      if (e.target.closest(NATIVE)) return;
      Ink.stopFling();
      const isPen = e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.button === 0);
      if (isPen) {
        if (touches.size) return;
        const t = drawTarget(e.target);
        if (!t) return;                                   // pen on typed text: a tap edits it
        e.preventDefault();
        const sess = beginDraw(e, t);
        if (sess) g = { type: 'draw', id: e.pointerId, sess };
        return;
      }
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary) { touches.clear(); ignored.clear(); if (g && g.type !== 'draw') g = null; }   // new gesture: forget stale state
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        const t = drawTarget(e.target);
        const base = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, t: e.timeStamp, vx: 0, vy: 0, moved: false, target: e.target };
        if (prefs.fingerDraws && t && !e.target.closest('textarea, input')) g = Object.assign(base, { type: 'fdraw', e0: e, sess: null });
        else if (prefs.lock) g = Object.assign(base, { type: 'tap' });
        else g = Object.assign(base, { type: 'pan' });
      } else if (touches.size === 2) {
        if (g && g.type === 'fdraw' && g.sess) { g.sess.cancel(); dropEmptyInk(g.sess); }
        const [p1, p2] = [...touches.values()];
        const r = sc.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
        g = { type: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z0: userZoom, zoom0: curZoom,
          cx: (sc.scrollLeft + mx) / curZoom, cy: (sc.scrollTop + my) / curZoom, mx, my };
        suppressClickUntil = Date.now() + 400;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (ignored.has(e.pointerId)) return;
      if (e.pointerType === 'touch' && touches.has(e.pointerId) && (penDown || isPalm(e) || (A && A.penNear && A.penNear()))) { cancelTouchGesture(); return; }
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g) return;
      if (g.type === 'draw' && e.pointerId === g.id) { e.preventDefault(); g.sess.move(e); return; }
      if (e.pointerId !== g.id && g.type !== 'pinch') return;
      if (g.type === 'pinch') {
        if (touches.size < 2) return;
        const [p1, p2] = [...touches.values()];
        const r = sc.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
        const ratio = Math.hypot(p1.x - p2.x, p1.y - p2.y) / g.d0;
        userZoom = Math.max(0.6, Math.min(4, g.z0 * ratio));
        applyZoom();
        sc.scrollLeft = g.cx * curZoom - mx;
        sc.scrollTop = g.cy * curZoom - my;
        return;
      }
      const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Math.max(1, e.timeStamp - g.t);
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 6) g.moved = true;
      if (g.type === 'fdraw') {
        if (!g.sess && g.moved) { g.sess = beginDraw(g.e0, g.target); if (!g.sess) { g = null; return; } }
        if (g.sess) g.sess.move(e);
      } else if (g.type === 'pan') {
        sc.scrollLeft -= dx; sc.scrollTop -= dy;
        g.vx = 0.7 * g.vx + 0.3 * dx / dt; g.vy = 0.7 * g.vy + 0.3 * dy / dt;
      }
      g.x = e.clientX; g.y = e.clientY; g.t = e.timeStamp;
    }, { passive: false });

    const up = (e) => {
      if (ignored.delete(e.pointerId)) { suppressTouchClickUntil = Date.now() + 400; return; }
      const wasTouch = touches.delete(e.pointerId);
      if (!g) return;
      if (g.type === 'pinch') { if (!touches.size) g = null; return; }
      if (e.pointerId !== g.id) return;
      const cur = g; g = null;
      if (cur.type === 'draw') { cur.sess.end(e); return; }
      if (cur.type === 'fdraw') {
        if (cur.sess) { cur.sess.end(e); return; }
        if (e.type !== 'pointerup') return;
        // a tap: dot on ink, typing on empty space
        if (cur.target.closest('.block.ink')) { const s2 = beginDraw(cur.e0, cur.target); if (s2) s2.end(e); }
        else if (cur.target.closest('.pad')) typeAtPad(cur.target.closest('.pad'));
        return;
      }
      if (cur.moved) {
        suppressClickUntil = Date.now() + 350;
        if (cur.type === 'pan' && Math.abs(cur.vx) + Math.abs(cur.vy) > 0.15) Ink.fling(sc, cur.vx, cur.vy);
        return;
      }
      if (e.type !== 'pointerup' || !wasTouch) return;
      // finger tap without drawing
      const ink = cur.target.closest('.block.ink');
      if (ink) selectInk(ink.dataset.id, null);
      else if (cur.target.closest('.pad')) typeAtPad(cur.target.closest('.pad'));
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('click', (e) => {
      const blocked = Date.now() < suppressClickUntil || (e.pointerType === 'touch' && Date.now() < suppressTouchClickUntil);
      if (blocked && e.target.closest('#scroller, #toolbar, #penbar')) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    // mouse / trackpad: ctrl+wheel zooms
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      userZoom = Math.max(0.6, Math.min(4, userZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      applyZoom();
    }, { passive: false });
    window.addEventListener('resize', () => { applyZoom(); });
  }

  /* ---------------- convert handwriting ---------------- */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function setBusy(on, label) {
    $('#btnConvert').classList.toggle('busy', on);
    $('#btnConvert').innerHTML = on ? (label || 'Reading…') : '⇄<span class="lbl"> Convert</span>';
  }

  async function ensureModel() {
    if (window.InkRecMock) return true;
    let st = InkRec.status();
    for (let i = 0; i < 10 && st === 'checking'; i++) { await sleep(300); st = InkRec.status(); }
    if (st === 'ready') return true;
    if (st === 'unavailable') { toast("Handwriting recognition isn't available on this device"); return false; }
    if (st === 'downloading') { toast('The handwriting model is still downloading…'); return false; }
    if (!(await ask('Converting handwriting needs Google\'s on-device handwriting model (about 20 MB, one-time download). After that it works offline. Download it now?', 'Download'))) return false;
    setBusy(true, 'Downloading…');
    try { await InkRec.download(); toast('Handwriting model ready'); return true; }
    catch (e) { toast(e.message); return false; }
    finally { setBusy(false); }
  }

  let cv = null;   // {id, idx, items:[{type,src,alts,strokes}]}
  const copyStrokes = (list) => list.map(st => ({ c: st.c, s: st.s, k: st.k, p: st.p.map(q => q.slice()) }));

  async function convertInk(id, idx) {
    const b = blockById(id);
    if (!b) return;
    const strokes = b.strokes.filter((st, i) => (!idx || idx.has(i)) && st.k !== 'hl');
    if (!strokes.length) { toast('Nothing to convert'); return; }
    if (!(await ensureModel())) return;
    setBusy(true);
    try {
      const res = await InkRec.convert(copyStrokes(strokes), prefs.mode);
      if (!res.length) { toast('Couldn\'t read that'); return; }
      ensureSpell();
      res.forEach(r => {
        if (r.type === 'text') { r.src = Cleanup.cleanText(applyCorrections(r.src), { userDict, autoMath: prefs.autoMath }).text; r.orig = r.src; }
      });
      cv = { id, idx, items: res };
      renderConvert();
      $('#convert').hidden = false;
    } catch (e) {
      toast('Recognition failed: ' + e.message);
    } finally { setBusy(false); }
  }

  function renderConvert() {
    const body = $('#cvBody');
    body.innerHTML = '';
    cv.items.forEach((it, k) => {
      const box = document.createElement('div');
      box.className = 'cv';
      box.innerHTML = '<div class="cvhead"><div class="seg"><button data-t="text">Aa Text</button><button data-t="math">∑ Math</button></div>' +
        '<span class="grow"></span><button class="pill" data-rm="1">Remove</button></div><textarea rows="1"></textarea><div class="pv"></div><div class="alts"></div>';
      const ta = box.querySelector('textarea'), pv = box.querySelector('.pv');
      ta.value = it.src;
      ta.classList.toggle('mono', it.type === 'math');
      $$('.seg button', box).forEach(btn => {
        btn.classList.toggle('on', btn.dataset.t === it.type);
        btn.onclick = async () => {
          if (btn.dataset.t === it.type) return;
          const want = btn.dataset.t;
          box.classList.add('busy');
          try {
            const again = it.strokes ? await InkRec.convert(it.strokes, want) : [];
            it.src = again.length ? again.map(r => r.src).join(want === 'text' ? '\n' : ' ') : it.src;
            if (want === 'text') it.src = Cleanup.cleanText(it.src, { userDict, autoMath: prefs.autoMath }).text;
          } catch (e) { toast(e.message); }
          it.type = want;
          renderConvert();
        };
      });
      box.querySelector('[data-rm]').onclick = () => { cv.items.splice(k, 1); renderConvert(); };
      const upd = () => {
        it.src = ta.value;
        autoGrow(ta);
        if (it.type === 'math') { pv.className = 'pv'; pv.innerHTML = MathText.renderMath(it.src, true).html; }
        else { pv.className = 'pv hand'; pv.innerHTML = MathText.renderText(it.src, { autoMath: prefs.autoMath }); }
      };
      ta.addEventListener('input', upd);
      const alts = box.querySelector('.alts');
      (it.alts || []).filter(a => a && a !== it.src).slice(0, 4).forEach(a => {
        const x = document.createElement('button');
        x.textContent = a;
        x.onclick = () => { ta.value = it.type === 'text' ? Cleanup.cleanText(a, { userDict, autoMath: prefs.autoMath }).text : a; upd(); };
        alts.appendChild(x);
      });
      body.appendChild(box);
      requestAnimationFrame(upd);
    });
    if (!cv.items.length) body.innerHTML = '<p style="color:#7a7466">Nothing left to insert.</p>';
  }

  function closeConvert() { $('#convert').hidden = true; cv = null; }

  function insertConverted() {
    if (!cv) return;
    const b = blockById(cv.id);
    if (!b) { closeConvert(); return; }
    const keep = $('#cvKeep').checked;
    const items = cv.items.filter(it => it.src.trim());
    let at = blockIndex(b.id);
    if (cv.idx && !keep) {
      // selection: place the result above the ink if nothing else sits above the selection
      const sel = b.strokes.filter((_, i) => cv.idx.has(i)), rest = b.strokes.filter((_, i) => !cv.idx.has(i));
      const selTop = Ink.boundsOf(sel).y0;
      const restAbove = rest.some(st => Ink.boundsOf([st]).y1 < selTop);
      if (restAbove) at += 1;
      b.strokes = rest;
    } else if (!keep) {
      b.strokes = [];
    } else {
      at += 1;
    }
    for (const it of items) {
      if (it.type === 'text' && it.orig) learnCorrections(it.orig, it.src);
      const nb = { id: uid(), type: it.type, src: it.type === 'math' ? it.src.trim() : it.src };
      note.blocks.splice(at++, 0, nb);
    }
    if (!b.strokes.length) note.blocks.splice(blockIndex(b.id), 1);
    inkSel = null;
    closeConvert();
    renderBlocks();
    commit();
  }

  /* ---------------- handwriting training ---------------- */
  let tr = null;
  function openTrain() {
    closeMenu();
    finishEdit();
    const k = Train.SYMBOLS.findIndex(([s]) => Train.count(s) < 3);
    tr = { i: k < 0 ? 0 : k, savedTool: Ink.tool.kind, savedSize: Ink.tool.size };
    Ink.tool.kind = 'pen'; Ink.tool.size = 3;
    $('#train').hidden = false;
    showTrain();
  }
  function closeTrain() {
    if (!tr) return;
    Ink.tool.kind = tr.savedTool; Ink.tool.size = tr.savedSize;
    tr = null;
    $('#train').hidden = true;
  }
  function showTrain() {
    const [sym, tok] = Train.SYMBOLS[tr.i];
    $('#trPrompt').innerHTML = /^[A-Za-z0-9()<>+=]$/.test(sym) ? '<span style="font-family:var(--hand)">' + MathText.escapeHtml(sym) + '</span>'
      : MathText.renderMath(tok, false).html;
    const n = Train.count(sym);
    $('#trInfo').textContent = 'Write “' + sym + '”  ·  ' + n + ' of 3 samples' + (n >= 3 ? ' ✓ (more is fine)' : '');
    const svg = $('#trPad');
    tr.block = { strokes: [], w: 600, h: 300 };
    Ink.render(svg, tr.block);
    tr.sess = Ink.session(svg, tr.block, {});
    const chips = $('#trChips');
    chips.innerHTML = '';
    Train.SYMBOLS.forEach(([s], k) => {
      const b = document.createElement('button');
      const c = Train.count(s);
      b.className = (c >= 3 ? 'done' : '') + (k === tr.i ? ' on' : '');
      b.innerHTML = MathText.escapeHtml(s) + (c ? '<sup>' + c + '</sup>' : '');
      b.onclick = () => { tr.i = k; showTrain(); };
      chips.appendChild(b);
    });
  }
  function wireTrain() {
    const svg = $('#trPad');
    let active = null;
    svg.addEventListener('pointerdown', (e) => {
      if (!tr || active !== null) return;
      e.preventDefault();
      active = e.pointerId;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { }
      tr.sess.start(e);
    });
    svg.addEventListener('pointermove', (e) => { if (tr && e.pointerId === active) { e.preventDefault(); tr.sess.move(e); } });
    const end = (e) => { if (tr && e.pointerId === active) { active = null; tr.sess.end(e); } };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    $('#trClear').onclick = () => showTrain();
    $('#trSkip').onclick = () => { tr.i = (tr.i + 1) % Train.SYMBOLS.length; showTrain(); };
    $('#trSave').onclick = () => {
      if (!tr.block.strokes.length) { toast('Write the symbol first'); return; }
      const sym = Train.SYMBOLS[tr.i][0];
      Train.addSample(sym, tr.block.strokes);
      if (Train.count(sym) >= 3) {
        const next = Train.SYMBOLS.findIndex(([s], k) => k > tr.i && Train.count(s) < 3);
        tr.i = next < 0 ? (tr.i + 1) % Train.SYMBOLS.length : next;
      }
      showTrain();
    };
    $('#trDone').onclick = closeTrain;
    $('#trReset').onclick = async () => {
      if (await ask('Delete all your handwriting samples?', 'Delete')) { Train.clear(); showTrain(); }
    };
  }

  /* ---------------- learning from corrections ---------------- */
  let corrections = {};
  try { corrections = JSON.parse(store.getPref('corrections') || '{}') || {}; } catch (e) { }
  const wordKey = (w) => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  function applyCorrections(text) {
    if (!text) return text;
    return text.replace(/[A-Za-z][A-Za-z']*/g, (w) => {
      const c = corrections[w.toLowerCase()];
      if (!c) return w;
      return w[0] === w[0].toUpperCase() && c[0] === c[0].toLowerCase() ? c[0].toUpperCase() + c.slice(1) : c;
    });
  }
  function learnCorrections(before, after) {
    const a = (before || '').split(/\s+/).filter(Boolean), b = (after || '').split(/\s+/).filter(Boolean);
    if (!a.length || a.length !== b.length) return;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const x = wordKey(a[i]), y = b[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, '');
      if (!x || !y || x === y.toLowerCase() || !/^[a-z']+$/.test(x) || !/^[A-Za-z']+$/.test(y)) continue;
      if (Math.abs(x.length - y.length) > 3) continue;
      // a capital only at the first letter is usually just sentence position — store it lowercase
      corrections[x] = /^[A-Z][a-z']+$/.test(y) ? y.toLowerCase() : y; n++;
    }
    if (n) {
      const keys = Object.keys(corrections);
      if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete corrections[k]);
      store.setPref('corrections', JSON.stringify(corrections));
    }
  }

  /* ---------------- export ---------------- */
  function toMarkdown() {
    const out = ['# ' + (note.title || 'Untitled'), ''];
    for (const b of note.blocks) {
      if (b.type === 'text') out.push(MathText.textToLatexMarkdown(b.src, prefs.autoMath), '');
      else if (b.type === 'math') out.push('$$' + MathText.toTeX(b.src) + '$$', '');
      else out.push('[sketch]', '');
    }
    return out.join('\n').trim() + '\n';
  }

  function backupAll() {
    saveNow();
    const notes = store.ids().map(id => { try { return JSON.parse(store.load(id)); } catch (e) { return null; } }).filter(Boolean);
    const json = JSON.stringify({ app: 'InkNotes', version: 1, exported: new Date().toISOString(), userDict: [...userDict], notes });
    const name = 'InkNotes-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    if (A) A.saveBackup(name, json);
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name; a.click(); }
  }

  function restoreFrom(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        if (!data || !Array.isArray(data.notes)) throw new Error('not an InkNotes backup');
        let n = 0;
        for (const nt of data.notes) {
          if (!nt || !nt.id || !/^[A-Za-z0-9_\-]{1,80}$/.test(nt.id)) continue;
          let existing = null;
          try { existing = JSON.parse(store.load(nt.id) || 'null'); } catch (e) { }
          if (existing && (existing.updated || 0) > (nt.updated || 0)) continue;
          store.save(nt.id, JSON.stringify(nt)); n++;
        }
        (data.userDict || []).forEach(w => userDict.add(String(w).toLowerCase()));
        store.setPref('userDict', JSON.stringify([...userDict]));
        loadIndex(); renderList();
        if (note) openNote(note.id);
        toast('Restored ' + n + ' note' + (n === 1 ? '' : 's'));
      } catch (e) { toast('Restore failed: ' + e.message); }
    };
    fr.readAsText(file);
  }

  /* ---------------- confirm dialog ---------------- */
  function ask(msg, okLabel) {
    return new Promise(res => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = '<div class="card" style="max-width:420px"><p style="font-size:16px"></p><div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="pill" data-v="0">Cancel</button><button class="pill primary" data-v="1"></button></div></div>';
      m.querySelector('p').textContent = msg;
      m.querySelector('[data-v="1"]').textContent = okLabel || 'OK';
      m.addEventListener('click', e => { const b = e.target.closest('button'); if (!b && e.target !== m) return; m.remove(); res(b ? b.dataset.v === '1' : false); });
      document.body.appendChild(m);
    });
  }

  /* ---------------- menu ---------------- */
  function buildMenu() {
    const fr = $('#fontRow');
    for (const [k, fam, label] of FONTS) {
      const x = document.createElement('button');
      x.textContent = label; x.style.fontFamily = fam; x.style.fontSize = '20px';
      x.classList.toggle('on', prefs.font === k);
      x.onclick = () => { setPref('font', k); applyBodyClasses(); $$('#fontRow button').forEach(y => y.classList.toggle('on', y === x)); renderBlocks(); };
      fr.appendChild(x);
    }
    const pr = $('#paperRow');
    for (const [k, label] of PAPERS) {
      const x = document.createElement('button');
      x.textContent = label; x.dataset.p = k;
      x.onclick = () => {
        note.paper = k; setPref('paper', k);
        $$('.sheet', pagesEl).forEach(sh => { sh.className = 'sheet paper-' + k; });
        $$('#paperRow button').forEach(y => y.classList.toggle('on', y === x));
        commit();
      };
      pr.appendChild(x);
    }
    const sr = $('#sizeRow');
    for (const k of Object.keys(SIZES)) {
      const x = document.createElement('button');
      x.textContent = SIZES[k].label; x.dataset.s = k;
      x.onclick = () => {
        finishEdit();
        note.size = k; setPref('size', k);
        $$('#sizeRow button').forEach(y => y.classList.toggle('on', y === x));
        applyZoom(); renderBlocks(); commit();
      };
      sr.appendChild(x);
    }
    $$('#zoomRow button').forEach(x => x.onclick = () => {
      const z = x.dataset.z;
      userZoom = z === 'fit' ? 1 : Math.max(0.6, Math.min(4, userZoom * (z === 'in' ? 1.25 : 0.8)));
      applyZoom();
    });
    const bind = (id, key, after) => {
      const c = $(id); c.checked = prefs[key];
      c.onchange = () => { setPref(key, c.checked); applyBodyClasses(); after && after(); };
    };
    bind('#optHandMath', 'handMath', () => renderBlocks());
    bind('#optAutoMath', 'autoMath', () => renderBlocks());
    $('#miPdf').onclick = () => { closeMenu(); finishEdit(); saveNow(); setTimeout(() => A ? A.printPdf(note.title || 'InkNotes', note.size || 'letter') : window.print(), 150); };
    $('#miShare').onclick = () => { closeMenu(); finishEdit(); const md = toMarkdown(); if (A) A.shareText(note.title || 'Note', md); else console.log(md); };
    $('#miHelp').onclick = () => { closeMenu(); openHelp(); };
    $('#miTrain').onclick = () => openTrain();
    $('#miDelete').onclick = async () => {
      closeMenu();
      if (!(await ask('Delete “' + (note.title || 'Untitled') + '”? This can\'t be undone.', 'Delete'))) return;
      store.remove(note.id);
      editing = null;
      note = null;
      loadIndex();
      if (index.length) openNote(index[0].id); else newNote();
      renderList();
    };
  }
  function openMenu() {
    $$('#paperRow button').forEach(y => y.classList.toggle('on', y.dataset.p === (note.paper || prefs.paper)));
    $$('#sizeRow button').forEach(y => y.classList.toggle('on', y.dataset.s === (note.size || prefs.size)));
    $('#menu').hidden = false;
  }
  function closeMenu() { $('#menu').hidden = true; }

  function openHelp() {
    $$('#help .ex').forEach(td => { td.innerHTML = MathText.renderMath(td.dataset.am, false).html; });
    $('#help').hidden = false;
  }

  /* ---------------- welcome note ---------------- */
  function welcome() {
    const blocks = [
      { id: uid(), type: 'text', src: '# Write anywhere\nWrite on the page with the S Pen or your finger, then tap **⇄ Convert**: your handwriting becomes neat text like this, and formulas become typeset math. **Aa Text / ∑ Math / Auto** decides how it is read, and you can fix anything before it goes in.\n[ ] Try it: write a sentence, then x^2 + y^2 = r^2 below it, and Convert with Auto' },
      { id: uid(), type: 'text', src: '# Fingers & pages\n- ☝️ Finger writes: one finger writes, two fingers scroll and pinch-zoom\n- 🔒 Lock: only two fingers move the page\n- Pages are Letter or A4 (⋮ menu); writing flows onto the next page' },
      { id: uid(), type: 'text', src: '# Typing\nTap empty space to type. teh app tidies spelling , spacing and capitals when you tap ✨ Clean up.\nmath inside sentences is spotted automatically: E = mc^2 and a^2 + b^2 = c^2.' },
      { id: uid(), type: 'math', src: 'int_0^oo e^(-x^2) dx = sqrt(pi)/2' }
    ];
    return newNote(blocks, 'Welcome to InkNotes');
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $$('#modeSeg button').forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
    $$('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('#btnConvert').addEventListener('pointerdown', e => e.preventDefault());
    $('#btnConvert').onclick = () => {
      if (inkSel) return convertInk(inkSel.id, inkSel.idx);
      const inks = note.blocks.filter(b => b.type === 'ink' && b.strokes.length);
      if (!inks.length) { toast('Write something on the page first'); return; }
      const target = inks.find(b => b.id === lastInkId) || inks[inks.length - 1];
      convertInk(target.id, null);
    };
    $('#cvCancel').onclick = () => closeConvert();
    $('#cvInsert').onclick = () => insertConverted();
    $('#btnClean').addEventListener('pointerdown', e => e.preventDefault());
    $('#btnClean').onclick = cleanUp;
    $('#btnUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnMore').onclick = (e) => { e.stopPropagation(); $('#menu').hidden ? openMenu() : closeMenu(); };
    $('#btnMenu').onclick = () => {
      if (window.innerWidth >= 1100) {
        const c = !document.body.classList.contains('sidecollapsed');
        document.body.classList.toggle('sidecollapsed', c);
        store.setPref('sideCollapsed', c ? '1' : '0');
        setTimeout(() => { applyZoom(); }, 220);
      } else document.body.classList.toggle('drawer');
    };
    document.body.classList.toggle('sidecollapsed', store.getPref('sideCollapsed') === '1');
    $('#scrim').onclick = () => document.body.classList.remove('drawer');
    $('#btnNew').onclick = () => { document.body.classList.remove('drawer'); newNote(); $('#title').focus(); };
    $('#search').oninput = renderList;
    $('#btnBackup').onclick = backupAll;
    $('#restoreFile').onchange = (e) => { const f = e.target.files[0]; if (f) restoreFrom(f); e.target.value = ''; };
    $('#helpClose').onclick = () => { $('#help').hidden = true; };
    $('#help').onclick = (e) => { if (e.target.id === 'help') $('#help').hidden = true; };
    $('#title').addEventListener('input', () => { note.title = $('#title').value; scheduleSave(); });
    $('#title').addEventListener('change', commit);
    $('#title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = note.blocks[0];
        if (first && first.type !== 'ink') startEdit(first.id, { caret: 'start' });
        else startEdit(insertBlock(prefs.mode === 'math' ? 'math' : 'text').id);
      }
    });
    wireGestures();
    // tap outside the block being edited finishes it
    document.addEventListener('pointerdown', (e) => {
      if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMore')) closeMenu();
      if (inkSel && !e.target.closest('.block.ink.selected, #toolbar, #penbar, .modal, #report')) clearInkSel();
      if (!editing) return;
      if (e.target.closest('.block.editing, #toolbar, #mathbar, #penbar, #report, #menu, .modal, .pad')) return;
      if (e.target.closest('.block')) return; // the click handler on that block switches editing
      if (e.target.closest('#scroller') && e.pointerType !== 'touch') finishEdit();
    }, true);
    window.addEventListener('resize', () => { if (editing && editing.ta) autoGrow(editing.ta); });
    // finger taps on the page close the editor (pans don't)
    document.addEventListener('click', (e) => {
      if (!editing || !e.target.closest('#scroller')) return;
      if (e.target.closest('.block, .pad, ' + NATIVE)) return;
      finishEdit();
    });
  }

  window.InkNotes = {
    onBack() {
      if (!$('#train').hidden) { closeTrain(); return true; }
      if (!$('#convert').hidden) { closeConvert(); return true; }
      if (!$('#help').hidden) { $('#help').hidden = true; return true; }
      if (inkSel) { clearInkSel(); return true; }
      if (!$('#menu').hidden) { closeMenu(); return true; }
      if (!$('#report').hidden) { $('#report').hidden = true; return true; }
      if (editing) { finishEdit(); return true; }
      if (document.body.classList.contains('drawer')) { document.body.classList.remove('drawer'); return true; }
      return false;
    },
    flush() { if (editing) commit(); saveNow(); },
    _debug: { get note() { return note; }, cleanUp, setMode, startEdit, finishEdit, insertBlock, convertInk, renderBlocks }
  };

  /* ---------------- boot ---------------- */
  applyBodyClasses();
  buildMathbar();
  Train.init(store);
  buildPenbar();
  wireTrain();
  buildMenu();
  wire();
  setModeUI(prefs.mode);
  loadIndex();
  const start = () => {
    if (prefs.lastNote && index.some(i => i.id === prefs.lastNote)) openNote(prefs.lastNote);
    else if (index.length) openNote(index[0].id);
    else welcome();
  };
  // wait for handwriting fonts so the first paint is already pretty
  (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('31px Caveat'), document.fonts.load('23px Kalam'),
    document.fonts.load('26px "Patrick Hand"'), document.fonts.load('26px "Shadows Into Light"')]).catch(() => { }) : Promise.resolve())
    .then(start);
  // load the dictionary when idle so misspellings get underlined
  setTimeout(() => { ensureSpell(); if (note && !editing) renderBlocks(); }, 1200);
})();
