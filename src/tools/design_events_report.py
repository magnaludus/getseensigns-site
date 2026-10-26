#!/usr/bin/env python3
"""Summarise the designer's usage events. Not deployed, standard library only, no network.

Export the events/ prefix of the private R2 bucket to a folder (any layout; every *.json below it is
read), then run:

    python3 src/tools/design_events_report.py <folder of exported events/*.json>

Each file is one batch written by functions/api/design-event.js: {"day": "YYYY-MM-DD", "events": [...]}.
Prints, per day and in total: designer starts (design_start), proofs (proof_submit_ok), start-to-proof
conversion, the mobile share of proof submits, the editor_error rate and the count of every event name.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def read_batches(folder):
    """Yield (day, events) for every readable batch file; count the ones that were not."""
    batches, skipped = [], 0
    for root, _dirs, names in os.walk(folder):
        for name in sorted(names):
            if not name.endswith(".json"):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError):
                skipped += 1
                continue
            events = data.get("events") if isinstance(data, dict) else data
            if not isinstance(events, list):
                skipped += 1
                continue
            day = data.get("day") if isinstance(data, dict) else None
            if not (isinstance(day, str) and DAY.match(day)):
                parent = os.path.basename(root)
                day = parent if DAY.match(parent) else "unknown"
            batches.append((day, [e for e in events if isinstance(e, dict) and isinstance(e.get("name"), str)]))
    return batches, skipped


def pct(part, whole):
    return "-" if not whole else "%.1f%%" % (100.0 * part / whole)


def per100(part, whole):
    return "-" if not whole else "%.1f" % (100.0 * part / whole)


def table(headers, rows):
    """Plain text table: first column left aligned, the rest right aligned."""
    cells = [[str(c) for c in row] for row in [headers] + rows]
    widths = [max(len(row[i]) for row in cells) for i in range(len(headers))]
    lines = []
    for n, row in enumerate(cells):
        lines.append("  ".join(c.ljust(widths[i]) if i == 0 else c.rjust(widths[i]) for i, c in enumerate(row)))
        if n == 0:
            lines.append("  ".join("-" * w for w in widths))
    return "\n".join(lines)


def main(argv):
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        sys.stderr.write("usage: design_events_report.py <folder of exported events/*.json>\n")
        return 2
    batches, skipped = read_batches(argv[1])
    names = defaultdict(Counter)   # day -> event name -> count
    mobile = defaultdict(Counter)  # day -> event name -> count with vp == "m"
    sessions = defaultdict(set)    # day -> sids
    failed = defaultdict(set)      # day -> sids that hit an editor_error
    total_events = 0
    for day, events in batches:
        for event in events:
            name = event["name"]
            total_events += 1
            names[day][name] += 1
            if event.get("vp") == "m":
                mobile[day][name] += 1
            sid = event.get("sid")
            if isinstance(sid, str) and sid:
                sessions[day].add(sid)
                if name == "editor_error":
                    failed[day].add(sid)
    days = sorted(names)
    print("Design events report")
    print("%d events in %d batch files%s" % (total_events, len(batches), " (%d files skipped)" % skipped if skipped else ""))
    if not days:
        return 0

    def figures(label, subset):
        count = sum((names[d] for d in subset), Counter())
        phone = sum((mobile[d] for d in subset), Counter())
        sids = set().union(*[sessions[d] for d in subset])
        bad = set().union(*[failed[d] for d in subset])
        starts, submits, ok, errors = count["design_start"], count["proof_submit"], count["proof_submit_ok"], count["editor_error"]
        funnel = [label, starts, ok, pct(ok, starts), submits, pct(phone["proof_submit"], submits), pct(phone["proof_submit_ok"], ok)]
        health = [label, errors, per100(errors, starts), len(sids), pct(len(bad), len(sids))]
        return funnel, health

    rows = [figures(day, [day]) for day in days] + [figures("TOTAL", days)]
    print("\nFunnel")
    print(table(["day", "starts", "proofs", "start>proof", "submits", "mobile submits", "mobile proofs"], [f for f, _h in rows]))
    print("\nEditor errors")
    print(table(["day", "editor_error", "per 100 starts", "sessions", "sessions with error"], [h for _f, h in rows]))
    total = sum((names[d] for d in days), Counter())
    print("\nEvents by name")
    print(table(["event"] + days + ["TOTAL"], [[n] + [names[d][n] for d in days] + [total[n]] for n in sorted(total, key=lambda n: (-total[n], n))]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
