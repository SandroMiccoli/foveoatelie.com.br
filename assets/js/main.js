(function () {
  document.documentElement.classList.add("js");

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    var heroCrop = document.querySelector(".logo-crop--hero");
    if (heroCrop && document.documentElement.classList.contains("has-logo-handoff") && "IntersectionObserver" in window) {
      var logoObserver = null;
      var watchHeroLogo = function () {
        if (logoObserver) logoObserver.disconnect();
        var top = Math.ceil(header.getBoundingClientRect().height);
        logoObserver = new IntersectionObserver(function (entries) {
          header.classList.toggle("is-logo", !entries[0].isIntersecting);
        }, { threshold: 0, rootMargin: "-" + top + "px 0px 0px 0px" });
        logoObserver.observe(heroCrop);
      };
      watchHeroLogo();
      window.addEventListener("resize", watchHeroLogo);
    }

    var toggle = header.querySelector(".nav-toggle");
    var menu = header.querySelector(".nav");
    if (toggle && menu) {
      var setMenu = function (open) {
        header.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Fechar o menu" : "Abrir o menu");
      };
      toggle.addEventListener("click", function () {
        setMenu(!header.classList.contains("is-open"));
      });
      menu.addEventListener("click", function (event) {
        if (event.target.closest("a")) setMenu(false);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && header.classList.contains("is-open")) {
          setMenu(false);
          toggle.focus();
        }
      });
      window.matchMedia("(min-width: 760px)").addEventListener("change", function (event) {
        if (event.matches) setMenu(false);
      });
    }
  }

  var bar = document.querySelector(".fv-consent");
  var panel = document.getElementById("fv-privacy");
  var storedChoice = null;
  try { storedChoice = localStorage.getItem("fv-consent"); } catch (e) {}
  function showConsentBar() {
    if (bar && !storedChoice) bar.classList.add("is-open");
  }
  if (document.documentElement.classList.contains("intro-on") && !window.__fvIntroDone) {
    window.addEventListener("fv-intro-done", showConsentBar);
  } else {
    showConsentBar();
  }

  var returnFocus = null;
  var barWasOpen = false;

  function setChoice(choice) {
    storedChoice = choice;
    try { localStorage.setItem("fv-consent", choice); } catch (err) {}
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: choice === "granted" ? "granted" : "denied"
      });
    }
    barWasOpen = false;
    if (bar) bar.classList.remove("is-open");
    closePanel(false);
  }

  function focusable(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }

  function openPanel(trigger) {
    if (!panel) return;
    returnFocus = trigger || document.activeElement;
    barWasOpen = !!(bar && bar.classList.contains("is-open"));
    if (bar) bar.classList.remove("is-open");
    panel.hidden = false;
    document.body.classList.add("fv-privacy-open");
    window.requestAnimationFrame(function () {
      panel.classList.add("is-shown");
    });
    var closeBtn = panel.querySelector(".fv-privacy__close");
    if (closeBtn) closeBtn.focus();
  }

  function closePanel(restoreFocus) {
    if (!panel || panel.hidden) {
      if (restoreFocus && returnFocus) returnFocus.focus();
      return;
    }
    panel.classList.remove("is-shown");
    var finish = function () {
      panel.hidden = true;
      document.body.classList.remove("fv-privacy-open");
      if (barWasOpen && bar) bar.classList.add("is-open");
      barWasOpen = false;
      if (restoreFocus && returnFocus) returnFocus.focus();
    };
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) finish();
    else window.setTimeout(finish, 380);
  }

  document.addEventListener("click", function (event) {
    var choiceBtn = event.target.closest("button[data-c]");
    if (choiceBtn && ((bar && bar.contains(choiceBtn)) || (panel && panel.contains(choiceBtn)))) {
      setChoice(choiceBtn.getAttribute("data-c"));
      return;
    }

    var privacyLink = event.target.closest("a[href]");
    if (privacyLink && panel) {
      var path = privacyLink.pathname || "";
      if (/\/privacidade\/?$/.test(path)) {
        event.preventDefault();
        openPanel(privacyLink);
        return;
      }
    }

    if (event.target.closest("[data-privacy-close]")) {
      closePanel(true);
      return;
    }

    var opener = event.target.closest("[data-consent-open]");
    if (opener && bar) {
      event.preventDefault();
      if (panel && !panel.hidden) closePanel(false);
      bar.classList.add("is-open");
      var first = bar.querySelector("button");
      if (first) first.focus();
      return;
    }

    var link = event.target.closest("a[href*='wa.me']");
    if (!link || typeof window.gtag !== "function") return;
    var product = link.getAttribute("data-wa-product");
    var params = {};
    if (product) params.product_name = product;
    window.gtag("event", "whatsapp_click", params);
  });

  document.addEventListener("keydown", function (event) {
    if (!panel || panel.hidden) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel(true);
      return;
    }
    if (event.key !== "Tab") return;
    var items = focusable(panel);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;

  var nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  document.documentElement.classList.add("js");

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });

  nodes.forEach(function (node) { observer.observe(node); });
})();
