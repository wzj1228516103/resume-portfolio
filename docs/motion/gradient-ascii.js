(() => {
  const characters = ".:=+xX0S8#@";

  function getSeed(column, row) {
    const noise = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
    return noise - Math.floor(noise);
  }

  // The horizon composition is inspired by Gradient ASCII from React Bits.
  window.createAxonAscii = function createAxonAscii(canvas) {
    const context = canvas?.getContext("2d");
    if (!context) return null;

    let width = 0;
    let height = 0;
    let cells = [];
    let elapsed = 0;
    let lastFrame = -1;

    function draw(time) {
      const frame = Math.floor(time * 10);
      if (frame === lastFrame || !width || !height) return;
      elapsed = time;
      lastFrame = frame;
      context.clearRect(0, 0, width, height);

      for (const {x, y, across, envelope, seed} of cells) {
        const drift = Math.sin(time * 0.55 + across * 3.6);
        const rim = height * (0.43 + 0.3 * across ** 2 + drift * 0.035);
        const distance = y - rim;
        const spread = height * (distance < 0 ? 0.24 : 0.055);
        const light = Math.exp(-Math.abs(distance) / spread) * envelope;
        if (light < 0.085 + seed * 0.38) continue;

        const brightness = Math.min(1, light * (0.79 + seed * 0.32));
        const index = Math.floor(brightness * (characters.length - 1));
        context.globalAlpha = brightness * (0.26 + brightness * 0.52);
        context.fillText(characters[index], x, y);
      }
    }

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (!width || !height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const cellHeight = Math.max(width < 640 ? 12 : 16, Math.ceil(width / 155));
      const cellWidth = Math.round(cellHeight * 0.78);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      context.font = `${Math.round(cellHeight * 0.82)}px Consolas, "Liberation Mono", monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";

      const colors = context.createLinearGradient(0, 0, width, 0);
      colors.addColorStop(0, "#4a2786");
      colors.addColorStop(0.38, "#9675ea");
      colors.addColorStop(0.54, "#d3c4ff");
      colors.addColorStop(0.77, "#747fd0");
      colors.addColorStop(1, "#3b4587");
      context.fillStyle = colors;

      const spread = Math.min(width * 0.50, 820);
      cells = [];
      for (let row = 0, y = cellHeight / 2; y < height; row++, y += cellHeight) {
        for (let column = 0, x = cellWidth / 2; x < width; column++, x += cellWidth) {
          const across = (x - width * 0.48) / spread;
          if (Math.abs(across) >= 1) continue;
          const envelope = (1 - Math.abs(across)) ** 0.88;
          cells.push({x, y, across, envelope, seed: getSeed(column, row)});
        }
      }
      lastFrame = -1;
      draw(elapsed);
    }

    resize();
    new ResizeObserver(resize).observe(canvas);
    return draw;
  };
})();
