//! Exercises the app's JNI ops (inkmathLoad, inkmath, texCanon) on one recorded formula.
use inkcore::jni::util;
use serde_json::{json, Value};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    println!("{}", util("inkmathLoad", &json!({"onnx": a[1], "vocab": a[2]}).to_string()));
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&a[3]).unwrap()).unwrap();
    let r = &d["records"][a[4].parse::<usize>().unwrap()];
    println!("{} -> {}", r["expected"], util("inkmath", &json!({"strokes": r["strokes"]}).to_string()));
    println!("{} | {}", util("texCanon", "x^2+\\frac12"), util("texCanon", "x^{2}+\\frac{1}{2}"));
}
