//! Finds formula-looking runs inside typed/converted prose ("so x^2 + 1 = y here").

use regex::Regex;
use std::sync::OnceLock;

const GREEK: &str = "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega";
const FUNCS: &str = "sin cos tan cot sec csc sinh cosh tanh log ln exp lim det max min arg sqrt root int oint sum prod grad del abs floor ceil";

macro_rules! re { ($n:ident, $p:expr) => { fn $n() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new($p).unwrap()) } }; }
re!(op_only, r"^(=|==|\+|-|−|\*|/|\^|<|>|<=|>=|!=|~~|~=|\+-|-\+|xx|\*\*|->|=>|<=>|:=|\||·|×|±|≈|≤|≥|≠|→)$");
re!(num, r"^[-+]?(\d+([.,]\d+)?|\.\d+)([eE][-+]?\d+)?%?$");
re!(func, r"^(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|log|ln|exp|lim|det|max|min|arg|sqrt|root|int|oint|sum|prod|grad|del|abs|floor|ceil)([^a-z]|$)");
re!(ratio, r"^[A-Za-z]{1,2}\d{0,2}/[A-Za-z]{1,2}\d{0,2}$");
re!(numratio, r"^\d+(\.\d+)?/\d+(\.\d+)?$");
re!(simple_expr, r"^[A-Za-z]?\(?[A-Za-z0-9+\-*/^_.,]+\)?$");
re!(fx, r"^[A-Za-z]\(\w{1,3}\)$");
re!(degn, r"^\d+(\.\d+)?deg$");
re!(dvar, r"^d[A-Za-z]$|^d(theta|phi|tau|omega|lambda|nu)$");
re!(scripty, r"^[\w^_=<>+\-*/().,|{}\[\]~!:]+$");
re!(strong_rel, r"=|<=|>=|!=|~~|≈|≤|≥|≠|±|\+-");
re!(strong_fn, r"^(sqrt|root|int|sum|prod|lim)(\(|_|\^)");
re!(strong_paren, r"^\w*\(.*[+*/^].*\)\w*$");
re!(single_ok, r"[\^_=]|\ddeg$|^(sqrt|root|int|sum)\(|^[A-Za-z]{1,2}\d{0,2}/[A-Za-z]|\)/\(|\)/\w|\w/\(");
re!(lead_re, r#"^["'“‘]+"#);
re!(trail_re, r#"[.,;:!?"'”’]+$"#);

struct Core { lead: String, tok: String, trail: String }

fn core(tok: &str) -> Core {
    let mut tok = tok.to_string();
    let mut lead = String::new();
    let mut trail = String::new();
    if let Some(m) = lead_re().find(&tok) { lead = m.as_str().into(); tok = tok[m.end()..].into(); }
    let ends_num_dot = tok.ends_with('.') && tok[..tok.len() - 1].chars().all(|c| c.is_ascii_digit()) && tok.len() > 1;
    if let Some(m) = trail_re().find(&tok) { if !ends_num_dot { trail = m.as_str().into(); tok = tok[..m.start()].into(); } }
    let opens = tok.matches('(').count();
    let closes = tok.matches(')').count();
    if closes > opens && tok.ends_with(')') { trail = format!("){}", trail); tok.pop(); }
    if opens > closes && tok.starts_with('(') { lead.push('('); tok.remove(0); }
    Core { lead, tok, trail }
}

fn mathy(t: &str) -> bool {
    if t.is_empty() || t.contains("://") || t.contains('@') || t.contains("www.") { return false; }
    if op_only().is_match(t) || num().is_match(t) { return true; }
    if t.len() == 1 && t.chars().all(|c| c.is_ascii_alphabetic()) { return true; }
    if GREEK.split(' ').any(|g| g == t) { return true; }
    if func().is_match(t) && t.starts_with(|c: char| c.is_ascii_lowercase()) {
        return t.contains(['(', '_', '^']) || FUNCS.split(' ').any(|f| f == t);
    }
    if t.contains(['^', '_', '=', '<', '>']) && scripty().is_match(t) { return true; }
    if ratio().is_match(t) || numratio().is_match(t) { return true; }
    if simple_expr().is_match(t) && t.contains(['+', '*', '/', '^', '_']) && t.chars().any(|c| c.is_ascii_alphanumeric()) { return true; }
    if fx().is_match(t) || degn().is_match(t) || dvar().is_match(t) { return true; }
    if t.chars().count() <= 48 && t.chars().all(|c| c.is_alphanumeric() || "_+-*/^.,()".contains(c)) && t.chars().any(|c| c.is_ascii_alphanumeric()) {
        if let (Some(a), Some(b)) = (t.find('('), t.rfind(')')) {
            if a < b && t[a..b].contains(['+', '-', '*', '/', '^']) {
                let mut d = 0i32;
                for ch in t.chars() { if ch == '(' { d += 1; } else if ch == ')' { d -= 1; if d < 0 { return false; } } }
                if d == 0 { return true; }
            }
        }
    }
    false
}

fn strong(t: &str) -> bool {
    if t.contains("://") || t.contains('@') { return false; }
    t.contains(['^', '_']) || strong_rel().is_match(t) || strong_fn().is_match(t) || ratio().is_match(t) || strong_paren().is_match(t)
        || t == "xx" || t == "×" || t == "+" || degn().is_match(t)
}

/// Byte ranges of formula-looking runs in a line of prose.
pub fn find_math_runs(line: &str) -> Vec<(usize, usize)> {
    let mut toks: Vec<(usize, usize)> = vec![];
    let mut start: Option<usize> = None;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() { if let Some(s) = start.take() { toks.push((s, i)); } } else if start.is_none() { start = Some(i); }
    }
    if let Some(s) = start { toks.push((s, line.len())); }
    let raw = |k: usize| &line[toks[k].0..toks[k].1];
    let mut runs = vec![];
    let mut i = 0;
    while i < toks.len() {
        if !mathy(&core(raw(i)).tok) { i += 1; continue; }
        let mut j = i;
        let (mut has_strong, mut has_ln) = (false, false);
        let mut first_tok = String::new();
        while j < toks.len() {
            let c = core(raw(j));
            if !mathy(&c.tok) || (j > i && !c.lead.is_empty()) { break; }
            if j == i { first_tok = c.tok.clone(); }
            if strong(&c.tok) { has_strong = true; }
            if !op_only().is_match(&c.tok) { has_ln = true; }
            j += 1;
            if c.trail.contains(['.', ',', ';', ':', '!', '?', ')']) { break; }
        }
        let mut ok = has_strong && has_ln;
        if j - i == 1 { ok = ok && single_ok().is_match(&first_tok); }
        if ok {
            let (mut s, mut e) = (i, j - 1);
            while s <= e { let t = core(raw(s)).tok; if op_only().is_match(&t) && t != "-" && t != "−" && t != "+" { s += 1; } else { break; } }
            while e >= s && op_only().is_match(&core(raw(e)).tok) { if e == 0 { break; } e -= 1; }
            if e >= s && !op_only().is_match(&core(raw(e)).tok) {
                let f = core(raw(s));
                let l = core(raw(e));
                runs.push((toks[s].0 + f.lead.len(), toks[e].1 - l.trail.len()));
            }
        }
        i = if j > i { j } else { i + 1 };
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;
    fn spans(s: &str) -> Vec<&str> { find_math_runs(s).into_iter().map(|(a, b)| &s[a..b]).collect() }
    #[test]
    fn finds() {
        assert_eq!(spans("so x^2 + 1 = y here."), vec!["x^2 + 1 = y"]);
        assert_eq!(spans("the slope dn/dT is small"), vec!["dn/dT"]);
        assert_eq!(spans("I have a cat and 3 dogs."), Vec::<&str>::new());
        assert_eq!(spans("see https://x.com/a^b now"), Vec::<&str>::new());
        assert_eq!(spans("we get (a+b)/(c-d), then stop"), vec!["(a+b)/(c-d)"]);
        assert_eq!(spans("angle of 90deg ok"), vec!["90deg"]);
    }
}
