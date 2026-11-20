//! How well would the exported personal samples have corrected misread symbols?
//! Uses leave-one-attempt-out: the samples in the export (taken at export time) vs. each recorded symbol.
use inkcore::dollarp;
use inkcore::model::Stroke;
use serde_json::Value;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&a[1]).unwrap()).unwrap();
    dollarp::load(&d["samples"].to_string());
    let tok = |s: &str| dollarp::SYMBOLS.iter().find(|x| x.1 == s || x.0 == s).map(|x| x.0.to_string()).unwrap_or(s.to_string());
    let mut rows: Vec<(String, String, String, f32, f32, f32)> = vec![];
    let (mut wrong, mut top1, mut fixed, mut broke, mut total) = (0, 0, 0, 0, 0);
    let mut rec_of: Vec<usize> = vec![];
    for (ri, r) in d["records"].as_array().unwrap().iter().enumerate() {
        if r["kind"] != "formula" { continue; }
        let strokes: Vec<Stroke> = serde_json::from_value(r["strokes"].clone()).unwrap();
        let syms = r["syms"].as_array().cloned().unwrap_or_default();
        let glyphs: Vec<String> = r["glyphs"].as_array().map(|x| x.iter().map(|g| g.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        if syms.len() != glyphs.len() { continue; }
        // pair up as the app does
        let x0 = |s: &Value| s["strokes"].as_array().unwrap().iter().map(|k| strokes[k.as_u64().unwrap() as usize].bounds().x0).fold(f32::MAX, f32::min);
        let mut idx: Vec<usize> = (0..syms.len()).collect(); idx.sort_by(|&p, &q| x0(&syms[p]).partial_cmp(&x0(&syms[q])).unwrap());
        let mut truth: Vec<String> = syms.iter().map(|s| s["ch"].as_str().unwrap().to_string()).collect();
        let mut rem = glyphs.clone(); let mut un = vec![];
        for &i in &idx { if let Some(p) = rem.iter().position(|g| *g == truth[i]) { rem.remove(p); } else { un.push(i); } }
        for (j, &i) in un.iter().enumerate() { truth[i] = rem[j].clone(); }
        for (i, s) in syms.iter().enumerate() {
            let g: Vec<&Stroke> = s["strokes"].as_array().unwrap().iter().map(|k| &strokes[k.as_u64().unwrap() as usize]).collect();
            let read = s["ch"].as_str().unwrap();
            let cls = dollarp::classify_leave_out(&g);
            let ov = dollarp::decide(&cls, read);
            total += 1;
            let is_wrong = read != truth[i];
            if is_wrong { wrong += 1; }
            let best = cls.first().map(|c| c.1.clone()).unwrap_or_default();
            if is_wrong && best == truth[i] { top1 += 1; }
            if is_wrong && ov.as_deref() == Some(truth[i].as_str()) { fixed += 1; }
            if !is_wrong && ov.is_some() { broke += 1; }
            let cur_d = cls.iter().find(|c| c.1 == read).map(|c| c.2).unwrap_or(9.0);
            rec_of.push(ri);
            rows.push((truth[i].clone(), read.to_string(), best.clone(), cls.first().map(|c| c.2).unwrap_or(9.0), cur_d,
                cls.iter().find(|c| c.1 != best).map(|c| c.2).unwrap_or(9.0)));
            if is_wrong && std::env::var("V").is_ok() {
                let top: Vec<String> = cls.iter().take(3).map(|c| format!("{}:{:.2}", c.0, c.2)).collect();
                println!("{:>6} read {:>6}  best {}  override {:?}", tok(&truth[i]), read, top.join(" "), ov);
            }
        }
    }
    // try override rules: best class differs from what was read, best distance below t, and the read class is
    // clearly worse (ratio) — count fixes and breakages
    for t in [0.8f32, 1.0, 1.1, 1.2, 1.3, 1.4] { for ratio in [1.1f32, 1.2, 1.3, 1.5] {
        let (mut fx, mut br, mut bad) = (0, 0, 0);
        for (truth, read, best, bd, cd, _sd) in &rows {
            let ov = best != read && *bd < t && *cd > ratio * *bd;
            if !ov { continue; }
            if best == truth && read != truth { fx += 1 } else if read == truth { br += 1 } else { bad += 1 }
        }
        println!("t={t} ratio={ratio}: fixes {fx}, breaks {br}, wrong-to-other-wrong {bad}");
    }}
    // personal confusions, learned from the OTHER attempts only
    println!("--- only between symbols you've had confused (learned from other attempts) ---");
    for t in [1.0f32, 1.2, 1.4, 1.6] { for ratio in [1.0f32, 1.1, 1.2] {
        let (mut fx, mut br, mut bad) = (0, 0, 0);
        for (k, (truth, read, best, bd, cd, _)) in rows.iter().enumerate() {
            let seen = rows.iter().enumerate().any(|(j, r)| rec_of[j] != rec_of[k] && r.1 == *read && r.0 == *best && r.0 != r.1);
            let ov = seen && best != read && *bd < t && *cd > ratio * *bd;
            if !ov { continue; }
            if best == truth && read != truth { fx += 1 } else if read == truth { br += 1 } else { bad += 1 }
        }
        println!("t={t} ratio={ratio}: fixes {fx}, breaks {br}, wrong-to-other-wrong {bad}");
    }}
    println!("symbols {total}, misread {wrong}, samples rank the right one first {top1}, override fixes {fixed}, override would break correct ones {broke}");
}
