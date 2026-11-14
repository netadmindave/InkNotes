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
  const INK_COLORS = ['#1d3557', '#111111', '#c2410c', '#2f7d32', '#7b2cbf'];

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
      Ink.render(svg, b);
    }
    el.addEventListener('click', (e) => {
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
    } else if (b.type === 'ink') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.appendChild(svg);
      Ink.render(svg, b);
      editing.svg = svg;
      editing.detach = Ink.attach(svg, b, {
        color: () => prefs.inkColor, size: () => prefs.inkSize, tool: () => inkTool,
        penOnly: () => prefs.penOnly, scroller: $('#scroller'),
        onChange: () => { commit(); },
        onPenSeen: () => { }
      });
      showInkbar();
      ensureVisible(el);
    }
    setModeUI(b.type === 'math' ? 'math' : b.type === 'text' ? 'text' : prefs.mode);
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
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
    if (quiet || !editing) return;
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
  let inkTool = 'pen';
  function buildInkbar() {
    const sw = $('#inkbar .swatches');
    for (const c of INK_COLORS) {
      const x = document.createElement('button');
      x.className = 'swatch' + (c === prefs.inkColor ? ' on' : '');
      x.style.background = c;
      x.onclick = () => { setPref('inkColor', c); $$('.swatch').forEach(s => s.classList.toggle('on', s === x)); inkTool = 'pen'; syncTools(); };
      sw.appendChild(x);
    }
    $$('#inkbar .tool').forEach(t => t.onclick = () => { inkTool = t.dataset.tool; syncTools(); });
    $$('#inkbar .size').forEach(t => {
      t.classList.toggle('on', parseFloat(t.dataset.size) === prefs.inkSize);
      t.onclick = () => { setPref('inkSize', parseFloat(t.dataset.size)); $$('#inkbar .size').forEach(s => s.classList.toggle('on', s === t)); };
    });
    $('#inkDone').onclick = () => finishEdit();
    $('#inkTaller').onclick = () => {
      if (!editing || editing.type !== 'ink') return;
      const b = blockById(editing.id); b.h += 200; Ink.setup(editing.svg, b); commit();
    };
    $('#inkTidy').onclick = () => {
      if (!editing || editing.type !== 'ink') return;
      const b = blockById(editing.id); Ink.smooth(b); Ink.render(editing.svg, b); commit();
    };
  }
  function syncTools() { $$('#inkbar .tool').forEach(t => t.classList.toggle('on', t.dataset.tool === inkTool)); }
  function showMathbar() { $('#mathbar').hidden = false; $('#inkbar').hidden = true; }
  function showInkbar() { $('#inkbar').hidden = false; $('#mathbar').hidden = true; inkTool = 'pen'; syncTools(); }
  function hideBars() { $('#mathbar').hidden = true; $('#inkbar').hidden = true; }

  /* ---------------- clean up ---------------- */
  function ensureSpell() {
    if (!Cleanup.ready) Cleanup.loadSpell(store.readAsset);
  }

  function cleanUp() {
    if (!note) return;
    if (editing && editing.type === 'ink') {
      const b = blockById(editing.id); Ink.smooth(b); Ink.render(editing.svg, b); commit();
      toast('Strokes smoothed'); return;
    }
    finishEdit();
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
    bind('#optPenOnly', 'penOnly');
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
      { id: uid(), type: 'text', src: 'Write normally in text blocks. teh app tidies up spelling , spacing and capitals when you tap ✨ Clean up.\nmath inside sentences is spotted automatically: the energy is E = mc^2, and a^2 + b^2 = c^2 when the angle is 90deg.' },
      { id: uid(), type: 'text', src: '# Formulas\nTap **∑ Math** (or the → ∑ button on a block) for a display formula:' },
      { id: uid(), type: 'math', src: 'int_0^oo e^(-x^2) dx = sqrt(pi)/2' },
      { id: uid(), type: 'math', src: '(dn)/(dT) ~~ 1.2 xx 10^-5 K^-1' },
      { id: uid(), type: 'text', src: '# Lists\n- bullets start with a dash\n1. numbers work too\n[x] tap a box to tick it\n[ ] try the ✎ Ink button to sketch with the S Pen' }
    ];
    return newNote(blocks, 'Welcome to InkNotes');
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $$('#modeSeg button').forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
    $$('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('#btnInk').addEventListener('pointerdown', e => e.preventDefault());
    $('#btnInk').onclick = () => {
      const after = editing ? editing.id : null, i = after ? blockIndex(after) : -1;
      finishEdit();
      const b = after ? insertAt('ink', blockById(after) ? i + 1 : i) : insertBlock('ink');
      startEdit(b.id);
    };
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
    $('#tail').onclick = () => {
      const last = note.blocks[note.blocks.length - 1];
      const type = prefs.mode === 'math' ? 'math' : 'text';
      if (last && last.type === type && type === 'text' && editing && editing.id === last.id) return;
      finishEdit();
      const b = insertBlock(type);
      startEdit(b.id);
    };
    // tap outside the block being edited finishes it
    document.addEventListener('pointerdown', (e) => {
      if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMore')) closeMenu();
      if (!editing) return;
      if (e.target.closest('.block.editing, #toolbar, #mathbar, #inkbar, #report, #menu, .modal, #tail')) return;
      if (e.target.closest('.block')) return; // the click handler on that block switches editing
      if (e.target.closest('#page') || e.target.closest('#scroller')) finishEdit();
    }, true);
    window.addEventListener('resize', () => { if (editing && editing.ta) autoGrow(editing.ta); });
  }

  window.InkNotes = {
    onBack() {
      if (!$('#help').hidden) { $('#help').hidden = true; return true; }
      if (!$('#menu').hidden) { closeMenu(); return true; }
      if (!$('#report').hidden) { $('#report').hidden = true; return true; }
      if (editing) { finishEdit(); return true; }
      if (document.body.classList.contains('drawer')) { document.body.classList.remove('drawer'); return true; }
      return false;
    },
    flush() { if (editing) commit(); saveNow(); },
    _debug: { get note() { return note; }, cleanUp, setMode, startEdit, finishEdit, insertBlock }
  };

  /* ---------------- boot ---------------- */
  applyBodyClasses();
  buildMathbar();
  buildInkbar();
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
