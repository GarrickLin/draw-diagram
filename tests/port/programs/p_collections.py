"""Containers: dict order and methods, defaultdict, Counter, deque, sorting, heapq, comparisons."""
import heapq
from collections import Counter, defaultdict, deque
from copy import deepcopy


class Rand:
    def __init__(self, seed):
        self.state = seed

    def next(self, n):
        self.state = (self.state * 48271 + 11) % 2147483647
        return self.state % n


def main():
    out = []
    d = {"x": 1, "y": 2}
    d["a"] = 3
    d.update({"x": 9, "b": 4}, c=5)
    out.append([list(d), list(d.values()), list(d.items()), d.get("q"), d.get("q", 0), d.setdefault("x", 0), d.setdefault("n", [])])
    out.append([d.pop("y"), d.pop("zz", "dflt"), list(d), "a" in d, len(d), dict(zip("abc", range(3))), dict.fromkeys([3, 1, 2], 0)])
    out.append([{1: "a", 1.0: "b", True: "c"}, {(1, 2): 1, (1.0, 2.0): 2}, {**{"a": 1}, **{"a": 2, "b": 3}}, {k: v for k, v in [("q", 1), ("p", 2), ("q", 3)]}])
    dd = defaultdict(list)
    for i, w in enumerate("the quick brown fox jumps over the lazy dog the end".split()):
        dd[len(w)].append((i, w))
    out.append([sorted(dd.items()), list(dd), dd[99], list(dd)])
    c = Counter("abracadabra simsalabim")
    out.append([sorted(c.items()), c["a"], c["zz"], list(c), sum(c.values())])
    c.update("aaa")
    c2 = Counter(["x", "y", "x"])
    out.append([sorted(c.items()), list(c2.items())])
    q = deque([1, 2, 3])
    q.append(4)
    q.appendleft(0)
    q.append(5)
    q.extend([6, 7])
    out.append([list(q), q.popleft(), q.pop(), list(q), len(q), q[0], q[-1]])
    for seed in range(15):
        r = Rand(seed)
        rows = [(r.next(5), r.next(3), "abcdef"[r.next(6)]) for _ in range(30)]
        out.append(sorted(rows))
        out.append(sorted(rows, key=lambda t: t[0]))
        out.append(sorted(rows, key=lambda t: t[1], reverse=True))
        out.append(sorted(rows, key=lambda t: (-t[0], t[2])))
        lst = list(rows)
        lst.sort(key=lambda t: t[2], reverse=True)
        out.append(lst)
        h = []
        for row in rows:
            heapq.heappush(h, (row[0], row[1]))
        out.append([heapq.heappop(h) for _ in range(len(h))])
        h2 = [r.next(50) for _ in range(25)]
        heapq.heapify(h2)
        out.append(list(h2))
        out.append([max(rows), min(rows), max(rows, key=lambda t: t[1]), min(rows, key=lambda t: t[1])])
    out.append([(1, 2) < (1, 2, 0), [1, 2] < [1, 3], (2,) > (1, 9), [] == [], (1, [2]) == (1, [2]), "a" < "b", [1, "a"] == [1, "a"], None == 0])
    a = [[1, 2], {"k": [3]}, (4, [5])]
    b = deepcopy(a)
    b[0].append(9)
    b[1]["k"].append(9)
    b[2][1].append(9)
    out.append([a, b, a == b])
    lst = list(range(10))
    del lst[2]
    lst[1] = "x"
    lst.insert(2, "y")
    lst.insert(0, -1)
    lst.extend((7, 7))
    lst.remove(7)
    out.append([lst, lst.index("y"), lst.count(7), lst[::-2], lst[-3:], [*lst[:2], *"ab"], list(reversed(lst)), list(enumerate("ab", 1))])
    out.append([list(zip([1, 2, 3], "ab")), list(map(lambda v: v * 2, [1, 2])), list(filter(None, [0, 1, "", "a", None, [], [0]])), any([]), all([]), any(x > 2 for x in [1, 3])])
    out.append([list(range(10, 0, -3)), list(range(0)), len(range(1, 100, 7)), 5 in range(0, 10, 5), range(3)[-1], list(range(5))[1::2]])
    return out
