// hashlib.sha256 over the bytes str.encode() gives.
import { createHash } from "node:crypto";

class Hash {
  constructor(data) {
    this.h = createHash("sha256");
    if (data !== undefined) this.update(data);
  }
  update(data) {
    this.h.update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data));
    return null;
  }
  hexdigest() {
    return this.h.copy().digest("hex");
  }
}
export function sha256(data) {
  return new Hash(data);
}
