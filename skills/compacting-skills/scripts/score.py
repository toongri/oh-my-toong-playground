#!/usr/bin/env python3
"""Score graded scenario answers.

Usage: score.py <grades-dir> <out.md> [--reps r1,r2,r3,r4,r5]

Reads every grades-*.csv in <grades-dir> (columns: scenario,rep,grade[,note]; grade C/P/W),
scores C=1, P=0.5, W=0, and writes a per-scenario table plus the total to <out.md>.
A scenario missing any listed rep is reported and left out of the total.
"""
import collections
import csv
import glob
import os
import sys

POINTS = {"C": 1.0, "P": 0.5, "W": 0.0}


def main(argv):
    args = [a for a in argv if not a.startswith("--reps")]
    reps = ["r1", "r2", "r3", "r4", "r5"]
    for i, a in enumerate(argv):
        if a == "--reps":
            reps = argv[i + 1].split(",")
            args.remove(argv[i + 1])
    if len(args) != 2:
        sys.exit(__doc__)
    grades_dir, out = args
    grades = collections.defaultdict(dict)
    for path in sorted(glob.glob(os.path.join(grades_dir, "grades-*.csv"))):
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                grade = row["grade"].strip().upper()
                if grade not in POINTS:
                    sys.exit(f"{path}: bad grade {grade!r} for {row['scenario']} {row['rep']}")
                grades[row["scenario"].strip()][row["rep"].strip()] = grade

    def order(s):
        head, _, tail = s.rpartition("-")
        return (head, int(tail)) if tail.isdigit() else (s, 0)

    lines = ["| scenario | grades | C | P | W | score |", "|---|---|---|---|---|---|"]
    total = collections.Counter()
    missing = []
    for scenario in sorted(grades, key=order):
        got = [grades[scenario].get(r) for r in reps]
        if None in got:
            missing.append(scenario)
            continue
        c = collections.Counter(got)
        total.update(c)
        score = sum(POINTS[g] for g in got) / len(reps)
        lines.append(f"| {scenario} | {''.join(got)} | {c['C']} | {c['P']} | {c['W']} | {score:.2f} |")
    n = sum(total.values())
    summary = f"Total: {n} answers, C {total['C']} / P {total['P']} / W {total['W']}"
    if n:
        summary += f", score {(total['C'] + 0.5 * total['P']) / n:.3f}"
    lines += ["", summary]
    if missing:
        lines.append("Missing reps (excluded): " + ", ".join(missing))
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(summary)
    if missing:
        print("missing:", ", ".join(missing))


if __name__ == "__main__":
    main(sys.argv[1:])
