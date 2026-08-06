# Working in this repo

`archiveszone.app` is served directly from this repository by GitHub Pages. **There is
no build step and no source checkout here** — these files *are* the deployed site. You
edit built output, including minified JavaScript, and it goes live on push.

Historically this repo received `Deploy <sha>` commits from a separate React source
repo. That is no longer the workflow; this repo is now the source of truth. If you find
yourself looking for `src/`, there isn't one.

## Before you ship a funnel change — read the release checklist

If you are touching the funnel (`start.html`, `paywall.html`, `plan.html`,
`unlocked.html`, `index.html`/`404.html`) or anything that fires tracking events,
follow **`docs/FUNNEL_RELEASE.md` in the `archives-analytics-dashboard` repo**
before deploying, and run its post-deploy checks afterwards.

It is there and not here because the funnel lives in **two** repos that are synced
by hand — this one (canonical, `archiveszone.app`) and `archives-web2app-test`
(the Vercel ads mirror that takes 100% of paid Meta traffic). A checklist copied
into both would drift exactly the way the funnels already do.

The short version, because these fail silently and are expensive to notice late:

- **Adding, removing, reordering or renaming a screen means bumping `js/fv.js`
  in BOTH repos** (bare label here, `-test` suffix on the mirror), and bumping
  `SV` in `start.html`. Skip the `fv` bump and the dashboard merges two different
  funnels into one cohort — it has already happened once, and the mixed window
  stays mixed forever.
- **A screen's `key` is its permanent identity in analytics.** Never reuse one for
  a different question; retire it and mint a new one.
- **Any page that fires events needs `js/fv.js` loaded as a plain sync script
  ABOVE `t.js`.** `t.js` reads `window.__fv` at send time, so the wrong order
  emits unstamped events. `index.html` and `404.html` went a month without it.
- **Running an A/B test?** The mechanism and the traps (which metrics can
  actually move, why `landing` will not be per-arm, how long to run) are in the
  same document.

## Routing

GitHub Pages serves `/foo` from `foo.html`, so every internal link is extensionless
(`/islamic-quiz`, not `/islamic-quiz.html`). Unknown paths fall back to `404.html`,
which is a byte-for-byte copy of `index.html` acting as the SPA shell. If you change
`index.html`, mirror it to `404.html`.

## Two kinds of pages

| Kind | How to spot it | Examples |
| --- | --- | --- |
| React SSG | contains `__VITE_REACT_SSG_HASH__`, markup is minified onto one line | `index.html`, `family.html`, `schools.html`, `podcast.html` |
| Hand-written | plain indented HTML, no React bundle; loads `/css/site.css`, and the quiz pages also load `/js/quiz-*.js` | `islamic-quiz.html`, `seerah-quiz.html`, `free-islamic-studies-online.html` |

React SSG pages are prerendered *and* hydrate from `assets/app-*.js`. Their visible
markup exists twice: once as HTML in the file, and once as JSX inside a chunk that
re-renders it in the browser. **Editing only the HTML does not work** — React will
overwrite it a moment after load, so crawlers that execute JavaScript see your change
disappear. Whenever you touch shared UI on an SSG page, change the chunk too.

Hand-written pages have no React at all. What you write is what ships.

## The rule that breaks the site silently

Internal links to hand-written pages must be plain `<a href="/...">`, never a
react-router `Link`.

The router only has routes for `/`, `schools`, `mosques`, `podcast`, `curiosity`,
`family`, `reconnect`, `privacy`, `terms`, `support` and a handful of funnel pages, plus
a `*` catch-all. The quiz and studies pages are not routes. A `Link` to one is
intercepted by the router, matches only the catch-all, and renders the SPA's 404 page.
The URL changes but the real page never loads until you force a reload — which makes it
look like a server problem when it isn't.

Get the full list of real routes with:

```bash
grep -o 'path:"[^"]*"' assets/app-*.js | sort -u
```

## Shared navbar and footer

The navbar and footer appear on 17 pages and in `assets/SiteFooter-*.js`. That's 18
copies with nothing keeping them in sync, so they are owned by a script rather than
edited by hand:

```bash
python3 tools/sync-nav-footer.py            # verify; exits 1 on drift
python3 tools/sync-nav-footer.py --write    # regenerate the HTML
```

The link lists live in the `LINKS` section at the top of that file: `NAV_SPA`,
`NAV_STANDALONE`, `FOOTER_MAIN`, `FOOTER_LEARN`, `FOOTER_LEGAL`. Edit those, never the
markup in the pages.

The script rewrites HTML only. It emits minified markup for SSG pages (whitespace
between tags causes hydration mismatches) and indented markup for hand-written pages,
matching each file's existing style.

It **verifies but never rewrites** `assets/SiteFooter-*.js`, because that file is
minified and can't be regenerated safely. It fails, with the exact change spelled out,
when the chunk's nav arrays or footer rows disagree with the config, when a `Link`
points at something that isn't a route, when a link has no corresponding file, and it
warns when an indexable page is missing from `sitemap.xml`.

## Adding a new standalone page

1. Create `your-page.html`. Copying an existing quiz page gives you the right head,
   fonts, navbar and footer shell.
2. Add it to `sitemap.xml` unless it is `noindex`.
3. Add it to `FOOTER_LEARN` in `tools/sync-nav-footer.py`, and to `NAV_STANDALONE` if it
   deserves a navbar slot. The navbar holds about six items before it overflows at the
   `lg` breakpoint (1024px), so check the layout if you add one.
4. Run `python3 tools/sync-nav-footer.py --write`.
5. Hand-edit `assets/SiteFooter-*.js` to match (see below), then re-run the script with
   no arguments until it prints `OK`.
6. Preview and click the new links (see below).

## Hand-editing the React chunk

`assets/SiteFooter-*.js` holds both the header and the footer. It is minified but
readable. Two arrays drive the navbar:

- `l` — react-router routes, rendered with `Link`, navigate client-side.
- `q` — standalone pages, rendered as plain `<a>`, cause a full page load.

Putting a standalone page in `l` reintroduces the 404 bug described above. The script
catches it, but understand why before you move things between the arrays.

Footer links follow one of two shapes. Use the first for real routes and the second for
standalone pages:

```js
e.jsx(s,{to:"/schools",className:"hover:text-white transition-colors",children:"For Schools"})
e.jsx("a",{href:"/seerah-quiz",className:"hover:text-white transition-colors",children:"Seerah Quiz"})
```

Keep the order identical to the config, since the script compares them positionally, and
the prerendered HTML has to match what the chunk renders. Separators between links are
`<span class="text-white/30" aria-hidden="true">·</span>`, present between every pair
and absent after the last link.

Always syntax-check afterwards. A stray character here white-screens every page:

```bash
cp assets/SiteFooter-*.js /tmp/c.mjs && node --check /tmp/c.mjs
```

## Asset filename hashes are stale

Filenames like `SiteFooter-BUtO2PCw.js` embed a content hash from the original build.
Hand-editing the contents makes the hash wrong. Nothing breaks, because every page
references the file by name, but browsers that already cached it keep the old copy until
GitHub Pages' roughly ten-minute cache expires. Expect a short delay before an edit is
visible to returning visitors, and hard-reload when testing.

## Previewing locally

Use the included server. A plain static server is not sufficient because it won't map
`/islamic-quiz` to `islamic-quiz.html` or fall back to `404.html`:

```bash
python3 tools/serve.py        # http://localhost:8080
```

It sends `Cache-Control: no-store`, so a normal reload picks up edits.

When you change shared UI, verify in a browser rather than by reading the HTML: load a
React page such as `/`, confirm your links survive hydration instead of vanishing a
moment after load, check the console for hydration warnings, and click through to a
hand-written page to confirm it loads on the first click rather than showing the 404
page.
