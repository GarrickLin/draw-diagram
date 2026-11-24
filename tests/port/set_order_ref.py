"""Random set programs and the iteration order CPython gives them; the JS port must agree."""
import json, random, sys
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
progs = []
def val():
    r = random.random()
    if r < 0.5: return random.randint(-20, 200)
    if r < 0.6: return random.choice([True, False, None])
    if r < 0.75: return random.choice([0.5, 1.5, -2.25, 3.0, 1e-3, 1e20, 0.1])
    return ("t", random.randint(0, 9), random.randint(0, 9)) if random.random() < 0.5 else (random.randint(0, 50),)
def enc(v):
    if isinstance(v, tuple): return {"t": [enc(x) for x in v if not isinstance(x, str)], "s": [x for x in v if isinstance(x, str)][:1]}
    return v
for _ in range(400):
    ops, sets = [], [set() for _ in range(3)]
    for _ in range(random.randint(1, 60)):
        k = random.random(); a = random.randrange(3); b = random.randrange(3)
        if k < 0.5:
            v = val()
            if isinstance(v, tuple) and isinstance(v[0], str): v = tuple(x for x in v if not isinstance(x, str))
            ops.append(["add", a, v]); sets[a].add(v)
        elif k < 0.6:
            vs = [val() for _ in range(random.randint(0, 30))]
            vs = [tuple(x for x in v if not isinstance(x, str)) if isinstance(v, tuple) else v for v in vs]
            ops.append(["new", a, vs]); sets[a] = set(vs)
        elif k < 0.68: ops.append(["union", a, b]); sets[a] = sets[a] | sets[b]
        elif k < 0.76: ops.append(["inter", a, b]); sets[a] = sets[a] & sets[b]
        elif k < 0.84: ops.append(["diff", a, b]); sets[a] = sets[a] - sets[b]
        elif k < 0.9: ops.append(["isub", a, b]); sets[a] -= sets[b]
        elif k < 0.95:
            v = val()
            if isinstance(v, tuple) and isinstance(v[0], str): v = tuple(x for x in v if not isinstance(x, str))
            ops.append(["discard", a, v]); sets[a].discard(v)
        else: ops.append(["copy", a, b]); sets[a] = sets[b].copy()
        ops[-1].append([list(s) for s in sets])
    progs.append(ops)
def conv(x):
    if isinstance(x, tuple): return {"__tuple__": [conv(i) for i in x]}
    if isinstance(x, list): return [conv(i) for i in x]
    return x
print(json.dumps(conv(progs)))
