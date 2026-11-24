// The part of PIL the layout path touches. Label placement creates an image and a draw object
// and measures text; nothing it draws is used, so drawing does nothing here and measuring asks
// the font (the width-table font of publication_render).
import { splitKw } from "./runtime.js";

class Img {
  save() {
    return null;
  }
}
class Draw {
  constructor(img) {
    this.img = img;
  }
  textlength(text, ...rest) {
    const [pos, kw] = splitKw(rest);
    const font = kw.font ?? pos[0];
    return font.getlength(text);
  }
  __getattr__() {
    return () => null;
  }
}
for (const m of ["rectangle", "rounded_rectangle", "polygon", "line", "text", "ellipse", "point", "arc"]) Draw.prototype[m] = () => null;

export const Image = { new: () => new Img() };
export const ImageDraw = { Draw: (img) => new Draw(img) };
export const ImageFont = {
  Layout: { BASIC: 0, RAQM: 1 },
  truetype() {
    throw new Error("fonts are not available; layout measures with the width table");
  },
};
