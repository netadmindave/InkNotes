//! An open note: editing operations, the stroke being drawn, lasso selection, undo/redo.

use crate::ink::{self, erase_along, lasso_strokes, snap_shape};
use crate::model::{new_id, page_size, Item, Note, Page, Pt, Rect, Stroke};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default)]
pub struct Tool {
    pub kind: String,  // "pen" | "pencil" | "hl" | "eraser" | "lasso"
    pub color: String,
    pub size: f32,
    pub dash: String,
    pub shapes: bool,
    pub eraser_size: f32,
    pub eraser_whole: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Selection {
    pub page: usize,
    pub strokes: BTreeSet<usize>,
    pub items: BTreeSet<String>,
}

enum Live {
    None,
    Draw { page: usize, st: Stroke },
    Erase { page: usize, last: (f32, f32), changed: bool },
    Lasso { page: usize, poly: Vec<[f32; 2]> },
}

pub struct Doc {
    pub note: Note,
    pub tool: Tool,
    pub sel: Option<Selection>,
    live: Live,
    undo: Vec<String>,
    redo: Vec<String>,
    dirty: bool,
    /// per-page change counter so the UI can cache geometry
    pub versions: Vec<u64>,
}

const UNDO_DEPTH: usize = 60;

impl Doc {
    pub fn open(json: &str) -> Result<Doc, String> {
        let note = Note::parse(json)?;
        let n = note.pages.len();
        let mut d = Doc { note, tool: Tool::default(), sel: None, live: Live::None, undo: vec![], redo: vec![], dirty: false, versions: vec![1; n] };
        d.undo.push(d.snapshot());
        Ok(d)
    }

    fn snapshot(&self) -> String {
        serde_json::to_string(&(&self.note.title, &self.note.pages, &self.note.paper, &self.note.size, &self.note.recordings)).unwrap_or_default()
    }

    fn touch(&mut self, page: usize) {
        if self.versions.len() != self.note.pages.len() { self.versions.resize(self.note.pages.len(), 1); }
        if let Some(v) = self.versions.get_mut(page) { *v += 1; }
        self.dirty = true;
    }
    fn touch_all(&mut self) {
        self.versions = self.versions.iter().map(|v| v + 1).collect();
        self.versions.resize(self.note.pages.len(), 1);
        self.dirty = true;
    }

    /// Record an undo step if anything changed since the last one.
    pub fn commit(&mut self) {
        let s = self.snapshot();
        if self.undo.last() == Some(&s) { return; }
        self.undo.push(s);
        if self.undo.len() > UNDO_DEPTH { self.undo.remove(0); }
        self.redo.clear();
    }
    pub fn can_undo(&self) -> bool { self.undo.len() > 1 }
    pub fn can_redo(&self) -> bool { !self.redo.is_empty() }
    fn restore(&mut self, s: &str) {
        if let Ok((t, p, pa, sz, rec)) = serde_json::from_str(s) {
            self.note.title = t; self.note.pages = p; self.note.paper = pa; self.note.size = sz; self.note.recordings = rec;
        }
        self.sel = None;
        self.touch_all();
    }
    pub fn undo(&mut self) -> bool {
        if self.undo.len() < 2 { return false; }
        let cur = self.undo.pop().unwrap();
        self.redo.push(cur);
        let s = self.undo.last().unwrap().clone();
        self.restore(&s);
        true
    }
    pub fn redo(&mut self) -> bool {
        match self.redo.pop() {
            Some(s) => { self.restore(&s); self.undo.push(s); true }
            None => false,
        }
    }
    pub fn take_dirty(&mut self) -> bool { std::mem::replace(&mut self.dirty, false) }

    /* ---------- pages ---------- */

    pub fn add_page(&mut self, at: usize, now: i64) -> usize {
        let (w, h) = page_size(&self.note.size);
        let at = at.min(self.note.pages.len());
        self.note.pages.insert(at, Page::blank(new_id("p", now), w, h));
        self.versions.insert(at, 1);
        self.sel = None;
        self.touch_all();
        self.commit();
        at
    }
    pub fn remove_page(&mut self, page: usize) {
        if self.note.pages.len() <= 1 || page >= self.note.pages.len() { return; }
        self.note.pages.remove(page);
        self.versions.remove(page);
        self.sel = None;
        self.touch_all();
        self.commit();
    }
    pub fn move_page(&mut self, from: usize, to: usize) {
        if from >= self.note.pages.len() || to >= self.note.pages.len() || from == to { return; }
        let p = self.note.pages.remove(from);
        self.note.pages.insert(to, p);
        self.sel = None;
        self.touch_all();
        self.commit();
    }
    pub fn set_size(&mut self, size: &str) {
        self.note.size = size.into();
        let (w, h) = page_size(size);
        for p in self.note.pages.iter_mut() { if p.bg.is_none() { p.w = w; p.h = h; } }
        self.touch_all();
        self.commit();
    }

    /* ---------- live input ---------- */

    /// Pen/finger down at page coordinates. `button_erase`: S Pen side button or eraser end.
    pub fn begin(&mut self, page: usize, x: f32, y: f32, pressure: f32, button_erase: bool, rt: Option<(u32, i64)>) {
        if page >= self.note.pages.len() { return; }
        let kind = if button_erase { "eraser".to_string() } else { self.tool.kind.clone() };
        self.live = match kind.as_str() {
            "eraser" => {
                let mut l = Live::Erase { page, last: (x, y), changed: false };
                self.erase_step(&mut l, x, y);
                l
            }
            "lasso" => Live::Lasso { page, poly: vec![[x, y]] },
            _ => {
                let k = match kind.as_str() { "pencil" => "pc", "hl" => "hl", _ => "" };
                Live::Draw { page, st: Stroke { c: self.tool.color.clone(), s: self.tool.size, k: k.into(), d: self.tool.dash.clone(), g: 0,
                    p: vec![Pt { x, y, p: pressure, t: 0.0 }], rt } }
            }
        };
    }

    fn erase_step(&mut self, l: &mut Live, x: f32, y: f32) {
        if let Live::Erase { page, last, changed } = l {
            let r = self.tool.eraser_size.max(2.0);
            if erase_along(&mut self.note.pages[*page].strokes, last.0, last.1, x, y, r, self.tool.eraser_whole) {
                *changed = true;
                let p = *page;
                self.touch(p);
            }
            *last = (x, y);
        }
    }

    /// More points (x, y, pressure, t) for the live gesture.
    pub fn extend(&mut self, pts: &[[f32; 4]]) {
        let mut live = std::mem::replace(&mut self.live, Live::None);
        match &mut live {
            Live::Draw { st, .. } => {
                for q in pts {
                    let l = st.p.last().unwrap();
                    if (q[0] - l.x).hypot(q[1] - l.y) < 0.5 { continue; }
                    st.p.push(Pt { x: q[0], y: q[1], p: q[2], t: q[3] });
                }
            }
            Live::Erase { .. } => { for q in pts { self.erase_step(&mut live, q[0], q[1]); } }
            Live::Lasso { poly, .. } => { for q in pts { poly.push([q[0], q[1]]); } }
            Live::None => {}
        }
        self.live = live;
    }

    /// The stroke being drawn (for preview), possibly snapped when `held`.
    pub fn live_stroke(&self, held: bool) -> Option<Stroke> {
        if let Live::Draw { st, .. } = &self.live {
            let mut s = st.clone();
            if held { if let Some(sn) = snap_shape(&s.p, true) { s.p = sn.p; s.g = sn.g; } }
            return Some(s);
        }
        None
    }
    pub fn live_lasso(&self) -> Option<&[[f32; 2]]> {
        if let Live::Lasso { poly, .. } = &self.live { Some(poly) } else { None }
    }
    pub fn live_page(&self) -> Option<usize> {
        match &self.live { Live::Draw { page, .. } | Live::Erase { page, .. } | Live::Lasso { page, .. } => Some(*page), Live::None => None }
    }

    /// Pen up. `held`: the pen rested still at the end (snap to a shape).
    /// Returns what happened: 0 nothing, 1 stroke added, 2 erased, 3 selection made / cleared.
    pub fn end(&mut self, held: bool, item_rects: &[(String, Rect)]) -> u8 {
        match std::mem::replace(&mut self.live, Live::None) {
            Live::Draw { page, mut st } => {
                if st.p.len() == 1 { let q = st.p[0]; st.p.push(Pt { x: q.x + 0.5, y: q.y + 0.5, ..q }); }
                let snapped = if held { snap_shape(&st.p, true) } else if self.tool.shapes && st.k != "hl" { snap_shape(&st.p, false) } else { None };
                if let Some(sn) = snapped { st.p = sn.p; st.g = sn.g; }
                self.note.pages[page].strokes.push(st);
                self.sel = None;
                self.touch(page);
                self.commit();
                1
            }
            Live::Erase { page, changed, .. } => {
                if changed { self.touch(page); self.commit(); 2 } else { 0 }
            }
            Live::Lasso { page, poly } => {
                let strokes: BTreeSet<usize> = lasso_strokes(&self.note.pages[page].strokes, &poly).into_iter().collect();
                let items: BTreeSet<String> = if poly.len() > 2 {
                    item_rects.iter().filter(|(_, r)| ink::point_in_poly(r.cx(), r.cy(), &poly)).map(|(id, _)| id.clone()).collect()
                } else { BTreeSet::new() };
                self.sel = if strokes.is_empty() && items.is_empty() { None } else { Some(Selection { page, strokes, items }) };
                self.touch(page);
                3
            }
            Live::None => 0,
        }
    }
    pub fn cancel(&mut self) {
        if let Live::Erase { page, changed: true, .. } = self.live { self.touch(page); self.commit(); }
        self.live = Live::None;
    }

    /* ---------- selection ---------- */

    pub fn clear_selection(&mut self) {
        if let Some(s) = self.sel.take() { self.touch(s.page); }
    }
    pub fn selection_bounds(&self, item_rects: &[(String, Rect)]) -> Option<Rect> {
        let s = self.sel.as_ref()?;
        let pg = &self.note.pages[s.page];
        let mut r = Rect::empty();
        for &i in &s.strokes { if let Some(st) = pg.strokes.get(i) { r.union(&st.bounds()); } }
        for (id, rr) in item_rects { if s.items.contains(id) { r.union(rr); } }
        if r.is_empty() { None } else { Some(Rect { x0: r.x0 - 10.0, y0: r.y0 - 10.0, x1: r.x1 + 10.0, y1: r.y1 + 10.0 }) }
    }
    pub fn move_selection(&mut self, dx: f32, dy: f32) {
        let Some(s) = self.sel.clone() else { return };
        let pg = &mut self.note.pages[s.page];
        for &i in &s.strokes { if let Some(st) = pg.strokes.get_mut(i) { for q in st.p.iter_mut() { q.x += dx; q.y += dy; } } }
        for it in pg.items.iter_mut() { if s.items.contains(&it.id) { it.x = (it.x + dx).max(0.0); it.y = (it.y + dy).max(0.0); } }
        self.touch(s.page);
        self.commit();
    }
    pub fn delete_selection(&mut self) {
        let Some(s) = self.sel.take() else { return };
        let pg = &mut self.note.pages[s.page];
        let mut i = 0;
        pg.strokes.retain(|_| { let keep = !s.strokes.contains(&i); i += 1; keep });
        pg.items.retain(|it| !s.items.contains(&it.id));
        self.touch(s.page);
        self.commit();
    }
    pub fn smooth_selection(&mut self) {
        let Some(s) = self.sel.clone() else { return };
        for &i in &s.strokes { if let Some(st) = self.note.pages[s.page].strokes.get_mut(i) { ink::smooth(st); } }
        self.touch(s.page);
        self.commit();
    }
    pub fn recolor_selection(&mut self, color: &str) {
        let Some(s) = self.sel.clone() else { return };
        for &i in &s.strokes { if let Some(st) = self.note.pages[s.page].strokes.get_mut(i) { st.c = color.into(); } }
        self.touch(s.page);
        self.commit();
    }
    pub fn selected_strokes(&self) -> Vec<Stroke> {
        let Some(s) = &self.sel else { return vec![] };
        s.strokes.iter().filter_map(|&i| self.note.pages[s.page].strokes.get(i).cloned()).collect()
    }
    /// Remove the selected strokes (after converting them) and place new items.
    pub fn replace_selection_with(&mut self, items: Vec<Item>, keep_ink: bool) {
        let Some(s) = self.sel.take() else { return };
        let pg = &mut self.note.pages[s.page];
        if !keep_ink {
            let mut i = 0;
            pg.strokes.retain(|_| { let keep = !s.strokes.contains(&i); i += 1; keep });
        }
        pg.items.extend(items);
        self.touch(s.page);
        self.commit();
    }

    /* ---------- items ---------- */

    pub fn upsert_item(&mut self, page: usize, item: Item) {
        if page >= self.note.pages.len() { return; }
        let pg = &mut self.note.pages[page];
        match pg.items.iter_mut().find(|i| i.id == item.id) {
            Some(i) => *i = item,
            None => pg.items.push(item),
        }
        self.touch(page);
    }
    pub fn remove_item(&mut self, id: &str) {
        for p in 0..self.note.pages.len() {
            let before = self.note.pages[p].items.len();
            self.note.pages[p].items.retain(|i| i.id != id);
            if self.note.pages[p].items.len() != before { self.touch(p); }
        }
    }
    pub fn find_item(&self, id: &str) -> Option<(usize, &Item)> {
        self.note.pages.iter().enumerate().find_map(|(p, pg)| pg.items.iter().find(|i| i.id == id).map(|i| (p, i)))
    }

    /// Smooth all handwriting (used by Clean up). Returns pages changed.
    pub fn smooth_all(&mut self) -> usize {
        let mut n = 0;
        for p in 0..self.note.pages.len() {
            let mut any = false;
            for st in self.note.pages[p].strokes.iter_mut() { any |= ink::smooth(st); }
            if any { n += 1; self.touch(p); }
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc() -> Doc {
        let mut d = Doc::open(&Note::new("n".into(), 1, "lined", "letter").to_json()).unwrap();
        d.tool = Tool { kind: "pen".into(), color: "#000".into(), size: 2.5, eraser_size: 10.0, ..Default::default() };
        d
    }
    #[test]
    fn draw_erase_undo_redo() {
        let mut d = doc();
        d.begin(0, 100.0, 100.0, 0.5, false, None);
        d.extend(&(1..40).map(|i| [100.0 + i as f32 * 5.0, 100.0 + (i % 3) as f32, 0.5, i as f32]).collect::<Vec<_>>());
        assert_eq!(d.end(false, &[]), 1);
        assert_eq!(d.note.pages[0].strokes.len(), 1);
        d.begin(0, 200.0, 80.0, 0.5, true, None);
        d.extend(&[[200.0, 120.0, 0.5, 0.0]]);
        assert_eq!(d.end(false, &[]), 2);
        assert_eq!(d.note.pages[0].strokes.len(), 2, "split in two");
        assert!(d.undo());
        assert_eq!(d.note.pages[0].strokes.len(), 1);
        assert!(d.redo());
        assert_eq!(d.note.pages[0].strokes.len(), 2);
    }
    #[test]
    fn lasso_select_move_delete() {
        let mut d = doc();
        d.begin(0, 100.0, 100.0, 0.5, false, None);
        d.extend(&[[140.0, 110.0, 0.5, 0.0]]);
        d.end(false, &[]);
        d.tool.kind = "lasso".into();
        d.begin(0, 80.0, 80.0, 0.5, false, None);
        d.extend(&[[180.0, 80.0, 0.5, 0.0], [180.0, 140.0, 0.5, 0.0], [80.0, 140.0, 0.5, 0.0], [80.0, 82.0, 0.5, 0.0]]);
        let rects = vec![("t1".to_string(), Rect { x0: 100.0, y0: 90.0, x1: 160.0, y1: 120.0 }), ("t2".to_string(), Rect { x0: 400.0, y0: 400.0, x1: 500.0, y1: 420.0 })];
        assert_eq!(d.end(false, &rects), 3);
        let s = d.sel.clone().unwrap();
        assert_eq!(s.strokes.len(), 1);
        assert!(s.items.contains("t1") && !s.items.contains("t2"));
        d.move_selection(10.0, 20.0);
        assert_eq!(d.note.pages[0].strokes[0].p[0].y, 120.0);
        d.delete_selection();
        assert!(d.note.pages[0].strokes.is_empty());
    }
}
