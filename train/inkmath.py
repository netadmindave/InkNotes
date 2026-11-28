"""InkMath: a small ink -> LaTeX recogniser for InkNotes.

Input is online ink (strokes of x, y points, y pointing down, any scale).  Output is canonical LaTeX tokens.
Architecture: per-point features -> 2 strided convs (4x shorter) -> pre-norm Transformer encoder -> CTC.

The preprocessing here is mirrored exactly in core/src/inkmath.rs (the on-device version); if you change
anything in `prepare` or `features`, change it there too, or the app will see different input than training did.
"""
import json, math, os, re, random
import numpy as np

# ---------------------------------------------------------------- preprocessing (mirrored in Rust)
COARSE = 0.03     # first resampling step, in units of the ink's normalised height
STEP = 0.06       # final resampling step
MAXP = 1600       # max points fed to the model (step grows for very long inks)


def _scale(strokes):
    pts = np.concatenate([s for s in strokes if len(s)], 0)
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    h, w = y1 - y0, x1 - x0
    s = max(h, 0.15 * w, 1e-6)
    return x0, y0, s


def resample(strokes, step):
    """Uniform arclength resampling: each stroke is sampled at distances 0, step, 2*step, ... along its path, plus its
    last point if that is more than 0.3*step past the last sample.  Returns (m,3): x, y, stroke-start flag."""
    out = []
    for s in strokes:
        s = np.asarray(s, dtype=np.float64)
        if len(s) == 0:
            continue
        d = np.hypot(np.diff(s[:, 0]), np.diff(s[:, 1]))
        c = np.concatenate([[0.0], np.cumsum(d)])
        total = c[-1]
        k = int(math.floor(total / step + 1e-9))
        t = np.arange(k + 1) * step
        x = np.interp(t, c, s[:, 0])
        y = np.interp(t, c, s[:, 1])
        if total - t[-1] > 0.3 * step:
            x = np.append(x, s[-1, 0]); y = np.append(y, s[-1, 1])
        f = np.zeros(len(x)); f[0] = 1.0
        out.append(np.stack([x, y, f], 1))
    if not out:
        return np.zeros((0, 3), np.float32)
    return np.concatenate(out, 0).astype(np.float32)


def split3(p):
    """(m,3) x,y,start -> list of (n,2) strokes"""
    starts = list(np.nonzero(p[:, 2] > 0.5)[0]) + [len(p)]
    return [p[starts[i]:starts[i + 1], :2] for i in range(len(starts) - 1)]


def coarse(strokes):
    """Raw strokes (any units) -> normalised, coarsely resampled points (m,3). This is what the training cache stores."""
    strokes = [np.asarray(s, dtype=np.float64)[:, :2] for s in strokes if len(s)]
    x0, y0, s = _scale(strokes)
    strokes = [np.stack([(a[:, 0] - x0) / s, (a[:, 1] - y0) / s], 1) for a in strokes]
    return resample(strokes, COARSE)


def features(p):
    """Coarse points (m,3) -> model input (n,5): dx/step, dy/step, y, stroke start, stroke end."""
    strokes = split3(p)
    if not strokes:
        return np.zeros((1, 5), np.float32)
    x0, y0, s = _scale(strokes)                      # renormalise (augmentation may have changed the extent)
    strokes = [np.stack([(a[:, 0] - x0) / s, (a[:, 1] - y0) / s], 1) for a in strokes]
    length = sum(float(np.hypot(*np.diff(a, axis=0).T).sum()) if len(a) > 1 else 0.0 for a in strokes)
    step = STEP
    if length / step + len(strokes) > MAXP:
        step = (length + 1e-6) / (MAXP - len(strokes) - 2)
    q = resample(strokes, step)
    n = len(q)
    f = np.zeros((n, 5), np.float32)
    f[1:, 0] = (q[1:, 0] - q[:-1, 0]) / step
    f[1:, 1] = (q[1:, 1] - q[:-1, 1]) / step
    f[:, 2] = q[:, 1]
    f[:, 3] = q[:, 2]
    f[:-1, 4] = q[1:, 2]
    f[-1, 4] = 1.0
    np.clip(f[:, :2], -8.0, 8.0, out=f[:, :2])
    return f


def augment(p, rng):
    """Random writer-style distortion of coarse points (training only)."""
    q = p.copy()
    x, y = q[:, 0].astype(np.float64), q[:, 1].astype(np.float64)
    sx = math.exp(rng.uniform(-0.25, 0.25))
    sh = rng.uniform(-0.35, 0.25)                    # slant
    rot = math.radians(rng.uniform(-6, 6))
    x = x * sx + sh * (y - 0.5)
    c, s = math.cos(rot), math.sin(rot)
    x, y = c * x - s * y, s * x + c * y
    # gentle per-stroke wobble
    starts = list(np.nonzero(q[:, 2] > 0.5)[0]) + [len(q)]
    for i in range(len(starts) - 1):
        a, b = starts[i], starts[i + 1]
        x[a:b] += rng.normal(0, 0.015)
        y[a:b] += rng.normal(0, 0.015)
    q[:, 0], q[:, 1] = x, y
    return q


# ---------------------------------------------------------------- LaTeX tokens (canonicalisation mirrored in Rust)
TOK = re.compile(r"\\[A-Za-z]+|\\.|[^\s]")
DROP = {"\\left", "\\right", "\\,", "\\;", "\\!", "\\ ", "\\quad", "\\qquad", "\\displaystyle", "\\limits", "\\nolimits", "\\:", "\\big", "\\Big", "\\bigg", "\\Bigg"}
SYN = {"\\le": "\\leq", "\\ge": "\\geq", "\\ne": "\\neq", "\\dfrac": "\\frac", "\\tfrac": "\\frac", "\\lbrace": "\\{", "\\rbrace": "\\}",
       "\\to": "\\rightarrow", "\\gets": "\\leftarrow", "\\varepsilon": "\\epsilon", "\\vartheta": "\\theta", "\\varphi": "\\phi",
       "\\lvert": "|", "\\rvert": "|", "\\vert": "|", "\\ast": "*", "−": "-", "×": "\\times", "·": "\\cdot"}


def canon(latex):
    """LaTeX string -> canonical token list (scripts always braced, spacing and \\left/\\right dropped)."""
    t = [SYN.get(x, x) for x in TOK.findall(latex) if x not in DROP]
    out = []
    i = 0
    while i < len(t):
        out.append(t[i])
        if t[i] in ("^", "_") and i + 1 < len(t) and t[i + 1] != "{":
            out += ["{", t[i + 1], "}"]
            i += 2
            continue
        i += 1
    return out


class Vocab:
    def __init__(self, toks):
        self.toks = list(toks)            # index 0 is the CTC blank
        self.idx = {t: i for i, t in enumerate(self.toks)}

    @staticmethod
    def build(label_iter, min_count=20):
        from collections import Counter
        c = Counter()
        for lab in label_iter:
            c.update(canon(lab))
        return Vocab(["<blank>"] + sorted(t for t, n in c.items() if n >= min_count))

    def encode(self, toks):
        ids = [self.idx.get(t) for t in toks]
        return None if any(i is None or i == 0 for i in ids) else ids

    def save(self, path):
        json.dump({"tokens": self.toks, "coarse": COARSE, "step": STEP, "maxp": MAXP}, open(path, "w"), ensure_ascii=False, indent=0)

    @staticmethod
    def load(path):
        return Vocab(json.load(open(path))["tokens"])


def join(toks):
    """tokens -> LaTeX text (same as join_latex in Rust)"""
    s = ""
    for x in toks:
        m = re.search(r"\\[A-Za-z]+$", s)
        if m and x[:1].isascii() and x[:1].isalpha():
            s += " "
        s += x
    return s


def ctc_greedy(logp, vocab):
    """logp: (T, V) log-probs -> (tokens, confidence)"""
    best = logp.argmax(-1)
    pmax = np.exp(logp.max(-1))
    toks, conf, prev = [], 1.0, 0
    for i, k in enumerate(best):
        k = int(k)
        if k != prev and k != 0:
            toks.append(vocab.toks[k])
            conf = min(conf, float(pmax[i]))
        prev = k
    return toks, conf


# ---------------------------------------------------------------- model
def make_model(nvocab, d=256, layers=8, heads=4, ff=1024, drop=0.1):
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class Block(nn.Module):
        def __init__(s):
            super().__init__()
            s.n1, s.n2 = nn.LayerNorm(d), nn.LayerNorm(d)
            s.qkv, s.o = nn.Linear(d, 3 * d), nn.Linear(d, d)
            s.f1, s.f2 = nn.Linear(d, ff), nn.Linear(ff, d)
            s.drop = nn.Dropout(drop)

        def forward(s, x, bias):
            B, T, _ = x.shape
            q, k, v = s.qkv(s.n1(x)).view(B, T, 3, heads, d // heads).permute(2, 0, 3, 1, 4)
            a = torch.matmul(q, k.transpose(-1, -2)) * (1.0 / math.sqrt(d // heads))
            if bias is not None:
                a = a + bias
            a = torch.softmax(a, -1)
            y = torch.matmul(s.drop(a), v).transpose(1, 2).reshape(B, T, d)
            x = x + s.drop(s.o(y))
            return x + s.drop(s.f2(s.drop(F.gelu(s.f1(s.n2(x))))))

    class Net(nn.Module):
        def __init__(s):
            super().__init__()
            s.cfg = dict(nvocab=nvocab, d=d, layers=layers, heads=heads, ff=ff)
            s.inp = nn.Linear(5, d)
            s.c1 = nn.Conv1d(d, d, 5, stride=2, padding=2)
            s.c2 = nn.Conv1d(d, d, 5, stride=2, padding=2)
            pe = torch.zeros(4096, d)
            pos = torch.arange(4096).float()[:, None]
            div = torch.exp(torch.arange(0, d, 2).float() * (-math.log(10000.0) / d))
            pe[:, 0::2], pe[:, 1::2] = torch.sin(pos * div), torch.cos(pos * div)
            s.register_buffer("pe", pe, persistent=False)
            s.blocks = nn.ModuleList(Block() for _ in range(layers))
            s.norm = nn.LayerNorm(d)
            s.out = nn.Linear(d, nvocab)

        @staticmethod
        def out_len(n):
            return (((n + 1) // 2) + 1) // 2

        def forward(s, x, lengths=None):
            """x: (B, T, 5) -> log-probs (B, T', V)"""
            h = F.gelu(s.inp(x)).transpose(1, 2)
            h = F.gelu(s.c2(F.gelu(s.c1(h)))).transpose(1, 2)
            T = h.shape[1]
            h = h + s.pe[:T]
            bias = None
            if lengths is not None:
                ol = s.out_len(lengths)
                pad = torch.arange(T, device=x.device)[None, :] >= ol[:, None]
                bias = pad[:, None, None, :].float() * -1e4
            for b in s.blocks:
                h = b(h, bias)
            return torch.log_softmax(s.out(s.norm(h)), -1)

    return Net()


def export_onnx(model, path):
    import torch
    model = model.eval().float().cpu()
    x = torch.randn(1, 300, 5)
    torch.onnx.export(model, (x,), path, input_names=["x"], output_names=["logp"],
                      dynamic_axes={"x": {1: "T"}, "logp": {1: "U"}}, opset_version=17, dynamo=False)


# ---------------------------------------------------------------- data
def read_inkml(path):
    from xml.etree import ElementTree
    root = ElementTree.fromstring(open(path, encoding="utf-8").read())
    strokes, ann = [], {}
    for el in root:
        tag = el.tag.split("}")[-1]
        if tag == "annotation":
            ann[el.attrib.get("type")] = el.text or ""
        elif tag == "trace":
            pts = [p.split() for p in el.text.strip().split(",")]
            strokes.append(np.array([[float(a[0]), float(a[1])] for a in pts if len(a) >= 2]))
    return strokes, ann


def inknotes_strokes(rec_strokes):
    """InkNotes export stroke objects -> list of (n,2) arrays"""
    return [np.array([[p[0], p[1]] for p in s["p"]], dtype=np.float64) for s in rec_strokes if s.get("p")]


class Cache:
    """All training inks as coarse points in one float16 array + offsets (memory-mappable)."""

    def __init__(self, pts, off, labels, src):
        self.pts, self.off, self.labels, self.src = pts, off, labels, src

    def __len__(self):
        return len(self.labels)

    def get(self, i):
        return self.pts[self.off[i]:self.off[i + 1]].astype(np.float32)

    def save(self, base):
        np.save(base + "-pts.npy", self.pts)
        np.save(base + "-off.npy", self.off)
        json.dump({"labels": self.labels, "src": self.src}, open(base + "-meta.json", "w"))

    @staticmethod
    def load(base, mmap=True):
        m = json.load(open(base + "-meta.json"))
        return Cache(np.load(base + "-pts.npy", mmap_mode="r" if mmap else None), np.load(base + "-off.npy"), m["labels"], m["src"])

    @staticmethod
    def build(items):
        """items: iterable of (coarse points (m,3), label ids list, source tag)"""
        chunks, off, labels, src = [], [0], [], []
        for p, ids, tag in items:
            chunks.append(p.astype(np.float16))
            off.append(off[-1] + len(p))
            labels.append(ids)
            src.append(tag)
        pts = np.concatenate(chunks, 0) if chunks else np.zeros((0, 3), np.float16)
        return Cache(pts, np.array(off, np.int64), labels, src)


def batches(cache, idx, max_frames, rng, aug=True):
    """Length-bucketed batches of (features list, label list)."""
    idx = list(idx)
    lens = np.diff(cache.off)
    idx.sort(key=lambda i: lens[i] + rng.random() * 40)
    groups, cur, cur_max = [], [], 0
    for i in idx:
        L = int(lens[i] * COARSE / STEP) + 8
        m = max(cur_max, L)
        if cur and m * (len(cur) + 1) > max_frames:
            groups.append(cur)
            cur, m = [], L
        cur.append(i)
        cur_max = m
    if cur:
        groups.append(cur)
    rng.shuffle(groups)
    for g in groups:
        feats = []
        for i in g:
            p = cache.get(i)
            if aug:
                p = augment(p, rng)
            feats.append(features(p))
        yield feats, [cache.labels[i] for i in g]


def collate(feats, labels, device):
    import torch
    T = max(len(f) for f in feats)
    x = np.zeros((len(feats), T, 5), np.float32)
    for k, f in enumerate(feats):
        x[k, :len(f)] = f
    lengths = torch.tensor([len(f) for f in feats])
    tgt = torch.tensor([t for l in labels for t in l], dtype=torch.long)
    tl = torch.tensor([len(l) for l in labels])
    return torch.from_numpy(x).to(device), lengths.to(device), tgt, tl


def decode_batch(logp, lengths, model, vocab):
    out = []
    ol = model.out_len(lengths).cpu().numpy()
    lp = logp.float().cpu().numpy()
    for k in range(lp.shape[0]):
        out.append(ctc_greedy(lp[k, :ol[k]], vocab))
    return out
