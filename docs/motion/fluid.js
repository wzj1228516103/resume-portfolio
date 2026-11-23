/* global THREE */
(() => {
  "use strict";

  const SIM_SIZE = 256;
  const DYE_SIZE = 512;
  const DT = 1 / 60;
  const VELOCITY_DISSIPATION = 0.98;
  const DENSITY_DISSIPATION = 0.97;
  const PRESSURE_DISSIPATION = 0.95;
  const PRESSURE_ITERATIONS = 5;
  const CURL = 30;
  const IDLE_FRAMES = 180;

  const fullscreenVertex = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const clearFragment = `
    void main() {
      gl_FragColor = vec4(0.0);
    }
  `;

  const splatFragment = `
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform vec2 uStart, uEnd;
    uniform vec3 uForce;
    uniform float uAspect, uRadius;

    void main() {
      vec2 aspect = vec2(uAspect, 1.0);
      vec2 segment = (uEnd - uStart) * aspect;
      vec2 offset = (vUv - uStart) * aspect;
      float along = clamp(dot(offset, segment) / max(dot(segment, segment), 1e-8), 0.0, 1.0);
      vec2 delta = offset - segment * along;
      float falloff = exp(-4.0 * dot(delta, delta) / (uRadius * uRadius));
      vec3 previous = texture2D(uTarget, vUv).rgb;
      gl_FragColor = vec4(previous + uForce * falloff, 1.0);
    }
  `;

  const curlFragment = `
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 uTexel;

    void main() {
      float left = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
      float right = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
      float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
      float top = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
      gl_FragColor = vec4(0.5 * (right - left - top + bottom), 0.0, 0.0, 1.0);
    }
  `;

  const vorticityFragment = `
    varying vec2 vUv;
    uniform sampler2D uVelocity, uCurl;
    uniform vec2 uTexel;
    uniform float uDt, uStrength;

    void main() {
      float left = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).r;
      float right = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).r;
      float bottom = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).r;
      float top = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).r;
      float center = texture2D(uCurl, vUv).r;

      vec2 force = 0.5 * vec2(abs(top) - abs(bottom), abs(left) - abs(right));
      force *= uStrength * center / max(length(force), 1e-4);

      vec3 velocity = texture2D(uVelocity, vUv).xyz;
      velocity.xy = clamp(velocity.xy + force * uDt, -1000.0, 1000.0);
      gl_FragColor = vec4(velocity, 1.0);
    }
  `;

  const divergenceFragment = `
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 uTexel;

    void main() {
      vec2 center = texture2D(uVelocity, vUv).xy;
      vec2 dx = vec2(uTexel.x, 0.0);
      vec2 dy = vec2(0.0, uTexel.y);
      float left = vUv.x < uTexel.x ? -center.x : texture2D(uVelocity, vUv - dx).x;
      float right = vUv.x > 1.0 - uTexel.x ? -center.x : texture2D(uVelocity, vUv + dx).x;
      float bottom = vUv.y < uTexel.y ? -center.y : texture2D(uVelocity, vUv - dy).y;
      float top = vUv.y > 1.0 - uTexel.y ? -center.y : texture2D(uVelocity, vUv + dy).y;
      gl_FragColor = vec4(0.5 * (right - left + top - bottom), 0.0, 0.0, 1.0);
    }
  `;

  const decayFragment = `
    varying vec2 vUv;
    uniform sampler2D uField;
    uniform float uDissipation;

    void main() {
      gl_FragColor = texture2D(uField, vUv) * uDissipation;
    }
  `;

  const pressureFragment = `
    varying vec2 vUv;
    uniform sampler2D uPressure, uDivergence;
    uniform vec2 uTexel;

    void main() {
      float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
      float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
      float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).r;
      float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).r;
      float divergence = texture2D(uDivergence, vUv).r;
      gl_FragColor = vec4(0.25 * (left + right + bottom + top - divergence), 0.0, 0.0, 1.0);
    }
  `;

  const gradientFragment = `
    varying vec2 vUv;
    uniform sampler2D uPressure, uVelocity;
    uniform vec2 uTexel;

    void main() {
      float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
      float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
      float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).r;
      float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).r;
      vec3 velocity = texture2D(uVelocity, vUv).xyz;
      velocity.xy -= vec2(right - left, top - bottom);
      gl_FragColor = vec4(velocity, 1.0);
    }
  `;

  // On WebGL implementations without half-float texture filtering, interpolate in the shader.
  const fieldSampler = `
    vec4 sampleField(sampler2D field, vec2 uv, vec2 texel) {
      #ifdef MANUAL_FILTER
        vec2 pixel = uv / texel - 0.5;
        vec2 origin = (floor(pixel) + 0.5) * texel;
        vec2 weight = fract(pixel);
        vec4 bottom = mix(
          texture2D(field, origin),
          texture2D(field, origin + vec2(texel.x, 0.0)),
          weight.x
        );
        vec4 top = mix(
          texture2D(field, origin + vec2(0.0, texel.y)),
          texture2D(field, origin + texel),
          weight.x
        );
        return mix(bottom, top, weight.y);
      #else
        return texture2D(field, uv);
      #endif
    }
  `;

  const advectionFragment = `
    varying vec2 vUv;
    uniform sampler2D uVelocity, uField;
    uniform vec2 uVelocityTexel, uFieldTexel;
    uniform float uDt, uDissipation;
    FIELD_SAMPLER

    void main() {
      vec2 velocity = sampleField(uVelocity, vUv, uVelocityTexel).xy;
      vec2 origin = vUv - uDt * velocity * uVelocityTexel;
      gl_FragColor = sampleField(uField, origin, uFieldTexel) * uDissipation;
    }
  `.replace("FIELD_SAMPLER", fieldSampler);

  const maskFragment = `
    varying vec2 vUv;
    uniform sampler2D uDye;
    uniform vec2 uDyeTexel;
    FIELD_SAMPLER

    void main() {
      vec3 dye = sampleField(uDye, vUv, uDyeTexel).rgb;
      gl_FragColor = vec4(dye, max(dye.r, max(dye.g, dye.b)));
    }
  `.replace("FIELD_SAMPLER", fieldSampler);

  function makeTarget(width, height, filter) {
    return new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  function makePair(size, filter) {
    return { read: makeTarget(size, size, filter), write: makeTarget(size, size, filter) };
  }

  function swap(pair) {
    const read = pair.read;
    pair.read = pair.write;
    pair.write = read;
  }

  function makePass(fragmentShader, inputs = {}, defines = {}) {
    const uniforms = {};
    for (const [name, value] of Object.entries(inputs)) {
      uniforms[name] = { value };
    }
    return new THREE.ShaderMaterial({
      uniforms,
      defines,
      vertexShader: fullscreenVertex,
      fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  class AxonFluid {
    #renderer;
    #scene;
    #camera;
    #quad;
    #passes;
    #velocity;
    #dye;
    #pressure;
    #curl;
    #divergence;
    #mask;
    #aspect = 1;
    #idle = IDLE_FRAMES;

    constructor(renderer, width, height, pixelRatio) {
      this.#renderer = renderer;
      const linear = renderer.capabilities.isWebGL2 ||
        renderer.extensions.has("OES_texture_half_float_linear");
      const filter = linear ? THREE.LinearFilter : THREE.NearestFilter;
      const defines = linear ? {} : { MANUAL_FILTER: 1 };
      const simTexel = new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE);
      const dyeTexel = new THREE.Vector2(1 / DYE_SIZE, 1 / DYE_SIZE);

      this.#velocity = makePair(SIM_SIZE, filter);
      this.#dye = makePair(DYE_SIZE, filter);
      this.#pressure = makePair(SIM_SIZE, THREE.NearestFilter);
      this.#curl = makeTarget(SIM_SIZE, SIM_SIZE, THREE.NearestFilter);
      this.#divergence = makeTarget(SIM_SIZE, SIM_SIZE, THREE.NearestFilter);
      this.#mask = makeTarget(1, 1, filter);

      this.#passes = {
        clear: makePass(clearFragment),
        splat: makePass(splatFragment, {
          uTarget: null, uStart: new THREE.Vector2(), uEnd: new THREE.Vector2(),
          uForce: new THREE.Vector3(), uAspect: 1, uRadius: 0,
        }),
        curl: makePass(curlFragment, { uVelocity: null, uTexel: simTexel }),
        vorticity: makePass(vorticityFragment, {
          uVelocity: null, uCurl: null, uTexel: simTexel, uDt: DT, uStrength: CURL,
        }),
        divergence: makePass(divergenceFragment, { uVelocity: null, uTexel: simTexel }),
        decay: makePass(decayFragment, { uField: null, uDissipation: PRESSURE_DISSIPATION }),
        pressure: makePass(pressureFragment, {
          uPressure: null, uDivergence: null, uTexel: simTexel,
        }),
        gradient: makePass(gradientFragment, {
          uPressure: null, uVelocity: null, uTexel: simTexel,
        }),
        advectVelocity: makePass(advectionFragment, {
          uVelocity: null, uField: null, uVelocityTexel: simTexel,
          uFieldTexel: simTexel, uDt: DT, uDissipation: VELOCITY_DISSIPATION,
        }, defines),
        advectDye: makePass(advectionFragment, {
          uVelocity: null, uField: null, uVelocityTexel: simTexel,
          uFieldTexel: dyeTexel, uDt: DT, uDissipation: DENSITY_DISSIPATION,
        }, defines),
        mask: makePass(maskFragment, { uDye: null, uDyeTexel: dyeTexel }, defines),
      };

      this.#scene = new THREE.Scene();
      this.#camera = new THREE.Camera();
      this.#quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.#passes.clear);
      this.#quad.frustumCulled = false;
      this.#scene.add(this.#quad);

      this.#clearFields();
      this.resize(width, height, pixelRatio);
    }

    get velocity() {
      return this.#velocity.read.texture;
    }

    get density() {
      return this.#mask.texture;
    }

    resize(width, height, pixelRatio) {
      this.#aspect = Math.max(width, 1) / Math.max(height, 1);
      const limit = this.#renderer.capabilities.maxTextureSize;
      const scale = Math.min(pixelRatio, limit / Math.max(width, height, 1));
      const targetWidth = Math.max(1, Math.floor(width * scale));
      const targetHeight = Math.max(1, Math.floor(height * scale));
      this.#mask.setSize(targetWidth, targetHeight);
      this.#withRenderTarget(() => this.#display());
    }

    splat(fromX, fromY, toX, toY, forceX, forceY, radiusUV) {
      if (radiusUV <= 0) return;

      this.#idle = 0;
      const uniforms = this.#passes.splat.uniforms;
      uniforms.uStart.value.set(fromX, fromY);
      uniforms.uEnd.value.set(toX, toY);
      uniforms.uAspect.value = this.#aspect;

      this.#withRenderTarget(() => {
        uniforms.uForce.value.set(forceX, forceY, 1);
        uniforms.uRadius.value = Math.max(radiusUV, 1 / SIM_SIZE);
        this.#advance(this.#velocity, this.#passes.splat, {
          uTarget: this.#velocity.read.texture,
        });

        uniforms.uForce.value.set(1, 1, 1);
        uniforms.uRadius.value = Math.max(radiusUV, 1 / DYE_SIZE);
        this.#advance(this.#dye, this.#passes.splat, { uTarget: this.#dye.read.texture });
      });
    }

    step() {
      if (this.#idle >= IDLE_FRAMES) return;

      this.#idle += 1;
      if (this.#idle === IDLE_FRAMES) {
        // The remaining dye and velocity contribute negligible force after three seconds.
        this.#clearFields();
        return;
      }

      const pass = this.#passes;
      this.#withRenderTarget(() => {
        this.#render(pass.curl, this.#curl, { uVelocity: this.velocity });
        this.#advance(this.#velocity, pass.vorticity, {
          uVelocity: this.velocity, uCurl: this.#curl.texture,
        });
        this.#render(pass.divergence, this.#divergence, { uVelocity: this.velocity });
        this.#advance(this.#pressure, pass.decay, { uField: this.#pressure.read.texture });

        for (let iteration = 0; iteration < PRESSURE_ITERATIONS; iteration += 1) {
          this.#advance(this.#pressure, pass.pressure, {
            uPressure: this.#pressure.read.texture, uDivergence: this.#divergence.texture,
          });
        }

        this.#advance(this.#velocity, pass.gradient, {
          uPressure: this.#pressure.read.texture, uVelocity: this.velocity,
        });
        this.#advance(this.#velocity, pass.advectVelocity, {
          uVelocity: this.velocity, uField: this.velocity,
        });
        this.#advance(this.#dye, pass.advectDye, {
          uVelocity: this.velocity, uField: this.#dye.read.texture,
        });
        this.#display();
      });
    }

    dispose() {
      for (const pair of [this.#velocity, this.#dye, this.#pressure]) {
        pair.read.dispose();
        pair.write.dispose();
      }
      for (const target of [this.#curl, this.#divergence, this.#mask]) {
        target.dispose();
      }
      for (const pass of Object.values(this.#passes)) {
        pass.dispose();
      }
      this.#quad.geometry.dispose();
    }

    #withRenderTarget(run) {
      const renderer = this.#renderer;
      const target = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try {
        run();
      } finally {
        renderer.setRenderTarget(target);
        renderer.autoClear = autoClear;
      }
    }

    #render(pass, target, inputs = {}) {
      for (const [name, value] of Object.entries(inputs)) {
        pass.uniforms[name].value = value;
      }
      this.#quad.material = pass;
      this.#renderer.setRenderTarget(target);
      this.#renderer.render(this.#scene, this.#camera);
    }

    #advance(pair, pass, inputs) {
      this.#render(pass, pair.write, inputs);
      swap(pair);
    }

    #clearFields() {
      this.#withRenderTarget(() => {
        const clear = this.#passes.clear;
        this.#render(clear, this.#velocity.read);
        this.#render(clear, this.#dye.read);
        this.#render(clear, this.#pressure.read);
        this.#render(clear, this.#mask);
      });
    }

    #display() {
      this.#render(this.#passes.mask, this.#mask, { uDye: this.#dye.read.texture });
    }
  }

  window.AxonFluid = AxonFluid;
})();
