/* mathtext.js — math-aware rendering of handwritten-style text.
 * - toTeX(src): AsciiMath (or raw LaTeX) -> LaTeX
 * - renderMath(src, display): HTML via KaTeX
 * - findMathRuns(text): spans of plain prose that look like formulas
 * - renderText(src, opts): text block source -> HTML
 */
(function () {
  'use strict';
  const AM = new AsciiMathParser();

  const GREEK = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
  const GREEK_SET = new Set(GREEK);
  const FUNCS = 'sin cos tan cot sec csc sinh cosh tanh log ln exp lim det max min arg sqrt root int oint sum prod grad del abs floor ceil'.split(' ');
  const FUNC_RE = new RegExp('^(' + FUNCS.join('|') + ')(?![a-z])');

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** Pre-tidy AsciiMath so common hand-typed forms parse the way people mean them. */
  function prepAscii(s) {
    let t = s.trim();
    // dn/dT, dy/dx, 1/2 written without parens -> keep each side grouped
    t = t.replace(/(^|[\s=(+\-*,])([A-Za-z]{1,3}|\d+(?:\.\d+)?)\/([A-Za-z]{1,3}|\d+(?:\.\d+)?)(?=$|[\s=)+\-*,^])/g,
      (m, pre, a, b) => pre + '(' + a + ')/(' + b + ')');
    // 3*10^8 -> 3 xx 10^8 ; a*b keeps cdot
    t = t.replace(/(\d)\s*\*\s*10\^/g, '$1 xx 10^');
    t = t.replace(/\*/g, ' cdot ');
    // degrees
    t = t.replace(/(\d)\s*deg\b/g, '$1^@');
    return t;
  }

  function toTeX(src) {
    const s = (src || '').trim();
    if (!s) return '';
    if (/^\\\[[\s\S]*\\\]$/.test(s)) return s.slice(2, -2);
    if (/^\\/.test(s) || /\\(frac|left|begin|mathrm|text)\b/.test(s)) return s; // raw LaTeX
    try {
      return AM.parse(prepAscii(s)).replace(/\^\{@\}/g, '^{\\circ}');
    } catch (e) {
      return s;
    }
  }

  function renderMath(src, display) {
    const tex = toTeX(src);
    if (!tex) return { html: '', ok: true, tex: '' };
    try {
      return {
        html: katex.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: 'ignore', trust: false }),
        ok: true, tex
      };
    } catch (e) {
      return {
        html: katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: 'ignore' }),
        ok: false, tex, err: String(e.message || e).replace(/^KaTeX parse error: /, '')
      };
    }
  }

  /* ---------- inline formula detection ---------- */
  const OP_ONLY = /^(=|==|\+|-|−|\*|\/|\^|<|>|<=|>=|!=|~~|~=|\+-|-\+|xx|\*\*|->|=>|<=>|:=|\||·|×|±|≈|≤|≥|≠|→)$/;
  const NUM = /^[-+]?(\d+([.,]\d+)?|\.\d+)([eE][-+]?\d+)?%?$/;

  function core(tok) {
    // strip sentence punctuation from the ends (but keep brackets that balance)
    let lead = '', trail = '';
    let m = tok.match(/^["'“‘]+/); if (m) { lead = m[0]; tok = tok.slice(lead.length); }
    m = tok.match(/[.,;:!?"'”’]+$/);
    if (m && !/^\d+\.$/.test(tok)) { trail = m[0]; tok = tok.slice(0, -trail.length); }
    // unbalanced trailing ')' belongs to prose: "(see x^2)"
    const opens = (tok.match(/\(/g) || []).length, closes = (tok.match(/\)/g) || []).length;
    if (closes > opens && tok.endsWith(')')) { trail = ')' + trail; tok = tok.slice(0, -1); }
    if (opens > closes && tok.startsWith('(')) { lead = lead + '('; tok = tok.slice(1); }
    return { lead, tok, trail };
  }

  function mathy(t) {
    if (!t) return false;
    if (/:\/\/|@|www\./.test(t)) return false;
    if (OP_ONLY.test(t)) return true;
    if (NUM.test(t)) return true;
    if (/^[A-Za-z]$/.test(t)) return true;
    if (GREEK_SET.has(t)) return true;
    if (FUNC_RE.test(t) && /^[a-z]+(\(|_|\^|$)/.test(t)) return /[(_^]/.test(t) || FUNCS.includes(t);
    if (/[\^_=<>]/.test(t) && /^[\w^_=<>+\-*/().,|{}\[\]~!:]+$/.test(t)) return true;
    if (/^[A-Za-z]{1,2}\d{0,2}\/[A-Za-z]{1,2}\d{0,2}$/.test(t)) return true;      // dn/dT, v1/v2
    if (/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(t)) return true;                        // 1/2
    if (/^[A-Za-z]?\(?[A-Za-z0-9+\-*/^_.,]+\)?$/.test(t) && /[+*/^_]/.test(t) && /[A-Za-z0-9]/.test(t)) return true; // (a+b), 2x+1
    if (/^[A-Za-z]\(\w{1,3}\)$/.test(t)) return true;                              // f(x)
    if (/^\d+(\.\d+)?deg$/.test(t)) return true;                                       // 90deg
    if (/^d[A-Za-z]$|^d(theta|phi|tau|omega|lambda|nu)$/.test(t)) return true;        // dx, dt, dtheta
    if (t.length <= 48 && /^[\w+\-*/^_.,()]+$/.test(t) && /[A-Za-z0-9]/.test(t) && /\(.*[+\-*/^].*\)/.test(t)) {
      let d = 0; for (const ch of t) { if (ch === '(') d++; else if (ch === ')' && --d < 0) return false; }
      if (d === 0) return true;                                                      // (y2-y1)/(x2-x1)
    }
    if (/^\d+(\.\d+)?[A-Za-z]{1,2}$/.test(t) && !/^\d+(st|nd|rd|th|am|pm|s)$/i.test(t)) return false; // units like 5mm: prose
    return false;
  }

  function strong(t) {
    if (/:\/\/|@/.test(t)) return false;
    if (/[\^_]/.test(t)) return true;
    if (/=|<=|>=|!=|~~|≈|≤|≥|≠|±|\+-/.test(t)) return true;
    if (/^(sqrt|root|int|sum|prod|lim)(\(|_|\^)/.test(t)) return true;
    if (/^[A-Za-z]{1,2}\d{0,2}\/[A-Za-z]{1,2}\d{0,2}$/.test(t)) return true;
    if (/^\w*\(.*[+*/^].*\)\w*$/.test(t)) return true;
    if (t === 'xx' || t === '×' || t === '+') return true;
    if (/^\d+(\.\d+)?deg$/.test(t)) return true;
    return false;
  }

  /**
   * Find formula-looking runs in a plain-text line. Returns [{start,end}] (character offsets).
   */
  function findMathRuns(line) {
    const toks = [];
    const re = /\S+/g; let m;
    while ((m = re.exec(line))) toks.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    const runs = [];
    let i = 0;
    while (i < toks.length) {
      const c = core(toks[i].raw);
      if (!mathy(c.tok)) { i++; continue; }
      let j = i, hasStrong = false, nonOp = 0, hasLetterOrNum = false;
      const parts = [];
      while (j < toks.length) {
        const cj = core(toks[j].raw);
        if (!mathy(cj.tok)) break;
        if (j > i && cj.lead) break;
        parts.push(cj);
        if (strong(cj.tok)) hasStrong = true;
        if (!OP_ONLY.test(cj.tok)) { nonOp++; hasLetterOrNum = true; }
        j++;
        if (cj.trail && /[.,;:!?)]/.test(cj.trail)) break; // sentence punctuation ends a formula
      }
      const n = j - i;
      // a lone single-letter / number is prose ("a", "I", "3")
      let ok = hasStrong && hasLetterOrNum;
      if (n === 1) ok = ok && /[\^_=]|\ddeg$|^(sqrt|root|int|sum)\(|^[A-Za-z]{1,2}\d{0,2}\/[A-Za-z]|\)\/\(|\)\/\w|\w\/\(/.test(parts[0].tok);
      // "a - b" with weak ops only is ambiguous; need a strong token
      if (ok) {
        // trim leading/trailing pure operators like a trailing "-" dash
        let s = i, e = j - 1;
        while (s <= e && OP_ONLY.test(core(toks[s].raw).tok) && !/^[-−+]$/.test(core(toks[s].raw).tok)) s++;
        while (e >= s && OP_ONLY.test(core(toks[e].raw).tok)) e--;
        if (e >= s) {
          const first = core(toks[s].raw), last = core(toks[e].raw);
          runs.push({ start: toks[s].start + first.lead.length, end: toks[e].end - last.trail.length });
        }
      }
      i = j > i ? j : i + 1;
    }
    return runs;
  }

  /* ---------- text block rendering ---------- */
  function inlineFormat(seg) {
    // seg is plain text (no math). escape then **bold**
    return escapeHtml(seg).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  function renderInline(line, opts) {
    // 1) explicit $...$ (and `...` for AsciiMath) ; 2) auto-detected runs in the remaining text
    let out = '';
    const re = /\$([^$]+)\$|`([^`]+)`/g;
    let last = 0, m;
    const plain = (s) => {
      if (!opts.autoMath) return mark(s);
      const runs = findMathRuns(s);
      let o = '', p = 0;
      for (const r of runs) {
        o += mark(s.slice(p, r.start));
        const res = renderMath(s.slice(r.start, r.end), false);
        o += res.ok ? '<span class="im">' + res.html + '</span>' : mark(s.slice(r.start, r.end));
        p = r.end;
      }
      return o + mark(s.slice(p));
    };
    const mark = (s) => {
      if (!opts.misspelt || !opts.misspelt.size) return inlineFormat(s);
      return inlineFormat(s).replace(/[A-Za-z][A-Za-z']+/g, w => opts.misspelt.has(w) ? '<span class="misspelt">' + w + '</span>' : w);
    };
    while ((m = re.exec(line))) {
      out += plain(line.slice(last, m.index));
      const res = renderMath(m[1] || m[2], false);
      out += '<span class="im">' + res.html + '</span>';
      last = m.index + m[0].length;
    }
    return out + plain(line.slice(last));
  }

  function renderText(src, opts) {
    opts = opts || {};
    const lines = (src || '').split('\n');
    let html = '';
    let num = 0;
    lines.forEach((line, idx) => {
      let m;
      if ((m = line.match(/^#{1,3}\s+(.*)$/))) {
        html += '<h3>' + renderInline(m[1], opts) + '</h3>';
        num = 0;
      } else if ((m = line.match(/^\s*\[( |x|X)\]\s?(.*)$/))) {
        const x = m[1] !== ' ';
        html += '<p class="li"><span class="bullet"><span class="cb' + (x ? ' x' : '') + '" data-line="' + idx + '"></span></span>' +
          '<span class="' + (x ? 'done' : '') + '">' + renderInline(m[2], opts) + '</span></p>';
        num = 0;
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        html += '<p class="li"><span class="bullet">•</span>' + renderInline(m[1], opts) + '</p>';
        num = 0;
      } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
        html += '<p class="li"><span class="bullet">' + m[1] + '.</span>' + renderInline(m[2], opts) + '</p>';
      } else {
        html += '<p>' + (line.trim() ? renderInline(line, opts) : '') + '</p>';
        num = 0;
      }
    });
    return html;
  }

  /** Plain-text export: inline math -> $LaTeX$, display math handled by caller. */
  function textToLatexMarkdown(src, autoMath) {
    return (src || '').split('\n').map(line => {
      line = line.replace(/\$([^$]+)\$|`([^`]+)`/g, (m, a, b) => '$' + toTeX(a || b) + '$');
      if (!autoMath) return line;
      // only convert outside existing $...$
      return line.split(/(\$[^$]+\$)/).map(part => {
        if (/^\$[^$]+\$$/.test(part)) return part;
        const runs = findMathRuns(part);
        let o = '', p = 0;
        for (const r of runs) { o += part.slice(p, r.start) + '$' + toTeX(part.slice(r.start, r.end)) + '$'; p = r.end; }
        return o + part.slice(p);
      }).join('');
    }).join('\n');
  }

  window.MathText = { toTeX, renderMath, findMathRuns, renderText, textToLatexMarkdown, escapeHtml, mathy, core, GREEK };
})();
