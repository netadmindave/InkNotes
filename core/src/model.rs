//! Note / page / stroke / item model. The JSON layout matches InkNotes 1.x, so notes move across as-is.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// A sampled pen point: x, y (page px), pressure (0..1), t (ms since stroke start).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Pt {
    pub x: f32,
    pub y: f32,
    pub p: f32,
    pub t: f32,
}

impl Pt {
    pub fn new(x: f32, y: f32) -> Self {
        Pt { x, y, p: 0.5, t: 0.0 }
    }
}

impl Serialize for Pt {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let r = |v: f32, k: f32| (v * k).round() / k;
        [r(self.x, 10.0), r(self.y, 10.0), r(self.p, 1000.0), self.t.round()].serialize(s)
    }
}

impl<'de> Deserialize<'de> for Pt {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v: Vec<f32> = Vec::deserialize(d)?;
        Ok(Pt {
            x: *v.first().unwrap_or(&0.0),
            y: *v.get(1).unwrap_or(&0.0),
            p: *v.get(2).unwrap_or(&0.5),
            t: *v.get(3).unwrap_or(&0.0),
        })
    }
}

/// One ink stroke.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Stroke {
    /// colour, CSS hex (#rrggbb)
    pub c: String,
    /// nominal line width (page px)
    pub s: f32,
    /// kind: "" pen, "pc" pencil, "hl" highlighter
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub k: String,
    /// line style: "" solid, "dash", "dot"
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub d: String,
    /// geometry: 0 freehand, 1 open shape (straight segments), 2 closed shape
    #[serde(default, skip_serializing_if = "is_zero")]
    pub g: u8,
    pub p: Vec<Pt>,
    /// voice-recording sync: (recording index, ms into the recording when the stroke was written)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rt: Option<(u32, i64)>,
}

fn is_zero(v: &u8) -> bool {
    *v == 0
}

impl Stroke {
    pub fn bounds(&self) -> Rect {
        Rect::of_points(self.p.iter().map(|q| (q.x, q.y)))
    }
}

/// Things placed on a page: typed/converted text, formulas, pictures, tables.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // "text" | "math" | "image" | "table"
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub w: f32,
    #[serde(default, skip_serializing_if = "is_fzero")]
    pub h: f32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub src: String,
    /// image file name (inside the app's media folder)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub file: String,
    /// table cells, row-major
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<Vec<String>>,
    /// table column widths (page px)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cols: Vec<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rt: Option<(u32, i64)>,
}

fn is_fzero(v: &f32) -> bool {
    *v == 0.0
}

impl Item {
    pub fn new(kind: &str, id: String, x: f32, y: f32, w: f32) -> Self {
        Item { id, kind: kind.into(), x, y, w, h: 0.0, src: String::new(), file: String::new(), cells: vec![], cols: vec![], rt: None }
    }
}

/// A page from an imported PDF shown underneath the ink.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PageBg {
    pub pdf: String,
    pub page: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub w: f32,
    #[serde(default)]
    pub h: f32,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<PageBg>,
    /// paper style override for this page (PDF pages use "plain")
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub paper: String,
}

impl Page {
    pub fn blank(id: String, w: f32, h: f32) -> Self {
        Page { id, w, h, strokes: vec![], items: vec![], bg: None, paper: String::new() }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Recording {
    pub file: String,
    /// length in ms
    #[serde(default)]
    pub ms: i64,
    #[serde(default)]
    pub created: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub updated: i64,
    #[serde(default = "default_paper")]
    pub paper: String,
    #[serde(default = "default_size")]
    pub size: String,
    #[serde(default)]
    pub pages: Vec<Page>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recordings: Vec<Recording>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// InkNotes 1.0–1.0.8 stored a stack of blocks instead of pages
    #[serde(default, skip_serializing)]
    pub blocks: Option<Vec<Value>>,
}

fn default_paper() -> String {
    "lined".into()
}
fn default_size() -> String {
    "letter".into()
}

/// Page sizes in CSS px at 96 dpi.
pub fn page_size(size: &str) -> (f32, f32) {
    match size {
        "a4" => (794.0, 1123.0),
        _ => (816.0, 1056.0),
    }
}
pub const MARGIN_L: f32 = 96.0;
pub const MARGIN_R: f32 = 56.0;
pub const MARGIN_B: f32 = 56.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

impl Rect {
    pub fn empty() -> Self {
        Rect { x0: f32::MAX, y0: f32::MAX, x1: f32::MIN, y1: f32::MIN }
    }
    pub fn of_points(it: impl Iterator<Item = (f32, f32)>) -> Self {
        let mut r = Rect::empty();
        for (x, y) in it {
            r.add(x, y);
        }
        r
    }
    pub fn add(&mut self, x: f32, y: f32) {
        self.x0 = self.x0.min(x);
        self.y0 = self.y0.min(y);
        self.x1 = self.x1.max(x);
        self.y1 = self.y1.max(y);
    }
    pub fn union(&mut self, o: &Rect) {
        if o.is_empty() {
            return;
        }
        self.add(o.x0, o.y0);
        self.add(o.x1, o.y1);
    }
    pub fn is_empty(&self) -> bool {
        self.x0 > self.x1
    }
    pub fn w(&self) -> f32 {
        self.x1 - self.x0
    }
    pub fn h(&self) -> f32 {
        self.y1 - self.y0
    }
    pub fn cx(&self) -> f32 {
        (self.x0 + self.x1) / 2.0
    }
    pub fn cy(&self) -> f32 {
        (self.y0 + self.y1) / 2.0
    }
    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x0 && x <= self.x1 && y >= self.y0 && y <= self.y1
    }
}

static mut COUNTER: u64 = 0;
/// Short unique id (time + counter) — callers pass the clock in so the core stays deterministic in tests.
pub fn new_id(prefix: &str, now_ms: i64) -> String {
    // SAFETY: ids are only generated on the UI thread; a race would at worst repeat a counter value
    let c = unsafe {
        COUNTER = COUNTER.wrapping_add(1);
        COUNTER
    };
    format!("{}{:x}{:x}", prefix, now_ms, c)
}

impl Note {
    pub fn parse(json: &str) -> Result<Note, String> {
        let mut n: Note = serde_json::from_str(json).map_err(|e| e.to_string())?;
        n.migrate();
        Ok(n)
    }

    pub fn new(id: String, now_ms: i64, paper: &str, size: &str) -> Note {
        let (w, h) = page_size(size);
        Note {
            id,
            title: String::new(),
            created: now_ms,
            updated: now_ms,
            paper: paper.into(),
            size: size.into(),
            pages: vec![Page::blank(new_id("p", now_ms), w, h)],
            recordings: vec![],
            tags: vec![],
            pinned: false,
            blocks: None,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }

    /// Lay out InkNotes 1.0–1.0.8 block notes onto pages (same rules as the 1.0.9 migration).
    pub fn migrate(&mut self) {
        let (w, h) = page_size(&self.size);
        if let Some(blocks) = self.blocks.take() {
            if self.pages.is_empty() {
                let l = 32.0;
                let top = 2.0 * l;
                let cw = w - MARGIN_L - MARGIN_R;
                let bottom = h - MARGIN_B;
                let mut pages = vec![Page::blank(new_id("p", self.updated), w, h)];
                let mut y = top + 3.0 * l;
                for b in blocks {
                    let kind = b.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    if kind == "break" {
                        pages.push(Page::blank(new_id("p", self.updated), w, h));
                        y = top;
                        continue;
                    }
                    let src = b.get("src").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let bw = b.get("w").and_then(|v| v.as_f64()).unwrap_or(cw as f64) as f32;
                    let bh = b.get("h").and_then(|v| v.as_f64()).unwrap_or(200.0) as f32;
                    let hh = match kind {
                        "text" => src.split('\n').map(|l| ((l.chars().count() as f32) / 60.0).ceil().max(1.0)).sum::<f32>() * l,
                        "math" => 3.0 * l,
                        _ => bh * cw / bw.max(1.0),
                    };
                    if y + hh > bottom && y > top + 10.0 {
                        pages.push(Page::blank(new_id("p", self.updated), w, h));
                        y = top;
                    }
                    let pg = pages.last_mut().unwrap();
                    if kind == "ink" {
                        let k = cw / bw.max(1.0);
                        if let Some(Value::Array(sts)) = b.get("strokes") {
                            for sv in sts {
                                if let Ok(mut st) = serde_json::from_value::<Stroke>(sv.clone()) {
                                    st.s *= k;
                                    for q in st.p.iter_mut() {
                                        q.x = MARGIN_L + q.x * k;
                                        q.y = y + q.y * k;
                                    }
                                    pg.strokes.push(st);
                                }
                            }
                        }
                    } else if kind == "text" || kind == "math" {
                        let id = b.get("id").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| new_id("b", self.updated));
                        let mut it = Item::new(kind, id, MARGIN_L, y, cw);
                        it.src = src;
                        pg.items.push(it);
                    }
                    y += (hh / l).ceil() * l;
                }
                self.pages = pages;
            }
        }
        if self.pages.is_empty() {
            self.pages.push(Page::blank(new_id("p", self.updated), w, h));
        }
        for p in self.pages.iter_mut() {
            if p.w <= 0.0 || (p.bg.is_none() && (p.w, p.h) != (w, h)) {
                p.w = w;
                p.h = h;
            }
        }
    }

    pub fn preview(&self) -> String {
        let mut items: Vec<&Item> = self.pages.iter().flat_map(|p| p.items.iter()).collect();
        items.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
        let t: String = items.iter().filter(|i| i.kind == "text" || i.kind == "math").map(|i| i.src.as_str()).collect::<Vec<_>>().join(" ");
        t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v19_note_and_roundtrips() {
        let j = r##"{"id":"n1","title":"T","updated":5,"paper":"lined","size":"letter","pages":[{"id":"p1","w":816,"h":1056,
            "strokes":[{"c":"#000","s":2.5,"p":[[1,2,0.5,0],[3,4]]},{"c":"#111","s":2,"g":2,"d":"dash","p":[[0,0,0.5,0],[5,5,0.5,0]]}],
            "items":[{"id":"a","type":"text","x":96,"y":128,"w":664,"src":"hi"}]}]}"##;
        let n = Note::parse(j).unwrap();
        assert_eq!(n.pages[0].strokes.len(), 2);
        assert_eq!(n.pages[0].strokes[0].p[1].p, 0.5);
        assert_eq!(n.pages[0].strokes[1].g, 2);
        let back = Note::parse(&n.to_json()).unwrap();
        assert_eq!(back.pages, n.pages);
    }

    #[test]
    fn migrates_blocks() {
        let j = r##"{"id":"old","title":"Old","updated":1,"size":"letter","blocks":[
            {"id":"b1","type":"text","src":"Line one\nLine two"},
            {"id":"b2","type":"ink","w":900,"h":200,"strokes":[{"c":"#000","s":4,"p":[[10,10,0.5,0],[300,80,0.5,10]]}]},
            {"id":"b3","type":"math","src":"x^2"},{"id":"b4","type":"break"},{"id":"b5","type":"text","src":"page two"}]}"##;
        let n = Note::parse(j).unwrap();
        assert_eq!(n.pages.len(), 2);
        let p0 = &n.pages[0];
        assert_eq!(p0.items.iter().map(|i| (i.kind.as_str(), i.y)).collect::<Vec<_>>(), vec![("text", 160.0), ("math", 384.0)]);
        assert!((p0.strokes[0].p[0].x - 103.4).abs() < 0.1 && (p0.strokes[0].p[0].y - 231.4).abs() < 0.2);
        assert_eq!(n.pages[1].items[0].y, 64.0);
    }
}
