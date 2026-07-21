/*
 * Funnel version stamp — the ONE place the funnel's version label lives.
 *
 * t.js reads window.__fv and stamps it on every tracking event (raw.fv), so
 * the analytics dashboard's "Funnel versions" section can cohort sessions by
 * the exact build they saw (survives caching and mid-session deploys).
 *
 * BUMP THIS on every meaningful funnel change, in the same PR as the change,
 * and log the deploy in the dashboard's funnel_deploys table (see the
 * Analytics Dashboard repo). Keep labels short, unique, and descriptive —
 * date + what changed. Don't bump for typo-level tweaks: every label becomes
 * a column in the version comparison table.
 *
 * Must load BEFORE t.js (plain sync script, no async/defer) on every page
 * that tracks: start.html, paywall.html, unlocked.html, plan.html.
 */
window.__fv = '0721-checkout-email';
