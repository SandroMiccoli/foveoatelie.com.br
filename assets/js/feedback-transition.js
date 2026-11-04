/**
 * feedback-transition.js
 * Smooth outro + intro for the /feedback/ → /feedback/obrigado/ flow.
 *
 * Architecture (no Swup — avoids version-mismatch and dynamic-import fragility):
 *
 *   /feedback/  submit
 *     → capture-phase listener fires BEFORE main.js's bubble-phase listener
 *     → keepalive fetch POSTs form data to Netlify (fire-and-forget, reliable)
 *     → GSAP outro plays (Ō seal + dark overlay, ~0.6 s)
 *     → browser navigates to /feedback/obrigado/ (window.location.href)
 *
 *   /feedback/obrigado/ load
 *     → sessionStorage flag set by outro detected here
 *     → GSAP in-animation plays (seal settles, text fades in, ~0.75 s)
 *
 * Fallbacks (all graceful):
 *   • GSAP CDN unreachable      → CSS overlay + 1 s delay, then navigate
 *   • prefers-reduced-motion    → capture listener returns without stopping propagation;
 *                                  browser submits naturally, no in-animation on obrigado
 *   • JS disabled               → plain Netlify form POST, unchanged
 */
(function () {
  'use strict';

  var SESSION_KEY = 'fv-from-feedback';
  var GSAP_SRC    = 'https://cdn.jsdelivr.net/npm/gsap@3.12.7/dist/gsap.min.js';

  // ─── Shared: load GSAP via script tag ───────────────────────────────────

  function loadGsap(cb) {
    if (typeof window.gsap !== 'undefined') { cb(); return; }
    var s = document.createElement('script');
    s.src = GSAP_SRC;
    s.crossOrigin = 'anonymous';
    s.onload  = cb;
    s.onerror = function () { window.__gsapFailed = true; cb(); };
    document.head.appendChild(s);
  }

  // ─── Serialise FormData → application/x-www-form-urlencoded body ────────
  //
  // Correctly handles repeated keys (e.g. vela[] with multiple checkboxes).
  // URLSearchParams(FormData) is not reliable across all mobile browsers, so
  // we iterate manually.

  function encodeForm(form) {
    var parts = [];
    new FormData(form).forEach(function (val, key) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
    });
    return parts.join('&');
  }

  // ════════════════════════════════════════════════════════════════════════
  // /feedback/obrigado/ — play in-animation when arriving from the form
  // ════════════════════════════════════════════════════════════════════════

  if (document.querySelector('.obrigado-band')) {
    var fromFeedback = false;
    try { fromFeedback = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) {}
    if (!fromFeedback) return;

    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}

    // Keep the band invisible until GSAP is ready to avoid a flash of unstyled content.
    var band = document.querySelector('.obrigado-band');
    if (band) band.style.visibility = 'hidden';

    loadGsap(function () {
      if (!band) return;
      band.style.visibility = '';

      var gsap = window.gsap;
      if (!gsap || window.__gsapFailed) return; // reveal as-is; no animation

      var seal   = band.querySelector('.obrigado-seal');
      var msg    = band.querySelector('.obrigado-msg');
      var assina = band.querySelector('.obrigado-assina');
      var cta    = band.querySelector('.cta');

      var tl = gsap.timeline();

      if (seal) {
        // Seal arrives from above, echoing the size it had in the overlay.
        tl.fromTo(
          seal,
          { scale: 1.5, opacity: 0 },
          { scale: 1, opacity: 0.85, duration: 0.65, ease: 'back.out(1.3)' },
          0
        );
      }

      var textEls = [msg, assina, cta].filter(Boolean);
      if (textEls.length) {
        tl.fromTo(
          textEls,
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.38, ease: 'power2.out', stagger: 0.09 },
          0.22
        );
      }
      // Total in-animation: ~0.75 s
    });

    return; // nothing else to do on the thank-you page
  }

  // ════════════════════════════════════════════════════════════════════════
  // /feedback/ — intercept submit, POST, play outro, navigate
  // ════════════════════════════════════════════════════════════════════════

  var tfForm = document.querySelector('form[name="feedback"]');
  if (!tfForm) return;

  // Start loading GSAP immediately so it is almost certainly ready by submit time.
  loadGsap(function () {});

  // Use capture phase so our listener fires before main.js's bubble-phase listener.
  // stopImmediatePropagation() prevents main.js from also intercepting.
  document.addEventListener('submit', onSubmit, true);

  function onSubmit(e) {
    if (e.target !== tfForm) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      // Let the browser submit naturally; no outro, no in-animation.
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    // Remove our listener so a re-submit (double-tap) cannot replay the animation.
    document.removeEventListener('submit', onSubmit, true);

    var actionUrl = tfForm.action;
    var formBody  = encodeForm(tfForm);

    // ── 1. POST to Netlify — fire-and-forget with keepalive ───────────────
    //
    // keepalive ensures the browser sends this request even after we navigate
    // away with window.location.href.  Netlify records the submission from the
    // HTTP POST; our subsequent GET navigation just loads the thank-you page.

    try {
      fetch(actionUrl, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:     formBody,
        keepalive: true,
      }).catch(function () {});   // ignore response/network errors
    } catch (fetchErr) {
      // fetch itself threw (very old browser) — fall back to native submit
      tfForm.submit();
      return;
    }

    // ── 2. Play outro, then navigate ──────────────────────────────────────

    var overlay = document.getElementById('tf-submit-overlay');

    if (typeof window.gsap !== 'undefined' && !window.__gsapFailed && overlay) {
      // Disable the CSS transitions on these elements so GSAP has sole control.
      document.documentElement.classList.add('fv-using-gsap');
      playOutro(overlay, function () {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        window.location.href = actionUrl;
      });
    } else {
      // GSAP not ready (CDN slow/failed) — use the CSS overlay as a fallback.
      if (overlay) overlay.classList.add('is-active');
      window.setTimeout(function () {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        window.location.href = actionUrl;
      }, overlay ? 1100 : 0);
    }
  }

  // ── Outro animation (~0.6 s) ─────────────────────────────────────────────
  //
  // Mirrors the visual language of the site intro:
  //   • Dark background floods in
  //   • Ō seal scales up from centre with spring ease
  // Then onDone() is called → navigation happens.

  function playOutro(overlay, onDone) {
    var gsap = window.gsap;
    var seal = overlay.querySelector('.tf-submit-seal');

    overlay.classList.add('is-active');
    gsap.set(overlay, { opacity: 0, pointerEvents: 'auto' });
    if (seal) gsap.set(seal, { opacity: 0, scale: 0.72, transformOrigin: 'center center' });

    var tl = gsap.timeline({ onComplete: onDone });

    // Fade in the dark veil.
    tl.to(overlay, { opacity: 1, duration: 0.2, ease: 'power1.out' });

    if (seal) {
      // Seal springs in, overlapping the veil fade.
      tl.to(seal, {
        opacity:  0.92,
        scale:    1,
        duration: 0.42,
        ease:     'back.out(1.4)',
      }, '-=0.08');
    }
    // Total: ~0.54 s before onDone fires
  }
})();
