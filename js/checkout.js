/* Archives shared web checkout (RevenueCat Web Billing + tracking helpers).
   Extracted from paywall.html so paywall.html and plan.html run ONE checkout
   implementation — never copy-paste this block back into a page.

   Exposes window.ArchivesCheckout. Pages own their UI (plan cards, buttons);
   this module owns: RC SDK loading, offering resolution (incl. the winback
   offering switch), package matching, purchase + unlocked.html redirect,
   store fallback, and the TikTok pixel/CAPI helpers.

   Offer resolution: the web funnel's DEFAULT offering is 'web_v2' (intro-priced
   annual, no trial, lifetime anchor) — no URL param needed. offer='wb40' still
   prefers the 'winback' offering (drip emails), offer='webv2' is a now-redundant
   alias for the default, and offer='std' is the QA escape hatch that forces the
   plain current-first resolution. If a preferred offering doesn't exist,
   everything silently falls back to the current offering — degraded, never
   broken, and resolveOfferContext() derives its copy mode from the RESOLVED
   package's actual pricing phases so no state can show copy that contradicts
   what Stripe charges. */
(function () {
  'use strict';

  var RC_WEB_API_KEY = 'rcb_yQedavJlsbzBERTqkBYHIDtKYkDq'; // production Web Billing key
  var SUPABASE_URL = 'https://kcgiugdfudbwtjjsvwia.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjZ2l1Z2RmdWRid3RqanN2d2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxOTYxNjgsImV4cCI6MjA2NDc3MjE2OH0.i4q-ZtYzdP6OuotC7Rk1EGC09oW9xj0iA5NQTCXOKTc';

  // offer URL param -> RC Offering identifier. 'std' maps to '' = "no named
  // offering preference" (plain current-first resolution; QA escape hatch and
  // it cannot be overridden by the default). Absent/unknown params fall
  // through to DEFAULT_OFFER_NAME.
  var OFFER_TO_OFFERING = { wb40: 'winback', webv2: 'web_v2', std: '' };
  // The web funnel's default offering. Reverting this one line to '' restores
  // the old current-first behavior on every page (rollback lever).
  var DEFAULT_OFFER_NAME = 'web_v2';

  var _rc = null, _RC = null;

  function rcConfigured() { return !!RC_WEB_API_KEY; }

  async function rcInstance() {
    if (_rc) return _rc;
    var mod = await import('https://cdn.jsdelivr.net/npm/@revenuecat/purchases-js@1/+esm');
    _RC = mod.Purchases;
    _rc = _RC.configure({ apiKey: RC_WEB_API_KEY, appUserId: _RC.generateRevenueCatAnonymousAppUserId() });
    return _rc;
  }

  /* ---- offering / package helpers (moved verbatim from paywall.html) ---- */
  function allOfferings(offerings) {
    var offs = [];
    if (offerings.current) offs.push(offerings.current);
    if (offerings.all) Object.keys(offerings.all).forEach(function (k) {
      if (offerings.all[k] !== offerings.current) offs.push(offerings.all[k]);
    });
    return offs;
  }

  /* Like allOfferings, but the preferred offering (the offer param's mapping,
     or DEFAULT_OFFER_NAME when the param is absent/unknown) is searched FIRST
     so its packages win package matching. offer='std' explicitly yields the
     plain list. Missing offering -> plain list (silent fallback). */
  function resolveOfferings(offerings, offer) {
    var offs = allOfferings(offerings);
    var name = Object.prototype.hasOwnProperty.call(OFFER_TO_OFFERING, offer || '')
      ? OFFER_TO_OFFERING[offer || '']
      : DEFAULT_OFFER_NAME;
    if (!name || !offerings.all || !offerings.all[name]) return offs;
    var target = offerings.all[name];
    return [target].concat(offs.filter(function (o) { return o !== target; }));
  }

  function prodId(pk) {
    var pr = pk.webBillingProduct || pk.rcBillingProduct || pk.product || {};
    return pr.identifier || '';
  }

  function pkgPrice(pk) {
    var pr = pk.webBillingProduct || pk.rcBillingProduct || pk.product || {};
    var cp = pr.currentPrice || pr.price || {};
    return cp.formattedPrice || cp.formatted ||
      (cp.amountMicros ? ('$' + (cp.amountMicros / 1e6).toFixed(2)) :
        (typeof cp.amount === 'number' ? ('$' + (cp.amount / 100).toFixed(2)) : ''));
  }

  /* Intro-offer price (e.g. the winback $29.99 first year). currentPrice
     returns the BASE price for intro products, so offer displays must read
     the intro phase explicitly or the card shows $49.99 while Stripe
     charges $29.99. */
  function pkgIntro(pk) {
    var pr = pk && (pk.webBillingProduct || pk.rcBillingProduct || pk.product || {});
    var opt = pr.defaultSubscriptionOption || {};
    var ip = opt.introPrice;
    if (!ip || !ip.price) return null;
    var p = ip.price;
    var formatted = p.formattedPrice ||
      (p.amountMicros ? ('$' + (p.amountMicros / 1e6).toFixed(2)) :
        (typeof p.amount === 'number' ? ('$' + (p.amount / 100).toFixed(2)) : null));
    var value = p.amountMicros ? p.amountMicros / 1e6 :
      (typeof p.amount === 'number' ? p.amount / 100 : null);
    return formatted ? { formatted: formatted, value: value, cycles: (ip.cycleCount || ip.cycles || null) } : null;
  }

  /* Free-trial phase on the resolved package (e.g. the legacy current-offering
     annual). Lets fallback copy describe the LIVE product truthfully instead of
     hardcoding "7-day free trial". Returns { days } (days null when the phase
     exists but its duration can't be parsed) or null when there is no trial. */
  function pkgTrial(pk) {
    var pr = pk && (pk.webBillingProduct || pk.rcBillingProduct || pk.product || {});
    var opt = (pr && pr.defaultSubscriptionOption) || {};
    var tr = opt.trial || opt.trialPhase || null;
    if (!tr) return null;
    var days = null;
    var iso = tr.periodDuration || (typeof tr.period === 'string' ? tr.period : '');
    var m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(iso || '');
    if (m && (m[1] || m[2] || m[3] || m[4])) {
      days = (+m[1] || 0) * 365 + (+m[2] || 0) * 30 + (+m[3] || 0) * 7 + (+m[4] || 0);
    } else if (tr.period && tr.period.unit != null) {
      var n = tr.period.number || tr.period.value || 0;
      var u = String(tr.period.unit).toLowerCase();
      days = n * (u.indexOf('year') === 0 ? 365 : u.indexOf('month') === 0 ? 30 : u.indexOf('week') === 0 ? 7 : u.indexOf('day') === 0 ? 1 : 0) || null;
    }
    return { days: days || null };
  }

  /* True only when the matched product is genuinely a one-time purchase — the
     lifetime card and its "forever" copy must never render against a recurring
     product (e.g. the spec's quarterly substitute). */
  function pkgOneTime(pk) {
    var pr = pk && (pk.webBillingProduct || pk.rcBillingProduct || pk.product || {});
    if (!pr || !pr.identifier) return false;
    var t = String(pr.productType || pr.product_type || '').toLowerCase();
    // Live Web Billing reports 'subscription' vs 'non_consumable' (verified
    // against Lifetime_web_v2 2026-07-21); anything that isn't a subscription
    // type counts as one-time.
    if (t) return t !== 'subscription' && t.indexOf('renewable_subscription') === -1;
    return !pr.defaultSubscriptionOption && !pr.normalPeriodDuration;
  }

  function pkgValue(pk) {
    var pr = pk && (pk.webBillingProduct || pk.rcBillingProduct || pk.product || {});
    var cp = (pr && (pr.currentPrice || pr.price)) || {};
    var amt = cp.amountMicros ? cp.amountMicros / 1e6 : (typeof cp.amount === 'number' ? cp.amount / 100 : null);
    return { value: (amt != null ? Math.round(amt * 100) / 100 : null), currency: cp.currency || cp.currencyCode || 'USD' };
  }

  function findPkg(offs, id, kw) {
    for (var i = 0; i < offs.length; i++) {
      var o = offs[i];
      if (o.packagesById && o.packagesById[id]) return o.packagesById[id];
      var ap = o.availablePackages || [];
      for (var j = 0; j < ap.length; j++) {
        var pk = ap[j];
        if (pk.identifier === id || prodId(pk) === id) return pk;
      }
    }
    if (kw) {
      var k = kw.toLowerCase();
      for (var a = 0; a < offs.length; a++) {
        var ap2 = offs[a].availablePackages || [];
        for (var b = 0; b < ap2.length; b++) {
          var pk2 = ap2[b];
          if ((pk2.identifier || '').toLowerCase().indexOf(k) > -1 || prodId(pk2).toLowerCase().indexOf(k) > -1) return pk2;
        }
      }
    }
    return null;
  }

  /* ---- offer context: the ONE resolution both pages render from ----
     Turns (offer param, page plan defs) into everything a page needs for
     truthful pricing. Decorates planDefs IN PLACE and resolves:
       mode  'winback' | 'intro' | 'trial' | 'plain' — derived from the
             RESOLVED annual package's actual pricing phases, never from
             offering presence or static flags. An offering that resolves but
             whose intro price fails to load renders 'plain' (bills today at
             the listed price — exactly what Stripe will do), never trial copy.
       plans decorated planDefs: pkgObj, amt, stdAmt, was, savePct, perDay,
             perMo, trialDays
       lifetimePkg  only in intro mode, only when the matched product is
             genuinely one-time, and only from the same offering the annual
             matched from (no cross-offering mixes)
       defaultSelected  'annual' for winback/intro, else 'monthly'
       offeringId  identifier of the offering the annual matched from */
  async function resolveOfferContext(offer, planDefs) {
    var rc = await rcInstance();
    var offerings = await rc.getOfferings();
    var offs = resolveOfferings(offerings, offer);
    function srcOf(pk) {
      for (var i = 0; i < offs.length; i++) {
        var o = offs[i], ap = o.availablePackages || [];
        for (var j = 0; j < ap.length; j++) if (ap[j] === pk) return o;
        if (o.packagesById) {
          var ks = Object.keys(o.packagesById);
          for (var k = 0; k < ks.length; k++) if (o.packagesById[ks[k]] === pk) return o;
        }
      }
      return null;
    }
    function sym(formatted) { return (formatted || '').replace(/[\d.,\s]+/g, ''); }
    var annualDef = null;
    planDefs.forEach(function (p) { if (p.id === 'annual') annualDef = p; });
    // The annual anchors the context: its source offering wins, and every
    // other package matches from that offering first so mode, prices and the
    // lifetime card can never mix across offerings.
    var annualPkg = annualDef ? findPkg(offs, annualDef.pkg, annualDef.kw) : null;
    var src = annualPkg ? srcOf(annualPkg) : null;
    var searchOrder = src ? [src].concat(offs.filter(function (o) { return o !== src; })) : offs;
    planDefs.forEach(function (p) {
      var pk = p.id === 'annual' ? annualPkg : findPkg(searchOrder, p.pkg, p.kw);
      if (!pk) return;
      p.pkgObj = pk;
      var pr = pkgPrice(pk); if (pr) p.amt = pr;
      // Per-package trial phase so EVERY plan's copy is truthful — the live
      // Monthly_web_pro carries a 7-day trial in RC, so monthly must not
      // claim "billed today" while Stripe starts a trial. hasTrial is the
      // branch flag (a trial phase can exist with an unparseable duration).
      var ptr = pkgTrial(pk); if (ptr) { p.hasTrial = true; p.trialDays = ptr.days; }
      var v = pkgValue(pk), s = sym(pr);
      if (v.value && s) {
        if (p.id === 'annual') { p.perMo = s + (v.value / 12).toFixed(2) + '/mo'; p.perDay = s + (v.value / 365).toFixed(2) + '/day'; }
        if (p.id === 'monthly') { p.perDay = s + (v.value / 30).toFixed(2) + '/day'; }
      }
    });
    var intro = annualPkg ? pkgIntro(annualPkg) : null;
    var trial = annualPkg ? pkgTrial(annualPkg) : null;
    var mode;
    if (offer === 'wb40' && src && src.identifier === 'winback' && intro) mode = 'winback';
    else if (intro) mode = 'intro';
    else if (trial) mode = 'trial';
    else mode = 'plain';
    if (annualDef && (mode === 'winback' || mode === 'intro')) {
      annualDef.stdAmt = annualDef.amt || '';
      annualDef.was = annualDef.stdAmt;
      var base = pkgValue(annualPkg);
      annualDef.savePct = (intro.value && base.value) ? Math.round((1 - intro.value / base.value) * 100) : null;
      annualDef.amt = intro.formatted;
      var s2 = sym(intro.formatted);
      annualDef.perDay = (intro.value && s2) ? s2 + (intro.value / 365).toFixed(2) + '/day' : '';
      // Multi-cycle intro (should never be configured, but guard the claim):
      // drop the "then {std}/yr" anchor so pages fall back to "the standard
      // yearly price" instead of asserting the wrong second-year charge.
      if (intro.cycles && intro.cycles > 1) { annualDef.stdAmt = ''; annualDef.was = ''; }
    }
    var lifetimePkg = null;
    if (mode === 'intro' && src) {
      var lp = findPkg([src], '$rc_lifetime', 'lifetime');
      if (lp && pkgOneTime(lp)) lifetimePkg = lp;
    }
    return {
      offerings: offerings, offs: offs, mode: mode, plans: planDefs,
      lifetimePkg: lifetimePkg,
      defaultSelected: (mode === 'winback' || mode === 'intro') ? 'annual' : 'monthly',
      offeringId: (src && src.identifier) || ''
    };
  }

  /* ---- purchase (moved from paywall.html checkout handler) ----
     opts: { pkg, planId, email, sid }. Returns nothing on success — it
     redirects to unlocked.html. Throws on failure (caller renders errors).
     Caller should treat /cancel|closed|dismiss/ errors as user-cancel. */
  async function purchase(opts) {
    var rc = await rcInstance();
    // A trial-start checkout charges $0 today — tell unlocked.html so it can
    // fire Meta StartTrial instead of a full-value Purchase.
    var isTrial = !pkgIntro(opts.pkg) && !!pkgTrial(opts.pkg);
    var result = await rc.purchase({
      rcPackage: opts.pkg,
      customerEmail: opts.email || undefined,
      metadata: opts.sid ? { quiz_sid: opts.sid } : undefined
    });
    var redeem = (result && result.redemptionInfo && (result.redemptionInfo.redeemUrl || result.redemptionInfo.url)) || '';
    // Conversion fires on unlocked.html (stable landing). Here we send ONLY the
    // TikTok CompletePayment via server-side CAPI as a keepalive safety net; it
    // shares event_id with the unlocked.html pixel fire so TikTok dedups.
    var v = pkgValue(opts.pkg), eid = ttGenId();
    ttCapi('CompletePayment',
      ttNorm({ content_id: 'plan_' + opts.planId, content_type: 'product', content_name: 'Archives ' + opts.planId, quantity: 1, value: (v.value || undefined), currency: (v.currency || 'USD') }),
      eid, opts.email || '');
    // Checkout completed: clear the abandon flag BEFORE navigating so the
    // pagehide checkout_cancel beacon never fires for a converted buyer.
    try { sessionStorage.removeItem('arc_ck_open'); } catch (e) { }
    // em: base64 buyer email so unlocked.html's conversion event carries it
    // even on drip-link visits with no localStorage quiz state — the email
    // drip engine suppresses paying customers by this field.
    var em = ''; try { em = opts.email ? btoa(unescape(encodeURIComponent(opts.email))) : ''; } catch (e) { }
    var dest = 'unlocked.html?status=success&plan=' + encodeURIComponent(opts.planId)
      + '&v=' + encodeURIComponent(v.value || '') + '&cur=' + encodeURIComponent(v.currency || 'USD') + '&eid=' + encodeURIComponent(eid)
      + (isTrial ? '&trial=1' : '')
      + (em ? '&em=' + encodeURIComponent(em) : '')
      + (redeem ? '&redeem=' + encodeURIComponent(redeem) : '');
    // The conversion event fires on unlocked.html, a fresh page load after a
    // cross-site checkout round trip — relay the session + ad attribution so
    // the sale is credited to the ad that paid for it rather than to organic.
    try { if (window.atrackRelay) dest = window.atrackRelay(dest); } catch (e) { }
    location.href = dest;
  }

  /* ---- store fallback ---- */
  function goStore(page) {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua);
    try { window.atrack && window.atrack('store_click', null, { store: ios ? 'ios' : 'android', page: page || location.pathname }); } catch (e) { }
    location.href = ios ? 'https://apps.apple.com/app/id6751173663' : 'https://play.google.com/store/apps/details?id=ai.affinitylabs.archivesexpo';
  }

  /* ---- TikTok pixel + server-side CAPI (shared event_id, deduped) ---- */
  function ttGenId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
  function ttCookie(n) { var m = document.cookie.match('(?:^|;)\\s*' + n + '=([^;]+)'); return m ? decodeURIComponent(m[1]) : ''; }
  function ttClid() { try { return localStorage.getItem('ttclid') || ''; } catch (e) { return ''; } }
  function sha256(str) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode((str || '').trim().toLowerCase())).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function ttCapi(name, props, eid, email) {
    try {
      fetch(SUPABASE_URL + '/functions/v1/tiktok-events', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
        body: JSON.stringify({ event: name, event_id: eid, event_time: Math.floor(Date.now() / 1000), url: location.href, properties: props || {}, email: email || undefined, ttclid: ttClid() || undefined, ttp: ttCookie('_ttp') || undefined })
      }).catch(function () { });
    } catch (e) { }
  }
  // TikTok requires content_id on every event (VSA matching).
  function ttNorm(props) {
    props = props || {};
    var cid = props.content_id || props.content_name || 'archives-app';
    if (!props.content_id) props.content_id = cid;
    if (!props.content_type) props.content_type = 'product';
    if (!props.contents) props.contents = [{ content_id: cid, content_type: props.content_type, content_name: props.content_name || cid, quantity: props.quantity || 1 }];
    return props;
  }
  function ttFire(name, props, email) {
    var eid = ttGenId();
    props = ttNorm(props);
    try { if (typeof ttq !== 'undefined') ttq.track(name, props, { event_id: eid }); } catch (e) { }
    ttCapi(name, props, eid, email);
  }

  /* ---- multi-pixel fire (GA4 + Meta + TikTok + PostHog + first-party) ----
     Pages create one with their known email: var fire = AC.makeFire(function(){return email;}) */
  function makeFire(getEmail) {
    return function fire(ga, gp, fb, fp) {
      try { if (typeof gtag === 'function') gtag('event', ga, gp || {}); } catch (e) { }
      try {
        if (typeof fbq === 'function' && fb) {
          var std = { Lead: 1, ViewContent: 1, InitiateCheckout: 1, CompleteRegistration: 1, Purchase: 1, Subscribe: 1 };
          std[fb] ? fbq('track', fb, fp || {}) : fbq('trackCustom', fb, fp || {});
        }
      } catch (e) { }
      if (fb) { ttFire(fb, fp || gp || {}, (getEmail && getEmail()) || ''); }
      try { if (typeof posthog !== 'undefined' && posthog.capture) posthog.capture(ga, gp || {}); } catch (e) { }
      /* first-party tracker: every funnel event, organic included (props -> ad_events.raw.props) */
      try { if (window.atrack) window.atrack(ga, null, gp || {}); } catch (e) { }
    };
  }

  window.ArchivesCheckout = {
    rcConfigured: rcConfigured,
    rcInstance: rcInstance,
    allOfferings: allOfferings,
    resolveOfferings: resolveOfferings,
    prodId: prodId,
    pkgPrice: pkgPrice,
    pkgIntro: pkgIntro,
    pkgTrial: pkgTrial,
    pkgOneTime: pkgOneTime,
    pkgValue: pkgValue,
    findPkg: findPkg,
    resolveOfferContext: resolveOfferContext,
    purchase: purchase,
    goStore: goStore,
    ttGenId: ttGenId,
    ttFire: ttFire,
    ttCapi: ttCapi,
    ttNorm: ttNorm,
    sha256: sha256,
    makeFire: makeFire,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON: SUPABASE_ANON
  };
})();
