(function () {
  document.documentElement.classList.add("js");

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

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
  if (bar) {
    var stored = null;
    try { stored = localStorage.getItem("fv-consent"); } catch (e) {}
    if (!stored) bar.classList.add("is-open");

    bar.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-c]");
      if (!button) return;
      var choice = button.getAttribute("data-c");
      try { localStorage.setItem("fv-consent", choice); } catch (err) {}
      if (typeof window.gtag === "function") {
        window.gtag("consent", "update", {
          analytics_storage: choice === "granted" ? "granted" : "denied"
        });
      }
      bar.classList.remove("is-open");
    });
  }

  document.addEventListener("click", function (event) {
    var opener = event.target.closest("[data-consent-open]");
    if (opener && bar) {
      event.preventDefault();
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
