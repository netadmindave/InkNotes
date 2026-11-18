//! Tidies prose while leaving formulas, code and links alone: spacing, sentence capitals, "i"→"I",
//! doubled words, common misspellings, and Hunspell spelling with a lab vocabulary + user words.

use crate::mathtext;
use regex::Regex;
use serde::Serialize;
use spellbook::Dictionary;
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

const COMMON: &[(&str, &str)] = &[
    ("teh", "the"), ("hte", "the"), ("taht", "that"), ("thier", "their"), ("recieve", "receive"), ("recieved", "received"), ("reciever", "receiver"),
    ("beleive", "believe"), ("belive", "believe"), ("definately", "definitely"), ("definatly", "definitely"), ("seperate", "separate"),
    ("seperately", "separately"), ("occured", "occurred"), ("occurence", "occurrence"), ("untill", "until"), ("wich", "which"), ("whcih", "which"),
    ("becuase", "because"), ("becasue", "because"), ("beacuse", "because"), ("adn", "and"), ("nad", "and"), ("jsut", "just"), ("wiht", "with"),
    ("waht", "what"), ("woudl", "would"), ("coudl", "could"), ("shoudl", "should"), ("dont", "don't"), ("doesnt", "doesn't"), ("didnt", "didn't"),
    ("cant", "can't"), ("wont", "won't"), ("isnt", "isn't"), ("wasnt", "wasn't"), ("arent", "aren't"), ("werent", "weren't"), ("couldnt", "couldn't"),
    ("wouldnt", "wouldn't"), ("shouldnt", "shouldn't"), ("havent", "haven't"), ("hasnt", "hasn't"), ("im", "I'm"), ("ive", "I've"), ("thats", "that's"),
    ("alot", "a lot"), ("aswell", "as well"), ("accross", "across"), ("acheive", "achieve"), ("adress", "address"), ("agian", "again"),
    ("apparant", "apparent"), ("arguement", "argument"), ("basicly", "basically"), ("begining", "beginning"), ("calender", "calendar"),
    ("comming", "coming"), ("commited", "committed"), ("concious", "conscious"), ("curent", "current"), ("enviroment", "environment"),
    ("existance", "existence"), ("experiement", "experiment"), ("experment", "experiment"), ("foward", "forward"), ("freind", "friend"),
    ("goverment", "government"), ("happend", "happened"), ("independant", "independent"), ("knowlege", "knowledge"), ("lenght", "length"),
    ("wavelenght", "wavelength"), ("mesurement", "measurement"), ("measurment", "measurement"), ("neccessary", "necessary"),
    ("necesary", "necessary"), ("noticable", "noticeable"), ("occassion", "occasion"), ("paralel", "parallel"), ("parrallel", "parallel"),
    ("posible", "possible"), ("prefered", "preferred"), ("probaly", "probably"), ("propogate", "propagate"), ("propogation", "propagation"),
    ("recomend", "recommend"), ("refered", "referred"), ("relevent", "relevant"), ("resistence", "resistance"), ("responce", "response"),
    ("succesful", "successful"), ("sucessful", "successful"), ("suprise", "surprise"), ("temperture", "temperature"), ("tempurature", "temperature"),
    ("tommorow", "tomorrow"), ("tomorow", "tomorrow"), ("truely", "truly"), ("unfortunatly", "unfortunately"), ("usualy", "usually"),
    ("wierd", "weird"), ("writting", "writing"), ("freqency", "frequency"), ("frequncy", "frequency"), ("amplitdue", "amplitude"),
    ("refractve", "refractive"), ("coeficient", "coefficient"), ("coefficent", "coefficient"), ("equasion", "equation"), ("eqution", "equation"),
    ("intergral", "integral"), ("derivitive", "derivative"), ("funtion", "function"), ("fucntion", "function"), ("vaule", "value"),
    ("calulate", "calculate"), ("calcualte", "calculate"), ("abosrption", "absorption"), ("absorbtion", "absorption"), ("dispersoin", "dispersion"),
    ("polarisation", "polarization"), ("theroy", "theory"), ("thoery", "theory"), ("resonace", "resonance"),
];

const SCIENCE: &str = "interferometer interferometry interferometric heterodyne homodyne photonic photonics photodiode photodetector \
spectroscopy spectrometer spectrograph spectrogram spectral wavelength wavelengths waveguide waveguides birefringence birefringent \
refractive thermo-optic thermooptic etalon etalons fiber fibers fibre collimator collimated collimation polarizer polarizers \
polarization polarimetry heterodyning beatnote beatnotes linewidth linewidths femtosecond picosecond nanosecond attosecond \
terahertz gigahertz megahertz kilohertz thz ghz mhz khz hz nm um mw dbm db nanometer micrometer metrology metrological \
microcomb microcombs soliton solitons supercontinuum chirped chirp dispersion dispersive nonlinear nonlinearity kerr \
fabry perot michelson zehnder sagnac fourier lorentzian gaussian bessel hermite laguerre \
eigenvalue eigenvalues eigenvector eigenvectors eigenmode eigenmodes hamiltonian lagrangian jacobian laplacian hermitian \
unitary orthonormal orthogonal integrand integrable differentiable antiderivative quasi parametric parametrize \
thermistor thermocouple tec pid piezo piezoelectric actuator actuators photolithography lithography annealing anneal \
chalcogenide germanium silica borosilicate fused sapphire yag erbium ytterbium thulium holmium \
creol ucf labview python numpy scipy matplotlib jupyter matlab gps pll vco rf daq adc dac fpga osa obr \
eikenberry lantern lanterns multimode singlemode monomode cladding modal intermodal \
sinusoid sinusoidal quadrature demodulation demodulate modulator modulators acousto-optic electro-optic aom eom vs etc eg ie approx";

fn dict() -> &'static Dictionary {
    static D: OnceLock<Dictionary> = OnceLock::new();
    D.get_or_init(|| Dictionary::new(include_str!("../dict/en_US.aff"), include_str!("../dict/en_US.dic")).expect("dictionary"))
}
fn science() -> &'static HashSet<&'static str> { static S: OnceLock<HashSet<&str>> = OnceLock::new(); S.get_or_init(|| SCIENCE.split_whitespace().collect()) }
fn common(lw: &str) -> Option<&'static str> { COMMON.iter().find(|c| c.0 == lw).map(|c| c.1) }

pub struct Speller { pub user: HashSet<String> }

impl Speller {
    pub fn new(user_words: &[String]) -> Self { Speller { user: user_words.iter().map(|w| w.to_lowercase()).collect() } }
    pub fn known(&self, w: &str) -> bool {
        let lw = w.to_lowercase();
        if science().contains(lw.as_str()) || self.user.contains(&lw) { return true; }
        let d = dict();
        if d.check(w) || d.check(&lw) { return true; }
        if let Some(b) = lw.strip_suffix("'s") { if d.check(b) || d.check(&w[..w.len() - 2]) { return true; } }
        false
    }
    fn ok(&self, c: &str) -> bool { c.len() > 1 && (science().contains(c) || self.user.contains(c) || dict().check(c)) }
    /// (transpositions, other single edits) that are real words.
    fn edits(&self, lw: &str) -> (Vec<String>, Vec<String>) {
        let w: Vec<char> = lw.chars().collect();
        let mut trans = vec![];
        let mut other = vec![];
        let s = |v: &[char]| v.iter().collect::<String>();
        for i in 0..w.len().saturating_sub(1) { let mut v = w.clone(); v.swap(i, i + 1); trans.push(s(&v)); }
        for i in 0..w.len() { let mut v = w.clone(); v.remove(i); other.push(s(&v)); }
        for i in 0..w.len() { for c in 'a'..='z' { if c != w[i] { let mut v = w.clone(); v[i] = c; other.push(s(&v)); } } }
        for i in 0..=w.len() { for c in 'a'..='z' { let mut v = w.clone(); v.insert(i, c); other.push(s(&v)); } }
        let mut seen = HashSet::new();
        let trans: Vec<String> = trans.into_iter().filter(|c| self.ok(c) && seen.insert(c.clone())).collect();
        let other: Vec<String> = other.into_iter().filter(|c| self.ok(c) && seen.insert(c.clone())).collect();
        (trans, other)
    }
    pub fn suggestions(&self, word: &str) -> Vec<String> {
        let (mut t, o) = self.edits(&word.to_lowercase());
        t.extend(o);
        if t.is_empty() { let mut v = vec![]; dict().suggest(word, &mut v); return v.into_iter().take(4).collect(); }
        t
    }
}

fn match_case(src: &str, repl: &str) -> String {
    if src.len() > 1 && src == src.to_uppercase() { return repl.to_uppercase(); }
    if src.starts_with(|c: char| c.is_uppercase()) { let mut c = repl.chars(); return c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default(); }
    repl.into()
}

macro_rules! re { ($n:ident, $p:expr) => { fn $n() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new($p).unwrap()) } }; }
re!(prot_re, r"\$[^$]+\$|`[^`]+`|https?://\S+|www\.\S+|\S+@\S+\.\S+");
re!(prefix_re, r"^(\s*(?:#{1,3}\s+|[-*•]\s+|\d+[.)]\s+|\[[ xX]\]\s*)?)");
re!(word_re, r"[A-Za-z][A-Za-z']*|[.!?]+|\S");

fn protected(line: &str, auto_math: bool) -> Vec<(usize, usize)> {
    let mut r: Vec<(usize, usize)> = prot_re().find_iter(line).map(|m| (m.start(), m.end())).collect();
    if auto_math {
        let mut gaps = vec![];
        let mut p = 0;
        let mut base = r.clone();
        base.sort();
        for &(s, e) in &base { if s > p { gaps.push((p, s)); } p = p.max(e); }
        if p < line.len() { gaps.push((p, line.len())); }
        for (gs, ge) in gaps { for (a, b) in mathtext::find_math_runs(&line[gs..ge]) { r.push((gs + a, gs + b)); } }
    }
    r.sort();
    r
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Change { pub kind: String, pub from: String, pub to: String }

#[derive(Serialize, Debug)]
pub struct Cleaned { pub text: String, pub changes: Vec<Change>, pub unknown: BTreeMap<String, Vec<String>> }

fn tidy_spacing(t: &str, first: bool, last: bool) -> String {
    re!(a, r"[ \t]{2,}"); re!(b, r"\s+([,;:!?])(\s|$)"); re!(c, r"([a-zA-Z)])\s+\.(\s|$)"); re!(d, r"([a-zA-Z)])\s+\.([A-Za-z])");
    re!(e, r"([,;])([A-Za-z])"); re!(f, r"([a-z]{2,}[.!?])([A-Z][a-z])"); re!(g, r"(\w)--(\w)");
    let mut t = a().replace_all(t, " ").into_owned();
    if first { t = t.trim_start().into(); }
    // lookahead-free equivalents: run twice so adjacent matches are caught
    for _ in 0..2 {
        t = b().replace_all(&t, "$1$2").into_owned();
        t = c().replace_all(&t, "$1.$2").into_owned();
        t = d().replace_all(&t, "$1. $2").into_owned();
        t = e().replace_all(&t, "$1 $2").into_owned();
        t = f().replace_all(&t, "$1 $2").into_owned();
    }
    t = t.replace(" -- ", " — ");
    t = g().replace_all(&t, "$1—$2").into_owned();
    if last { t = t.trim_end().into(); }
    t
}

pub fn clean_text(src: &str, sp: &Speller, auto_math: bool) -> Cleaned {
    let mut changes: Vec<Change> = vec![];
    let mut unknown = BTreeMap::new();
    let mut prev_ends = true;
    let push = |changes: &mut Vec<Change>, k: &str, f: &str, t: &str| changes.push(Change { kind: k.into(), from: f.into(), to: t.into() });
    let mut out_lines = vec![];
    for raw in src.replace('\r', "").split('\n') {
        let prefix = prefix_re().find(raw).map(|m| m.as_str()).unwrap_or("").to_string();
        let body = &raw[prefix.len()..];
        let is_item = !prefix.trim().is_empty();
        if body.trim().is_empty() { prev_ends = true; out_lines.push(prefix.trim_end().to_string()); continue; }
        let prot = protected(body, auto_math);
        let mut segs: Vec<(bool, String)> = vec![];
        let mut p = 0;
        for (s, e) in prot {
            if s < p { if e > p { segs.last_mut().unwrap().1.push_str(&body[p..e]); p = e; } continue; }
            if s > p { segs.push((false, body[p..s].into())); }
            segs.push((true, body[s..e].into()));
            p = e;
        }
        if p < body.len() { segs.push((false, body[p..].into())); }
        let mut sentence_start = is_item || prev_ends;
        let nseg = segs.len();
        for (si, seg) in segs.iter_mut().enumerate() {
            if seg.0 { sentence_start = false; continue; }
            let before = seg.1.clone();
            let t = tidy_spacing(&before, si == 0, si == nseg - 1);
            if t != before && !before.trim().is_empty() && t.trim() != before.trim() && !changes.iter().any(|c| c.kind == "spacing") {
                push(&mut changes, "spacing", "spacing", "tidied");
            }
            // words
            let mut out = String::new();
            let mut last = 0;
            let mut prev_word: Option<(String, usize)> = None; // (word, end offset in t)
            for m in word_re().find_iter(&t) {
                let tok = m.as_str();
                let gap = &t[last..m.start()];
                last = m.end();
                if tok.chars().all(|c| ".!?".contains(c)) { sentence_start = true; prev_word = None; out.push_str(gap); out.push_str(tok); continue; }
                if !tok.starts_with(|c: char| c.is_ascii_alphabetic()) {
                    if !"\"'([“‘".contains(tok) { sentence_start = false; }
                    prev_word = None; out.push_str(gap); out.push_str(tok); continue;
                }
                let next = t[m.end()..].chars().next().unwrap_or(' ');
                let prevc = t[..m.start()].chars().last().unwrap_or(' ');
                if "0123456789_^=/".contains(next) || "0123456789_^=/".contains(prevc) { sentence_start = false; prev_word = None; out.push_str(gap); out.push_str(tok); continue; }
                let mut w = tok.to_string();
                let lw = w.to_lowercase();
                if let Some((pw, _)) = &prev_word {
                    if pw.to_lowercase() == lw && !["that", "had", "is", "do", "bye", "very", "so", "no", "ha", "la"].contains(&lw.as_str()) && gap.trim().is_empty() && !gap.is_empty() {
                        push(&mut changes, "double", &format!("{} {}", pw, w), pw);
                        continue;
                    }
                }
                if lw == "i" || ["i'm", "i've", "i'll", "i'd"].contains(&lw.as_str()) {
                    let fixed = format!("I{}", &w[1..]);
                    if fixed != w { push(&mut changes, "cap", &w, &fixed); w = fixed; }
                } else if let Some(c) = common(&lw) {
                    let fixed = match_case(&w, c);
                    push(&mut changes, "spell", &w, &fixed); w = fixed;
                } else if w.len() >= 3 && w != w.to_uppercase() && !(w.starts_with(|c: char| c.is_uppercase()) && !sentence_start) && !sp.known(&w) {
                    let (trans, other) = sp.edits(&lw);
                    let mut sug = trans.clone(); sug.extend(other);
                    if sug.len() == 1 || (trans.len() == 1 && lw.len() >= 4) {
                        let fixed = match_case(&w, &sug[0]);
                        push(&mut changes, "spell", &w, &fixed); w = fixed;
                    } else {
                        unknown.insert(w.clone(), if sug.is_empty() { sp.suggestions(&w) } else { sug.into_iter().take(4).collect() });
                    }
                }
                if sentence_start && w.starts_with(|c: char| c.is_ascii_lowercase()) && (w.len() > 1 || w == "a") {
                    let fixed = w[..1].to_uppercase() + &w[1..];
                    push(&mut changes, "cap", &w, &fixed); w = fixed;
                }
                sentence_start = false;
                out.push_str(gap);
                out.push_str(&w);
                prev_word = Some((w, out.len()));
            }
            out.push_str(&t[last..]);
            seg.1 = out;
        }
        let joined: String = segs.into_iter().map(|s| s.1).collect();
        re!(sp2, r"[ \t]{2,}");
        let out = sp2().replace_all(&joined, " ").trim_end().to_string();
        re!(ends, r#"[.!?:]["')\]]?$"#);
        prev_ends = ends().is_match(&out) || is_item || prefix.trim().starts_with('#');
        out_lines.push(format!("{}{}", prefix, out));
    }
    let mut text = out_lines.join("\n");
    while text.contains("\n\n\n") { text = text.replace("\n\n\n", "\n\n"); }
    if text != src && changes.is_empty() { push(&mut changes, "spacing", "spacing", "tidied"); }
    Cleaned { text, changes, unknown }
}

/// Words that would get a wavy underline.
pub fn misspelt(src: &str, sp: &Speller, auto_math: bool) -> Vec<String> {
    let mut set = std::collections::BTreeSet::new();
    re!(w_re, r"[A-Za-z][A-Za-z']*");
    for line in src.split('\n') {
        let prot = protected(line, auto_math);
        for m in w_re().find_iter(line) {
            let w = m.as_str();
            if w.len() < 3 || w == w.to_uppercase() || prot.iter().any(|&(s, e)| m.start() >= s && m.start() < e) { continue; }
            let next = line[m.end()..].chars().next().unwrap_or(' ');
            let prevc = line[..m.start()].chars().last().unwrap_or(' ');
            if "0123456789_^=/".contains(next) || "0123456789_^=/".contains(prevc) { continue; }
            if !sp.known(w) && common(&w.to_lowercase()).is_none() { set.insert(w.to_string()); }
        }
    }
    set.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleans() {
        let sp = Speller::new(&["Tacoma".into()]);
        let r = clean_text("i think teh the  wavelenght is 1550 nm .the index x^2 + 1 = y stays", &sp, true);
        assert_eq!(r.text, "I think the wavelength is 1550 nm. The index x^2 + 1 = y stays");
        let r = clean_text("the interferometer measurment was good", &sp, true);
        assert_eq!(r.text, "The interferometer measurement was good");
        assert!(sp.known("heterodyne") && sp.known("Tacoma") && sp.known("receive"));
        assert_eq!(misspelt("this is qwzxv text", &sp, true), vec!["qwzxv"]);
    }
}
