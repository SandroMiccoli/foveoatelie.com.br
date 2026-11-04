/**
 * feedback-transition.js
 * Swup + GSAP page transition: /feedback/ → /feedback/obrigado/
 * Loaded only on feedback pages. Non-JS and reduced-motion paths degrade gracefully.
 */
(function () {
  'use strict';

  // Guard: only run on feedback pages
  var onForm    = !!document.getElementById('tf-pager');
  var onThankYou = !!document.querySelector('.obrigado-band');
  if (!onForm && !onThankYou) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The submit overlay lives in the feedback page's HTML but must persist
  // through Swup's container swap. Move it to <body> so it sits outside #swup.
  var overlay = document.getElementById('tf-submit-overlay');
  if (overlay && overlay.parentNode !== document.body) {
    document.body.appendChild(overlay);
  }

  // Load GSAP via script tag (matches the pattern already used in main.js for FAQ),
  // then load Swup and plugins as browser ESM modules via dynamic import().
  // __fvSwupActive is set to true only after successful initialisation so that
  // main.js's fallback submit handler remains active until Swup is ready.
  loadGsap(function () {
    Promise.all([
      import('https://esm.sh/swup@4'),
      import('https://esm.sh/@swup/forms-plugin@2'),
      import('https://esm.sh/@swup/js-plugin@3'),
    ]).then(function (mods) {
      var Swup = mods[0].default;
      var SwupFormsPlugin = mods[1].default;
      var SwupJsPlugin = mods[2].default;
      initSwup(Swup, SwupFormsPlugin, SwupJsPlugin);
    }).catch(function (err) {
      // CDN unreachable — main.js handles submission as before.
      if (typeof console !== 'undefined') {
        console.warn('[Foveō] Swup failed to load; using native form submit.', err);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  function loadGsap(cb) {
    if (typeof window.gsap !== 'undefined') { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/gsap@3.12.7/dist/gsap.min.js';
    s.crossOrigin = 'anonymous';
    s.onload  = cb;
    s.onerror = cb; // fall back gracefully even without GSAP
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Swup initialisation
  // ─────────────────────────────────────────────────────────────────────────

  function initSwup(Swup, SwupFormsPlugin, SwupJsPlugin) {
    var gsap = window.gsap; // may be undefined if CDN failed; handled below

    // Disable the CSS overlay transitions so GSAP has exclusive control.
    document.documentElement.classList.add('fv-using-gsap');

    var swup = new Swup({
      // Replace only the shared page container on both feedback pages.
      containers: ['#swup'],

      // Swup should NOT intercept regular link clicks — only form submissions.
      // This prevents it from hijacking the logo link (back to "/") or footer links.
      linkSelector: 'a[data-swup-link]',

      // Disable Swup's popstate interception so the browser Back button
      // navigates normally (avoids re-fetching /feedback/ as a Swup visit).
      skipPopstate: true,

      plugins: [
        // Handle the Netlify form submission via fetch POST.
        new SwupFormsPlugin({
          formSelector: 'form[name="feedback"]',
        }),

        // GSAP-powered animations for the feedback → obrigado transition.
        new SwupJsPlugin({
          animations: [
            {
              from: /\/feedback\/?$/,
              to:   /\/feedback\/obrigado\/?/,
              out:  animateOut,
              in:   animateIn,
            },
            // Catch-all: instant swap for any other Swup-managed navigation.
            {
              from: '(.*)',
              to:   '(.*)',
              out:  function (next) { next(); },
              in:   function (next) { next(); },
            },
          ],
        }),
      ],
    });

    // Now that Swup is live, disable main.js's fallback submit handler.
    window.__fvSwupActive = true;

    // Fire a GA4 page_view after each Swup content swap.
    swup.hooks.on('page:view', function () {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'page_view', {
          page_title:    document.title,
          page_location: window.location.href,
        });
      }
    });

    // ── Out animation ─────────────────────────────────────────────────────
    // Runs while the feedback page is still visible (~0.5s).
    // Shows the Ō seal overlay, then hands off to Swup for the DOM swap.

    function animateOut(next) {
      if (reducedMotion || !gsap || !overlay) {
        if (overlay) overlay.classList.add('is-active');
        window.setTimeout(next, reducedMotion ? 60 : 0);
        return;
      }

      var seal = overlay.querySelector('.tf-submit-seal');

      // Start from a clean state; CSS transitions are suppressed by .fv-using-gsap.
      gsap.set(overlay, { opacity: 0, pointerEvents: 'auto' });
      if (seal) gsap.set(seal, { opacity: 0, scale: 0.76, transformOrigin: 'center center' });

      overlay.classList.add('is-active');

      var tl = gsap.timeline({ onComplete: next });

      // Fade in the dark background.
      tl.to(overlay, { opacity: 1, duration: 0.18, ease: 'power1.out' });

      if (seal) {
        // Reveal the seal with a springy scale — overlapping the background fade.
        tl.to(seal, {
          opacity:  0.92,
          scale:    1,
          duration: 0.42,
          ease:     'back.out(1.4)',
        }, '-=0.08');
        // No extra hold — Swup fetches the next page during this time anyway.
      }
      // Total out duration: ~0.52s
    }

    // ── In animation ──────────────────────────────────────────────────────
    // Runs after Swup has injected the obrigado page content (~0.75s).
    // The overlay persists (it's outside #swup) and fades out here.

    function animateIn(next) {
      if (reducedMotion || !gsap) {
        if (overlay) {
          overlay.classList.remove('is-active');
          overlay.style.cssText = '';
        }
        next();
        return;
      }

      var container = document.getElementById('swup');
      if (!container) { next(); return; }

      // Hide the freshly inserted content; GSAP will reveal it.
      gsap.set(container, { opacity: 0 });

      var tl = gsap.timeline({
        onComplete: function () {
          if (overlay) {
            overlay.classList.remove('is-active');
            overlay.style.cssText = '';
          }
          next();
        },
      });

      // Fade the overlay out while the new content fades in.
      if (overlay) {
        tl.to(overlay, { opacity: 0, duration: 0.38, ease: 'power1.in' }, 0);
      }

      tl.to(container, { opacity: 1, duration: 0.44, ease: 'power2.out' }, 0.06);

      // The Ō seal "lands" from the overlay position: start large, settle to natural size.
      var obrigadoSeal = container.querySelector('.obrigado-seal');
      if (obrigadoSeal) {
        tl.fromTo(
          obrigadoSeal,
          { scale: 1.45, opacity: 0 },
          { scale: 1, opacity: 0.85, duration: 0.58, ease: 'back.out(1.3)' },
          0.08
        );
      }

      // Stagger the text lines in after the seal settles.
      var textNodes = container.querySelectorAll('.obrigado-msg, .obrigado-assina, .cta');
      if (textNodes.length) {
        tl.fromTo(
          textNodes,
          { y: 12, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.36, ease: 'power2.out', stagger: 0.08 },
          0.22
        );
      }
      // Total in duration: ~0.72s (last text ends at 0.22 + 0.08*(n-1) + 0.36)
    }
  }
})();
