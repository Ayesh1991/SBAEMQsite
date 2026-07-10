/* ============================================================
   fx.js — GSAP-powered motion design.
   Every animation has a no-op fallback so the app remains fully
   functional if GSAP fails to load or the user prefers reduced
   motion.
   ============================================================ */

const FX = (() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = () => typeof gsap !== 'undefined' && !reducedMotion;

  /* ---------- page transitions ---------- */

  function viewIn(root) {
    if (!hasGSAP()) return;
    const targets = root.querySelectorAll('[data-animate]');
    if (!targets.length) return;
    gsap.fromTo(targets,
      { opacity: 0, y: 26 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: 'power3.out', clearProps: 'transform' });
  }

  /* ---------- landing hero ---------- */

  function heroIntro(root) {
    if (!hasGSAP()) return;
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.fromTo(root.querySelectorAll('.hero-kicker'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6 })
      .fromTo(root.querySelectorAll('.hero-title .line'),
        { opacity: 0, y: 60, rotateX: 35 },
        { opacity: 1, y: 0, rotateX: 0, duration: 0.9, stagger: 0.12 }, '-=0.3')
      .fromTo(root.querySelectorAll('.hero-sub, .hero-cta'),
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.1 }, '-=0.45')
      .fromTo(root.querySelectorAll('.hero-stat'),
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.4');
  }

  /* ---------- numbers & meters ---------- */

  function countUp(elm, value, suffix = '') {
    if (!hasGSAP()) { elm.textContent = value + suffix; return; }
    const obj = { v: 0 };
    gsap.to(obj, {
      v: value, duration: 1.1, ease: 'power2.out',
      onUpdate: () => { elm.textContent = Math.round(obj.v) + suffix; }
    });
  }

  function fillBar(elm, fraction) {
    const pct = Math.round(fraction * 100) + '%';
    if (!hasGSAP()) { elm.style.width = pct; return; }
    gsap.fromTo(elm, { width: 0 }, { width: pct, duration: 1.2, ease: 'power3.out' });
  }

  /* ---------- quiz feedback ---------- */

  function pulse(elm) {
    if (!hasGSAP()) return;
    gsap.fromTo(elm, { scale: 0.97 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' });
  }

  function shake(elm) {
    if (!hasGSAP()) return;
    gsap.fromTo(elm, { x: -6 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.35)' });
  }

  function questionSwap(elm, dir = 1) {
    if (!hasGSAP()) return;
    gsap.fromTo(elm, { opacity: 0, x: 36 * dir }, { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out' });
  }

  /* ---------- results celebration ---------- */

  function confetti(host, count = 90) {
    if (reducedMotion) return;
    const colors = ['#5eead4', '#a78bfa', '#f4c95d', '#3987e5', '#f0abc9'];
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    host.appendChild(layer);

    for (let i = 0; i < count; i++) {
      const bit = document.createElement('span');
      bit.className = 'confetti-bit';
      bit.style.background = colors[i % colors.length];
      bit.style.left = (35 + Math.random() * 30) + '%';
      layer.appendChild(bit);
      const fall = () => {
        bit.style.transition = `transform ${1.6 + Math.random()}s cubic-bezier(.2,.7,.3,1), opacity 0.6s ease ${1.4 + Math.random() * 0.8}s`;
        bit.style.transform = `translate(${(Math.random() - 0.5) * 480}px, ${320 + Math.random() * 260}px) rotate(${Math.random() * 720 - 360}deg)`;
        bit.style.opacity = '0';
      };
      if (hasGSAP()) {
        gsap.fromTo(bit, { y: -20, opacity: 1 }, {
          y: 340 + Math.random() * 260,
          x: (Math.random() - 0.5) * 480,
          rotation: Math.random() * 720 - 360,
          opacity: 0,
          duration: 1.8 + Math.random() * 1.2,
          ease: 'power1.in',
          delay: Math.random() * 0.35
        });
      } else {
        requestAnimationFrame(fall);
      }
    }
    setTimeout(() => layer.remove(), 3600);
  }

  function scoreReveal(elm, percent) {
    countUp(elm, percent, '%');
    if (hasGSAP()) {
      gsap.fromTo(elm, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.6)' });
    }
  }

  return { viewIn, heroIntro, countUp, fillBar, pulse, shake, questionSwap, confetti, scoreReveal };
})();
