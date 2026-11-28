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
print('your recordings:', sum(1 for _ in open(DAVE)), 'inks')
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
""")
code("""
# Honest score after tuning: tune on half of your prompts, test on the other half (and swap)
folds = run.prompt_folds(dave)
rep_f, right, total = [], 0, 0
for k, held in enumerate(folds):
    tr = [d for d in dave if d['prompt'] not in held]
    te = [d for d in dave if d['prompt'] in held and d['kind'] == 'formula']
    fm = run.finetune(BASE, train_c, tr, vocab, f'/content/fold{k}.pt', minutes=FOLD_MINUTES, max_frames=MAX_FRAMES, log=say)
    em, rep = run.inknotes_report(fm, vocab, te, f'Fold {k + 1} (formulas it never saw)')
    right += round(em * len(te)); total += len(te)
    say(rep.split('\\n')[0]); rep_f.append(rep)
say(f'Tuned, on formulas it never saw: {right}/{total}')
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

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                                   "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
for c in cells:
    c["source"] = [l + "\n" for l in c["source"].split("\n")]
    c["source"][-1] = c["source"][-1].rstrip("\n")
out = os.path.join(here, "InkNotes_formula_training.ipynb")
json.dump(nb, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", out)
