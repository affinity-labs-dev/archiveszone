/*
 * PostHog — the ONE place this funnel's PostHog setup lives.
 *
 * Loaded as a plain sync script on every page that tracks, and it MUST come
 * AFTER t.js: the register() call below reads the tracker's session id, and
 * t.js is what resolves that (from localStorage / sessionStorage / cookie, or
 * the ?asid= relay when a webview has dropped all three).
 *
 * Why a file and not the snippet pasted into each page: the funnel lives in two
 * hand-synced repos across 13 pages, and copies drift. `js/fv.js` went a month
 * missing from index.html for exactly that reason. One file, one <script> tag.
 *
 * PostHog is a PASSIVE OBSERVER here. Nothing in the funnel — assignment,
 * rendering, tracking — reads it or waits for it. array.js is injected async
 * with an onerror that nulls it out, and every posthog.capture() call site is
 * guarded by `typeof posthog !== 'undefined'`. If this fails to load, nothing
 * else changes behaviour. Keep it that way.
 *
 * The phc_ key is a publishable client key, meant to ship in HTML. It is not a
 * secret and grants no read access.
 */
(function () {
  var KEY  = 'phc_X5HfjebCIE8Y00e9p1ip2ajDT9lRsenpMGmWq5iWrP';
  var HOST = 'https://eu.i.posthog.com';

  /* Official PostHog loader stub (verbatim). Queues any call made before
     array.js arrives, which is what makes the register() below safe. */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="an ln init xn Cn Br kn In capture Fn nn calculateEventProperties On register register_once register_for_session unregister unregister_for_session Ln getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Dn identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty An Rn createPersonProfile setInternalOrTestUser $n yn jn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Tn debug Ur Rt getPageViewId captureTraceFeedback captureTraceMetric pn".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  try {
    posthog.init(KEY, {
      api_host: HOST,
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      /* The funnel already fires explicit, well-named events (select_hook,
         view_paywall, conversion…). Autocapture would additionally record a
         click for every tap on all 45 quiz screens — roughly doubling event
         volume, which is what PostHog bills on, to capture worse-labelled
         copies of data we already have. */
      autocapture: false,
      capture_pageview: true,
    });
  } catch (e) {}

  /* Super properties: stamped on EVERY event, so the PostHog data is joinable
     and cohort-aware from day one without touching the seven capture() sites.
     - archives_sid is the join key back to ad_events.session_id
     - fv is the build (plus the A/B arm suffix when a test is running), the
       same label the analytics dashboard cohorts on
     Deliberately NOT posthog.identify(sid): a new ad click mints a new session
     id, so identifying on it would create a fresh PostHog person per click and
     destroy person-level continuity and replay history. */
  var sid = null;
  try {
    var m = String(window.atrackParams && window.atrackParams()).match(/asid=([^&]+)/);
    if (m) sid = decodeURIComponent(m[1]);
  } catch (e) {}
  /* Separate try: if reading the session id fails (t.js blocked, or it threw),
     still stamp fv/arm/page rather than losing every super property with it. */
  try {
    posthog.register({
      archives_sid: sid,
      fv:   window.__fv  || null,
      arm:  window.__arm || null,
      page: location.pathname,
    });
  } catch (e) {}
})();
