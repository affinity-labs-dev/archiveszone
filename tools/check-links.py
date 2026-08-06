#!/usr/bin/env python3
"""Every page carries the internal links that make the standalone pages crawlable.

    python3 tools/check-links.py     # exits 1 on any FAIL

Replaces the chunk/HTML verification in tools/sync-nav-footer.py, which is not
usable against this tree any more. That script owned the shared chrome when this
repo was hand-edited: it emitted exact markup and compared byte-for-byte, and it
pattern-matched minified variable names inside assets/SiteFooter-*.js.

Both assumptions are now false. The chrome is rendered by SiteHeader.tsx and
SiteFooter.tsx in affinity-labs-dev/archives, and React writes attributes in its
own order (`href` before `class`, where the script emitted `class` first) — the
same links, byte-different. The chunk is rebuilt on every deploy, so its
minified identifiers change and cannot be matched by name.

So this checks the thing that actually matters and survives a rebuild: are the
links present, pointing where they should. Attribute order, class lists and
minified names are all irrelevant to that.

What it does NOT check, because no cheap check can: that a link to a standalone
page is a plain <a> rather than a react-router <Link>. A <Link> is intercepted
by the router, matches only the `*` catch-all and renders the SPA's 404 — the
URL changes but the page never loads. That rule lives in the components, and is
commented there. If these pages ever start rendering the SPA 404 on click, that
is the first thing to look at.
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Standalone pages in public/ — not react-router routes. Every page carrying the
# shared chrome must link to them, or they are orphaned: before 2026-08-05
# nothing on the site pointed at them at all.
STANDALONE = [
    "/islamic-quiz",
    "/islamic-quiz-for-kids",
    "/seerah-quiz",
    "/quran-quiz",
    "/online-islamic-studies-for-kids",
    "/free-islamic-studies-online",
]

# The footer row that carries them. Named by its aria-label, which is stable
# across React and hand-written markup alike.
FOOTER_ROW = 'aria-label="Quizzes and lessons"'

# Pages with the shared chrome. Identified by the footer, not by a filename
# list, so a new page is covered the moment it renders the footer.
CHROME_MARKER = '<footer class="bg-onyx'


def pages():
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith(".html"):
            continue
        with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
            src = fh.read()
        if CHROME_MARKER in src:
            yield name, src


def main():
    if sys.argv[1:]:
        sys.exit(__doc__)

    problems = []
    seen = 0

    for name, src in pages():
        seen += 1
        # href="..." with either quote style, order-independent.
        hrefs = set(re.findall(r'href=["\']([^"\']+)["\']', src))
        missing = [h for h in STANDALONE if h not in hrefs]
        if missing:
            problems.append(f"{name} is missing links to: {', '.join(missing)}")
        if FOOTER_ROW not in src:
            problems.append(f'{name} has no {FOOTER_ROW} nav row')

    print(f"pages with shared chrome: {seen}")
    if not seen:
        problems.append(
            "no pages with the shared chrome found — the footer markup changed "
            "and this check is now blind. Update CHROME_MARKER."
        )

    for p in problems:
        print(f"\nFAIL  {p}")

    if problems:
        print(f"\n{len(problems)} problem(s).")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
