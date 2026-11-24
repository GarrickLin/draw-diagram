// The part of pathlib (and builtin open) the modules use, on node:fs.

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import * as nodePath from "node:path";
import { Tuple, T, splitKw, pystr, OSError, ValueError, TypeError_, nv, getitem } from "./runtime.js";

class Parents {
  constructor(p) {
    this.p = p;
  }
  __getitem__(i) {
    let q = this.p;
    for (let k = 0; k <= nv(i); k++) {
      const up = nodePath.dirname(q);
      if (up === q && k <= nv(i)) throw new ValueError("index out of range");
      q = up;
    }
    return new Path(q);
  }
  __len__() {
    let n = 0;
    let q = this.p;
    while (nodePath.dirname(q) !== q) {
      q = nodePath.dirname(q);
      n++;
    }
    return n;
  }
}

export class Path {
  constructor(...parts) {
    const ps = parts.map((x) => (x instanceof Path ? x.p : pystr(x)));
    this.p = ps.length ? nodePath.join(...ps) : ".";
    if (this.p !== "/" && this.p.endsWith("/")) this.p = this.p.slice(0, -1);
  }
  __str__() {
    return this.p;
  }
  __repr__() {
    return `PosixPath('${this.p}')`;
  }
  __truediv__(other) {
    return new this.constructor(this.p, other);
  }
  resolve() {
    return new this.constructor(nodePath.resolve(this.p));
  }
  get parent() {
    return new this.constructor(nodePath.dirname(this.p));
  }
  get parents() {
    return new Parents(this.p);
  }
  get name() {
    return nodePath.basename(this.p);
  }
  get suffix() {
    const n = nodePath.basename(this.p);
    const i = n.lastIndexOf(".");
    return i > 0 && i < n.length - 1 ? n.slice(i) : "";
  }
  get stem() {
    const n = nodePath.basename(this.p);
    return this.suffix ? n.slice(0, -this.suffix.length) : n;
  }
  get parts() {
    const out = [];
    if (this.p.startsWith("/")) out.push("/");
    for (const s of this.p.split("/")) if (s && s !== ".") out.push(s);
    return T(...out);
  }
  with_name(n) {
    return new this.constructor(nodePath.dirname(this.p), n);
  }
  as_posix() {
    return this.p;
  }
  is_absolute() {
    return this.p.startsWith("/");
  }
  is_file() {
    try {
      return statSync(this.p).isFile();
    } catch {
      return false;
    }
  }
  is_dir() {
    try {
      return statSync(this.p).isDirectory();
    } catch {
      return false;
    }
  }
  exists() {
    return existsSync(this.p);
  }
  relative_to(other) {
    const o = other instanceof Path ? other.p : pystr(other);
    const r = nodePath.relative(o, this.p);
    if (r.startsWith("..") || nodePath.isAbsolute(r)) throw new ValueError(`'${this.p}' is not in the subpath of '${o}'`);
    return new this.constructor(r || ".");
  }
  is_relative_to(other) {
    try {
      this.relative_to(other);
      return true;
    } catch {
      return false;
    }
  }
  read_text(...args) {
    try {
      return readFileSync(this.p, "utf8");
    } catch (e) {
      throw new OSError(e.message);
    }
  }
  read_bytes() {
    try {
      return readFileSync(this.p);
    } catch (e) {
      throw new OSError(e.message);
    }
  }
  open(...args) {
    return open(this, ...args);
  }
}
export class PurePosixPath extends Path {}

class Stream {
  constructor(path, binary) {
    this.path = path;
    this.binary = binary;
    try {
      this.fd = openSync(path, "r");
    } catch (e) {
      throw new OSError(e.message);
    }
  }
  read(n = -1) {
    n = nv(n);
    if (n < 0) {
      const data = readFileSync(this.fd);
      return this.binary ? data : data.toString("utf8");
    }
    const buf = Buffer.alloc(n);
    const got = readSync(this.fd, buf, 0, n, null);
    const out = buf.subarray(0, got);
    return this.binary ? out : out.toString("utf8");
  }
  close() {
    closeSync(this.fd);
    return null;
  }
  __enter__() {
    return this;
  }
  __exit__() {
    this.close();
    return null;
  }
}

/** builtin open(path, mode="r", encoding=...) for reading. */
export function open(...args) {
  const [pos, kw] = splitKw(args);
  const path = pos[0] instanceof Path ? pos[0].p : pystr(pos[0]);
  const mode = kw.mode ?? pos[1] ?? "r";
  if (/[wax+]/.test(mode)) throw new TypeError_("only reading is supported");
  return new Stream(path, mode.includes("b"));
}
