"""Numbers: float repr, rounding, integer division, formatting, math."""
import math


def main():
    out = []
    xs = [0.1 + 0.2, 1 / 3, 2 / 3, 1e16, 1e-7, 123456789.125, 2.5, 3.5, -2.5, 0.125, 1e22, 1.0, -0.0,
          5e-324, 1.7976931348623157e308, 100.0, 1e15 + 0.3, 0.000123, 12345.678, 9.995, 0.5, 1.5]
    for x in xs:
        out.append([repr(x), str(x), round(x), round(x, 1), round(x, 2), round(x, -1), int(x)])
        out.append([f"{x:.2f}", f"{x:.0f}", f"{x:g}", f"{x:.3g}", f"{x:e}", f"{x:.1%}", f"{x:,.2f}", f"{x:10.3f}|", f"{x:<10.1f}|", f"{x:+.1f}"])
    for a in [7, -7, 7.5, -7.5, 0, 13]:
        for b in [2, -2, 3, 0.5, -1.5]:
            out.append([a // b, a % b, a / b, a ** 2, abs(a - b)])
    for n in [0, 1, -1, 255, 1000000, -42, 2 ** 40]:
        out.append([f"{n:03d}", f"{n:x}", f"{n:>6}", f"{n:,}", f"{n:+d}", f"{n:b}" if n >= 0 else ""])
    vals = [i * 0.1 for i in range(1, 40)]
    out.append([sum(vals), sum(vals[::-1]), sum([1e100, 1.0, -1e100]), sum([0.1] * 10), min(vals), max(vals)])
    out.append([math.sqrt(2), math.hypot(3, 4), math.hypot(1e-200, 1e-200), math.dist((0, 0), (1, 1)), math.dist((1.5, 2.5, 3), (4, 0.25, -1)),
                math.atan2(1, -1), math.degrees(1), math.radians(90), math.floor(-2.5), math.ceil(-2.5), math.floor(7), math.ceil(2.0000001),
                math.isclose(0.1 + 0.2, 0.3), math.log(10), math.log2(1024), math.log10(0.001), math.exp(1), math.sin(1), math.cos(1),
                math.inf > 1e308, -math.inf < 0, math.isinf(math.inf), math.isnan(float("nan")), math.copysign(1, -0.0), math.trunc(-3.7)])
    out.append([round(0.5), round(1.5), round(2.5), round(-0.5), round(2.675, 2), round(1.005, 2), round(1234.5678, -2), round(15, -1), round(25, -1), round(7, 0)])
    out.append([int("42"), int(" -7 "), float("1e3"), float("-inf"), int(3.99), int(-3.99), int(True), float(2), 7 // 2.0, 2 ** -1, 2 ** 0.5, (-8) ** 2, 10 ** 15])
    out.append([1 == 1.0, 1 < 1.5, True + True, 3 * True, max(1, 1.0), min(1.0, 1), max([3, 1, 2], key=lambda v: -v), sorted([3, 1.5, 2, -1, 0.0, 0])])
    out.append([str(1e16), str(1.5e-5), str(123e-10), repr(1e-5), repr(12345678901234567.0), repr(0.30000000000000004), str(float(10 ** 16)), str(2.0 ** 53)])
    return out
