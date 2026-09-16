/* ============================================================================
   snb-loader.js v2 -- shared-partial loader for SNB Circle embeds
   v1: swapped element partials (footer, app-cta) into data-snb-include slots.
   v2 adds FULL-PAGE partials: the whole Circle block is one slot
   (data-snb-include="page-<slug>") whose current version is fetched from this
   script's host, so page edits ship by deploy, never by pasting.

   What v2 handles that v1 didn't:
   1. SCRIPT EXECUTION. Scripts inserted via innerHTML never run, and six pages
      carry interactive-figure/toggle JS. After injecting a partial we replace
      each <script> with a programmatically-created clone, which does execute.
      The loader itself is never re-run (guarded by src match).
   2. NESTED SLOTS. A page partial contains the footer/app-cta slots; after
      injecting it we process the slots inside it (depth-capped). The first
      pass skips slots nested inside another slot to avoid wasted racing
      fetches (they're handled after their parent is injected).

   Failure behavior is unchanged and is the point of the design: every slot
   ships with the last-pasted markup inside it as fallback. Fetch fails, ad
   blocker, JS off => the reader gets the snapshot, never a hole. Crawlers
   without JS index the snapshot; Google renders JS and indexes the live
   version.

   No dependencies. IIFE, nothing leaks to window (WEB-FORMAT widget rule).
============================================================================ */
(function () {
  'use strict';
  var sc = document.currentScript;
  if (!sc || !sc.src || !window.fetch || !window.Promise) return; // old browser: keep fallbacks
  var base = sc.src.replace(/\/[^\/?#]*(?:[?#].*)?$/, '');
  var MAX_DEPTH = 3;

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fill(html, el) {
    return html.replace(/\{\{([a-z0-9-]+)(?:\|([^}]*))?\}\}/g, function (_, key, def) {
      var v = el.getAttribute('data-snb-' + key);
      return v !== null && v !== '' ? esc(v) : (def || '');
    });
  }

  /* innerHTML-inserted <script> tags are inert; recreate them so they run.
     Never re-run this loader itself. */
  function runScripts(container) {
    var list = [].slice.call(container.querySelectorAll('script'));
    list.forEach(function (old) {
      if (old.src && old.src.indexOf('snb-loader') !== -1) return;
      var s = document.createElement('script');
      [].forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); });
      s.text = old.text || '';
      old.parentNode.replaceChild(s, old);
    });
  }

  function process(root, depth) {
    if (depth > MAX_DEPTH) return;
    var slots = [].slice.call(root.querySelectorAll('[data-snb-include]'));
    if (depth === 0) {
      // First pass: leave nested slots to their parent's injection pass.
      slots = slots.filter(function (el) {
        var p = el.parentElement;
        return !(p && p.closest && p.closest('[data-snb-include]'));
      });
    }
    if (!slots.length) return;

    var byName = {};
    slots.forEach(function (el) {
      var n = el.getAttribute('data-snb-include');
      (byName[n] = byName[n] || []).push(el);
    });

    Object.keys(byName).forEach(function (name) {
      if (!/^[a-z0-9-]+$/.test(name)) return; // partial names are simple slugs
      fetch(base + '/partials/' + name + '.html', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
          byName[name].forEach(function (el) {
            if (!el.isConnected) return;        // replaced by a parent swap meanwhile
            el.innerHTML = fill(html, el);
            runScripts(el);
            process(el, depth + 1);             // nested slots (footer/cta inside a page)
          });
        })
        .catch(function () { /* keep the inline fallback -- silence is the feature */ });
    });
  }

  process(document, 0);
})();

/* ============================================================================
   snb-cta-tracking -- delegated GA4 cta_click dispatcher (added 2026-07-17)
   Fires ONE GA4 event `cta_click` with params {cta_id, state?, placement?} for
   any clicked element carrying data-ga-cta. Resilient: routes through the host's
   gtag() if present, else pushes to dataLayer, else no-ops -- so it is safe to
   ship BEFORE the Circle GA tag (G-JLDNN3MZH3) is live; it starts reporting the
   moment the tag lands. Delegated on document, so it also catches CTAs inside
   loader-injected page partials. Additive only: it never calls preventDefault,
   never touches navigation, the existing data-cta hooks, or the src= params
   (those are the Stripe/pulse conversion instrument, owned by Coach/GMS -- do
   not alter). Nothing leaks to window (guard flag lives on document).
   Spec: Get More Sales ATTRIBUTION.md / SALES_ENGINE.md §4-5 (2026-07-17).
============================================================================ */
(function () {
  'use strict';
  if (document.__snbCtaBound) return;             // bind exactly once per page
  document.__snbCtaBound = true;
  document.addEventListener('click', function (e) {
    var t = e.target;
    var el = t && t.closest ? t.closest('[data-ga-cta]') : null;
    if (!el) return;
    var p = { cta_id: el.getAttribute('data-ga-cta') };
    var st = el.getAttribute('data-ga-state');
    var pl = el.getAttribute('data-ga-placement');
    if (st) p.state = st;
    if (pl) p.placement = pl;
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'cta_click', p);       // GA4 gtag path (uses sendBeacon; survives nav)
    } else {
      window.dataLayer = window.dataLayer || [];
      p.event = 'cta_click';
      window.dataLayer.push(p);                    // GTM/dataLayer fallback
    }
  }, true);
})();
