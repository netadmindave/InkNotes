# InkMath training

Small ink → LaTeX model (≈7M parameters, CTC Transformer over pen points) for InkNotes formulas.

- `inkmath.py` – preprocessing, LaTeX tokens, model, data cache. Preprocessing is mirrored in `core/src/inkmath.rs`.
- `run.py` – prepare MathWriting, train (time-budgeted, resumable), evaluate on InkNotes recordings, fine-tune, export ONNX.
- `make_notebook.py` – builds `InkNotes_formula_training.ipynb` (Colab) and `InkNotes_formula_training_local.ipynb` (Windows + PyCharm, local folder); both embed the two files.

Fine-tune data from InkNotes exports: `SKIP=70,71 cargo run --release --example finetune -- inknotes-dave.jsonl export.json`
Score a trained model through the on-device code: `cargo run --release --example inkmath_eval -- inkmath.onnx vocab.json export.json 70,71`
Python/Rust parity: `cargo run --release --example inkmath_parity -- inkmath.onnx parity.json vocab.json`

Training data: MathWriting (Google, CC BY-NC-SA 4.0).

## Homework (Samsung Notes) data
`homework/sdocx_dump.rs` (uses the `sdocx` crate; older notes need `sdocx = "=0.5.0"`) dumps strokes from .sdocx files;
`core/examples/sdlines.rs` splits pages into lines with the app's splitter; `homework/seg2.py` renders lines and runs the model;
labels were typed from the line images; `homework/strip.py` removes grader check marks. Output: `inknotes-homework.jsonl`
(kind "homework", prompt = note name, so the honest-score folds hold out whole notes).
