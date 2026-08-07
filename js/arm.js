/*
 * Funnel A/B arm — the ONE place a live test is defined.
 *
 * Loaded as a plain sync script on every page that tracks, AFTER t.js (it needs
 * the tracker session id) and BEFORE js/ph.js (which registers the arm as a
 * PostHog super property). Order on every page:
 *
 *     js/fv.js  ->  t.js  ->  js/arm.js  ->  js/ph.js
 *
 * It appends the arm to window.__fv, so the arm rides on the funnel version
 * stamp that already flows into ad_events.raw.fv. That means the analytics
 * dashboard cohorts arms with no new tooling: the Funnel version selector and
 * the "Funnel versions — did the change work?" table both work on day one.
 *
 *     js/fv.js = '0806-hook'       ->  '0806-hook__keep-hook'      / '0806-hook__skip-hook'
 *     js/fv.js = '0806-hook-test'  ->  '0806-hook-test__keep-hook' / '…__skip-hook'
 *
 * FULL RUNBOOK: docs/FUNNEL_RELEASE.md in the archives-analytics-dashboard repo
 * — what to bump, how to verify the split, how long to run, how to read it.
 *
 * MUST be deployed to BOTH funnel repos with the SAME TEST block. A test live in
 * one and not the other splits the data silently.
 */
(function () {

  /* ======================================================================
   * THE LIVE TEST.  null = no test running (the normal state).
   * ====================================================================== */
  var TEST = null;

  /* ENDED 2026-08-06: 0806-increase-initial-question-pass-rate (keep-hook vs
   * skip-hook). Removing the hook screen did not improve its own primary
   * metric -- 32.9% of skip-hook sessions answered the first question against
   * 35.0% of keep-hook -- and every downstream step was worse. The hook screen
   * is not what makes people leave. Full write-up and numbers in
   * docs/AB_TESTS.md (archives-analytics-dashboard). */

  /* TO END THIS TEST: set TEST back to null and bump js/fv.js in BOTH repos.
   * The arm suffix disappears, sessions pool again, and because the arm is
   * DERIVED and never stored there is nothing left in anyone's browser to
   * expire. Also remove the arm-'b' STEPS filter in start.html and drop SV back
   * to a single shape, or arm 'b' code will outlive the test that justified it.
   *
   * TO START THE NEXT ONE: replace the block above, make the variant's change in
   * the renderer (or in STEPS, as this one does), bump js/fv.js, deploy both
   * repos. Full runbook in docs/FUNNEL_RELEASE.md.
   */

  /* Arm names are free-form. They are appended after '__', and the dashboard
   * strips everything from '__' onwards to recognise several arms as one funnel
   * version -- so names can describe what they do instead of being a/b. Keep
   * them lowercase and hyphenated; they end up in column headers. */

  if (window.__armApplied) return;   // idempotent: never append the suffix twice
  window.__armApplied = true;
  window.__arm = null;

  if (!TEST) return;

  try {
    /* FNV-1a, 32-bit. Any decent avalanche works; this one is short and has no
       dependencies. % 100 rather than % 2 so the same function serves ramping. */
    function h32(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) % 100;
    }

    /* The arm is a PURE FUNCTION of the tracker session id — derived on every
       page, never written down.
       Why that matters: a stored arm has to survive the hop to paywall.html, and
       storage is exactly what fails here. In-app webviews dropping localStorage
       is what once put 38% of paywall views in the organic column. When storage
       fails, a stored coin flip re-rolls per page and a single journey gets
       shredded across both arms, corrupting both. t.js resolves the session id
       from localStorage, sessionStorage, a cookie, OR the ?asid= relay in the
       URL — so a derived arm survives everywhere the session does.
       atrackParams() is the only accessor that reflects the live id even when
       every storage mechanism is blocked (t.js keeps it in memory). */
    var m = String(window.atrackParams && window.atrackParams()).match(/asid=([^&]+)/);
    var sid = m ? decodeURIComponent(m[1]) : '';

    /* QA override: ?arm=a or ?arm=b pins this page load. Writes nothing — it is
       an override on the derived value, so it cannot leak into real traffic. */
    var qaRaw = (location.search.match(/[?&]arm=([a-z0-9-]+)/) || [])[1];
    var qa = TEST.arms.indexOf(qaRaw) > -1 ? qaRaw : null;

    var arm = null;
    if (qa) {
      arm = qa;
    } else if (sid) {
      /* TWO INDEPENDENT HASHES. If the arm were h32(sid) < split, then raising
         `ramp` later would move sessions across the A/B boundary mid-test and
         contaminate both arms. Hashing a different string for the arm means
         raising `ramp` only ever ADDS sessions; nobody already assigned moves. */
      if (h32(sid) < TEST.ramp) {
        arm = h32(sid + '|arm') < TEST.split ? TEST.arms[0] : TEST.arms[1];
      }
    }
    /* No sid (t.js blocked or failed) => no arm, and the session sits out the
       test. Deliberate: assigning at random without a stable id would give the
       same visitor different arms on different pages, which is worse than
       excluding them. Rare — t.js has four ways to resolve an id. */

    if (arm) {
      window.__arm = arm;
      /* Appended, so the base version stays the prefix and the dashboard's
         existing fv cohorting picks the arms up unchanged. */
      if (window.__fv) window.__fv = String(window.__fv) + '__' + arm;
    }
  } catch (e) { /* never let assignment break the funnel */ }

  /* ======================================================================
   * RENDERING A VARIANT
   * ======================================================================
   * Branch on window.__arm inside the renderer. In start.html:
   *
   *   var head = window.__arm === 'b'
   *     ? '<div class="t-hxl">Islamic history is more interesting than you think.</div>'
   *     : '<div class="t-hxl">Don\'t know where to start with Islamic history?</div>' +
   *       '<p class="t-bl muted mt8">A short quiz builds a plan…</p>';
   *
   * THIS test does not change copy — arm 'b' removes a whole screen, so the
   * change lives in start.html where STEPS is filtered. Same idea: branch, do
   * not fork the file.
   *
   * Rules that keep the arms comparable:
   *   - NEVER redirect an arm to a different HTML file. That costs it an extra
   *     page load and it will lose on that alone.
   *   - Same events and same screen keys in both arms. Rename either and the
   *     dashboard puts the arms on different rows and the ladders stop lining up.
   *   - Prefer copy-only changes, which keep screen count and order identical
   *     and leave the drop-off ladders directly comparable. When a test must
   *     change STRUCTURE (as this one does), expect two consequences: the arms
   *     have different screen indexes, so read each arm through the Funnel
   *     version selector rather than pooled; and the shared-screen metric is the
   *     one to judge on, because a screen missing from an arm is not a drop.
   *   - Change ONE thing, or a win will not tell you which half caused it.
   */
})();
