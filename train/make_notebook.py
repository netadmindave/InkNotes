"""Builds InkNotes_formula_training.ipynb (self-contained: it embeds inkmath.py and run.py)."""
import json, os

here = os.path.dirname(os.path.abspath(__file__))
src = {n: open(os.path.join(here, n), encoding="utf-8").read() for n in ["inkmath.py", "run.py"]}

cells = []
md = lambda s: cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
code = lambda s: cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md("""
# InkNotes formula model training

This trains the small handwriting → LaTeX model for InkNotes, then tunes it on your own writing.

**Before you start:** Runtime → Change runtime type → **T4 GPU** → Save. Then Runtime → **Run all**.

* It asks you to connect Google Drive. Everything is saved there, so if Colab disconnects you can just **Run all** again and it carries on where it stopped.
* It asks you to upload **inknotes-dave.jsonl** (skip that if you've put it in the `InkNotes-training` folder in your Drive).
* The whole run takes about 4½ hours. Keep this tab open.
* At the end it downloads **inkmath-model.zip**. Upload that file to Claude.

The model learns from Google's MathWriting data set (CC BY-NC-SA 4.0, fine for personal, non-commercial use).
""")
code("""
# Settings
TRAIN_HOURS = 3.0        # main training time (total, across restarts)
FOLD_MINUTES = 8         # each of the 2 honest-score fine-tunes
FINAL_MINUTES = 12       # final fine-tune on all your writing
MAX_FRAMES = 48000       # batch size (input points per batch); lower it if the GPU runs out of memory
""")
code("""
import os, subprocess, sys
import torch
print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE. Runtime → Change runtime type → T4 GPU, then Run all again')
from google.colab import drive
drive.mount('/content/drive')
DRIVE = '/content/drive/MyDrive/InkNotes-training'
os.makedirs(DRIVE, exist_ok=True)
!pip -q install onnx onnxscript onnxruntime
""")
for name, s in src.items():
    code(f"%%writefile {name}\n" + s)
code("""
import importlib, shutil, glob, json
import inkmath as im, run
importlib.reload(im); importlib.reload(run)
DAVE = os.path.join(DRIVE, 'inknotes-dave.jsonl')
if not os.path.exists(DAVE):
    from google.colab import files
    print('Upload inknotes-dave.jsonl')
    up = files.upload()
    name = next(iter(up))
    open(DAVE, 'wb').write(up[name])
HOMEWORK = os.path.join(DRIVE, 'inknotes-homework.jsonl')
print('your recordings:', sum(1 for _ in open(DAVE)), 'inks;', 'homework lines:', sum(1 for _ in open(HOMEWORK)) if os.path.exists(HOMEWORK) else 'none (optional: put inknotes-homework.jsonl in the Drive folder)')
""")
code("""
# MathWriting -> cache (done once; kept in Drive)
CACHE = os.path.join(DRIVE, 'cache')
if not os.path.exists(os.path.join(CACHE, 'train-meta.json')):
    if not os.path.exists('/content/mathwriting-2024'):
        print('downloading MathWriting (2.9 GB)...')
        subprocess.run(['wget', '-q', '-nc', 'https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz', '-O', '/content/mw.tgz'], check=True)
        print('unpacking...')
        subprocess.run(['tar', '-xzf', '/content/mw.tgz', '-C', '/content'], check=True)
        os.remove('/content/mw.tgz')
    # in a separate process so the memory it uses is given back afterwards
    subprocess.run([sys.executable, '-c', "import run; run.prepare('/content/mathwriting-2024', '/content/cache')"], check=True)
    shutil.copytree('/content/cache', CACHE, dirs_exist_ok=True)
elif not os.path.exists('/content/cache/train-meta.json'):
    shutil.copytree(CACHE, '/content/cache', dirs_exist_ok=True)
vocab = im.Vocab.load('/content/cache/vocab.json')
train_c = im.Cache.load('/content/cache/train')
valid_c = im.Cache.load('/content/cache/valid')
dave = run.load_inknotes(DAVE, vocab)
if os.path.exists(HOMEWORK):
    dave += run.load_inknotes(HOMEWORK, vocab)
print(len(vocab.toks), 'tokens;', len(train_c), 'training inks;', len(dave), 'of your inks usable')
""")
code("""
# Main training (resumes from Drive if interrupted)
log = open(os.path.join(DRIVE, 'log.txt'), 'a')
def say(s):
    print(s); log.write(s + '\\n'); log.flush()
BASE = os.path.join(DRIVE, 'base.pt')
model = run.train(run.Mixed(train_c, [], 0), vocab, BASE, hours=TRAIN_HOURS, max_frames=MAX_FRAMES,
                  eval_fn=run.valid_eval_fn(valid_c, vocab), eval_every=3000, log=say)
""")
code("""
# How well does it read your writing before seeing any of it?
model, _ = run.load_model(BASE)
em0, rep0 = run.inknotes_report(model, vocab, dave, 'Before tuning on your writing')
say(rep0.split('\\n')[0])
if any(d['kind'] == 'homework' for d in dave):
    _, rep0h = run.inknotes_report(model, vocab, dave, 'Before tuning on your writing', kind='homework')
    say(rep0h.split('\\n')[0]); rep0 += '\\n\\n' + rep0h
""")
code("""
# Honest score after tuning: tune on half of your prompts, test on the other half (and swap)
folds = run.prompt_folds(dave)
rep_f, right, total, hr, ht = [], 0, 0, 0, 0
for k, held in enumerate(folds):
    tr = [d for d in dave if d['prompt'] not in held]
    te = [d for d in dave if d['prompt'] in held and d['kind'] == 'formula']
    fm = run.finetune(BASE, train_c, tr, vocab, f'/content/fold{k}.pt', minutes=FOLD_MINUTES, max_frames=MAX_FRAMES, log=say)
    em, rep = run.inknotes_report(fm, vocab, te, f'Fold {k + 1} (formulas it never saw)')
    right += round(em * len(te)); total += len(te)
    say(rep.split('\\n')[0]); rep_f.append(rep)
    teh = [d for d in dave if d['prompt'] in held and d['kind'] == 'homework']
    if teh:
        emh, reph = run.inknotes_report(fm, vocab, teh, f'Fold {k + 1} (homework notes it never saw)', kind='homework')
        hr += round(emh * len([d for d in teh if not d['unsure']])); ht += len([d for d in teh if not d['unsure']])
        say(reph.split('\\n')[0]); rep_f.append(reph)
say(f'Tuned, on formulas it never saw: {right}/{total}')
if ht: say(f'Tuned, on homework notes it never saw: {hr}/{ht}')
""")
code("""
# Final model: tuned on all of your writing; export and download
FINAL = os.path.join(DRIVE, 'final.pt')
fm = run.finetune(BASE, train_c, dave, vocab, FINAL, minutes=FINAL_MINUTES, max_frames=MAX_FRAMES, log=say)
em1, rep1 = run.inknotes_report(fm, vocab, dave, 'Final model on all your formulas (it has seen these)')
report = '\\n\\n'.join([rep0] + rep_f + [rep1, open(os.path.join(DRIVE, 'log.txt')).read()[-20000:]])
out = '/content/inkmath-model'
run.export(FINAL, '/content/cache/vocab.json', out, report)
m0, _ = run.load_model(BASE, run.torch.device('cpu')); im.export_onnx(m0, os.path.join(out, 'inkmath-base.onnx'))
shutil.make_archive('/content/inkmath-model', 'zip', out)
shutil.copy('/content/inkmath-model.zip', DRIVE)
from google.colab import files
files.download('/content/inkmath-model.zip')
print('Done. Upload inkmath-model.zip to Claude (a copy is also in your Drive, InkNotes-training folder).')
""")


def save(cells, out, colab):
    meta = {"kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}}
    if colab:
        meta.update({"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"}})
    for c in cells:
        if isinstance(c["source"], str):
            c["source"] = [l + "\n" for l in c["source"].split("\n")]
            c["source"][-1] = c["source"][-1].rstrip("\n")
    json.dump({"cells": cells, "metadata": meta, "nbformat": 4, "nbformat_minor": 4}, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("wrote", out)


save(cells, os.path.join(here, "InkNotes_formula_training.ipynb"), True)

# ---------------------------------------------------------------- local Windows / PyCharm version
cells = []
md("""
# InkNotes formula model training (local, Windows + PyCharm)

Trains the small handwriting → LaTeX model on your laptop's NVIDIA GPU and tunes it on your own writing.
Everything is kept in an `inknotes-training` folder next to this notebook. If anything stops it, just **Run All** again
and it carries on from the last save.

**One-time setup** (in PyCharm's Terminal, with the project's Python 3.10–3.12 interpreter selected):

```
pip install torch --index-url https://download.pytorch.org/whl/cu126
pip install numpy onnx onnxscript onnxruntime jupyter
```

The first line matters: plain `pip install torch` gives a CPU-only build on Windows, which would take days.

**Then:** put `inknotes-dave.jsonl` in the same folder as this notebook, plug the laptop in, and **Run All**.

* About 15 GB of free disk is needed (2.9 GB download + about 3 GB of cache, plus checkpoints).
* Total time is about 4½ hours. The notebook keeps Windows from sleeping while it runs. Closing the lid may still sleep it.
* At the end it writes **inkmath-model.zip** into the `inknotes-training` folder. Upload that file to Claude.

Training data: Google's MathWriting (CC BY-NC-SA 4.0, fine for personal, non-commercial use).
""")
code("""
# Settings
TRAIN_HOURS = 3.0        # main training time (total, across restarts)
FOLD_MINUTES = 8         # each of the 2 honest-score fine-tunes
FINAL_MINUTES = 12       # final fine-tune on all your writing
MAX_FRAMES = 32000       # batch size (input points per batch). If you get 'CUDA out of memory', use 24000
WORKERS = 4              # CPU processes preparing batches
""")
code("""
import os, sys, subprocess, time
from pathlib import Path
HERE = Path.cwd()
WORK = HERE / 'inknotes-training'
WORK.mkdir(exist_ok=True)
os.chdir(HERE)
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import torch
print('Python', sys.version.split()[0], '| torch', torch.__version__)
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0), f'({torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB)')
else:
    print('NO GPU VISIBLE. In the Terminal run:\\n  pip uninstall -y torch\\n  pip install torch --index-url https://download.pytorch.org/whl/cu126\\nthen restart the kernel and Run All.')
for mod in ['numpy', 'onnx', 'onnxscript', 'onnxruntime']:
    try:
        __import__(mod)
    except ImportError:
        print('missing', mod, '-> run in the Terminal: pip install', mod)
if os.name == 'nt':   # keep Windows awake while the kernel is running
    import ctypes
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
    print('sleep disabled while this runs')
""")
for name, s_ in src.items():
    code(f"%%writefile {name}\n" + s_)
code("""
import importlib, shutil, json
import inkmath as im, run
importlib.reload(im); importlib.reload(run)
DAVE = HERE / 'inknotes-dave.jsonl'
if not DAVE.exists():
    DAVE = WORK / 'inknotes-dave.jsonl'
assert DAVE.exists(), 'Put inknotes-dave.jsonl next to this notebook, then run this cell again.'
HOMEWORK = HERE / 'inknotes-homework.jsonl'
print('your recordings:', sum(1 for _ in open(DAVE, encoding='utf-8')), 'inks;', 'homework lines:', sum(1 for _ in open(HOMEWORK, encoding='utf-8')) if HOMEWORK.exists() else 'none (optional: put inknotes-homework.jsonl next to this notebook)')
log_f = open(WORK / 'log.txt', 'a', encoding='utf-8')
def say(s):
    print(s); log_f.write(s + '\\n'); log_f.flush()
""")
code("""
# MathWriting download (resumes if interrupted) and one-time preparation
import urllib.request
URL = 'https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz'
TGZ = WORK / 'mathwriting-2024.tgz'
CACHE = WORK / 'cache'
if not (CACHE / 'test-meta.json').exists():
    req = urllib.request.Request(URL, method='HEAD')
    total = int(urllib.request.urlopen(req).headers['Content-Length'])
    have = TGZ.stat().st_size if TGZ.exists() else 0
    if have < total:
        req = urllib.request.Request(URL, headers={'Range': f'bytes={have}-'})
        with urllib.request.urlopen(req) as r, open(TGZ, 'ab') as f:
            t0, last = time.time(), 0
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b); have += len(b)
                if time.time() - last > 10:
                    print(f'  downloaded {have / 2**30:.2f} / {total / 2**30:.2f} GB', end='\\r'); last = time.time()
    print('\\ndownload complete; preparing (reads the archive once, ~20-40 min)...')
    # a separate process, so the memory it uses is handed back afterwards
    cmd = [sys.executable, '-u', '-c', f"import sys; sys.path.insert(0, {str(HERE)!r}); import run; run.prepare_tgz({str(TGZ)!r}, {str(CACHE)!r})"]
    p = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        print(line, end='')
    assert p.wait() == 0, 'preparation failed (see above)'
vocab = im.Vocab.load(CACHE / 'vocab.json')
train_c = im.Cache.load(str(CACHE / 'train'))
valid_c = im.Cache.load(str(CACHE / 'valid'))
dave = run.load_inknotes(DAVE, vocab)
if os.path.exists(HOMEWORK):
    dave += run.load_inknotes(HOMEWORK, vocab)
print(len(vocab.toks), 'tokens;', len(train_c), 'training inks;', len(dave), 'of your inks usable')
""")
code("""
# Main training (resumes from the last save if interrupted)
BASE = str(WORK / 'base.pt')
model = run.train(run.Mixed(train_c, [], 0), vocab, BASE, hours=TRAIN_HOURS, max_frames=MAX_FRAMES, workers=WORKERS,
                  eval_fn=run.valid_eval_fn(valid_c, vocab), eval_every=3000, log=say)
""")
code("""
# How well does it read your writing before seeing any of it?
model, _ = run.load_model(BASE)
em0, rep0 = run.inknotes_report(model, vocab, dave, 'Before tuning on your writing')
say(rep0.split('\\n')[0])
if any(d['kind'] == 'homework' for d in dave):
    _, rep0h = run.inknotes_report(model, vocab, dave, 'Before tuning on your writing', kind='homework')
    say(rep0h.split('\\n')[0]); rep0 += '\\n\\n' + rep0h
""")
code("""
# Honest score after tuning: tune on half of your prompts, test on the other half (and swap)
folds = run.prompt_folds(dave)
rep_f, right, total, hr, ht = [], 0, 0, 0, 0
for k, held in enumerate(folds):
    tr = [d for d in dave if d['prompt'] not in held]
    te = [d for d in dave if d['prompt'] in held and d['kind'] == 'formula']
    fm = run.finetune(BASE, train_c, tr, vocab, str(WORK / f'fold{k}.pt'), minutes=FOLD_MINUTES, max_frames=MAX_FRAMES, workers=WORKERS, log=say)
    em, rep = run.inknotes_report(fm, vocab, te, f'Fold {k + 1} (formulas it never saw)')
    right += round(em * len(te)); total += len(te)
    say(rep.split('\\n')[0]); rep_f.append(rep)
    teh = [d for d in dave if d['prompt'] in held and d['kind'] == 'homework']
    if teh:
        emh, reph = run.inknotes_report(fm, vocab, teh, f'Fold {k + 1} (homework notes it never saw)', kind='homework')
        hr += round(emh * len([d for d in teh if not d['unsure']])); ht += len([d for d in teh if not d['unsure']])
        say(reph.split('\\n')[0]); rep_f.append(reph)
say(f'Tuned, on formulas it never saw: {right}/{total}')
if ht: say(f'Tuned, on homework notes it never saw: {hr}/{ht}')
""")
code("""
# Final model: tuned on all of your writing; export
FINAL = str(WORK / 'final.pt')
fm = run.finetune(BASE, train_c, dave, vocab, FINAL, minutes=FINAL_MINUTES, max_frames=MAX_FRAMES, workers=WORKERS, log=say)
em1, rep1 = run.inknotes_report(fm, vocab, dave, 'Final model on all your formulas (it has seen these)')
report = '\\n\\n'.join([rep0] + rep_f + [rep1, open(WORK / 'log.txt', encoding='utf-8').read()[-20000:]])
out = WORK / 'inkmath-model'
run.export(FINAL, str(CACHE / 'vocab.json'), str(out), report)
m0, _ = run.load_model(BASE, torch.device('cpu')); im.export_onnx(m0, str(out / 'inkmath-base.onnx'))
shutil.make_archive(str(WORK / 'inkmath-model'), 'zip', out)
print('Done. Upload this file to Claude:', WORK / 'inkmath-model.zip')
""")
save(cells, os.path.join(here, "InkNotes_formula_training_local.ipynb"), False)
