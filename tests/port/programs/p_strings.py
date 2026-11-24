"""Strings: methods, slicing, comparison and formatting, including non-ASCII text."""


def main():
    out = []
    samples = ["  Hello, World  ", "a,b,,c", "GPU L2 Cache", "片上存储 SRAM", "tab\tsep\nnew line", "", "x", "CamelCaseName", "snake_case_name", "ÉCOLE", "ﬁne straße"]
    for s in samples:
        out.append([s.strip(), s.lstrip(), s.rstrip(), s.split(), s.split(","), s.split(",", 1), s.rsplit(" ", 1), s.upper(), s.lower(), s.title(), s.capitalize()])
        out.append([s.replace("a", "A"), s.replace("", "-") if len(s) < 4 else "", s.find("o"), s.rfind("o"), s.count("a"), s.startswith(("G", "  ")), s.endswith("e"), s.partition(" "), s.rpartition(" ")])
        out.append([s[::-1], s[1:-1], s[::2], s[-3:], s[:100], s[5:2], s.ljust(12, "."), s.rjust(12), len(s)])
        out.append([s.isdigit(), s.isalpha(), s.isspace(), s.isupper(), s.islower(), s.isalnum()])
        out.append([s.splitlines(), s.casefold()])
    words = ["banana", "Apple", "cherry", "apple", "Äpfel", "zebra", "Zebra", "10", "9", "片上", "🙂", "a🙂b", "", "ä"]
    out.append(sorted(words))
    out.append(sorted(words, key=str.lower))
    out.append(sorted(words, key=len))
    out.append(sorted(words, key=lambda w: (len(w), w), reverse=True))
    out.append([len("🙂"), len("a🙂b"), "a🙂b"[1], "a🙂b"[::-1], ord("🙂"), chr(128578), "🙂" < "￿", "\U0001f600" > "", "a🙂b".find("b")])
    out.append(["-".join(["a", "b", "c"]), "".join(reversed("abc")), "ab" * 3, "x" in "xyz"])
    out.append([repr("quote's"), repr('dq"'), repr("both'\""), repr("tab\t\n\\"), repr("片"), repr("\x00\x7f​"), str(None), str(True), str([1, "a", (2,)]), str({"k": [1.5, None]})])
    out.append(["a b  c".split(" "), " a b ".split(), "a-b-c".split("-", maxsplit=1), "1,2;3".replace(";", ","), "abc".index("c"), "aaa".replace("a", "b", 2)])
    out.append([f"{'left':<8}|{'right':>8}|{'mid':^8}|", f"{3.14159:.2f} {42:5d} {'s'!r}", f"{'片上':>6}|"])
    return out
