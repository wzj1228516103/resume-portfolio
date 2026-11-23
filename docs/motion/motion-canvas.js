(() => {
  const palette = ["#666273", "#a49fae", "#d7d4e0", "#f9f6ff", "#b9a4ee"];
  const posterWidth = 640;
  const posterHeight = 400;

  function posterSamples() {
    const data = atob(window.resumePosterPoints);
    const groups = palette.map(() => []);
    for (let index = 0; index < data.length; index += 6) {
      const x = data.charCodeAt(index) + data.charCodeAt(index + 1) * 256;
      const y = data.charCodeAt(index + 2) + data.charCodeAt(index + 3) * 256;
      const brightness = data.charCodeAt(index + 4);
      const tone = data.charCodeAt(index + 5);
      groups[tone].push({
        x: (x + Math.random()) / posterWidth,
        y: (y + Math.random()) / posterHeight,
        phase: Math.random() * Math.PI * 2,
        size: 0.9 + brightness / 285,
        shiftX: 0,
        shiftY: 0
      });
    }
    return groups;
  }

  window.createAxonCanvasMotion = function createAxonCanvasMotion(canvas) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || !window.resumePosterPoints) return null;
    const groups = posterSamples();
    let width, height, mobile;

    function resize(size) {
      ({ width, height, mobile } = size);
      const dpr = Math.min(size.dpr, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    }

    function draw(elapsed, delta, pointer, brush) {
      const aspect = posterWidth / posterHeight;
      const imageHeight = mobile ? height : Math.max(height, width / aspect);
      const imageWidth = imageHeight * aspect;
      const left = (width - imageWidth) / 2 + Math.sin(elapsed * 0.75) * 5;
      const top = (height - imageHeight) / 2 + Math.cos(elapsed * 0.5) * 4;
      const decay = Math.exp(-delta * 6);
      const radiusSquared = brush ? brush.radius ** 2 : 0;
      const stride = mobile ? 2 : 1;

      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      for (const [index, points] of groups.entries()) {
        context.fillStyle = palette[index];
        for (let i = 0; i < points.length; i += stride) {
          const point = points[i];
          const angle = point.phase + elapsed * 1.5;
          const x = left + point.x * imageWidth + Math.sin(angle) * 1.7;
          const y = top + point.y * imageHeight + Math.cos(angle * 0.8) * 1.7;
          point.shiftX *= decay;
          point.shiftY *= decay;

          if (brush) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const proximity = Math.max(0, 1 - (dx * dx + dy * dy) / radiusSquared);
            const force = brush.stroke * proximity ** 2 * 0.35;
            point.shiftX += brush.dx * force;
            point.shiftY += brush.dy * force;
          }
          context.fillRect(x + point.shiftX, y + point.shiftY, point.size, point.size);
        }
      }
      return true;
    }

    return { canvas, resize, draw };
  };
})();
