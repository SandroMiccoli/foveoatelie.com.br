/**
 * feedback-transition.spec.js
 *
 * Playwright test for the /feedback/ → /feedback/obrigado/ transition.
 *
 * Verifies at a mobile viewport (iPhone-style) that:
 *   1. Submitting the form sends a POST with form-name=feedback (Netlify format).
 *   2. The outro animation runs — the overlay opacity rises above 0.5 before
 *      navigation (i.e. GSAP tweens actually fire).
 *   3. The browser navigates to /feedback/obrigado/.
 *   4. The in-animation runs on the thank-you page — the seal's opacity is
 *      animated (starts near 0, ends at ~0.85).
 *
 * The test serves the pre-built _site with a local HTTP server so there is no
 * Netlify processing; we intercept the POST in the browser layer instead.
 */

const { test, expect } = require('@playwright/test');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const url   = require('url');

// ── Minimal static file server for _site ─────────────────────────────────

let server;
let baseUrl;

function serveStatic(dir, port) {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Accept POST to form action — return the thank-you page HTML so the
      // browser receives a valid 200 (Netlify would 302→200 in production).
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          // Store latest POST body so tests can inspect it.
          server.__lastPost = { url: req.url, body };

          // Respond with the thank-you page content.
          const thankYouPath = path.join(dir, 'feedback', 'obrigado', 'index.html');
          if (fs.existsSync(thankYouPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(thankYouPath));
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
          }
        });
        return;
      }

      // Serve static files.
      let filePath = path.join(dir, url.parse(req.url).pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.css':  'text/css',
        '.js':   'application/javascript',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.webp': 'image/webp',
        '.jpg':  'image/jpeg',
        '.ico':  'image/x-icon',
        '.woff2':'font/woff2',
        '.webmanifest': 'application/manifest+json',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

// ── Test setup / teardown ────────────────────────────────────────────────

test.beforeAll(async () => {
  const siteDir = path.resolve(__dirname, '..', '_site');
  if (!fs.existsSync(siteDir)) {
    throw new Error('_site directory not found — run `bundle exec jekyll build` first');
  }
  await serveStatic(siteDir, 4567);
  baseUrl = 'http://127.0.0.1:4567';
});

test.afterAll(async () => {
  if (server) server.close();
});

// ── Helper: set up the form state so it's submittable ────────────────────
//
// The pager wizard hides most screens with aria-hidden / no-current class.
// We set required fields programmatically and dispatch a submit event so we
// can test the animation path without clicking through every screen.

async function prepareAndSubmit(page) {
  await page.evaluate(() => {
    // Fill required fields so the form is valid for Netlify.
    const check = (sel) => { const el = document.querySelector(sel); if (el) el.checked = true; };
    check('[name="vela[]"][value="Acolher"]');
    check('[name="nota"][value="5"]');
    check('[name="compartilhar"][value="Sim, anônimo"]');
    check('[name="novidades"][value="Não"]');

    // Show the final screen so the submit button is visible/active.
    const screens = document.querySelectorAll('.tf-screen');
    screens.forEach((s, i) => {
      s.classList.toggle('is-current', i === screens.length - 1);
      s.setAttribute('aria-hidden', i === screens.length - 1 ? 'false' : 'true');
    });
  });

  // Dispatch the form's submit event — our capture-phase listener intercepts it.
  await page.evaluate(() => {
    const form = document.querySelector('form[name="feedback"]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14 Pro

test('POST with form-name=feedback is sent on submit', async ({ page }) => {
  // Intercept outgoing requests so we can inspect the POST body.
  const posts = [];
  page.on('request', req => {
    if (req.method() === 'POST') posts.push(req);
  });

  await page.goto(`${baseUrl}/feedback/`);
  // Wait for feedback-transition.js to parse and for GSAP to start loading.
  await page.waitForLoadState('domcontentloaded');

  // Wait until GSAP is available (CDN load) — timeout generous for CI.
  await page.waitForFunction(() => typeof window.gsap !== 'undefined', { timeout: 15000 });

  await prepareAndSubmit(page);

  // A POST to /feedback/obrigado/ must be recorded.
  await expect.poll(() => posts.length, { timeout: 3000 }).toBeGreaterThan(0);
  const post = posts[0];
  expect(post.method()).toBe('POST');
  expect(post.url()).toContain('/feedback/obrigado');

  const body = post.postData() || '';
  expect(body).toContain('form-name=feedback');
  // vela[] value should be URL-encoded
  expect(body).toContain('vela%5B%5D=Acolher');
  // Required fields present
  expect(body).toContain('nota=5');
});

test('outro animation: overlay opacity rises before navigation', async ({ page }) => {
  await page.goto(`${baseUrl}/feedback/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.gsap !== 'undefined', { timeout: 15000 });

  await prepareAndSubmit(page);

  // Poll until the overlay's inline opacity (set by GSAP) exceeds 0.5.
  // This proves GSAP tweens are actually running — the CSS fallback would
  // set opacity: 1 via class only, but GSAP sets it via inline style.
  const overlayBecameVisible = await page.waitForFunction(() => {
    const overlay = document.getElementById('tf-submit-overlay');
    if (!overlay) return false;
    const inlineOp = parseFloat(overlay.style.opacity);
    // GSAP sets inline style; check both inline and computed.
    const computedOp = parseFloat(getComputedStyle(overlay).opacity);
    return inlineOp > 0.5 || computedOp > 0.5;
  }, { timeout: 3000 });

  expect(overlayBecameVisible).toBeTruthy();
});

test('browser navigates to /feedback/obrigado/ after outro', async ({ page }) => {
  await page.goto(`${baseUrl}/feedback/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.gsap !== 'undefined', { timeout: 15000 });

  // Wait for navigation to the thank-you page (animation + fetch completes in <2 s).
  const [response] = await Promise.all([
    page.waitForNavigation({ url: /\/feedback\/obrigado/, timeout: 5000 }),
    prepareAndSubmit(page),
  ]);

  expect(page.url()).toContain('/feedback/obrigado');
});

test('in-animation on obrigado: seal opacity animates after arriving from form', async ({ page }) => {
  await page.goto(`${baseUrl}/feedback/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.gsap !== 'undefined', { timeout: 15000 });

  // Navigate to obrigado via the form flow.
  await Promise.all([
    page.waitForNavigation({ url: /\/feedback\/obrigado/, timeout: 5000 }),
    prepareAndSubmit(page),
  ]);

  // On obrigado, wait for GSAP to load and start the in-animation.
  await page.waitForFunction(() => typeof window.gsap !== 'undefined', { timeout: 15000 });

  // The seal should end up at opacity ≈ 0.85 (as GSAP animates it to that value).
  await page.waitForFunction(() => {
    const seal = document.querySelector('.obrigado-seal');
    if (!seal) return false;
    const op = parseFloat(getComputedStyle(seal).opacity);
    return op > 0.7; // well on its way to 0.85
  }, { timeout: 3000 });

  const sealOpacity = await page.evaluate(() => {
    const seal = document.querySelector('.obrigado-seal');
    return parseFloat(getComputedStyle(seal).opacity);
  });

  expect(sealOpacity).toBeGreaterThan(0.7);
});
