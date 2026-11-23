(() => {
  const surface = document.querySelector(".motion-surface");
  const webglCanvas = document.querySelector("#particles-webgl");
  const fallbackCanvas = document.querySelector("#particles-canvas");
  const button = document.querySelector("#motion-toggle");
  if (!button || button.closest(".site-head[hidden]")) return;

  const compact = matchMedia("(max-width: 800px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const english = /^en(?:-|$)/i.test(document.documentElement.lang);
  const drawAscii = window.createAxonAscii?.(surface.querySelector(".gradient-ascii"));

  function createWebGL(canvas) {
    const { THREE, AxonFluid, AxonParticles } = window;
    if (!THREE || !AxonFluid || !AxonParticles) return null;
    const options = { alpha: false, antialias: false, powerPreference: "high-performance" };
    const context = canvas.getContext("webgl2", options);
    if (!context?.getExtension("EXT_color_buffer_float")) return null;

    const renderer = new THREE.WebGLRenderer({ canvas, context, ...options });
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    const base = new THREE.Vector3(-1.17, 0, 6);
    const target = base.clone();
    camera.position.copy(base);

    let fluid, particles, mobile, width, height;
    let elapsedSinceStroke = Infinity;
    let frames = 0;

    function resize(size) {
      ({ width, height } = size);
      renderer.setPixelRatio(size.dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.zoom = size.mobile ? Math.min(0.9, camera.aspect * 1.08) : 0.88;
      camera.updateProjectionMatrix();
      if (fluid) fluid.resize(width, height, size.dpr);
      else fluid = new AxonFluid(renderer, width, height, size.dpr);
      if (!particles || mobile !== size.mobile) {
        particles?.dispose();
        mobile = size.mobile;
        particles = new AxonParticles(renderer, mobile);
        scene.add(particles.group);
        frames = 0;
      }
      particles.resize(size.dpr);
    }

    function draw(elapsed, delta, pointer, brush) {
      target.copy(base);
      if (pointer.active) {
        target.x = base.x - (pointer.x / width * 2 - 1) * 0.8;
        target.y = base.y + (pointer.y / height * 2 - 1) * 1.5;
      }
      elapsedSinceStroke += delta;
      if (brush) {
        const { dx, dy, distance, radius, stroke } = brush;
        const power = Math.min(distance / 15, 1) * 3.8 * stroke;
        const x = pointer.x / width;
        const y = 1 - pointer.y / height;
        const trail = elapsedSinceStroke <= 0.05 ? stroke : 0;
        fluid.splat(x - dx * trail / width, y + dy * trail / height,
          x, y, dx * power, -dy * power, radius / height);
        elapsedSinceStroke = 0;
      }
      camera.position.lerp(target, 0.05);
      camera.lookAt(0, 0, 0);
      fluid.step();
      particles.step(elapsed, delta * 60, camera, fluid.velocity, fluid.density);
      renderer.render(scene, camera);
      // Let the GPU simulation settle before replacing the poster.
      frames += 1;
      return frames >= 5;
    }

    function dispose() {
      particles?.dispose();
      fluid?.dispose();
      renderer.dispose();
    }

    return { canvas, resize, draw, dispose };
  }

  let engine, size, frame, lastFrame;
  let elapsed = 0;
  let needsResize = true;
  let visible = true;
  let canTryWebGL = true;
  let unavailable = false;
  let paused = reduced.matches;
  const pointer = { x: 0, y: 0, active: false };
  const previous = { ...pointer };

  function clearPointer() {
    pointer.active = previous.active = false;
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = lastFrame = undefined;
    clearPointer();
  }

  function track(event) {
    if (!event.isPrimary || frame === undefined || !size) return;
    const bounds = surface.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= size.width && pointer.y <= size.height;
    if (event.type === "pointerdown" || !pointer.active) previous.active = false;
  }

  function getBrush() {
    if (!pointer.active || !previous.active) return null;
    const dx = pointer.x - previous.x;
    const dy = pointer.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.01) return null;
    const maxRadius = Math.min(size.mobile ? 42 : 54, size.height * (size.mobile ? 0.08 : 0.06));
    const radius = Math.min(distance / 5, 1) * maxRadius;
    return { dx, dy, distance, radius, stroke: Math.min(1, 32 / distance) };
  }

  function recover() {
    stop();
    engine.canvas.classList.remove("is-rendering");
    if (engine.canvas !== webglCanvas) {
      unavailable = true;
      button.hidden = true;
      return;
    }
    try { engine.dispose(); } catch { /* A lost context may already have released its resources. */ }
    engine = undefined;
    canTryWebGL = false;
    needsResize = true;
    sync();
  }

  function animate(now) {
    const delta = lastFrame === undefined ? 1 / 60 : Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    elapsed += delta;
    try {
      if (needsResize) {
        size = {
          width: Math.max(surface.clientWidth, 1),
          height: Math.max(surface.clientHeight, 1),
          dpr: Math.min(devicePixelRatio || 1, 2),
          mobile: compact.matches
        };
        engine.resize(size);
        needsResize = false;
        clearPointer();
      }
      if (engine.draw(elapsed, delta, pointer, getBrush())) engine.canvas.classList.add("is-rendering");
    } catch {
      recover();
      return;
    }
    Object.assign(previous, pointer);
    drawAscii?.(elapsed);
    frame = requestAnimationFrame(animate);
  }

  function sync() {
    if (unavailable) return;
    button.textContent = english ? (paused ? "Play motion" : "Pause motion") : (paused ? "启用动效" : "暂停动效");
    if (paused || !visible || document.hidden) {
      stop();
      return;
    }

    if (!engine) {
      try {
        if (canTryWebGL) engine = createWebGL(webglCanvas);
      } catch { /* Try Canvas if WebGL is unavailable. */ }
      if (!engine) {
        try { engine = window.createAxonCanvasMotion?.(fallbackCanvas); } catch { /* Keep the poster. */ }
      }
      if (!engine) {
        unavailable = true;
        button.hidden = true;
        return;
      }
    }
    if (frame === undefined) frame = requestAnimationFrame(animate);
  }

  button.hidden = false;
  button.addEventListener("click", () => {
    paused = !paused;
    sync();
  });
  reduced.addEventListener("change", event => {
    paused = event.matches;
    sync();
  });
  new ResizeObserver(() => { needsResize = true; }).observe(surface);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(surface);
  window.addEventListener("pointermove", track, { passive: true });
  window.addEventListener("pointerdown", track, { passive: true });
  window.addEventListener("pointercancel", clearPointer, { passive: true });
  window.addEventListener("pointerup", event => {
    if (event.pointerType === "touch") clearPointer();
  }, { passive: true });
  window.addEventListener("pointerout", event => {
    if (!event.relatedTarget) clearPointer();
  }, { passive: true });
  document.addEventListener("visibilitychange", sync);
  webglCanvas.addEventListener("webglcontextlost", event => {
    if (engine?.canvas !== webglCanvas) return;
    event.preventDefault();
    recover();
  });
  sync();
})();
