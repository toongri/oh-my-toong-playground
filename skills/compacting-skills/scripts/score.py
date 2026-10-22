#!/usr/bin/env python3
"""Score graded scenario answers.

Usage: score.py <grades-dir> <out.md> [--reps r1,r2,r3,r4,r5] [--scenarios <rubric-dir>]

Reads every grades-*.csv in <grades-dir> (columns: scenario,rep,grade[,note]; grade C/P/W),
scores C=1, P=0.5, W=0, and writes a per-scenario table plus the total to <out.md>.
A scenario missing any listed rep is reported and left out of the total.
With --scenarios, every `### <id>` heading in <rubric-dir>/scenarios-*.md must have grades;
ids with none are reported as "No grades" and the run exits 1.
"""
import argparse
import collections
import csv
import glob
import os
import sys

POINTS = {"C": 1.0, "P": 0.5, "W": 0.0}


def main(argv):
    parser = argparse.ArgumentParser(usage=__doc__)
    parser.add_argument("grades_dir")
    parser.add_argument("out")
    parser.add_argument("--reps", default="r1,r2,r3,r4,r5")
    parser.add_argument("--scenarios")
    opts = parser.parse_args(argv)
    grades_dir, out, reps = opts.grades_dir, opts.out, opts.reps.split(",")
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
    ungraded = []
    if opts.scenarios:
        expected = set()
        for path in glob.glob(os.path.join(opts.scenarios, "scenarios-*.md")):
            with open(path, encoding="utf-8") as f:
                expected.update(m.split()[1] for m in f if m.startswith("### ") and len(m.split()) > 1)
        ungraded = sorted(expected - set(grades), key=order)
        if ungraded:
            lines.append("No grades: " + ", ".join(ungraded))
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(summary)
    if missing:
        print("missing:", ", ".join(missing))
    if ungraded:
        sys.exit("no grades: " + ", ".join(ungraded))


if __name__ == "__main__":
    main(sys.argv[1:])
