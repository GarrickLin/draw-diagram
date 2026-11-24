"""CPython's answers for structure_scene's astar on random grids (the fast JS path must agree).

The function is taken from the silicon source itself, so this is the code being ported:

    python -I tests/port/astar_ref.py <structure_scene.py> <cases> <seed>  -> JSON list on stdout
"""
import ast
import json
import random
import sys
import textwrap

source = open(sys.argv[1], encoding="utf-8").read()
node = next(n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == "astar")
body = textwrap.indent(textwrap.dedent(ast.get_source_segment(source, node)), "    ")
factory = "def make(maxx, maxy, blocked, occupied, segment_colors):\n    import heapq, math\n" + body + "\n    return astar\n"
namespace = {}
exec(compile(factory, "astar", "exec"), namespace)
make = namespace["make"]

count, seed = int(sys.argv[2]), int(sys.argv[3])
rnd = random.Random(seed)
COLORS = ["#3E6785", "#55785C", "#17324D", None]
cases = []
for _ in range(count):
    maxx, maxy = rnd.randint(6, 48), rnd.randint(6, 48)
    density = rnd.choice([0.0, 0.1, 0.25, 0.4])
    blocked = {(x, y) for x in range(maxx + 1) for y in range(maxy + 1) if rnd.random() < density}
    if rnd.random() < 0.3:  # walls with a gap make long detours and ties
        wx = rnd.randint(2, max(2, maxx - 2))
        gap = rnd.randint(1, maxy - 1)
        blocked |= {(wx, y) for y in range(maxy + 1) if y != gap}
    occupied, segment_colors = set(), {}
    for _ in range(rnd.randint(0, maxx * maxy // 6)):
        x, y = rnd.randint(0, maxx), rnd.randint(0, maxy)
        q = (x + 1, y) if rnd.random() < 0.5 else (x, y + 1)
        seg = tuple(sorted(((x, y), q)))
        occupied.add(seg)
        segment_colors[seg] = rnd.choice(COLORS)
    start = (rnd.randint(1, maxx - 1), rnd.randint(1, maxy - 1))
    goal = (rnd.randint(1, maxx - 1), rnd.randint(1, maxy - 1))
    if rnd.random() < 0.3:
        blocked |= {start, goal}  # start and goal may sit on obstacles
    bounds = None
    if rnd.random() < 0.4:
        x0, y0 = rnd.randint(0, min(start[0], goal[0])), rnd.randint(0, min(start[1], goal[1]))
        bounds = (x0, y0, rnd.randint(max(start[0], goal[0]), maxx), rnd.randint(max(start[1], goal[1]), maxy))
    line_color = rnd.choice(COLORS + [None, None])
    path = make(maxx, maxy, blocked, occupied, segment_colors)(start, goal, bounds, line_color)
    cases.append({
        "maxx": maxx, "maxy": maxy,
        "blocked": sorted(blocked), "occupied": sorted(occupied),
        "segment_colors": [[list(map(list, k)), v] for k, v in segment_colors.items()],
        "start": start, "goal": goal, "bounds": bounds, "line_color": line_color,
        "path": path,
    })
json.dump(cases, sys.stdout)
