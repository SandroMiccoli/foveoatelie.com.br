(function () {
  // Reading time after the entrance animation. Cards are meant to be read.
  var STORY_DURATION_MS = 6500;
  var HOLD_MS = 220;
  var SWIPE_PX = 48;

  var frame = document.getElementById("story");
  var slides = Array.prototype.slice.call(frame.querySelectorAll(".card"));
  var fills = Array.prototype.slice.call(frame.querySelectorAll(".segment-fill"));
  var zonePrev = frame.querySelector(".zone-prev");
  var zoneNext = frame.querySelector(".zone-next");
  var replay = document.querySelector(".replay");
  var prevBtn = document.querySelector(".arrow-prev");
  var nextBtn = document.querySelector(".arrow-next");
  var live = document.getElementById("story-live");

  var count = slides.length;
  var index = 0;
  var progress = 0;
  var paused = false;
  var ended = false;
  var holding = false;
  var hiddenPause = false;
  var phase = "enter";
  var raf = 0;
  var lastTs = 0;
  var activeTl = null;
  var generation = 0;
  var introPlayed = false;

  function reduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function renderBars() {
    for (var i = 0; i < fills.length; i++) {
      var scale = 0;
      if (i < index) scale = 1;
      else if (i === index) scale = Math.min(1, Math.max(0, progress));
      fills[i].style.transform = "scaleX(" + scale + ")";
    }
  }

  function targets(card) {
    return card.querySelectorAll(".anim, .cover-photo img, .logo-band");
  }

  function killCard(card) {
    if (!card) return;
    gsap.killTweensOf(card);
    gsap.killTweensOf(targets(card));
  }

  function beginReading() {
    phase = "read";
    progress = 0;
    lastTs = performance.now();
    if (!paused && !ended && !holding && !document.hidden) {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(tick);
    }
  }

  function playEntrance(card, intro) {
    var token = ++generation;
    if (activeTl) activeTl.kill();
    killCard(card);
    phase = "enter";
    window.cancelAnimationFrame(raf);

    var bits = card.querySelectorAll(".anim");
    var line = card.querySelector(".rule");
    var coverLine = card.querySelector(".cover-rule");
    var photo = card.querySelector(".cover-photo img");
    var band = card.querySelector(".logo-band");
    var quiet = reduced();

    gsap.set(card, { autoAlpha: 1 });
    card.setAttribute("aria-hidden", "false");

    if (quiet) {
      gsap.set(bits, { autoAlpha: 1, y: 0, scaleX: 1, scale: 1 });
      if (photo) gsap.set(photo, { autoAlpha: 1, scale: 1 });
      if (band) gsap.set(band, { autoAlpha: 1, y: 0 });
      if (line) gsap.set(line, { scaleX: 1 });
      if (coverLine) gsap.set(coverLine, { scaleX: 1 });
      beginReading();
      return;
    }

    var tl = gsap.timeline({
      defaults: { ease: "power2.out" },
      onComplete: function () {
        if (token !== generation) return;
        beginReading();
      }
    });
    activeTl = tl;

    if (intro && card.getAttribute("data-kind") === "cover") {
      gsap.set(card, { autoAlpha: 1 });
      gsap.set(photo, { autoAlpha: 0, scale: 1.06 });
      gsap.set(band, { autoAlpha: 0, y: 28 });
      gsap.set(card.querySelectorAll(".logo-wordmark, .tagline"), { autoAlpha: 0, y: 14 });
      gsap.set(coverLine, { autoAlpha: 1, y: 0, scaleX: 0 });
      gsap.set(card.querySelector(".lockup-rule"), { autoAlpha: 1, y: 0, scaleX: 0 });
      tl.to(photo, { autoAlpha: 1, scale: 1, duration: 1.5, ease: "power2.out" })
        .to(band, { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out" })
        .to(card.querySelector(".logo-wordmark"), { autoAlpha: 1, y: 0, duration: 0.55, ease: "power2.out" }, "-=0.15")
        .to(card.querySelector(".lockup-rule"), { scaleX: 1, duration: 0.45, ease: "power2.inOut" }, "-=0.08")
        .to(card.querySelector(".tagline"), { autoAlpha: 1, y: 0, duration: 0.45 }, "-=0.05")
        .to(coverLine, { scaleX: 1, duration: 0.55, ease: "power2.inOut" }, "-=0.05");
      return;
    }

    gsap.set(card, { autoAlpha: 0 });
    tl.to(card, { autoAlpha: 1, duration: 0.6, ease: "power2.out" }, 0);

    var items = card.querySelectorAll(".body, .lede, .steps li, .closing, .seal");
    gsap.set(card.querySelectorAll(".title"), { autoAlpha: 0, y: 18 });
    if (line) gsap.set(line, { scaleX: 0 });
    gsap.set(items, { autoAlpha: 0, y: 16 });

    tl.to(card.querySelectorAll(".title"), { autoAlpha: 1, y: 0, duration: 0.55, ease: "power3.out" }, 0.12);
    if (line) tl.to(line, { scaleX: 1, duration: 0.45, ease: "power2.inOut" }, 0.38);
    if (items.length) {
      tl.to(items, {
        autoAlpha: 1,
        y: 0,
        duration: 0.48,
        stagger: 0.12,
        ease: "power2.out"
      }, 0.55);
    }
  }

  function updateChrome() {
    var onLast = index === count - 1;
    if (!onLast) replay.hidden = true;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === count - 1;
    zonePrev.disabled = index === 0;
    live.textContent = "Card " + (index + 1) + " de " + count;
    renderBars();
    slides.forEach(function (card, i) {
      card.setAttribute("aria-hidden", i === index ? "false" : "true");
    });
  }

  function go(nextIndex, replayIntro) {
    if (nextIndex < 0 || nextIndex >= count || nextIndex === index) return;
    var previous = slides[index];
    generation += 1;
    if (activeTl) {
      activeTl.kill();
      activeTl = null;
    }
    window.cancelAnimationFrame(raf);
    ended = false;
    paused = false;
    holding = false;
    progress = 0;
    replay.hidden = true;

    if (previous && !reduced()) {
      gsap.killTweensOf(previous);
      gsap.to(previous.querySelectorAll(".anim"), {
        autoAlpha: 0,
        duration: 0.22,
        ease: "power2.in",
        overwrite: true
      });
      gsap.to(previous, {
        autoAlpha: 0,
        duration: 0.55,
        ease: "power2.inOut",
        overwrite: true
      });
    } else if (previous) {
      gsap.set(previous, { autoAlpha: 0 });
    }

    index = nextIndex;
    updateChrome();
    var intro = replayIntro || (!introPlayed && slides[index].getAttribute("data-kind") === "cover");
    if (intro) introPlayed = true;
    playEntrance(slides[index], intro);
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
    if (index === 0) {
      introPlayed = false;
      playEntrance(slides[0], true);
      introPlayed = true;
      ended = false;
      replay.hidden = true;
      progress = 0;
      updateChrome();
      return;
    }
    introPlayed = false;
    go(0, true);
  }

  function finish() {
    ended = true;
    paused = true;
    progress = 1;
    phase = "read";
    window.cancelAnimationFrame(raf);
    renderBars();
    replay.hidden = false;
  }

  function tick(now) {
    if (paused || ended || phase !== "read") return;
    progress += (now - lastTs) / STORY_DURATION_MS;
    lastTs = now;
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

  function pauseAll() {
    if (ended) return;
    paused = true;
    window.cancelAnimationFrame(raf);
    if (activeTl) activeTl.pause();
  }

  function resumeAll() {
    if (ended || holding || document.hidden) return;
    paused = false;
    if (phase === "enter" && activeTl && activeTl.progress() < 1) {
      activeTl.resume();
      return;
    }
    if (phase === "read") {
      lastTs = performance.now();
      raf = window.requestAnimationFrame(tick);
    }
  }

  frame.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    if (event.target.closest("a, button")) return;
    frame._ptr = {
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      moved: false,
      id: event.pointerId
    };
    holding = true;
    pauseAll();
    try {
      frame.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Synthetic pointers cannot be captured. */
    }
  });

  frame.addEventListener("pointermove", function (event) {
    var ptr = frame._ptr;
    if (!ptr) return;
    var dx = event.clientX - ptr.x;
    var dy = event.clientY - ptr.y;
    if (dx * dx + dy * dy > 144) ptr.moved = true;
  });

  function releasePointer(event) {
    var ptr = frame._ptr;
    if (!ptr) return;
    frame._ptr = null;
    holding = false;
    var dx = event.clientX - ptr.x;
    var held = performance.now() - ptr.t > HOLD_MS;
    var swiped = event.pointerType !== "mouse" && Math.abs(dx) > SWIPE_PX;
    if (swiped) {
      if (dx < 0) next();
      else prev();
      if (!ended && paused) resumeAll();
      return;
    }
    if (!held && !ptr.moved) {
      var rect = frame.getBoundingClientRect();
      var ratio = (event.clientX - rect.left) / rect.width;
      if (ratio < 1 / 3) prev();
      else next();
      if (!ended && paused) resumeAll();
      return;
    }
    resumeAll();
  }

  frame.addEventListener("pointerup", releasePointer);
  frame.addEventListener("pointercancel", function () {
    if (!frame._ptr) return;
    frame._ptr = null;
    holding = false;
    resumeAll();
  });

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  zonePrev.addEventListener("click", prev);
  zoneNext.addEventListener("click", next);
  replay.addEventListener("click", restart);

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
        pauseAll();
      }
      return;
    }
    if (hiddenPause) {
      hiddenPause = false;
      resumeAll();
    }
  });

  var SHARE_TEXT = "Gostou? Compartilhe a Foveō com quem você ama.";
  var SHARE_URL = "https://foveoatelie.com.br";
  var shareMessage = SHARE_TEXT + " " + SHARE_URL;
  var shareBtn = document.querySelector(".share");
  var shareStatus = document.querySelector(".share-status");
  var shareWa = document.querySelector(".share-wa");

  if (shareWa) {
    shareWa.href = "https://wa.me/?text=" + encodeURIComponent(shareMessage);
    if (!navigator.share) shareWa.hidden = false;
  }

  function showCopied() {
    if (!shareStatus) return;
    shareStatus.hidden = false;
    window.clearTimeout(showCopied.timer);
    showCopied.timer = window.setTimeout(function () {
      shareStatus.hidden = true;
    }, 2400);
  }

  function copyShare() {
    var done = function () { showCopied(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareMessage).then(done).catch(done);
    } else {
      done();
    }
    if (shareWa) shareWa.hidden = false;
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (navigator.share) {
        navigator.share({
          title: "Foveō Ateliê",
          text: SHARE_TEXT,
          url: SHARE_URL
        }).catch(function (err) {
          if (err && err.name === "AbortError") return;
          copyShare();
        });
        return;
      }
      copyShare();
    });
  }

  updateChrome();
  introPlayed = true;
  playEntrance(slides[0], true);
  window.setTimeout(function () {
    live.textContent = "Card 1 de " + count;
  }, 80);
})();
