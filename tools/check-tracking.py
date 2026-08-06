#!/usr/bin/env python3
"""Enforce the tracking-tag invariants that fail silently.

These rules are stated in AGENTS.md and in js/fv.js, and every one of them has
already been broken at least once in a way nobody noticed until the analytics
dashboard looked wrong days later. Nothing about a broken page looks broken in
a browser, so they are checked here instead of by eye.

    python3 tools/check-tracking.py     # exits 1 on any FAIL

Checked:

1. index.html and 404.html are byte-for-byte identical. 404.html is the SPA
   fallback for every unknown path, so it fires the same pv_home and landing
   events as the home page. When the two drift, half the home-page traffic
   silently runs different code.

2. Every funnel page loads js/fv.js, then t.js, then js/ph.js, in that order.
   Order is not cosmetic: t.js reads window.__fv at send time, so fv.js below
   it emits unstamped events, and ph.js registers the tracker session id as
   the join key back to ad_events, so ph.js above t.js has nothing to join on.

Warned (not failed) — see FV_SCOPE_NOTE below.
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FV = "/js/fv.js"
PH = "/js/ph.js"
TJS = 'src="https://track.archiveszone.app/t.js"'

# The funnel. These carry paid traffic and are the pages the dashboard cohorts
# by fv, so the full fv -> t.js -> ph.js stack is mandatory on each.
FUNNEL = [
    "index.html",
    "404.html",
    "start.html",
    "start-legacy.html",
    "paywall.html",
    "plan.html",
    "unlocked.html",
]

# Pages that must be byte-identical to each other.
MIRRORS = [("index.html", "404.html")]

FV_SCOPE_NOTE = """\
AGENTS.md says every page that fires events needs an fv stamp, but js/fv.js's
own header scopes that to the funnel pages, and the pages below have loaded
t.js without a stamp for as long as the git history goes back. That is a
pre-existing question about which pages are meant to be cohorted, not drift
introduced by a change, so it is reported and not failed. Resolve it by either
stamping these pages or narrowing the rule in AGENTS.md to match js/fv.js."""


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


def check_mirrors():
    problems = []
    for a, b in MIRRORS:
        if read(a) != read(b):
            problems.append(
                f"{a} and {b} have drifted apart; they must be byte-for-byte "
                f"identical (AGENTS.md, 'Routing'). Copy one over the other."
            )
    return problems


def _pos(haystack, needle, name, problems, label):
    """Index of needle, or None (recording a FAIL) when absent."""
    i = haystack.find(needle)
    if i < 0:
        problems.append(f"{name} does not load {label}")
        return None
    return i


def check_funnel_order():
    problems = []
    for name in FUNNEL:
        src = read(name)
        fv = _pos(src, FV, name, problems, "js/fv.js")
        tj = _pos(src, TJS, name, problems, "t.js")
        ph = _pos(src, PH, name, problems, "js/ph.js")
        if fv is None or tj is None or ph is None:
            continue
        if fv > tj:
            problems.append(
                f"{name} loads js/fv.js BELOW t.js. t.js reads window.__fv at "
                f"send time, so every event this page fires is unstamped and "
                f"lands in the dashboard's '(unversioned)' cohort."
            )
        if ph < tj:
            problems.append(
                f"{name} loads js/ph.js ABOVE t.js. ph.js registers the tracker "
                f"session id as the join key back to ad_events, and that id does "
                f"not exist yet."
            )
    return problems


def check_unstamped():
    """Pages firing events with no fv stamp of any kind. Reported, not failed."""
    unstamped = []
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith(".html"):
            continue
        src = read(name)
        if TJS not in src:
            continue
        if FV in src or "__fv" in src:
            continue
        unstamped.append(name)
    return unstamped


def main():
    if sys.argv[1:]:
        sys.exit(__doc__)

    problems = check_mirrors() + check_funnel_order()
    unstamped = check_unstamped()

    print(f"funnel pages checked: {len(FUNNEL)}")

    if unstamped:
        print(f"\nWARN  {len(unstamped)} page(s) fire events with no fv stamp:")
        for name in unstamped:
            print(f"        {name}")
        for line in FV_SCOPE_NOTE.splitlines():
            print(f"      {line}")

    for p in problems:
        print(f"\nFAIL  {p}")

    if problems:
        print(f"\n{len(problems)} problem(s).")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
