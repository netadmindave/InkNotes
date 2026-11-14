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
    penOnly: store.getPref('penOnly') !== '0',
    mode: store.getPref('mode') || 'text',
    inkColor: store.getPref('inkColor') || '#1d3557',
    inkSize: parseFloat(store.getPref('inkSize') || '4'),
    lastNote: store.getPref('lastNote') || ''
  };
  let userDict = new Set();
  try { userDict = new Set(JSON.parse(store.getPref('userDict') || '[]')); } catch (e) { }
  const setPref = (k, v) => { prefs[k] = v; store.setPref(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); };

  const FONTS = [['caveat', 'Caveat', 'Caveat'], ['kalam', 'Kalam', 'Kalam'], ['patrick', 'Patrick Hand', 'Patrick'], ['shadows', 'Shadows Into Light', 'Shadows']];
  const PAPERS = [['lined', 'Lined'], ['grid', 'Grid'], ['dot', 'Dots'], ['plain', 'Plain']];
  const INK_COLORS = ['#1d3557', '#111111', '#c2410c', '#2f7d32', '#7b2cbf', '#f5c518'];

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
    note = { id: uid('n'), title: title || '', created: Date.now(), updated: Date.now(), paper: prefs.paper, blocks: blocks || [] };
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
    showNote();
  }

  function showNote() {
    setPref('lastNote', note.id);
    $('#title').value = note.title || '';
    $('#page').className = 'paper-' + (note.paper || prefs.paper);
    $('#meta').textContent = note.updated ? 'Edited ' + fmtDate(note.updated) : '';
    history = [snapshot()]; hIdx = 0; updateUndo();
    renderBlocks();
    renderList();
    $('#scroller').scrollTop = 0;
  }

  /* ---------------- undo / redo ---------------- */
  let history = [], hIdx = 0;
  const snapshot = () => JSON.stringify({ title: note.title, blocks: note.blocks, paper: note.paper });
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
    note.title = o.title; note.blocks = o.blocks; note.paper = o.paper;
    $('#title').value = note.title || '';
    $('#page').className = 'paper-' + (note.paper || prefs.paper);
    renderBlocks();
    scheduleSave();
    updateUndo();
  }
  function undo() { finishEdit(); if (hIdx > 0) restore(history[--hIdx]); }
  function redo() { finishEdit(); if (hIdx < history.length - 1) restore(history[++hIdx]); }
  function updateUndo() { $('#btnUndo').disabled = hIdx <= 0; $('#btnRedo').disabled = hIdx >= history.length - 1; }

  /* ---------------- block rendering ---------------- */
  const blocksEl = $('#blocks');
  let editing = null;  // {id, el, type, detach}

  function blockById(id) { return note.blocks.find(b => b.id === id); }
  function blockIndex(id) { return note.blocks.findIndex(b => b.id === id); }

  function renderBlocks() {
    editing = null;
    hideBars();
    blocksEl.innerHTML = '';
    for (const b of note.blocks) blocksEl.appendChild(viewEl(b));
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
      el._ink = Ink.attach(svg, b, {
        scroller: $('#scroller'),
        onChange: () => { lastInkId = b.id; if (inkSel && inkSel.id === b.id) { inkSel = null; rerenderBlock(b.id); } commit(); },
        onTap: () => selectInk(b.id, null),
        onSelect: (idx) => { if (idx.length) selectInk(b.id, new Set(idx), true); else clearInkSel(); }
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
    const old = blocksEl.querySelector('.block[data-id="' + id + '"]');
    if (!b) { old && old.remove(); return; }
    const el = viewEl(b);
    if (old) old.replaceWith(el); else blocksEl.appendChild(el);
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
    const old = blocksEl.querySelector('.block[data-id="' + id + '"]');
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
      btn('Taller', () => { b.h += 200; rerenderBlock(b.id); commit(); });
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
    if (type === 'ink') { b.src = undefined; b.strokes = []; b.w = Ink.W; b.h = 260; }
    i = Math.max(0, Math.min(i, note.blocks.length));
    note.blocks.splice(i, 0, b);
    const el = viewEl(b);
    const ref = blocksEl.children[i];
    blocksEl.insertBefore(el, ref || null);
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
    const old = blocksEl.querySelector('.block[data-id="' + id + '"]');
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
    const el = blocksEl.querySelector('.block[data-id="' + id + '"]');
    el && el.remove();
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
    Ink.tool.color = prefs.inkColor; Ink.tool.size = prefs.inkSize; Ink.tool.penOnly = prefs.penOnly;
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
    $$('#penbar .tool').forEach(t => t.onclick = () => { Ink.tool.kind = t.dataset.tool; syncTools(); });
    $$('#penbar .size').forEach(t => {
      t.classList.toggle('on', parseFloat(t.dataset.size) === prefs.inkSize);
      t.onclick = () => { setPref('inkSize', parseFloat(t.dataset.size)); Ink.tool.size = prefs.inkSize; $$('#penbar .size').forEach(s => s.classList.toggle('on', s === t)); };
    });
    syncTools();
  }
  const HINTS = { pen: 'Write anywhere with the S Pen · fingers scroll', pencil: 'Pencil', hl: 'Highlighter — draws under your writing',
    eraser: 'Erase whole strokes (or hold the S Pen button any time)', lasso: 'Circle strokes to select, then Convert' };
  function syncTools() {
    $$('#penbar .tool').forEach(t => t.classList.toggle('on', t.dataset.tool === Ink.tool.kind));
    $('#inkHint').textContent = HINTS[Ink.tool.kind] || '';
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

  /* ---------------- writing pad: the S Pen writes anywhere below the last block ---------------- */
  function wireTail() {
    const tail = $('#tail');
    let finger = null;
    tail.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        finger = { id: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
        try { tail.setPointerCapture(e.pointerId); } catch (err) { }
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      finishEdit();
      clearInkSel();
      let b = note.blocks[note.blocks.length - 1];
      if (!b || b.type !== 'ink') b = insertBlock('ink');
      const el = blocksEl.querySelector('.block[data-id="' + b.id + '"]');
      const r = el._svg.getBoundingClientRect();
      const need = (e.clientY - r.top) * (b.w / r.width) + 140;
      if (need > b.h) { b.h = Math.ceil(need); Ink.setup(el._svg, b); }
      el._ink.begin(e);
    });
    tail.addEventListener('pointermove', (e) => {
      if (!finger || e.pointerId !== finger.id) return;
      const dy = e.clientY - finger.y, dt = Math.max(1, e.timeStamp - finger.t);
      $('#scroller').scrollTop -= dy;
      finger.v = 0.7 * finger.v + 0.3 * dy / dt; finger.y = e.clientY; finger.t = e.timeStamp;
    });
    const end = (e) => {
      if (!finger || e.pointerId !== finger.id) return;
      const moved = Math.hypot(e.clientX - finger.x0, e.clientY - finger.y0);
      if (moved >= 8 && Math.abs(finger.v) > 0.1) Ink.fling($('#scroller'), finger.v);
      finger = null;
      if (moved < 8 && e.type === 'pointerup') typeAtEnd();
    };
    tail.addEventListener('pointerup', end);
    tail.addEventListener('pointercancel', end);
  }

  function typeAtEnd() {
    const last = note.blocks[note.blocks.length - 1];
    const type = prefs.mode === 'math' ? 'math' : 'text';
    if (last && editing && editing.id === last.id) return;
    finishEdit();
    clearInkSel();
    const b = insertBlock(type);
    startEdit(b.id);
  }

  /* ---------------- convert handwriting ---------------- */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function setBusy(on, label) {
    $('#btnConvert').classList.toggle('busy', on);
    $('#btnConvert').textContent = on ? (label || 'Reading…') : '⇄ Convert';
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
      res.forEach(r => { if (r.type === 'text') r.src = Cleanup.cleanText(r.src, { userDict, autoMath: prefs.autoMath }).text; });
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
      const nb = { id: uid(), type: it.type, src: it.type === 'math' ? it.src.trim() : it.src };
      note.blocks.splice(at++, 0, nb);
    }
    if (!b.strokes.length) note.blocks.splice(blockIndex(b.id), 1);
    inkSel = null;
    closeConvert();
    renderBlocks();
    commit();
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
        $('#page').className = 'paper-' + k;
        $$('#paperRow button').forEach(y => y.classList.toggle('on', y === x));
        commit();
      };
      pr.appendChild(x);
    }
    const bind = (id, key, after) => {
      const c = $(id); c.checked = prefs[key];
      c.onchange = () => { setPref(key, c.checked); applyBodyClasses(); after && after(); };
    };
    bind('#optHandMath', 'handMath', () => renderBlocks());
    bind('#optAutoMath', 'autoMath', () => renderBlocks());
    bind('#optPenOnly', 'penOnly', () => { Ink.tool.penOnly = prefs.penOnly; });
    $('#miPdf').onclick = () => { closeMenu(); finishEdit(); saveNow(); setTimeout(() => A ? A.printPdf(note.title || 'InkNotes') : window.print(), 150); };
    $('#miShare').onclick = () => { closeMenu(); finishEdit(); const md = toMarkdown(); if (A) A.shareText(note.title || 'Note', md); else console.log(md); };
    $('#miHelp').onclick = () => { closeMenu(); openHelp(); };
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
      { id: uid(), type: 'text', src: '# Write with the S Pen\nWrite anywhere below with the pen — fingers scroll. Then tap **⇄ Convert**: your handwriting becomes neat text like this, and formulas become typeset math. The **Aa Text / ∑ Math / Auto** switch decides how it is read, and you can fix anything before it is inserted.\n[ ] Try it: write a sentence, then x^2 + y^2 = r^2 on the next line, and Convert with Auto' },
      { id: uid(), type: 'text', src: '# Pen tools\n- Pen, pencil and highlighter, 6 colours, 3 sizes\n- Hold the S Pen side button to erase, or pick the eraser\n- Lasso strokes to convert, smooth or delete just those' },
      { id: uid(), type: 'text', src: '# Typing\nTap the page with a finger to type. teh app tidies spelling , spacing and capitals when you tap ✨ Clean up.\nmath inside sentences is spotted automatically: E = mc^2 and a^2 + b^2 = c^2.' },
      { id: uid(), type: 'math', src: 'int_0^oo e^(-x^2) dx = sqrt(pi)/2' },
      { id: uid(), type: 'math', src: '(dn)/(dT) ~~ 1.2 xx 10^-5 K^-1' }
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
      if (!inks.length) { toast('Write something with the S Pen first'); return; }
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
    $('#btnMenu').onclick = () => document.body.classList.toggle('drawer');
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
    wireTail();
    // tap outside the block being edited finishes it
    document.addEventListener('pointerdown', (e) => {
      if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMore')) closeMenu();
      if (!editing) return;
      if (inkSel && !e.target.closest('.block.ink.selected, #toolbar, #penbar, .modal, #report')) clearInkSel();
      if (e.target.closest('.block.editing, #toolbar, #mathbar, #penbar, #report, #menu, .modal, #tail')) return;
      if (e.target.closest('.block')) return; // the click handler on that block switches editing
      if (e.target.closest('#page') || e.target.closest('#scroller')) finishEdit();
    }, true);
    window.addEventListener('resize', () => { if (editing && editing.ta) autoGrow(editing.ta); });
  }

  window.InkNotes = {
    onBack() {
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
  buildPenbar();
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
