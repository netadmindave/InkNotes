/* cleanup.js — tidies prose while leaving formulas, code and links untouched. */
(function () {
  'use strict';

  const COMMON = {
    teh: 'the', hte: 'the', taht: 'that', thier: 'their', recieve: 'receive', recieved: 'received', reciever: 'receiver',
    beleive: 'believe', belive: 'believe', definately: 'definitely', definatly: 'definitely', seperate: 'separate',
    seperately: 'separately', occured: 'occurred', occurence: 'occurrence', untill: 'until', wich: 'which', whcih: 'which',
    becuase: 'because', becasue: 'because', beacuse: 'because', adn: 'and', nad: 'and', jsut: 'just', wiht: 'with',
    waht: 'what', woudl: 'would', coudl: 'could', shoudl: 'should', dont: "don't", doesnt: "doesn't", didnt: "didn't",
    cant: "can't", wont: "won't", isnt: "isn't", wasnt: "wasn't", arent: "aren't", werent: "weren't", couldnt: "couldn't",
    wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", im: "I'm", ive: "I've", thats: "that's",
    alot: 'a lot', aswell: 'as well', accross: 'across', acheive: 'achieve', adress: 'address', agian: 'again',
    apparant: 'apparent', arguement: 'argument', basicly: 'basically', begining: 'beginning', calender: 'calendar',
    comming: 'coming', commited: 'committed', concious: 'conscious', curent: 'current', enviroment: 'environment',
    existance: 'existence', experiement: 'experiment', experment: 'experiment', foward: 'forward', freind: 'friend',
    goverment: 'government', happend: 'happened', independant: 'independent', knowlege: 'knowledge', lenght: 'length',
    wavelenght: 'wavelength', mesurement: 'measurement', measurment: 'measurement', neccessary: 'necessary',
    necesary: 'necessary', noticable: 'noticeable', occassion: 'occasion', paralel: 'parallel', parrallel: 'parallel',
    posible: 'possible', prefered: 'preferred', probaly: 'probably', propogate: 'propagate', propogation: 'propagation',
    recomend: 'recommend', refered: 'referred', relevent: 'relevant', resistence: 'resistance', responce: 'response',
    succesful: 'successful', sucessful: 'successful', suprise: 'surprise', temperture: 'temperature', tempurature: 'temperature',
    tommorow: 'tomorrow', tomorow: 'tomorrow', truely: 'truly', unfortunatly: 'unfortunately', usualy: 'usually',
    wierd: 'weird', writting: 'writing', freqency: 'frequency', frequncy: 'frequency', amplitdue: 'amplitude',
    refractve: 'refractive', coeficient: 'coefficient', coefficent: 'coefficient', equasion: 'equation', eqution: 'equation',
    intergral: 'integral', derivitive: 'derivative', funtion: 'function', fucntion: 'function', vaule: 'value',
    calulate: 'calculate', calcualte: 'calculate', abosrption: 'absorption', absorbtion: 'absorption', dispersoin: 'dispersion',
    polarisation: 'polarization', thermo: 'thermo', theroy: 'theory', thoery: 'theory', resonace: 'resonance'
  };

  // Field vocabulary so the spell checker doesn't nag about lab words.
  const SCIENCE = ('interferometer interferometry interferometric heterodyne homodyne photonic photonics photodiode photodetector ' +
    'spectroscopy spectrometer spectrograph spectrogram spectral wavelength wavelengths waveguide waveguides birefringence birefringent ' +
    'refractive thermo-optic thermooptic dn/dT etalon etalons fiber fibers fibre collimator collimated collimation polarizer polarizers ' +
    'polarization polarimetry heterodyning beatnote beatnotes linewidth linewidths femtosecond picosecond nanosecond attosecond ' +
    'terahertz gigahertz megahertz kilohertz THz GHz MHz kHz Hz nm µm um mW dBm dB nanometer micrometer metrology metrological ' +
    'microcomb microcombs soliton solitons supercontinuum chirped chirp dispersion dispersive nonlinear nonlinearity Kerr ' +
    'Fabry-Perot Fabry Perot Michelson Mach-Zehnder Zehnder Sagnac Fourier Lorentzian Gaussian Bessel Hermite Laguerre ' +
    'eigenvalue eigenvalues eigenvector eigenvectors eigenmode eigenmodes Hamiltonian Lagrangian Jacobian Laplacian Hermitian ' +
    'unitary orthonormal orthogonal integrand integrable differentiable antiderivative quasi parametric parametrize ' +
    'thermistor thermocouple TEC PID piezo piezoelectric actuator actuators photolithography lithography annealing anneal ' +
    'chalcogenide germanium silica borosilicate fused CaF2 ZnSe sapphire YAG Nd:YAG Er erbium ytterbium thulium holmium ' +
    'CREOL UCF LabVIEW Python NumPy SciPy matplotlib Jupyter MATLAB GPS PLL VCO RF IF DAQ ADC DAC FPGA OSA OBR ' +
    'Eikenberry lantern lanterns multimode singlemode monomode cladding core NA modal intermodal ' +
    'sinusoid sinusoidal quadrature demodulation demodulate modulator modulators acousto-optic electro-optic AOM EOM ' +
    'vs etc eg ie approx').split(/\s+/);

  let spell = null, spellLoading = false;
  const known = new Set();
  SCIENCE.forEach(w => known.add(w.toLowerCase()));

  function loadSpell(readFile) {
    if (spell || spellLoading) return;
    spellLoading = true;
    try {
      const aff = readFile('www/dict/en_US.aff');
      const dic = readFile('www/dict/en_US.dic');
      if (aff && dic) spell = new Typo('en_US', aff, dic);
    } catch (e) { console.warn('spell load failed', e); }
    spellLoading = false;
  }

  function isKnown(w, userDict) {
    const lw = w.toLowerCase();
    if (known.has(lw) || (userDict && userDict.has(lw))) return true;
    if (!spell) return true;
    if (spell.check(w) || spell.check(lw)) return true;
    if (/'s$/.test(lw) && (spell.check(w.slice(0, -2)) || spell.check(lw.slice(0, -2)))) return true;
    return false;
  }

  const AZ = 'abcdefghijklmnopqrstuvwxyz';
  function edits1(w) {
    const out = { trans: [], other: [] };
    for (let i = 0; i < w.length - 1; i++) out.trans.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    for (let i = 0; i < w.length; i++) out.other.push(w.slice(0, i) + w.slice(i + 1));            // delete
    for (let i = 0; i < w.length; i++) for (const c of AZ) if (c !== w[i]) out.other.push(w.slice(0, i) + c + w.slice(i + 1)); // replace
    for (let i = 0; i <= w.length; i++) for (const c of AZ) out.other.push(w.slice(0, i) + c + w.slice(i)); // insert
    return out;
  }

  function suggestions(word, userDict) {
    const lw = word.toLowerCase();
    if (!spell) return [];
    const e = edits1(lw);
    const ok = (c) => c.length > 1 && (known.has(c) || (userDict && userDict.has(c)) || spell.check(c));
    const trans = [...new Set(e.trans.filter(ok))];
    const other = [...new Set(e.other.filter(ok))].filter(c => !trans.includes(c));
    return trans.concat(other);
  }

  function matchCase(src, repl) {
    if (src === src.toUpperCase() && src.length > 1) return repl.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
    return repl;
  }

  /** Character ranges in a line that must not be touched. */
  function protectedRanges(line, autoMath) {
    const ranges = [];
    const add = (s, e) => ranges.push([s, e]);
    let m;
    const re = /\$[^$]+\$|`[^`]+`|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;
    while ((m = re.exec(line))) add(m.index, m.index + m[0].length);
    if (autoMath) {
      // run detection only on unprotected stretches
      let p = 0;
      const base = ranges.slice().sort((a, b) => a[0] - b[0]);
      const gaps = [];
      for (const [s, e] of base) { if (s > p) gaps.push([p, s]); p = Math.max(p, e); }
      if (p < line.length) gaps.push([p, line.length]);
      for (const [gs, ge] of gaps) {
        for (const r of MathText.findMathRuns(line.slice(gs, ge))) add(gs + r.start, gs + r.end);
      }
      // single-letter variables in prose ("where x is the ...") are protected from capitalization by the word rules
    }
    return ranges.sort((a, b) => a[0] - b[0]);
  }

  /**
   * Clean a text block.
   * @returns {{text:string, changes:Array<{from:string,to:string}>, unknown:Map<string,string[]>}}
   */
  function cleanText(src, opts) {
    opts = opts || {};
    const userDict = opts.userDict || new Set();
    const changes = [];
    const unknown = new Map();
    const lines = (src || '').replace(/\r/g, '').split('\n');
    let prevEndsSentence = true;

    const outLines = lines.map((rawLine) => {
      // list / heading prefix
      const pm = rawLine.match(/^(\s*(?:#{1,3}\s+|[-*•]\s+|\d+[.)]\s+|\[[ xX]\]\s*)?)/);
      const prefix = pm ? pm[1] : '';
      let body = rawLine.slice(prefix.length);
      const isItem = prefix.trim().length > 0;
      if (!body.trim()) { prevEndsSentence = true; return prefix.trimEnd() ? prefix : ''; }

      const prot = protectedRanges(body, opts.autoMath);
      // split into segments
      const segs = [];
      let p = 0;
      for (const [s, e] of prot) {
        if (s < p) { if (e > p) { segs[segs.length - 1].text += body.slice(p, e); p = e; } continue; }
        if (s > p) segs.push({ prot: false, text: body.slice(p, s) });
        segs.push({ prot: true, text: body.slice(s, e) });
        p = e;
      }
      if (p < body.length) segs.push({ prot: false, text: body.slice(p) });

      let sentenceStart = isItem || prevEndsSentence;
      let prevWord = null;

      segs.forEach((seg, si) => {
        if (seg.prot) { sentenceStart = false; prevWord = null; return; }
        let t = seg.text;
        const before = t;
        // spacing
        t = t.replace(/[ \t]{2,}/g, ' ');
        if (si === 0) t = t.replace(/^\s+/, '');
        t = t.replace(/\s+([,;:!?])(?=\s|$)/g, '$1');
        t = t.replace(/([a-z\)])\s+\.(?=\s|$)/gi, '$1.');
        t = t.replace(/([a-z\)])\s+\.(?=[A-Za-z])/gi, '$1. ');
        t = t.replace(/([,;])(?=[A-Za-z])/g, '$1 ');
        t = t.replace(/([a-z]{2,}[.!?])(?=[A-Z][a-z])/g, '$1 ');
        t = t.replace(/ -- /g, ' — ').replace(/(\w)--(\w)/g, '$1—$2');
        if (si === segs.length - 1) t = t.replace(/\s+$/, '');
        if (t !== before && before.trim() && t.trim() !== before.trim()) {
          // spacing changes are summarised once
          if (!changes.some(c => c.kind === 'spacing')) changes.push({ kind: 'spacing', from: 'spacing', to: 'tidied' });
        }

        // words
        t = t.replace(/[A-Za-z][A-Za-z']*|[.!?]+|\S/g, (tok, off, whole) => {
          if (/^[.!?]+$/.test(tok)) { sentenceStart = true; prevWord = null; return tok; }
          if (!/^[A-Za-z]/.test(tok)) { if (!/["'(\[“‘]/.test(tok)) sentenceStart = false; prevWord = null; return tok; }
          let w = tok;
          const lw = w.toLowerCase();
          const nextCh = whole[off + tok.length] || '';
          const partOfToken = /[0-9_^=\/]/.test(nextCh) || /[0-9_^=\/]/.test(whole[off - 1] || '');
          if (partOfToken) { sentenceStart = false; prevWord = null; return w; }

          // doubled words
          if (prevWord && prevWord.toLowerCase() === lw && !['that', 'had', 'is', 'do', 'bye', 'very', 'so', 'no', 'ha', 'la'].includes(lw)
              && /^\s+$/.test(whole.slice(prevWord._end, off))) {
            changes.push({ kind: 'double', from: prevWord + ' ' + w, to: prevWord });
            prevWord._kill = true;
            return '\u0000';
          }

          // i -> I
          if (lw === 'i' || /^i'(m|ve|ll|d)$/.test(lw)) {
            const fixed = 'I' + w.slice(1);
            if (fixed !== w) { changes.push({ kind: 'cap', from: w, to: fixed }); w = fixed; }
          } else if (COMMON[lw] && COMMON[lw] !== lw) {
            const fixed = matchCase(w, COMMON[lw]);
            changes.push({ kind: 'spell', from: w, to: fixed }); w = fixed;
          } else if (spell && w.length >= 3 && !(w === w.toUpperCase()) &&
                     !(w[0] === w[0].toUpperCase() && !sentenceStart) && !isKnown(w, userDict)) {
            const sug = suggestions(w, userDict);
            const transOnly = sug.length && edits1(lw).trans.includes(sug[0]) && sug.filter(s => edits1(lw).trans.includes(s)).length === 1;
            if (sug.length === 1 || (transOnly && lw.length >= 4)) {
              const fixed = matchCase(w, sug[0]);
              changes.push({ kind: 'spell', from: w, to: fixed }); w = fixed;
            } else {
              unknown.set(w, sug.slice(0, 4));
            }
          }

          // capitalise sentence starts (skip lone variables like "x" and a lowercase-intended unit)
          if (sentenceStart && /^[a-z]/.test(w) && (w.length > 1 || w === 'a')) {
            const fixed = w[0].toUpperCase() + w.slice(1);
            changes.push({ kind: 'cap', from: w, to: fixed }); w = fixed;
          }
          sentenceStart = false;
          const pw = new String(w); pw._end = off + tok.length; prevWord = pw;
          return w;
        });
        // remove doubled words (marked with \0) and the space before them
        t = t.replace(/\s+\u0000/g, '').replace(/\u0000/g, '');
        t = t.replace(/([a-z]{2,}[.!?])(?=[A-Z][a-z])/g, '$1 ');
        seg.text = t;
      });

      let out = segs.map(s => s.text).join('');
      // tidy space at joins between prose and formulas
      out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, '');
      prevEndsSentence = /[.!?:]["')\]]?$/.test(out) || isItem || /^#/.test(prefix.trim());
      return prefix + out;
    });

    // collapse 3+ blank lines into one blank line
    let text = outLines.join('\n').replace(/\n{3,}/g, '\n\n');
    if (text !== src && !changes.length) changes.push({ kind: 'spacing', from: 'spacing', to: 'tidied' });
    return { text, changes, unknown };
  }

  /** Words a block would flag (for the wavy underline). */
  function misspeltWords(src, userDict, autoMath) {
    const set = new Set();
    if (!spell) return set;
    for (const line of (src || '').split('\n')) {
      const prot = protectedRanges(line, autoMath);
      line.replace(/[A-Za-z][A-Za-z']*/g, (w, off) => {
        if (w.length < 3 || w === w.toUpperCase()) return w;
        if (prot.some(([s, e]) => off >= s && off < e)) return w;
        if (/[0-9_^=\/]/.test(line[off + w.length] || '') || /[0-9_^=\/]/.test(line[off - 1] || '')) return w;
        if (!isKnown(w, userDict) && !COMMON[w.toLowerCase()]) set.add(w);
        return w;
      });
    }
    return set;
  }

  function replaceWord(src, word, repl) {
    const re = new RegExp('(^|[^A-Za-z\'])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z\'])', 'g');
    return src.replace(re, (m, pre) => pre + repl);
  }

  window.Cleanup = { loadSpell, cleanText, misspeltWords, suggestions, replaceWord, get ready() { return !!spell; } };
})();
