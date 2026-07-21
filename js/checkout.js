/* Archives shared web checkout (RevenueCat Web Billing + tracking helpers).
   Extracted from paywall.html so paywall.html and plan.html run ONE checkout
   implementation — never copy-paste this block back into a page.

   Exposes window.ArchivesCheckout. Pages own their UI (plan cards, buttons);
   this module owns: RC SDK loading, offering resolution (incl. the winback
   offering switch), package matching, purchase + unlocked.html redirect,
   store fallback, and the TikTok pixel/CAPI helpers.

   Winback offer: pass offer='wb40' (from the drip emails' &offer=wb40 param)
   and resolveOfferings() will prefer the RC Offering named 'winback' so its
   discounted annual package matches first. If that offering doesn't exist
   yet, everything silently falls back to the current offering at full price
   — degraded, never broken. */
(function () {
  'use strict';

  var RC_WEB_API_KEY = 'rcb_yQedavJlsbzBERTqkBYHIDtKYkDq'; // production Web Billing key
  var SUPABASE_URL = 'https://kcgiugdfudbwtjjsvwia.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjZ2l1Z2RmdWRid3RqanN2d2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxOTYxNjgsImV4cCI6MjA2NDc3MjE2OH0.i4q-ZtYzdP6OuotC7Rk1EGC09oW9xj0iA5NQTCXOKTc';

  // offer URL param -> RC Offering identifier. Only listed offers exist;
  // anything else resolves to the default (current) offering.
  var OFFER_TO_OFFERING = { wb40: 'winback', webv2: 'web_v2' };

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

  /* Like allOfferings, but if `offer` maps to a named offering that exists,
     that offering is searched FIRST so its packages win package matching. */
  function resolveOfferings(offerings, offer) {
    var offs = allOfferings(offerings);
    var name = OFFER_TO_OFFERING[offer || ''];
    if (!name || !offerings.all || !offerings.all[name]) return offs;
    var target = offerings.all[name];
    return [target].concat(offs.filter(function (o) { return o !== target; }));
  }

  function offerActive(offerings, offer) {
    var name = OFFER_TO_OFFERING[offer || ''];
    return !!(name && offerings && offerings.all && offerings.all[name]);
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
    return formatted ? { formatted: formatted, value: value } : null;
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

  /* ---- purchase (moved from paywall.html checkout handler) ----
     opts: { pkg, planId, email, sid }. Returns nothing on success — it
     redirects to unlocked.html. Throws on failure (caller renders errors).
     Caller should treat /cancel|closed|dismiss/ errors as user-cancel. */
  async function purchase(opts) {
    var rc = await rcInstance();
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
    location.href = 'unlocked.html?status=success&plan=' + encodeURIComponent(opts.planId)
      + '&v=' + encodeURIComponent(v.value || '') + '&cur=' + encodeURIComponent(v.currency || 'USD') + '&eid=' + encodeURIComponent(eid)
      + (em ? '&em=' + encodeURIComponent(em) : '')
      + (redeem ? '&redeem=' + encodeURIComponent(redeem) : '');
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
          var std = { Lead: 1, ViewContent: 1, InitiateCheckout: 1, CompleteRegistration: 1, StartTrial: 1, Subscribe: 1 };
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
    offerActive: offerActive,
    prodId: prodId,
    pkgPrice: pkgPrice,
    pkgIntro: pkgIntro,
    pkgValue: pkgValue,
    findPkg: findPkg,
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
