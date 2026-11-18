//! AsciiMath → LaTeX (for native math rendering). Covers the AsciiMath symbol set used in notes:
//! Greek, operators, relations, arrows, functions, sqrt/root/frac, sub/superscripts, accents,
//! abs/norm/floor/ceil, text, matrices and brackets.

#[derive(Clone, Copy, PartialEq, Debug)]
enum K { Const, Unary, Binary, Left, Right, Func, Text }

fn sym(t: &str) -> Option<(&'static str, K)> {
    use K::*;
    Some(match t {
        // greek
        "alpha" => ("\\alpha", Const), "beta" => ("\\beta", Const), "gamma" => ("\\gamma", Const), "Gamma" => ("\\Gamma", Const),
        "delta" => ("\\delta", Const), "Delta" => ("\\Delta", Const), "epsilon" => ("\\epsilon", Const), "varepsilon" => ("\\varepsilon", Const),
        "zeta" => ("\\zeta", Const), "eta" => ("\\eta", Const), "theta" => ("\\theta", Const), "Theta" => ("\\Theta", Const), "vartheta" => ("\\vartheta", Const),
        "iota" => ("\\iota", Const), "kappa" => ("\\kappa", Const), "lambda" => ("\\lambda", Const), "Lambda" => ("\\Lambda", Const),
        "mu" => ("\\mu", Const), "nu" => ("\\nu", Const), "xi" => ("\\xi", Const), "Xi" => ("\\Xi", Const), "pi" => ("\\pi", Const), "Pi" => ("\\Pi", Const),
        "rho" => ("\\rho", Const), "sigma" => ("\\sigma", Const), "Sigma" => ("\\Sigma", Const), "tau" => ("\\tau", Const), "upsilon" => ("\\upsilon", Const),
        "phi" => ("\\phi", Const), "Phi" => ("\\Phi", Const), "varphi" => ("\\varphi", Const), "chi" => ("\\chi", Const), "psi" => ("\\psi", Const),
        "Psi" => ("\\Psi", Const), "omega" => ("\\omega", Const), "Omega" => ("\\Omega", Const),
        // operators
        "+" => ("+", Const), "-" => ("-", Const), "*" => ("\\cdot", Const), "cdot" => ("\\cdot", Const), "**" => ("\\ast", Const), "***" => ("\\star", Const),
        "//" => ("/", Const), "\\\\" => ("\\backslash", Const), "xx" => ("\\times", Const), "-:" => ("\\div", Const), "@" => ("\\circ", Const),
        "o+" => ("\\oplus", Const), "ox" => ("\\otimes", Const), "o." => ("\\odot", Const), "sum" => ("\\sum", Const), "prod" => ("\\prod", Const),
        "^^" => ("\\wedge", Const), "vv" => ("\\vee", Const), "nn" => ("\\cap", Const), "uu" => ("\\cup", Const),
        "int" => ("\\int", Const), "oint" => ("\\oint", Const), "iint" => ("\\iint", Const), "del" => ("\\partial", Const), "grad" => ("\\nabla", Const),
        "+-" => ("\\pm", Const), "-+" => ("\\mp", Const), "O/" => ("\\emptyset", Const), "oo" => ("\\infty", Const), "aleph" => ("\\aleph", Const),
        ":." => ("\\therefore", Const), "..." => ("\\ldots", Const), "cdots" => ("\\cdots", Const), "vdots" => ("\\vdots", Const), "ddots" => ("\\ddots", Const),
        "hbar" => ("\\hbar", Const), "ell" => ("\\ell", Const), "deg" => ("^{\\circ}", Const),
        "CC" => ("\\mathbb{C}", Const), "NN" => ("\\mathbb{N}", Const), "QQ" => ("\\mathbb{Q}", Const), "RR" => ("\\mathbb{R}", Const), "ZZ" => ("\\mathbb{Z}", Const),
        // relations
        "=" => ("=", Const), "!=" => ("\\neq", Const), "<" => ("<", Const), ">" => (">", Const), "<=" => ("\\le", Const), ">=" => ("\\ge", Const),
        "-<" => ("\\prec", Const), ">-" => ("\\succ", Const), "in" => ("\\in", Const), "!in" => ("\\notin", Const), "sub" => ("\\subset", Const),
        "sup" => ("\\supset", Const), "sube" => ("\\subseteq", Const), "supe" => ("\\supseteq", Const), "-=" => ("\\equiv", Const),
        "~=" => ("\\cong", Const), "~~" => ("\\approx", Const), "prop" => ("\\propto", Const), "<<" => ("\\ll", Const), ">>" => ("\\gg", Const),
        // logic & arrows
        "not" => ("\\neg", Const), "=>" => ("\\Rightarrow", Const), "<=>" => ("\\Leftrightarrow", Const), "AA" => ("\\forall", Const), "EE" => ("\\exists", Const),
        "uarr" => ("\\uparrow", Const), "darr" => ("\\downarrow", Const), "rarr" => ("\\rightarrow", Const), "->" => ("\\to", Const), "|->" => ("\\mapsto", Const),
        "larr" => ("\\leftarrow", Const), "<-" => ("\\leftarrow", Const), "harr" => ("\\leftrightarrow", Const), "rArr" => ("\\Rightarrow", Const),
        "lArr" => ("\\Leftarrow", Const), "hArr" => ("\\Leftrightarrow", Const),
        // functions
        "sin" => ("\\sin", Func), "cos" => ("\\cos", Func), "tan" => ("\\tan", Func), "sec" => ("\\sec", Func), "csc" => ("\\csc", Func), "cot" => ("\\cot", Func),
        "arcsin" => ("\\arcsin", Func), "arccos" => ("\\arccos", Func), "arctan" => ("\\arctan", Func),
        "sinh" => ("\\sinh", Func), "cosh" => ("\\cosh", Func), "tanh" => ("\\tanh", Func), "log" => ("\\log", Func), "ln" => ("\\ln", Func),
        "exp" => ("\\exp", Func), "det" => ("\\det", Func), "dim" => ("\\dim", Func), "lim" => ("\\lim", Func), "max" => ("\\max", Func),
        "min" => ("\\min", Func), "gcd" => ("\\gcd", Func), "arg" => ("\\arg", Func), "mod" => ("\\bmod", Func),
        // unary / binary
        "sqrt" => ("\\sqrt", Unary), "hat" => ("\\hat", Unary), "bar" => ("\\overline", Unary), "vec" => ("\\vec", Unary), "dot" => ("\\dot", Unary),
        "ddot" => ("\\ddot", Unary), "ul" => ("\\underline", Unary), "tilde" => ("\\tilde", Unary), "abs" => ("|", Unary), "norm" => ("\\|", Unary),
        "floor" => ("floor", Unary), "ceil" => ("ceil", Unary), "text" => ("\\text", Text), "bb" => ("\\mathbf", Unary), "cc" => ("\\mathcal", Unary),
        "tt" => ("\\mathtt", Unary), "sf" => ("\\mathsf", Unary), "fr" => ("\\mathfrak", Unary),
        "frac" => ("\\frac", Binary), "root" => ("\\sqrt", Binary), "stackrel" => ("\\stackrel", Binary), "overset" => ("\\overset", Binary), "underset" => ("\\underset", Binary),
        // brackets
        "(" => ("(", Left), ")" => (")", Right), "[" => ("[", Left), "]" => ("]", Right), "{" => ("\\{", Left), "}" => ("\\}", Right),
        "(:" => ("\\langle", Left), ":)" => ("\\rangle", Right), "{:" => (".", Left), ":}" => (".", Right),
        _ => return None,
    })
}

const NAMES: &[&str] = &[
    "varepsilon", "vartheta", "upsilon", "epsilon", "lambda", "Lambda", "stackrel", "overset", "underset", "arcsin", "arccos", "arctan",
    "omega", "Omega", "alpha", "gamma", "Gamma", "delta", "Delta", "theta", "Theta", "kappa", "sigma", "Sigma", "varphi", "aleph", "cdots",
    "vdots", "ddots", "beta", "zeta", "iota", "tilde", "sqrt", "root", "frac", "text", "norm", "floor", "ceil", "oint", "iint", "prop",
    "sinh", "cosh", "tanh", "uarr", "darr", "rarr", "larr", "harr", "rArr", "lArr", "hArr", "sube", "supe", "ddot", "hbar", "cdot",
    "prod", "grad", "eta", "chi", "psi", "Psi", "phi", "Phi", "rho", "tau", "sum", "int", "del", "hat", "bar", "vec", "dot", "abs", "sin",
    "cos", "tan", "sec", "csc", "cot", "log", "exp", "det", "dim", "lim", "max", "min", "gcd", "arg", "mod", "not", "sub", "sup", "deg",
    "ell", "Xi", "xi", "Pi", "pi", "mu", "nu", "ln", "in", "xx", "oo", "ul", "bb", "cc", "tt", "sf", "fr", "nn", "uu", "vv", "AA", "EE",
    "CC", "NN", "QQ", "RR", "ZZ",
];
const SYMS: &[&str] = &[
    "<=>", "|->", "***", "...", "**", "//", "\\\\", "-:", "o+", "ox", "o.", "^^", "+-", "-+", "O/", ":.", "!=", "<=", ">=", "-<", ">-",
    "!in", "-=", "~=", "~~", "<<", ">>", "=>", "->", "<-", "(:", ":)", "{:", ":}",
];

#[derive(Debug, PartialEq, Clone)]
enum Tok { Num(String), Sym(String), Var(char), Text(String), Ws }

fn tokenize(s: &str) -> Vec<Tok> {
    let cs: Vec<char> = s.chars().collect();
    let mut out = vec![];
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() { out.push(Tok::Ws); i += 1; continue; }
        if c == '"' {
            let j = cs[i + 1..].iter().position(|&x| x == '"').map(|p| i + 1 + p).unwrap_or(cs.len());
            out.push(Tok::Text(cs[i + 1..j].iter().collect()));
            i = (j + 1).min(cs.len());
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && cs.get(i + 1).map(|d| d.is_ascii_digit()).unwrap_or(false)) {
            let mut j = i;
            while j < cs.len() && (cs[j].is_ascii_digit() || (cs[j] == '.' && cs.get(j + 1).map(|d| d.is_ascii_digit()).unwrap_or(false))) { j += 1; }
            out.push(Tok::Num(cs[i..j].iter().collect()));
            i = j;
            continue;
        }
        let rest: String = cs[i..].iter().collect();
        if c.is_ascii_alphabetic() {
            if let Some(n) = NAMES.iter().filter(|n| rest.starts_with(*n)).max_by_key(|n| n.len()) {
                out.push(Tok::Sym(n.to_string()));
                i += n.chars().count();
                continue;
            }
            out.push(Tok::Var(c));
            i += 1;
            continue;
        }
        if let Some(n) = SYMS.iter().filter(|n| rest.starts_with(*n)).max_by_key(|n| n.len()) {
            out.push(Tok::Sym(n.to_string()));
            i += n.chars().count();
            continue;
        }
        out.push(Tok::Sym(c.to_string()));
        i += 1;
    }
    out
}

/// One parsed piece; bracket groups remember their content so arguments can drop the brackets.
#[derive(Clone, Debug)]
struct Piece { tex: String, inner: Option<String>, elems: Option<Vec<String>>, #[allow(dead_code)] is_rows: bool }
impl Piece {
    fn plain(tex: String) -> Self { Piece { tex, inner: None, elems: None, is_rows: false } }
    fn arg(&self) -> String { self.inner.clone().unwrap_or_else(|| self.tex.clone()) }
}

struct P { t: Vec<Tok>, i: usize }

impl P {
    fn skip_ws(&mut self) { while matches!(self.t.get(self.i), Some(Tok::Ws)) { self.i += 1; } }
    fn peek(&mut self) -> Option<Tok> { self.skip_ws(); self.t.get(self.i).cloned() }
    fn peek_sym(&mut self, s: &str) -> bool { matches!(self.peek(), Some(Tok::Sym(ref x)) if x == s) }

    fn expr(&mut self, in_group: bool) -> Vec<Piece> {
        let mut out: Vec<Piece> = vec![];
        loop {
            match self.peek() {
                None => break,
                Some(Tok::Sym(ref x)) if in_group && (matches!(sym(x), Some((_, K::Right))) || x == "|") => break,
                Some(Tok::Sym(ref x)) if !in_group && matches!(sym(x), Some((_, K::Right))) => { self.i += 1; out.push(Piece::plain(sym(x).unwrap().0.to_string())); continue; }
                _ => {}
            }
            let mut p = self.intermediate();
            if self.peek_sym("/") {
                self.i += 1;
                let d = self.intermediate();
                p = Piece::plain(format!("\\frac{{{}}}{{{}}}", p.arg(), d.arg()));
            }
            out.push(p);
        }
        out
    }

    fn intermediate(&mut self) -> Piece {
        let base = self.simple();
        let mut tex = base.tex.clone();
        let mut scripted = false;
        for _ in 0..2 {
            if self.peek_sym("_") || self.peek_sym("^") {
                let op = if self.peek_sym("_") { "_" } else { "^" };
                self.i += 1;
                let mut a = self.simple().arg();
                if a == "-" || a == "+" { let b = self.simple().arg(); a.push_str(&b); }
                tex = format!("{}{}{{{}}}", tex, op, a);
                scripted = true;
            }
        }
        if scripted { Piece::plain(tex) } else { base }
    }

    fn simple(&mut self) -> Piece {
        let Some(t) = self.peek() else { return Piece::plain(String::new()) };
        self.i += 1;
        match t {
            Tok::Num(n) => Piece::plain(n),
            Tok::Var(c) => Piece::plain(c.to_string()),
            Tok::Text(s) => Piece::plain(format!("\\text{{{}}}", s)),
            Tok::Ws => self.simple(),
            Tok::Sym(s) => {
                if s == "|" {
                    // |x| as absolute value when a closing bar follows
                    let save = self.i;
                    let inner = self.expr(true);
                    if self.peek_sym("|") { self.i += 1; let c = join(&inner); return Piece { tex: format!("\\left|{}\\right|", c), inner: None, elems: None, is_rows: false }; }
                    self.i = save;
                    return Piece::plain("|".into());
                }
                match sym(&s) {
                    Some((l, K::Left)) => {
                        let content = self.expr(true);
                        let r = match self.peek() { Some(Tok::Sym(x)) if matches!(sym(&x), Some((_, K::Right))) => { self.i += 1; sym(&x).unwrap().0 } _ => "." };
                        // split top-level commas → elements (for matrices)
                        let mut elems = vec![];
                        let mut cur = vec![];
                        for p in &content { if p.tex == "," { elems.push(std::mem::take(&mut cur)); } else { cur.push(p.clone()); } }
                        elems.push(cur);
                        // matrix: every element is itself a bracket group with the same number of entries
                        if elems.len() >= 1 && content.len() > 1 && elems.iter().all(|e| e.len() == 1 && e[0].elems.as_ref().map(|x| x.len() > 1).unwrap_or(false)) {
                            let n = elems[0][0].elems.as_ref().unwrap().len();
                            if elems.iter().all(|e| e[0].elems.as_ref().unwrap().len() == n) {
                                let rows: Vec<String> = elems.iter().map(|e| e[0].elems.as_ref().unwrap().join(" & ")).collect();
                                let env = match l { "[" => "bmatrix", "\\{" => "Bmatrix", "." => "matrix", _ => "pmatrix" };
                                return Piece { tex: format!("\\begin{{{env}}}{}\\end{{{env}}}", rows.join(" \\\\ ")), inner: None, elems: None, is_rows: true };
                            }
                        }
                        let inner = join(&content);
                        let el: Vec<String> = elems.iter().map(|e| join(e)).collect();
                        let lt = if l == "." { String::new() } else { format!("\\left{}", l) };
                        let rt = if r == "." { String::new() } else { format!("\\right{}", r) };
                        let tex = if lt.is_empty() && rt.is_empty() { inner.clone() } else { format!("{}{}{}", if lt.is_empty() { "\\left.".into() } else { lt }, inner, if rt.is_empty() { "\\right.".into() } else { rt }) };
                        Piece { tex, inner: Some(inner), elems: Some(el), is_rows: false }
                    }
                    Some((cmd, K::Unary)) => {
                        let a = self.simple().arg();
                        Piece::plain(match cmd {
                            "|" => format!("\\left|{}\\right|", a),
                            "\\|" => format!("\\left\\|{}\\right\\|", a),
                            "floor" => format!("\\left\\lfloor {}\\right\\rfloor", a),
                            "ceil" => format!("\\left\\lceil {}\\right\\rceil", a),
                            _ => format!("{}{{{}}}", cmd, a),
                        })
                    }
                    Some((cmd, K::Text)) => {
                        // text(...) keeps the raw characters
                        if self.peek_sym("(") {
                            let start = self.i + 1;
                            let mut depth = 0;
                            let mut j = self.i;
                            while j < self.t.len() {
                                if let Tok::Sym(x) = &self.t[j] { if x == "(" { depth += 1; } if x == ")" { depth -= 1; if depth == 0 { break; } } }
                                j += 1;
                            }
                            let raw: String = self.t[start..j.min(self.t.len())].iter().map(|t| match t { Tok::Num(s) | Tok::Sym(s) | Tok::Text(s) => s.clone(), Tok::Var(c) => c.to_string(), Tok::Ws => " ".into() }).collect();
                            self.i = (j + 1).min(self.t.len());
                            return Piece::plain(format!("{}{{{}}}", cmd, raw));
                        }
                        let a = self.simple().arg();
                        Piece::plain(format!("{}{{{}}}", cmd, a))
                    }
                    Some((cmd, K::Binary)) => {
                        let a = self.simple().arg();
                        let b = self.simple().arg();
                        Piece::plain(if s == "root" { format!("\\sqrt[{}]{{{}}}", a, b) } else { format!("{}{{{}}}{{{}}}", cmd, a, b) })
                    }
                    Some((cmd, K::Func)) => Piece::plain(format!("{} ", cmd)),
                    Some((cmd, _)) => Piece::plain(cmd.to_string()),
                    None => Piece::plain(match s.as_str() { "{" | "}" | "%" | "#" | "&" | "$" => format!("\\{}", s), "~" => "\\sim".into(), "'" => "'".into(), _ => s }),
                }
            }
        }
    }
}

fn join(ps: &[Piece]) -> String {
    let mut s = String::new();
    for p in ps {
        if !s.is_empty() && !s.ends_with(' ') && p.tex.starts_with(|c: char| c.is_ascii_alphanumeric()) && s.ends_with(|c: char| c.is_ascii_alphabetic() || c == '}') && s.contains('\\') && s.rsplit('\\').next().map(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false) {
            s.push(' ');
        }
        s.push_str(&p.tex);
    }
    s.trim().to_string()
}

/// Tidy hand-typed forms before parsing: dn/dT, 3*10^8, degrees.
pub fn prep(src: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;
    static R1: OnceLock<Regex> = OnceLock::new();
    static R2: OnceLock<Regex> = OnceLock::new();
    static R3: OnceLock<Regex> = OnceLock::new();
    let r1 = R1.get_or_init(|| Regex::new(r"(^|[\s=(+\-*,])([A-Za-z]{1,3}|\d+(?:\.\d+)?)/([A-Za-z]{1,3}|\d+(?:\.\d+)?)($|[\s=)+\-*,])").unwrap());
    let r2 = R2.get_or_init(|| Regex::new(r"(\d)\s*\*\s*10\^").unwrap());
    let r3 = R3.get_or_init(|| Regex::new(r"(\d)\s*deg\b").unwrap());
    let mut t = src.trim().to_string();
    // apply twice: matches can't overlap in one pass
    for _ in 0..2 { t = r1.replace_all(&t, "$1($2)/($3)$4").into_owned(); }
    t = r2.replace_all(&t, "$1 xx 10^").into_owned();
    t = t.replace("**", "\u{1}").replace('*', " cdot ").replace('\u{1}', "**");
    r3.replace_all(&t, "${1}^@").into_owned()
}

/// AsciiMath (or LaTeX, if it starts with a backslash) → LaTeX.
pub fn to_tex(src: &str) -> String {
    let s = src.trim();
    if s.is_empty() { return String::new(); }
    if s.starts_with("\\[") && s.ends_with("\\]") { return s[2..s.len() - 2].to_string(); }
    if s.starts_with('\\') || ["\\frac", "\\left", "\\begin", "\\mathrm", "\\text"].iter().any(|k| s.contains(k)) { return s.to_string(); }
    let mut p = P { t: tokenize(&prep(s)), i: 0 };
    join(&p.expr(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts() {
        let cases = [
            ("x^2 + y_1", "x^{2}+y_{1}"),
            ("(a+b)/(c-d)", "\\frac{a+b}{c-d}"),
            ("sqrt(2)", "\\sqrt{2}"),
            ("root(3)(x)", "\\sqrt[3]{x}"),
            ("int_0^oo e^(-x^2) dx = sqrt(pi)/2", "\\int_{0}^{\\infty}e^{-x^{2}}dx=\\frac{\\sqrt{\\pi}}{2}"),
            ("sum_(n=1)^N 1/n^2", "\\sum_{n=1}^{N}\\frac{1}{n^{2}}"),
            ("dn/dT ~~ 1.2 xx 10^-5", "\\frac{dn}{dT}\\approx 1.2\\times 10^{-5}"),
            ("n_(p0) - J_s + (2 pi)/(k_b T)", "n_{p0}-J_{s}+\\frac{2\\pi}{k_{b}T}"),
            ("[[a,b],[c,d]]", "\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}"),
            ("lim_(x->0) (sin x)/x", "\\lim _{x\\to 0}\\frac{\\sin x}{x}"),
            ("abs(x) <= 1", "\\left|x\\right|\\le 1"),
            ("vec v, hat x", "\\vec{v},\\hat{x}"),
            ("90 deg", "90^{\\circ}"),
            ("a*b", "a\\cdot b"),
            ("\\frac{a}{b}", "\\frac{a}{b}"),
        ];
        for (a, want) in cases { assert_eq!(to_tex(a), want, "for {a}"); }
    }
}
