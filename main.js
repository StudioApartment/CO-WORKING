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
})();
