(function () {
  const hero = document.querySelector(".hero");
  const scan = document.querySelector(".hero-scan");

  function revealHero() {
    if (hero) hero.classList.add("is-ready");
  }

  if (scan) {
    if (scan.complete) {
      requestAnimationFrame(revealHero);
    } else {
      scan.addEventListener("load", revealHero, { once: true });
      scan.addEventListener("error", revealHero, { once: true });
    }
  } else {
    revealHero();
  }

  window.setTimeout(revealHero, 1200);

  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.querySelector(".nav-menu");

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      const isOpen = navMenu.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    });

    navMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navMenu.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }
})();
