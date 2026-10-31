(function () {
  // How long each card stays before the next one. Cards are meant to be read.
  var STORY_DURATION_MS = 6500;
  var HOLD_MS = 220;
  var SWIPE_PX = 48;

  var frame = document.getElementById("story");
  var slides = Array.prototype.slice.call(frame.querySelectorAll(".card"));
  var fills = Array.prototype.slice.call(frame.querySelectorAll(".segment-fill"));
  var zonePrev = frame.querySelector(".zone-prev");
  var zoneNext = frame.querySelector(".zone-next");
  var whatsapp = document.querySelector(".whatsapp");
  var waHit = frame.querySelector(".wa-hit");
  var replay = document.querySelector(".replay");
  var prevBtn = document.querySelector(".arrow-prev");
  var nextBtn = document.querySelector(".arrow-next");
  var live = document.getElementById("story-live");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var count = slides.length;
  var index = 0;
  var progress = 0;
  var paused = false;
  var ended = false;
  var holding = false;
  var hiddenPause = false;
  var raf = 0;
  var lastTs = 0;
  var fadeTimer = 0;

  function renderBars() {
    for (var i = 0; i < fills.length; i++) {
      var scale = 0;
      if (i < index) scale = 1;
      else if (i === index) scale = Math.min(1, Math.max(0, progress));
      fills[i].style.transform = "scaleX(" + scale + ")";
    }
  }

  function preload(i) {
    var img = slides[i];
    if (!img) return;
    img.loading = "eager";
    if (!img.complete) {
      var pre = new Image();
      pre.src = img.src;
    }
  }

  function show(next) {
    var previous = index;
    slides.forEach(function (img, i) {
      img.classList.toggle("is-current", i === next);
      img.classList.toggle("is-previous", i === previous && i !== next);
    });
    window.clearTimeout(fadeTimer);
    var wait = reduceMotion.matches ? 0 : 400;
    fadeTimer = window.setTimeout(function () {
      slides.forEach(function (img) {
        img.classList.remove("is-previous");
      });
    }, wait);
  }

  function updateChrome() {
    var onLast = index === count - 1;
    whatsapp.hidden = !onLast;
    waHit.hidden = !onLast;
    if (!onLast) replay.hidden = true;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === count - 1;
    live.textContent = "Card " + (index + 1) + " de " + count;
    renderBars();
    preload(index + 1);
  }

  function start() {
    paused = false;
    ended = false;
    lastTs = performance.now();
    window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(tick);
  }

  function pause() {
    if (paused || ended) return;
    paused = true;
    window.cancelAnimationFrame(raf);
  }

  function resume() {
    if (!paused || ended || holding || document.hidden) return;
    start();
  }

  function finish() {
    ended = true;
    paused = true;
    progress = 1;
    window.cancelAnimationFrame(raf);
    renderBars();
    replay.hidden = false;
  }

  function go(nextIndex) {
    if (nextIndex < 0 || nextIndex >= count || nextIndex === index) return;
    show(nextIndex);
    index = nextIndex;
    progress = 0;
    ended = false;
    replay.hidden = true;
    updateChrome();
    start();
  }

  function next() {
    if (index >= count - 1) return;
    go(index + 1);
  }

  function prev() {
    if (index <= 0) return;
    go(index - 1);
  }

  function restart() {
    show(0);
    index = 0;
    progress = 0;
    ended = false;
    replay.hidden = true;
    updateChrome();
    start();
  }

  function tick(now) {
    if (paused || ended) return;
    var dt = now - lastTs;
    lastTs = now;
    progress += dt / STORY_DURATION_MS;
    if (progress >= 1) {
      progress = 1;
      renderBars();
      if (index < count - 1) next();
      else finish();
      return;
    }
    renderBars();
    raf = window.requestAnimationFrame(tick);
  }

  function bindPointer(zone, direction) {
    var startX = 0;
    var startY = 0;
    var startTime = 0;
    var moved = false;
    var active = false;

    zone.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      active = true;
      moved = false;
      holding = true;
      startX = event.clientX;
      startY = event.clientY;
      startTime = performance.now();
      pause();
      try {
        zone.setPointerCapture(event.pointerId);
      } catch (error) {
        /* Synthetic or already-released pointers cannot be captured. */
      }
    });

    zone.addEventListener("pointermove", function (event) {
      if (!active) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (dx * dx + dy * dy > 144) moved = true;
    });

    function release(event) {
      if (!active) return;
      active = false;
      holding = false;
      var dx = event.clientX - startX;
      var held = performance.now() - startTime > HOLD_MS;
      var swiped = event.pointerType !== "mouse" && Math.abs(dx) > SWIPE_PX;

      if (swiped) {
        if (dx < 0) next();
        else prev();
        if (!ended && paused) resume();
        return;
      }
      if (!held && !moved) {
        if (direction === "next") next();
        else prev();
        if (!ended && paused) resume();
        return;
      }
      resume();
    }

    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", function () {
      if (!active) return;
      active = false;
      holding = false;
      resume();
    });
  }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  replay.addEventListener("click", restart);

  [whatsapp, waHit, replay].forEach(function (el) {
    el.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (!paused && !ended) {
        hiddenPause = true;
        pause();
      }
      return;
    }
    if (hiddenPause) {
      hiddenPause = false;
      resume();
    }
  });

  bindPointer(zonePrev, "prev");
  bindPointer(zoneNext, "next");

  show(0);
  updateChrome();
  window.setTimeout(function () {
    live.textContent = "Card 1 de " + count;
  }, 60);
  start();
})();
