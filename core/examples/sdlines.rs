//! Splits Samsung Notes pages (strokes as [[x,y],..] from the sdocx dump) into lines with the app's own line splitter.
//! stdin: {"pages":[{"strokes":[{"p":[[x,y],..],"t":..}]}]}  stdout: per page, list of stroke-index groups
use inkcore::model::{Pt, Stroke};
use serde_json::Value;
fn main() {
    let d: Value = serde_json::from_reader(std::io::stdin()).unwrap();
    let mut out = vec![];
    for p in d["pages"].as_array().unwrap() {
        let ss: Vec<Stroke> = p["strokes"].as_array().unwrap().iter().map(|s| {
            let pts: Vec<Pt> = s["p"].as_array().unwrap().iter().map(|q| Pt::new(q[0].as_f64().unwrap() as f32, q[1].as_f64().unwrap() as f32)).collect();
            let mut st: Stroke = serde_json::from_value(serde_json::json!({"c": "#000000", "s": 2.0, "p": []})).unwrap();
            st.p = pts; st
        }).collect();
        let keep: Vec<usize> = (0..ss.len()).filter(|&i| !ss[i].p.is_empty()).collect();
        let sub: Vec<Stroke> = keep.iter().map(|&i| ss[i].clone()).collect();
        let lines = inkcore::recognize::split_lines(&sub);
        out.push(lines.into_iter().map(|l| l.into_iter().map(|k| keep[k]).collect::<Vec<_>>()).collect::<Vec<_>>());
    }
    println!("{}", serde_json::to_string(&out).unwrap());
}
