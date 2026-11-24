"""re: the translation of Python patterns to JS must match what CPython does."""
import re


def main():
    out = []
    texts = ["GPU L2 cache 4MB, HBM3 x8 @ 3.2 GHz", "片上存储 SRAM 256KB；共享 L2", "a_b-c d.e", "  leading and trailing  ",
             "CamelCaseString with HTTPServer", "line1\nline2\r\nline3", "x=1, y=22, z=333", "", "Straße naïve café", "tab\there"]
    pats = [r"\w+", r"\d+", r"\b\w", r"[A-Z][a-z]+", r"(\w+)=(\d+)", r"(?P<key>\w)=(?P<val>\d+)", r"\s+", r"^\w+", r"\w+$", r"(?m)^\w+",
            r"(?i)gpu|sram", r"[^\x00-\x7f]+", r"\S+", r"(?<=\s)\w", r"\w(?=\s)", r"(a|b)?c", r"\.", r"(\d)(\d)?", r"[一-鿿]+", r"\W+", r"\B\w"]
    for p in pats:
        rx = re.compile(p)
        for t in texts:
            m = rx.search(t)
            out.append([p, rx.findall(t), [x.span() for x in rx.finditer(t)], m.group(0) if m else None, m.groups() if m else None,
                        rx.sub("<\\g<0>>", t), rx.split(t), bool(rx.match(t)), bool(rx.fullmatch(t))])
    out.append(re.sub(r"(\w+)@(\w+)", r"\2 at \1", "me@host you@there"))
    out.append(re.sub(r"\d+", lambda m: str(int(m.group(0)) * 2), "a1 b22 c333"))
    out.append(re.sub(r"x*", "-", "abxd"))
    out.append(re.split(r"(,)", "a,b,c"))
    out.append(re.split(r",", "a,b,c,d", maxsplit=2))
    out.append(re.findall(r"(a)(b)?", "ab a"))
    m = re.match(r"(?P<first>\w+) (?P<last>\w+)", "Ada Lovelace extra")
    out.append([m.group("first"), m.group(2), m.start(2), m.end(), m.span("last"), m.string])
    out.append([re.escape("a.b*c"), re.escape("x-y_z 1"), bool(re.search("$", "abc\n")), re.findall(r"$", "a\nb\n"), re.sub(r"$", "!", "ab\n")])
    out.append([re.findall(r"(?s)a.b", "a\nb"), re.findall(r"a.b", "a\nb"), re.sub(r"(?x) a \s* b  # comment", "AB", "a   b")])
    out.append([re.fullmatch(r"\d{2,3}", "123") is not None, re.fullmatch(r"\d{2,3}", "1234") is not None, re.search(r"[[:alpha:]]" if False else r"[a-z]{2}", "A bc")[0]])
    return out
