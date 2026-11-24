"""Control flow: exceptions, generators, closures, keyword arguments, classes."""


class Shape:
    def __init__(self, name, scale=1.0):
        self.name = name
        self.scale = scale
        self.sides = 0

    def area(self):
        return 0

    def describe(self, prefix="", *, upper=False):
        text = f"{prefix}{self.name}:{self.sides}:{self.area():.2f}"
        return text.upper() if upper else text


class Square(Shape):
    def __init__(self, side, **kw):
        super().__init__("square", **kw)
        self.side = side
        self.sides = 4

    def area(self):
        return (self.side * self.scale) ** 2


class Fail(ValueError):
    def __init__(self, msg, code):
        super().__init__(msg)
        self.code = code


def gen(n):
    for i in range(n):
        if i % 3 == 0:
            continue
        yield i * i
    yield -1


def pairs(xs):
    it = iter(xs)
    for a in it:
        b = next(it, None)
        yield (a, b)


def counter():
    count = 0

    def bump(step=1):
        nonlocal count
        count += step
        return count

    return bump


def kw(a, b=2, *rest):
    return [a, b, list(rest)]


def kw2(a, b=2, c=3, **extra):
    return [a, b, c, sorted(extra.items())]


def risky(x):
    try:
        if x == 0:
            raise Fail("zero", 7)
        if x == 1:
            return {"a": 1}["b"]
        if x == 2:
            return [1][5]
        if x == 3:
            return 1 / 0
        if x == 4:
            return int("nope")
        return x * 2
    except Fail as e:
        return ["Fail", str(e), e.code, isinstance(e, ValueError)]
    except (KeyError, IndexError) as e:
        return [type(e).__name__, repr(e)]
    except ZeroDivisionError:
        return "div"
    except ValueError as e:
        return ["ValueError", str(e)]
    finally:
        pass


def main():
    out = []
    out.append(list(gen(10)))
    out.append(list(pairs([1, 2, 3, 4, 5])))
    out.append(sum(x for x in gen(7)))
    b = counter()
    out.append([b(), b(5), b(step=2)])
    out.append([kw(1), kw(1, 5, 6, 7), kw(*[4, 5, 6]), kw2(1, c=9), kw2(a=0, b=1, z=2, y=3), kw2(*[4, 5], **{"c": 6, "q": 1}), kw2(1, **{"b": 7})])
    out.append([risky(i) for i in range(6)])
    sq = Square(3)
    out.append([sq.describe(), sq.describe("> ", upper=True), Shape("blob").describe(), isinstance(sq, Shape), sq.sides, getattr(sq, "missing", "dflt"), hasattr(sq, "side")])
    found = "none"
    for i in range(10):
        if i * i > 20:
            found = i
            break
    n = 0
    while n < 3:
        n += 1
    out.append([found, n])
    out.append([x if x % 2 else -x for x in range(6)])
    out.append({k: [v for v in range(k)] for k in range(4)})
    out.append([[i * j for j in range(3)] for i in range(3)])
    out.append([(i, j) for i in range(3) for j in range(i) if (i + j) % 2])
    out.append([1 < 2 < 3, 1 < 3 < 2, 0 or "x", "" or None, 1 and 2, [] and 1, not [], None is None, 3 if [] else 4])
    out.append(sorted({"b": 2, "a": 3, "c": 1}.items(), key=lambda kv: kv[1]))
    try:
        raise KeyError("missing")
    except LookupError as e:
        out.append(["lookup", str(e), e.args])
    try:
        try:
            raise ValueError("inner")
        finally:
            out.append("finally ran")
    except ValueError as e:
        out.append(str(e))
    a, *rest = [1, 2, 3, 4]
    (p, q), r = (5, 6), 7
    out.append([a, rest, p, q, r])
    total = 0
    for i, (x, y) in enumerate([(1, 2), (3, 4)]):
        total += i * x + y
    out.append(total)
    return out
