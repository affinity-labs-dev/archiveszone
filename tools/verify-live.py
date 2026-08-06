#!/usr/bin/env python3
"""Confirm archiveszone.app is actually serving this commit.

    python3 tools/verify-live.py                    # poll until live, or fail
    python3 tools/verify-live.py --timeout 300      # give up sooner
    python3 tools/verify-live.py --once             # single check, no polling

Why this exists: `actions/deploy-pages` caps its `timeout` input at 600000ms
and clamps anything larger ("timeout value is greater than the allowed maximum
- timeout set to the maximum of 600000 milliseconds"). Since 2026-08-06 the
Pages backend has needed longer than that for this site, so the action reports
`Timeout reached, aborting!` and cancels — while Pages goes on to publish
anyway a few minutes later. The action's verdict therefore says nothing useful
about whether the site updated, in either direction:

  - It failed at 11:40 and the site did NOT update.
  - It failed at 14:28 and the site DID update, three minutes later.

So the deploy job asks this script instead. It compares what the origin is
actually serving against the files in this checkout, which answers the only
question that matters: does production match this commit?

If nothing changed in these files, this passes immediately — correctly. The
question is whether production matches, not whether bytes moved.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_BASE = "https://archiveszone.app"

# One of each kind of page, plus the two tracking scripts whose absence was the
# 2026-08-06 outage. index.html covers the React SSG build (its embedded
# __VITE_REACT_SSG_HASH__ changes on every build, so it is the most sensitive
# marker we have); unlocked.html covers the funnel; islamic-quiz.html covers
# the hand-written pages and the shared chrome.
PATHS = [
    "/index.html",
    "/unlocked.html",
    "/islamic-quiz.html",
    "/js/fv.js",
    "/js/ph.js",
]


def fetch(url):
    # Cache-buster in the query string plus a no-cache header: GitHub Pages
    # fronts the origin with a CDN that would otherwise happily serve the
    # previous deploy for several minutes and make a live site look stale.
    req = urllib.request.Request(
        f"{url}?_cb={time.time_ns()}",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def local(path):
    with open(os.path.join(ROOT, path.lstrip("/")), "rb") as fh:
        return fh.read()


def check(base):
    """Returns [] when every path matches, else a list of what does not."""
    stale = []
    for path in PATHS:
        want = local(path)
        try:
            got = fetch(base + path)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            stale.append(f"{path}: fetch failed ({exc})")
            continue
        if got != want:
            stale.append(f"{path}: {len(got)}B served != {len(want)}B in this commit")
    return stale


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--timeout", type=int, default=1500, help="seconds (default 25min)")
    ap.add_argument("--interval", type=int, default=20, help="seconds between polls")
    ap.add_argument("--once", action="store_true", help="check once and exit")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    deadline = time.monotonic() + args.timeout
    attempt = 0

    while True:
        attempt += 1
        stale = check(base)
        if not stale:
            print(f"OK  {base} matches this commit (attempt {attempt})")
            return 0

        remaining = deadline - time.monotonic()
        if args.once or remaining <= 0:
            print(f"\nFAIL  {base} is NOT serving this commit:")
            for s in stale:
                print(f"        {s}")
            print(
                "\nProduction is stale, not broken — it is still serving the previous\n"
                "deploy. Check the Pages deployment before assuming this shipped."
            )
            return 1

        print(f"  attempt {attempt}: {len(stale)} path(s) stale, "
              f"{int(remaining)}s left", flush=True)
        time.sleep(min(args.interval, max(1, remaining)))


if __name__ == "__main__":
    sys.exit(main())
