// io.BytesIO, only for code paths that build PNG guides (not used by layout).
export class BytesIO {
  constructor() {
    this.chunks = [];
  }
  write(b) {
    this.chunks.push(b);
    return b.length;
  }
  getvalue() {
    return Buffer.concat(this.chunks.map((c) => Buffer.from(c)));
  }
}
