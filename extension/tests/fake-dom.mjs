/* Minimal DOM stand-in for extract.js tests. Supports the selector subset used
 * by SELECTORS: compound tag / .class / [attr] / [attr="v"] / [attr^="v"] /
 * [attr*="v"] tokens plus the descendant combinator (spaces) and comma-separated
 * alternatives. Mirrors real DOM semantics for .children (ELEMENT children only,
 * like the real Element.children). NOT a general CSS engine; extend it if
 * SELECTORS grows new syntax.
 */
class FakeEl {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this._nodes = []; // elements AND text strings, in order
    this.parentElement = null;
    for (const c of children) this.append(c);
  }
  append(c) {
    if (typeof c === "string") this._nodes.push(c);
    else { c.parentElement = this; this._nodes.push(c); }
  }
  get children() { // element children only, like the real DOM
    return this._nodes.filter((n) => typeof n !== "string");
  }
  get textContent() {
    return this._nodes.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  *walk() {
    for (const c of this._nodes) {
      if (typeof c === "string") continue;
      yield c;
      yield* c.walk();
    }
  }
  matches(selector) {
    return selector.split(",").some((alt) => {
      const parts = alt.trim().split(/\s+/);
      if (parts.length === 1) return this._matchesCompound(parts[0]);
      if (!this._matchesCompound(parts[parts.length - 1])) return false;
      let el = this.parentElement;
      let i = parts.length - 2;
      while (el && i >= 0) {
        if (el._matchesCompound(parts[i])) i--;
        el = el.parentElement;
      }
      return i < 0;
    });
  }
  _matchesCompound(compound) {
    let rest = compound.trim();
    const tagM = rest.match(/^[a-z][\w-]*/i);
    if (tagM) {
      if (tagM[0].toUpperCase() !== this.tagName) return false;
      rest = rest.slice(tagM[0].length);
    }
    const tokens = rest.match(/\.[\w-]+|\[[^\]]+\]/g) || [];
    if (tokens.join("") !== rest) return false;
    for (const tok of tokens) {
      if (tok[0] === ".") {
        const cls = (this.attrs.class || "").split(/\s+/);
        if (!cls.includes(tok.slice(1))) return false;
      } else {
        const m = tok.match(/^\[([\w-]+)(?:([\^*])?="([^"]*)")?\]$/);
        if (!m) return false;
        const val = this.getAttribute(m[1]);
        if (val === null) return false;
        if (m[3] !== undefined) {
          if (m[2] === "^") { if (!val.startsWith(m[3])) return false; }
          else if (m[2] === "*") { if (!val.includes(m[3])) return false; }
          else if (val !== m[3]) return false;
        }
      }
    }
    return true;
  }
  querySelector(sel) {
    for (const alt of sel.split(",")) {
      const parts = alt.trim().split(/\s+/);
      const found = this._q(parts);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    for (const alt of sel.split(",")) {
      const parts = alt.trim().split(/\s+/);
      this._qAll(parts, out);
    }
    return out;
  }
  _q(parts) {
    for (const el of this.walk()) {
      if (el._matchesCompound(parts[0])) {
        if (parts.length === 1) return el;
        const deeper = el._q(parts.slice(1));
        if (deeper) return deeper;
      }
    }
    return null;
  }
  _qAll(parts, out) {
    for (const el of this.walk()) {
      if (el._matchesCompound(parts[0])) {
        if (parts.length === 1) { if (!out.includes(el)) out.push(el); }
        else el._qAll(parts.slice(1), out);
      }
    }
  }
  closest(sel) {
    let el = this;
    while (el) {
      if (el.matches(sel)) return el;
      el = el.parentElement;
    }
    return null;
  }
}

export function el(tag, attrs, children) {
  return new FakeEl(tag, attrs || {}, children || []);
}
