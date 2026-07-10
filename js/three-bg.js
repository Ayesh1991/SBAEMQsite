/* ============================================================
   three-bg.js — ambient Three.js scene behind the interface.

   A slowly-breathing double helix of luminous particles wrapped
   in a drifting starfield: quiet on interior pages, cinematic
   on the landing hero. Degrades gracefully — if Three.js fails
   to load or the user prefers reduced motion, the canvas simply
   stays empty and the CSS gradient backdrop carries the design.
   ============================================================ */

const ThreeBG = (() => {
  let renderer, scene, camera, helix, stars, raf = null;
  let mouseX = 0, mouseY = 0;
  let intensity = 1; // 1 = hero, 0.35 = interior pages

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function supported() {
    return typeof THREE !== 'undefined' && !reducedMotion;
  }

  function buildHelix() {
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const cA = new THREE.Color('#5eead4');   // teal strand
    const cB = new THREE.Color('#a78bfa');   // violet strand
    const cRung = new THREE.Color('#38508f');

    for (let i = 0; i < COUNT; i++) {
      const t = (i / COUNT) * Math.PI * 10;      // 5 turns
      const yPos = (i / COUNT - 0.5) * 34;
      const lane = i % 3;                        // 0,1 strands · 2 rungs
      let xPos, zPos, col;
      if (lane === 2) {
        const k = (i % 7) / 7;                   // point along the rung
        xPos = Math.cos(t) * 6 * (k * 2 - 1);
        zPos = Math.sin(t) * 6 * (k * 2 - 1);
        col = cRung;
      } else {
        const phase = lane === 0 ? 0 : Math.PI;
        xPos = Math.cos(t + phase) * 6;
        zPos = Math.sin(t + phase) * 6;
        col = lane === 0 ? cA : cB;
      }
      positions.set([xPos, yPos, zPos], i * 3);
      colors.set([col.r, col.g, col.b], i * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    return new THREE.Points(geo, mat);
  }

  function buildStars() {
    const COUNT = 700;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions.set([
        (Math.random() - 0.5) * 120,
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 60 - 10
      ], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8fa3d9, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function init(canvas) {
    if (!supported()) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0a0c18, 0.028);
      camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
      camera.position.set(0, 0, 24);

      helix = buildHelix();
      stars = buildStars();
      scene.add(helix, stars);

      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('pointermove', e => {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      }, { passive: true });

      loop(0);
      return true;
    } catch (e) {
      console.warn('Three.js background unavailable:', e);
      return false;
    }
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const time = t * 0.001;

    helix.rotation.y = time * 0.12;
    helix.position.y = Math.sin(time * 0.4) * 0.6;
    helix.material.opacity = 0.9 * intensity;

    stars.rotation.y = time * 0.008;
    stars.material.opacity = 0.55 * Math.max(intensity, 0.5);

    // parallax follows the pointer, eased
    camera.position.x += (mouseX * 2.2 - camera.position.x) * 0.03;
    camera.position.y += (-mouseY * 1.4 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  /** Interior pages dim the scene so content stays legible. */
  function setMood(mode) {
    intensity = mode === 'hero' ? 1 : 0.35;
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return { init, setMood, stop, supported };
})();
