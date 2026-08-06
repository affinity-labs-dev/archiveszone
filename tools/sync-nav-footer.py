#!/usr/bin/env python3
"""Single source of truth for the shared navbar and footer.

This repo is deployed static output with no build step, so the shared chrome is
physically duplicated in every HTML page *and* in the React chunk that re-renders
it after hydration. This script owns that duplication: edit the LINKS section
below, run with --write, and every copy is regenerated from it.

    python3 tools/sync-nav-footer.py            # check only, exits 1 on drift
    python3 tools/sync-nav-footer.py --write    # rewrite the HTML pages

It rewrites HTML only. The React chunk (assets/SiteFooter-*.js) is minified and
cannot be safely regenerated, so it is verified instead: if it disagrees with the
config the script fails and prints what to change by hand.

See AGENTS.md for the full workflow.
"""

from __future__ import annotations

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# LINKS - the single source of truth. Edit here, then run with --write.
# ---------------------------------------------------------------------------

WEB_APP_URL = "https://web.archiveszone.app/"
AFFINITY_URL = "https://affinitylabs.ai"
TAGLINE = "Turning Islamic history into a daily habit. One five-minute story at a time."
COPYRIGHT = "\u00a9 2026 Archives. All rights reserved."

# Navbar entries that ARE react-router routes. Rendered with <Link> in the React
# chunk so they navigate client-side.
NAV_SPA = [
    ("/schools", "For Schools"),
    ("/mosques", "For Mosques"),
    ("/podcast", "Podcast"),
]

# Navbar entries that are standalone HTML pages, NOT react-router routes. These
# must be plain <a> everywhere: a <Link> would be intercepted by the router,
# match nothing, and render the SPA's 404 page until you force a reload.
NAV_STANDALONE = [
    ("/islamic-quiz", "Quizzes"),
    ("/free-islamic-studies-online", "Free Lessons"),
]

FOOTER_MAIN = [
    ("/", "Home"),
    ("/schools", "For Schools"),
    ("/mosques", "For Mosques"),
    ("/podcast", "Podcast"),
]

FOOTER_LEARN = [
    ("/islamic-quiz", "Islamic Quiz"),
    ("/islamic-quiz-for-kids", "Quiz for Kids"),
    ("/seerah-quiz", "Seerah Quiz"),
    ("/quran-quiz", "Quran Quiz"),
    ("/online-islamic-studies-for-kids", "Islamic Studies for Kids"),
    ("/free-islamic-studies-online", "Free Islamic Studies"),
]

FOOTER_LEGAL = [
    ("/privacy", "Privacy"),
    ("/terms", "Terms"),
    ("/support", "Support"),
]

# ---------------------------------------------------------------------------
# Markup
# ---------------------------------------------------------------------------

NAV_CLS = "text-sm font-semibold text-onyx/70 hover:text-blue transition-colors"
FOOT_CLS = "hover:text-white transition-colors"
ROW_CLS = "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm"
DOT = '<span class="text-white/30" aria-hidden="true">\u00b7</span>'

NAV_RE = re.compile(r'<div class="hidden lg:flex items-center gap-8">.*?</div>', re.S)
FOOTER_RE = re.compile(r'<footer class="bg-onyx py-14 text-white">.*?</footer>', re.S)
# vite-react-ssg marker: these pages hydrate, so their markup must match the chunk.
SSG_MARKER = "__VITE_REACT_SSG_HASH__"


def _emit(parts, pretty, base):
    """parts is a list of (depth, html). Minified output must have no whitespace
    between tags or React will report a hydration mismatch on the SSG pages."""
    if not pretty:
        return "".join(html for _, html in parts)
    out = [parts[0][1]]
    out += [" " * (base + 2 * depth) + html for depth, html in parts[1:]]
    return "\n".join(out)


def _row(links, depth, extra_html=None):
    """One footer nav row: links joined by dot separators, separator glued to the
    end of the preceding line so pretty output stays one link per line."""
    items = [f'<a class="{FOOT_CLS}" href="{href}">{text}</a>' for href, text in links]
    if extra_html:
        items.append(extra_html)
    return [(depth, item + (DOT if i < len(items) - 1 else "")) for i, item in enumerate(items)]


def render_nav(pretty, base):
    web_app = (
        f'<a href="{WEB_APP_URL}" target="_blank" rel="noopener noreferrer" '
        f'class="{NAV_CLS}">Web App</a>'
    )
    parts = [(0, '<div class="hidden lg:flex items-center gap-8">')]
    parts += [(1, f'<a class="{NAV_CLS}" href="{href}">{text}</a>') for href, text in NAV_SPA]
    parts += [(1, f'<a class="{NAV_CLS}" href="{href}">{text}</a>') for href, text in NAV_STANDALONE]
    parts += [(1, web_app), (0, "</div>")]
    return _emit(parts, pretty, base)


def render_footer(pretty, base):
    web_app = (
        f'<a href="{WEB_APP_URL}" target="_blank" rel="noopener noreferrer" '
        f'class="{FOOT_CLS}">Web App</a>'
    )
    parts = [
        (0, '<footer class="bg-onyx py-14 text-white">'),
        (1, '<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">'),
        (2, '<img src="/images/logo-dark.png" alt="Archives" class="mx-auto h-7 w-auto '
            'object-contain brightness-0 invert" loading="lazy" decoding="async" '
            'width="752" height="166">'),
        (2, f'<p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/60">{TAGLINE}</p>'),
        (2, f'<nav class="mt-8 {ROW_CLS} text-white/60" aria-label="Footer">'),
        *_row(FOOTER_MAIN, 3, web_app),
        (2, "</nav>"),
        (2, f'<nav class="mt-3 {ROW_CLS} text-white/60" aria-label="Quizzes and lessons">'),
        *_row(FOOTER_LEARN, 3),
        (2, "</nav>"),
        (2, f'<nav class="mt-3 {ROW_CLS} text-white/50" aria-label="Legal">'),
        *_row(FOOTER_LEGAL, 3),
        (2, "</nav>"),
        (2, '<div class="mt-7 flex items-center justify-center gap-2">'),
        (3, '<span class="text-sm text-white/50">Powered by</span>'),
        (3, f'<a href="{AFFINITY_URL}" target="_blank" rel="noopener noreferrer" '
            'class="opacity-80 hover:opacity-100 transition-opacity">'
            '<img src="/lovable-uploads/affinity-labs-logo.webp" alt="Affinity Labs" '
            'class="h-5 w-auto object-contain" loading="lazy" decoding="async"></a>'),
        (2, "</div>"),
        (2, f'<p class="mt-6 text-xs text-white/30">{COPYRIGHT}</p>'),
        (1, "</div>"),
        (0, "</footer>"),
    ]
    return _emit(parts, pretty, base)


def indent_of(text, pos):
    line_start = text.rfind("\n", 0, pos) + 1
    return len(text[line_start:pos]) - len(text[line_start:pos].lstrip())


# ---------------------------------------------------------------------------
# HTML sync
# ---------------------------------------------------------------------------

def sync_html(write):
    problems, changed, seen = [], [], 0
    for path in sorted(glob.glob(os.path.join(ROOT, "*.html"))):
        name = os.path.basename(path)
        src = open(path, encoding="utf-8").read()
        # SSG pages hydrate, so they must stay minified to match the React chunk.
        pretty = SSG_MARKER not in src
        out = src

        for regex, render in ((NAV_RE, render_nav), (FOOTER_RE, render_footer)):
            m = regex.search(out)
            if not m:
                continue
            if len(regex.findall(out)) != 1:
                problems.append(f"{name}: expected 1 block, found {len(regex.findall(out))}")
                continue
            want = render(pretty, indent_of(out, m.start()))
            if m.group(0) != want:
                out = out[: m.start()] + want + out[m.end():]

        if out != src:
            changed.append(name)
            if write:
                open(path, "w", encoding="utf-8").write(out)
        if NAV_RE.search(src) or FOOTER_RE.search(src):
            seen += 1

    return seen, changed, problems


# ---------------------------------------------------------------------------
# React chunk verification
# ---------------------------------------------------------------------------

def spa_routes():
    routes = set()
    for path in glob.glob(os.path.join(ROOT, "assets", "app-*.js")):
        for p in re.findall(r'path:"([^"]*)"', open(path, encoding="utf-8").read()):
            if p != "*":
                routes.add("/" + p.lstrip("/") if p != "/" else "/")
    return routes


def verify_chunk():
    """The chunk re-renders nav/footer after hydration, so it has to agree with
    the config. It is minified, so we verify rather than rewrite it."""
    problems = []
    chunks = glob.glob(os.path.join(ROOT, "assets", "SiteFooter-*.js"))
    if len(chunks) != 1:
        return [f"expected 1 assets/SiteFooter-*.js, found {len(chunks)}"]
    js = open(chunks[0], encoding="utf-8").read()
    tag = os.path.basename(chunks[0])

    link_id = re.search(r"\bL as ([A-Za-z_$]+)\b", js)
    if not link_id:
        return [f"{tag}: could not find the react-router Link import (`L as ?`)"]
    link_id = link_id.group(1)

    def arr(key, name):
        m = re.search(rf"{name}=\[(\{{{key}:.*?)\](?=,|;)", js)
        if not m:
            return None
        return [(a, b) for a, b in re.findall(rf'{key}:"([^"]+)",label:"([^"]+)"', m.group(1))]

    if arr("to", "l") != NAV_SPA:
        problems.append(f"{tag}: nav array `l` is {arr('to','l')}, config NAV_SPA is {NAV_SPA}")
    if arr("href", "q") != NAV_STANDALONE:
        problems.append(f"{tag}: nav array `q` is {arr('href','q')}, config NAV_STANDALONE is {NAV_STANDALONE}")

    # Footer rows, in document order.
    jsx = re.compile(
        rf'e\.jsx\((?:{re.escape(link_id)}|"a"),\{{(?:to|href):"([^"]+)"[^}}]*?children:"([^"]*)"\}}'
    )
    for label, want in (
        ("Footer", FOOTER_MAIN + [(WEB_APP_URL, "Web App")]),
        ("Quizzes and lessons", FOOTER_LEARN),
        ("Legal", FOOTER_LEGAL),
    ):
        m = re.search(rf'"aria-label":"{label}",children:\[(.*?)\]\}}\)', js, re.S)
        if not m:
            problems.append(f'{tag}: footer row "{label}" not found')
            continue
        got = jsx.findall(m.group(1))
        if got != want:
            problems.append(f'{tag}: footer row "{label}" is {got}, config says {want}')

    # The bug class this script exists to prevent: a router Link aimed at a page
    # the router has no route for renders the SPA 404 until the user reloads.
    routes = spa_routes()
    for href in re.findall(rf'e\.jsx\({re.escape(link_id)},\{{to:"(/[^"]*)"', js):
        if href not in routes:
            problems.append(f"{tag}: <Link to=\"{href}\"> but that is not a react-router route - use a plain <a href>")
    for href, _ in re.findall(r'\{to:"(/[^"]+)",label:"([^"]+)"\}', js):
        if href not in routes:
            problems.append(f"{tag}: `l` contains {href}, which is not a react-router route - move it to `q`")

    return problems


# ---------------------------------------------------------------------------
# Link sanity
# ---------------------------------------------------------------------------

def verify_links():
    problems, warnings = [], []
    sitemap_path = os.path.join(ROOT, "sitemap.xml")
    sitemap = open(sitemap_path, encoding="utf-8").read() if os.path.exists(sitemap_path) else ""

    every = FOOTER_MAIN + FOOTER_LEARN + FOOTER_LEGAL + NAV_SPA + NAV_STANDALONE
    for href, _ in every:
        # GitHub Pages resolves /foo to foo.html.
        target = "index.html" if href == "/" else href.lstrip("/") + ".html"
        if not os.path.exists(os.path.join(ROOT, target)):
            problems.append(f"link {href} has no file ({target})")
            continue
        page = open(os.path.join(ROOT, target), encoding="utf-8").read()
        noindex = re.search(r'name="robots"[^>]*content="[^"]*noindex', page)
        listed = f"archiveszone.app{href}<" in sitemap or (
            href == "/" and "archiveszone.app/<" in sitemap
        )
        if not noindex and not listed:
            warnings.append(f"link {href} is indexable but missing from sitemap.xml")
    return problems, warnings


def main():
    write = "--write" in sys.argv[1:]
    if set(sys.argv[1:]) - {"--write", "--check"}:
        sys.exit(__doc__)

    seen, changed, html_problems = sync_html(write)
    chunk_problems = verify_chunk()
    link_problems, warnings = verify_links()

    print(f"pages with shared chrome: {seen}")
    if changed:
        verb = "rewrote" if write else "out of date"
        print(f"{verb}: {len(changed)}")
        for name in changed:
            print(f"  {name}")
    else:
        print("all pages match the config")

    for w in warnings:
        print(f"WARN  {w}")

    problems = html_problems + chunk_problems + link_problems
    for p in problems:
        print(f"FAIL  {p}")

    if problems:
        print(f"\n{len(problems)} problem(s). The React chunk is minified and is never rewritten "
              "automatically - fix it by hand, then re-run.")
        return 1
    if changed and not write:
        print("\nRun with --write to apply.")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
