use serde_json::json;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let doc = sdocx::parse(&a[1]).expect("parse");
    let mut pages = vec![];
    for p in &doc.pages {
        let strokes: Vec<_> = p.strokes().map(|s| json!({
            "p": s.points.iter().map(|q| [q.x, q.y]).collect::<Vec<_>>(),
            "t": s.timestamps.first().copied(),
        })).collect();
        pages.push(json!({"w": p.width, "h": p.height, "strokes": strokes}));
    }
    println!("{}", json!({"pages": pages, "created": doc.metadata.created_ms}));
}
