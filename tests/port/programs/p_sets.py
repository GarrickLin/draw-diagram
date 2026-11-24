"""Set and dict-view semantics, iteration order included (CPython's hash table order)."""


class Rand:
    def __init__(self, seed):
        self.state = seed

    def next(self, n):
        self.state = (self.state * 48271 + 11) % 2147483647
        return self.state % n


def value(r):
    k = r.next(10)
    if k < 4:
        return r.next(300) - 40
    if k == 4:
        return [None, True, False][r.next(3)]
    if k == 5:
        return [0.5, 1.5, -2.25, 3.0, 1e-3, 1e20, 0.1, -0.0, 2.0 ** 60][r.next(9)]
    if k < 8:
        return (r.next(12), r.next(12))
    if k == 8:
        return (r.next(5), (r.next(3), None))
    return 2 ** (r.next(50)) - r.next(3)


def main():
    out = []
    for seed in range(60):
        r = Rand(seed)
        sets = [set(), set(), set()]
        trace = []
        for _ in range(r.next(80) + 1):
            k = r.next(14)
            a = r.next(3)
            b = r.next(3)
            if k < 5:
                sets[a].add(value(r))
            elif k == 5:
                sets[a] = set(value(r) for _ in range(r.next(40)))
            elif k == 6:
                sets[a] = sets[a] | sets[b]
            elif k == 7:
                sets[a] = sets[a] & sets[b]
            elif k == 8:
                sets[a] = sets[a] - sets[b]
            elif k == 9:
                sets[a] -= sets[b]
            elif k == 10:
                sets[a] |= {value(r) for _ in range(r.next(6))}
            elif k == 11:
                sets[a].discard(value(r))
            elif k == 12:
                sets[a] = sets[a] ^ sets[b]
            else:
                sets[a] = sets[b].copy()
            trace.append(list(sets[a]))
        out.append(trace[-5:])
        out.append([len(s) for s in sets])
        out.append([sets[0] <= sets[1], sets[0] < sets[1], sets[1] >= sets[2]])
        out.append(sorted(sets[0], key=repr))
    # dict views as sets
    for seed in range(20):
        r = Rand(seed + 100)
        d = {value(r): i for i in range(r.next(30))}
        e = {value(r): -i for i in range(r.next(30))}
        s = {value(r) for _ in range(r.next(30))}
        out.append(list(d.keys() & e.keys()))
        out.append(list(d.keys() | s))
        out.append(list(d.keys() - s))
        out.append(list(s & d.keys()))
        out.append(list(d.items() & e.items()))
        out.append([d.keys() <= s, s <= d.keys(), d.keys() == set(d)])
    # frozensets as keys, pop order, membership with equal numbers
    fs = {frozenset([1, 2]): "a", frozenset([2, 1]): "b", frozenset(): "c"}
    out.append(list(fs.items()))
    s = {3, 1, 2, 1.0, True, 2 ** 52, -1, -2}
    out.append(list(s))
    popped = []
    while s:
        popped.append(s.pop())
    out.append(popped)
    out.append([1 in {1.0}, 1.5 in {3 / 2}, (1, 2) in {(1.0, 2.0)}, None in {None}])
    out.append(list({x * 7 % 64 for x in range(64)}))
    out.append(list(set(range(100, 0, -3))))
    return out
