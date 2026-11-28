"""Training pipeline for the InkMath model.  Used by the Colab notebook; can also be run as a script.

Steps: prepare (MathWriting InkML -> cache), train (CTC, time-budgeted, resumable), evaluate on the
InkNotes recordings, fine-tune (2-fold by prompt for an honest score, then on everything), export ONNX.
"""
import glob, json, math, os, random, time
from multiprocessing import Pool
import numpy as np
import torch
import inkmath as im


# ---------------------------------------------------------------- data preparation
def _load_one(path):
    try:
        strokes, ann = im.read_inkml(path)
        lab = ann.get("normalizedLabel") or ann.get("label") or ""
        if not strokes or not lab:
            return None
        return im.coarse(strokes).astype(np.float16), lab
    except Exception:
        return None


SPLITS = ["train", "synthetic", "symbols", "valid", "test"]


def prepare(mw_dir, out_dir, workers=None, limit=None, log=print):
    """Read every InkML file of an unpacked MathWriting folder once; writes train/valid/test caches and vocab.json."""
    files = {sp: sorted(glob.glob(os.path.join(mw_dir, sp, "*.inkml"))) for sp in SPLITS}
    raw = {}
    with Pool(workers or os.cpu_count()) as pool:
        for sp, f in files.items():
            t = time.time()
            raw[sp] = [r for r in pool.imap(_load_one, f[:limit] if limit else f, chunksize=256) if r is not None]
            log(f"  read {sp}: {len(raw[sp])} inks in {time.time() - t:.0f}s")
    return _finish(raw, out_dir, small=bool(limit), log=log)


def _parse_member(item):
    name, data = item
    try:
        strokes, ann = im.read_inkml_text(data.decode("utf-8"))
        lab = ann.get("normalizedLabel") or ann.get("label") or ""
        if not strokes or not lab:
            return None
        return name.replace("\\", "/").split("/")[-2], im.coarse(strokes).astype(np.float16), lab
    except Exception:
        return None


def prepare_tgz(tgz, out_dir, workers=None, small=False, log=print):
    """Same as prepare(), reading straight from mathwriting-2024.tgz (no unpacking of 650k small files)."""
    import tarfile
    raw = {sp: [] for sp in SPLITS}
    t, n = time.time(), 0
    import multiprocessing as mp
    ctx = mp.get_context("spawn" if os.name == "nt" or os.environ.get("INKMATH_SPAWN") else None)
    with ctx.Pool(workers or max(1, (os.cpu_count() or 2) - 1)) as pool, tarfile.open(tgz, "r|gz") as tf:
        chunk = []
        def flush():
            for r in pool.map(_parse_member, chunk, chunksize=64):
                if r is not None and r[0] in raw:
                    raw[r[0]].append(r[1:])
            chunk.clear()
        for m in tf:
            if m.isfile() and m.name.endswith(".inkml"):
                chunk.append((m.name, tf.extractfile(m).read()))
                n += 1
                if len(chunk) >= 20000:
                    flush()
                    log(f"  {n} inks read ({time.time() - t:.0f}s)")
        flush()
    log("  " + ", ".join(f"{sp}: {len(v)}" for sp, v in raw.items()) + f"  ({time.time() - t:.0f}s)")
    return _finish(raw, out_dir, small=small, log=log)


def _finish(raw, out_dir, small=False, log=print):
    os.makedirs(out_dir, exist_ok=True)
    vocab = im.Vocab.build((r[1] for sp in ["train", "synthetic", "symbols"] for r in raw[sp]), min_count=1 if small else 20)
    vocab.save(os.path.join(out_dir, "vocab.json"))
    log(f"vocab: {len(vocab.toks)} tokens")
    for name, sps in [("train", ["train", "synthetic", "symbols"]), ("valid", ["valid"]), ("test", ["test"])]:
        items, dropped = [], 0
        for sp in sps:
            for r in raw[sp]:
                p, lab = r[0], r[1]
                ids = vocab.encode(im.canon(lab))
                if ids is None or len(p) < 2:
                    dropped += 1
                    continue
                items.append((p, ids, sp))
        c = im.Cache.build(items)
        c.save(os.path.join(out_dir, name))
        log(f"{name}: {len(c)} inks ({dropped} dropped)")
    return vocab


def load_inknotes(path, vocab):
    """InkNotes fine-tune JSONL -> list of dict(p=coarse points, ids, prompt, kind)"""
    out = []
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        strokes = [np.array(s, dtype=np.float64).reshape(-1, 2) for s in r["strokes"] if len(s)]
        if not strokes:
            continue
        toks = im.canon(r["latex"])
        ids = vocab.encode(toks)
        if ids is None:
            print("  skipped (token not in vocabulary):", r["latex"])
            continue
        out.append(dict(p=im.coarse(strokes), ids=ids, toks=toks, prompt=r["prompt"], kind=r["kind"], latex=r["latex"], unsure=bool(r.get("unsure"))))
    return out


# ---------------------------------------------------------------- training
def _loader(stream, workers):
    ctx = "spawn" if (os.name == "nt" or os.environ.get("INKMATH_SPAWN")) and workers else None
    return torch.utils.data.DataLoader(stream, batch_size=None, num_workers=workers, prefetch_factor=4 if workers else None,
                                       multiprocessing_context=ctx, persistent_workers=False)


def device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def save_ckpt(path, model, opt, sched_step, extra):
    tmp = path + ".tmp"
    torch.save({"model": model.state_dict(), "opt": opt.state_dict() if opt else None, "step": sched_step, "cfg": model.cfg, **extra}, tmp)
    os.replace(tmp, path)


def load_model(path, dev=None):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    cfg = ck["cfg"]
    m = im.make_model(cfg["nvocab"], d=cfg["d"], layers=cfg["layers"], heads=cfg["heads"], ff=cfg["ff"])
    m.load_state_dict(ck["model"])
    return m.to(dev or device()), ck


class Mixed:
    """A cache-like view over MathWriting inks plus (oversampled) InkNotes inks."""

    def __init__(self, base, extra, reps):
        self.base, self.extra, self.reps = base, extra, reps
        self.nb = len(base) if base is not None else 0

    def items(self):
        return list(range(self.nb)) + [self.nb + i for i in range(len(self.extra)) for _ in range(self.reps)]

    def length(self, i):
        return (self.base.off[i + 1] - self.base.off[i]) if i < self.nb else len(self.extra[i - self.nb]["p"])

    def get(self, i):
        return (self.base.get(i), self.base.labels[i]) if i < self.nb else (self.extra[i - self.nb]["p"], self.extra[i - self.nb]["ids"])


def mixed_batches(ds, idx, max_frames, rng, aug=True):
    idx = list(idx)
    idx.sort(key=lambda i: ds.length(i) + rng.random() * 40)
    groups, cur, cur_max = [], [], 0
    for i in idx:
        L = int(ds.length(i) * im.COARSE / im.STEP) + 8
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
        feats, labs = [], []
        for i in g:
            p, ids = ds.get(i)
            feats.append(im.features(im.augment(p, rng) if aug else p))
            labs.append(ids)
        yield feats, labs


class _Stream(torch.utils.data.IterableDataset):
    def __init__(self, ds, max_frames, seed, aug=True, sub=None):
        self.ds, self.max_frames, self.seed, self.aug, self.sub = ds, max_frames, seed, aug, sub

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        wid, nw = (info.id, info.num_workers) if info else (0, 1)
        epoch = 0
        while True:
            rng = np.random.default_rng(self.seed * 1000 + epoch * 17 + wid)
            idx = self.ds.items() if self.sub is None else self.sub
            idx = [i for k, i in enumerate(idx) if k % nw == wid]
            for b in mixed_batches(self.ds, idx, self.max_frames, rng, self.aug):
                yield b
            epoch += 1


def train(ds, vocab, ckpt, hours, max_frames=48000, peak_lr=1e-3, warm=2000, workers=2,
          d=256, layers=8, heads=4, ff=1024, eval_fn=None, eval_every=2000, save_every_min=15, seed=0, log=print):
    """Trains for `hours` of training time in total (across restarts: progress is kept in the checkpoint).
    The learning rate warms up over `warm` steps, then follows a cosine over the time budget."""
    dev = device()
    elapsed = 0.0
    if os.path.exists(ckpt):
        model, ck = load_model(ckpt, dev)
        opt = torch.optim.AdamW(model.parameters(), lr=peak_lr, weight_decay=0.01)
        if ck.get("opt"):
            opt.load_state_dict(ck["opt"])
        start, elapsed = ck["step"], ck.get("elapsed", 0.0)
        log(f"resuming from step {start} ({elapsed / 3600:.2f} h done)")
    else:
        model = im.make_model(len(vocab.toks), d=d, layers=layers, heads=heads, ff=ff).to(dev)
        opt = torch.optim.AdamW(model.parameters(), lr=peak_lr, weight_decay=0.01)
        start = 0
    log(f"model: {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters on {dev}")
    budget = hours * 3600
    if elapsed >= budget:
        log("time budget already used; nothing to do")
        model.eval()
        return model
    loader = _loader(_Stream(ds, max_frames, seed + start), workers)
    scaler = torch.amp.GradScaler(enabled=dev.type == "cuda")
    ctc = torch.nn.CTCLoss(blank=0, zero_infinity=True)
    t_last = time.time()
    t_save = time.time() + save_every_min * 60
    step, run_loss, t0 = start, None, time.time()
    model.train()
    for feats, labs in loader:
        x, lengths, tgt, tl = im.collate(feats, labs, dev)
        frac = min(1.0, elapsed / budget)
        lr = peak_lr * min(1.0, (step + 1) / warm) * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * frac)))
        for g in opt.param_groups:
            g["lr"] = lr
        with torch.autocast(dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
            logp = model(x, lengths)
        ol = model.out_len(lengths)
        loss = ctc(logp.float().transpose(0, 1), tgt.to(dev), ol, tl.to(dev))
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        step += 1
        lv = float(loss.detach())
        run_loss = lv if run_loss is None else 0.98 * run_loss + 0.02 * lv
        now = time.time()
        elapsed += now - t_last
        t_last = now
        if step % 200 == 0:
            log(f"step {step}  loss {run_loss:.3f}  lr {lr:.2e}  {(now - t0) / 200:.2f}s/step  {elapsed / 3600:.2f}/{hours} h")
            t0 = now
        if eval_fn and step % eval_every == 0:
            model.eval()
            log("  " + eval_fn(model))
            model.train()
            t_last = time.time()
        done = elapsed >= budget
        if time.time() > t_save or done:
            save_ckpt(ckpt, model, opt, step, {"vocab": vocab.toks, "elapsed": elapsed})
            t_save = time.time() + save_every_min * 60
            t_last = time.time()
        if done:
            break
    model.eval()
    return model


# ---------------------------------------------------------------- evaluation
def edit(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


@torch.no_grad()
def recognise(model, vocab, points_list, max_frames=20000):
    dev = next(model.parameters()).device
    feats = [im.features(p) for p in points_list]
    out = [None] * len(feats)
    order = sorted(range(len(feats)), key=lambda i: len(feats[i]))
    k = 0
    while k < len(order):
        g = [order[k]]
        while k + len(g) < len(order) and len(feats[order[k + len(g)]]) * (len(g) + 1) <= max_frames:
            g.append(order[k + len(g)])
        x, lengths, _, _ = im.collate([feats[i] for i in g], [[1] for _ in g], dev)
        res = im.decode_batch(model(x, lengths), lengths, model, vocab)
        for i, r in zip(g, res):
            out[i] = r
        k += len(g)
    return out


def score(model, vocab, items):
    """items: list of (coarse points, reference token list). Returns (exact-match rate, token error rate)."""
    res = recognise(model, vocab, [p for p, _ in items])
    ok = sum(r[0] == ref for r, (_, ref) in zip(res, items))
    err = sum(edit(r[0], ref) for r, (_, ref) in zip(res, items))
    n = sum(len(ref) for _, ref in items)
    return ok / max(1, len(items)), err / max(1, n), res


def valid_eval_fn(valid, vocab, n=1500, seed=0):
    rng = random.Random(seed)
    sel = rng.sample(range(len(valid)), min(n, len(valid)))
    items = [(valid.get(i), [vocab.toks[t] for t in valid.labels[i]]) for i in sel]

    def f(model):
        em, ter, _ = score(model, vocab, items)
        return f"valid: exact {em:.1%}  token errors {ter:.1%}"
    return f


def inknotes_report(model, vocab, dave, title, kind="formula"):
    forms = [d for d in dave if d["kind"] == kind and not d.get("unsure")]
    em, ter, res = score(model, vocab, [(d["p"], d["toks"]) for d in forms])
    what = "practice formulas" if kind == "formula" else "homework lines"
    lines = [f"{title}: {em:.1%} of {len(forms)} {what} exactly right, token errors {ter:.1%}"]
    for d, r in zip(forms, res):
        lines.append(f"  {'✓' if r[0] == d['toks'] else '✗'} {d['latex']:<40} got {im.join(r[0])}   conf {r[1]:.2f}")
    return em, "\n".join(lines)


# ---------------------------------------------------------------- fine-tuning on InkNotes recordings
def finetune(base_ckpt, mw_train, dave_items, vocab, out_ckpt, minutes, reps=40, peak_lr=2e-4, max_frames=48000, workers=2, log=print):
    ds = Mixed(mw_train, dave_items, reps)
    if mw_train is not None:
        # keep a slice of MathWriting in the mix so the model doesn't forget general math
        rng = random.Random(1)
        n_dave = len(dave_items) * reps
        base_ids = rng.sample(range(len(mw_train)), min(len(mw_train), 2 * n_dave))
        sub = base_ids + [len(mw_train) + i for i in range(len(dave_items)) for _ in range(reps)]
    else:
        sub = None
    if os.path.exists(out_ckpt):
        os.remove(out_ckpt)
    dev = device()
    model, _ = load_model(base_ckpt, dev)
    opt = torch.optim.AdamW(model.parameters(), lr=peak_lr, weight_decay=0.01)
    ctc = torch.nn.CTCLoss(blank=0, zero_infinity=True)
    scaler = torch.amp.GradScaler(enabled=dev.type == "cuda")
    loader = _loader(_Stream(ds, max_frames, 7, sub=sub), workers)
    t_end = time.time() + minutes * 60
    step = 0
    total = None
    model.train()
    for feats, labs in loader:
        x, lengths, tgt, tl = im.collate(feats, labs, dev)
        frac = min(1.0, (time.time() - (t_end - minutes * 60)) / (minutes * 60))
        for g in opt.param_groups:
            g["lr"] = peak_lr * (min(1.0, step / 100) * (0.5 + 0.5 * math.cos(math.pi * frac)))
        with torch.autocast(dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
            logp = model(x, lengths)
        loss = ctc(logp.float().transpose(0, 1), tgt.to(dev), model.out_len(lengths), tl.to(dev))
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        step += 1
        if step % 100 == 0:
            log(f"  fine-tune step {step} loss {float(loss.detach()):.3f}")
        if time.time() > t_end:
            break
    model.eval()
    save_ckpt(out_ckpt, model, None, step, {"vocab": vocab.toks})
    return model


def prompt_folds(dave, k=2, seed=0):
    prompts = sorted(set(d["prompt"] for d in dave))
    random.Random(seed).shuffle(prompts)
    return [set(prompts[i::k]) for i in range(k)]


# ---------------------------------------------------------------- export
def export(ckpt, vocab_path, out_dir, report):
    os.makedirs(out_dir, exist_ok=True)
    model, _ = load_model(ckpt, torch.device("cpu"))
    im.export_onnx(model, os.path.join(out_dir, "inkmath.onnx"))
    import shutil
    shutil.copy(vocab_path, os.path.join(out_dir, "vocab.json"))
    open(os.path.join(out_dir, "report.txt"), "w", encoding="utf-8").write(report)
    # parity fixture: lets the app build check its own preprocessing + runner against PyTorch
    return out_dir
