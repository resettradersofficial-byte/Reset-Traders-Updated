// Reset Traders v2: the WebGL backdrop behind the homepage (one fixed canvas).
// Scroll tells the story: the hijack (a hot, volatile low-poly chart with Tilt's embers)
// cools into a steady chart (the reset), then a faceted globe shows the two paths.
// Phones and weak devices get fewer objects, no bloom and a lower pixel ratio.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;

const COLORS = {
  orange: new THREE.Color('#FA5901'),
  lamp: new THREE.Color('#ffb066'),
  loss: new THREE.Color('#ff3b4e'),
  cold: new THREE.Color('#7fb2ff'),
  calm: new THREE.Color('#d9e6ff')
};

// Camera keyframes, one per homepage section (hero, hijacks, how, paths, offer, story+).
const KEYS = [
  { cam: [0.0, 1.3, 11.5], look: [1.2, 1.0, -2], calm: 0.0, chaos: 1.0, dim: 0.0 },
  { cam: [-4.2, 3.6, 9.8], look: [0.0, 0.6, -3], calm: 0.15, chaos: 0.8, dim: 0.1 },
  { cam: [3.6, 1.7, 8.8], look: [1.4, 2.7, -2], calm: 0.85, chaos: 0.25, dim: 0.05 },
  { cam: [0.0, 1.9, 12.5], look: [-2.0, 3.0, -3], calm: 1.0, chaos: 0.08, dim: 0.25 },
  { cam: [-2.8, 5.8, 12.5], look: [0.0, 1.4, -3], calm: 1.0, chaos: 0.04, dim: 0.2 },
  { cam: [0.0, 8.5, 15.5], look: [0.0, 0.0, -4], calm: 1.0, chaos: 0.0, dim: 0.45 }
];
const SECTION_IDS = ['hero', 'hijacks', 'how', 'paths', 'offer', 'story'];

export async function initScene({ canvas, site, reduceMotion = false }) {
  const small = window.matchMedia('(max-width: 820px)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const high = !small && !weak;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.5);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x0a0c1c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c1c, 0.048);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
  scene.add(camera);

  let seed = 20261110;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------- Lights ---------- */
  scene.add(new THREE.HemisphereLight(0x8a98d8, 0x0a0c1c, 1.2));
  const keyLight = new THREE.DirectionalLight(0xa9c6ff, 1.7);
  keyLight.position.set(-8, 10, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xfa5901, 1.1);
  rimLight.position.set(9, 3, -8);
  scene.add(rimLight);
  const emberLight = new THREE.PointLight(0xff6a1a, 0, 0, 1.25);
  camera.add(emberLight);

  /* ---------- Candlestick chart (instanced, two rows for depth) ---------- */
  const N = high ? 72 : 44;
  const wild = [];
  const steady = [];
  {
    let p = 0;
    for (let i = 0; i < N; i++) {
      const o = p;
      const shock = rnd() < 0.14 ? (rnd() - 0.5) * 3.4 : 0;
      const c = (o + (rnd() - 0.5) * 2.2 + shock) * 0.86;
      wild.push([o, c, Math.max(o, c) + rnd() * 0.9, Math.min(o, c) - rnd() * 0.9]);
      p = c;
    }
    for (let i = 0; i < N; i++) {
      const base = -1.4 + (i / N) * 2.8 + Math.sin(i * 0.6) * 0.1;
      const up = i % 6 !== 4;
      const body = 0.1 + rnd() * 0.12;
      const o = up ? base : base + body;
      const c = up ? base + body : base;
      steady.push([o, c, Math.max(o, c) + 0.05 + rnd() * 0.06, Math.min(o, c) - 0.05 - rnd() * 0.06]);
    }
  }
  const glow = { value: 0.6 };
  const candleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.15, flatShading: true });
  candleMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.fragmentShader = 'uniform float uGlow;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * uGlow;'
    );
  };
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const wickGeo = new THREE.BoxGeometry(0.16, 1, 0.16);
  const white = new THREE.Color(1, 1, 1);
  function makeRow(opts) {
    const bodies = new THREE.InstancedMesh(bodyGeo, candleMat, N);
    const wicks = new THREE.InstancedMesh(wickGeo, candleMat, N);
    for (const mesh of [bodies, wicks]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < N; i++) mesh.setColorAt(i, white);
      scene.add(mesh);
    }
    return { bodies, wicks, x0: -((N - 1) * opts.dx) / 2, ...opts };
  }
  const rows = [
    makeRow({ z: -2, y: 1.15, dx: 0.36, w: 0.2, s: 0.78, curve: 0.012, phase: 0 }),
    makeRow({ z: -14, y: 2.6, dx: 0.85, w: 0.46, s: 1.7, curve: 0.004, phase: 0.35 })
  ];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  function updateChart(calm, chaos, t) {
    for (const row of rows) {
      for (let i = 0; i < N; i++) {
        const k = ease(clamp01(calm * 1.6 - (i / N) * 0.6 - row.phase * (1 - calm)));
        const a = wild[i];
        const b = steady[i];
        const o = lerp(a[0], b[0], k);
        let c = lerp(a[1], b[1], k);
        c += chaos * (1 - k) * Math.sin(t * (1.6 + (i % 7) * 0.45) + i * 1.7) * 0.22;
        const hi = Math.max(lerp(a[2], b[2], k), o, c);
        const lo = Math.min(lerp(a[3], b[3], k), o, c);
        const top = Math.max(o, c);
        const bot = Math.min(o, c);
        const x = row.x0 + i * row.dx;
        const z = row.z - x * x * row.curve;
        dummy.position.set(x, row.y + ((top + bot) / 2) * row.s, z);
        dummy.scale.set(row.w, Math.max(top - bot, 0.035) * row.s, row.w);
        dummy.updateMatrix();
        row.bodies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, row.y + ((hi + lo) / 2) * row.s, z);
        dummy.scale.set(row.w, Math.max(hi - lo, 0.05) * row.s, row.w);
        dummy.updateMatrix();
        row.wicks.setMatrixAt(i, dummy.matrix);
        const up = c >= o;
        tint.copy(up ? COLORS.lamp : COLORS.loss).lerp(up ? COLORS.calm : COLORS.cold, k);
        row.bodies.setColorAt(i, tint);
        row.wicks.setColorAt(i, tint);
      }
      row.bodies.instanceMatrix.needsUpdate = true;
      row.wicks.instanceMatrix.needsUpdate = true;
      row.bodies.instanceColor.needsUpdate = true;
      row.wicks.instanceColor.needsUpdate = true;
    }
  }

  /* ---------- Low-poly terrain: storm shape morphs into a calm one ---------- */
  const segX = high ? 72 : 40;
  const segZ = Math.round(segX * 0.55);
  const terrainGeo = new THREE.PlaneGeometry(84, 46, segX, segZ);
  terrainGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrainGeo.attributes.position;
    const storm = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (rnd() - 0.5) * 0.7;
      const z = pos.getZ(i) + (rnd() - 0.5) * 0.7;
      const calmH = Math.sin(x * 0.14) * Math.cos(z * 0.19) * 0.35 + rnd() * 0.16;
      const stormH = calmH + (Math.sin(x * 0.42 + z * 0.31) + Math.cos(z * 0.66 - x * 0.21)) * 0.75 + rnd() * 0.55;
      pos.setXYZ(i, x, calmH, z);
      storm[i * 3] = x;
      storm[i * 3 + 1] = stormH;
      storm[i * 3 + 2] = z;
    }
    terrainGeo.morphAttributes.position = [new THREE.Float32BufferAttribute(storm, 3)];
    terrainGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ color: 0x161c40, roughness: 0.82, metalness: 0.18, flatShading: true }));
  const terrainWire = new THREE.Mesh(terrainGeo, new THREE.MeshBasicMaterial({ color: 0x34407a, wireframe: true, transparent: true, opacity: 0.28 }));
  for (const mesh of [terrain, terrainWire]) {
    mesh.position.set(0, -1.7, -12);
    mesh.morphTargetInfluences = [1];
    scene.add(mesh);
  }

  /* ---------- Floating low-poly shards ---------- */
  const shardGeos = [new THREE.IcosahedronGeometry(0.5, 0), new THREE.OctahedronGeometry(0.46, 0), new THREE.TetrahedronGeometry(0.52, 0)];
  const shardDark = new THREE.MeshStandardMaterial({ color: 0x232c62, roughness: 0.28, metalness: 0.65, flatShading: true });
  const shardHot = new THREE.MeshStandardMaterial({ color: 0xfa5901, roughness: 0.4, metalness: 0.2, flatShading: true, emissive: 0xfa5901, emissiveIntensity: 0.55 });
  const shards = [];
  for (let i = 0; i < (high ? 16 : 9); i++) {
    const mesh = new THREE.Mesh(shardGeos[i % 3], i % 4 === 0 ? shardHot : shardDark);
    const side = i % 2 ? 1 : -1;
    mesh.position.set(side * (3 + rnd() * 11), -0.4 + rnd() * 7, -3 - rnd() * 14);
    mesh.scale.setScalar(0.35 + rnd() * 1.1);
    mesh.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    mesh.userData = { spin: 0.1 + rnd() * 0.35, bob: rnd() * 6, y: mesh.position.y };
    shards.push(mesh);
    scene.add(mesh);
  }

  /* ---------- Tilt's embers (anchored to the Tilt image in the hero) ---------- */
  const EN = high ? 1500 : 650;
  const emberGeo = new THREE.BufferGeometry();
  const eSeed = new Float32Array(EN * 4);
  const eSize = new Float32Array(EN);
  for (let i = 0; i < EN; i++) {
    eSeed[i * 4] = rnd(); eSeed[i * 4 + 1] = rnd(); eSeed[i * 4 + 2] = rnd(); eSeed[i * 4 + 3] = rnd();
    eSize[i] = 0.6 + rnd() * rnd() * 2.8;
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EN * 3), 3));
  emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 4));
  emberGeo.setAttribute('aSize', new THREE.BufferAttribute(eSize, 1));
  const timeU = { value: 0 };
  const emberMat = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, uChaos: { value: 1 }, uPR: { value: PR }, uScale: { value: 1 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      attribute float aSize;
      uniform float uTime, uChaos, uPR, uScale;
      varying float vHeat;
      varying float vA;
      void main() {
        float sp = mix(0.3, 1.0, uChaos);
        float life = fract(aSeed.w + uTime * (0.05 + 0.16 * aSeed.y) * sp);
        float dir = aSeed.x > 0.5 ? 1.0 : -1.0;
        float ang = aSeed.z * 6.2831853 + uTime * (0.35 + aSeed.y * 0.9) * sp * dir;
        float spread = 0.22 + aSeed.x * aSeed.x * 3.2;
        float r = spread * mix(0.55, 1.0, uChaos) * (1.0 - life * 0.35);
        vec3 p = vec3(cos(ang) * r, (life - 0.3) * (2.2 + spread * 0.8), sin(ang) * r * 0.55);
        p.x += sin(uTime * 1.7 + aSeed.z * 40.0) * 0.12 * uChaos;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR * uScale * (95.0 / -mv.z) * (1.0 - life * 0.55);
        vHeat = 1.0 - life;
        vA = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.65, 1.0, life)) * mix(0.16, 1.0, uChaos);
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha;
      varying float vHeat;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        vec3 deep = vec3(0.85, 0.05, 0.08);
        vec3 mid = vec3(1.0, 0.3, 0.02);
        vec3 hot = vec3(1.0, 0.78, 0.4);
        vec3 col = mix(deep, mid, smoothstep(0.0, 0.55, vHeat));
        col = mix(col, hot, smoothstep(0.6, 1.0, vHeat));
        gl_FragColor = vec4(col * 1.6, a * vA * uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  const emberGroup = new THREE.Group();
  emberGroup.add(embers);
  camera.add(emberGroup);

  /* ---------- Globe for the two paths (anchored to #v2-globe-slot) ---------- */
  const globeHolder = new THREE.Group();
  const globe = new THREE.Group();
  globe.rotation.order = 'XYZ';
  globe.rotation.x = 0.32;
  globeHolder.add(globe);
  camera.add(globeHolder);
  const sphereGeo = new THREE.IcosahedronGeometry(1, high ? 4 : 3);
  globe.add(new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0x1b2456, roughness: 0.5, metalness: 0.35, flatShading: true, emissive: 0x070b22 })));
  const globeWire = new THREE.LineSegments(new THREE.EdgesGeometry(sphereGeo, 1), new THREE.LineBasicMaterial({ color: 0x3f4d92, transparent: true, opacity: 0.55 }));
  globeWire.scale.setScalar(1.002);
  globe.add(globeWire);
  {
    const count = high ? 1100 : 600;
    const dots = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      dots[i * 3] = Math.cos(golden * i) * r * 1.012;
      dots[i * 3 + 1] = y * 1.012;
      dots[i * 3 + 2] = Math.sin(golden * i) * r * 1.012;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dots, 3));
    globe.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: 0x6f86d6, size: 0.016, transparent: true, opacity: 0.7, depthWrite: false })));
  }
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.14, 48, 32), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#5d86ff') } },
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying vec3 vN; void main(){ float i = pow(clamp(0.62 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0); gl_FragColor = vec4(uColor * i * 0.8, i); }',
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  globeHolder.add(atmosphere);

  const latLon = (lat, lon, r = 1) => {
    const phi = (90 - lat) * D2R;
    const th = (lon + 180) * D2R;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  };
  const HOME = [19.08, 72.88];
  const HUBS = [[51.51, -0.13], [40.71, -74.0], [41.88, -87.63], [25.2, 55.27], [1.35, 103.82]];
  const markerGeo = new THREE.SphereGeometry(0.03, 12, 8);
  const ringGeo = new THREE.RingGeometry(0.045, 0.06, 32);
  const zAxis = new THREE.Vector3(0, 0, 1);
  function marker(lat, lon, color) {
    const group = new THREE.Group();
    const p = latLon(lat, lon, 1.01);
    group.position.copy(p);
    group.quaternion.setFromUnitVectors(zAxis, p.clone().normalize());
    group.add(new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(ring);
    group.userData.ring = ring;
    globe.add(group);
    return group;
  }
  const homeMarker = marker(HOME[0], HOME[1], new THREE.Color('#ff7a2a'));
  const hubMarkers = HUBS.map(([lat, lon]) => marker(lat, lon, new THREE.Color('#8fbcff')));
  const arcMats = HUBS.map(([lat, lon], i) => {
    const a = latLon(HOME[0], HOME[1], 1.01);
    const b = latLon(lat, lon, 1.01);
    const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1.02 + a.distanceTo(b) * 0.42);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: timeU, uOn: { value: 1 }, uOff: { value: i * 0.21 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime, uOn, uOff;
        varying vec2 vUv;
        void main() {
          float head = fract(uTime * 0.32 + uOff) * 1.3;
          float d = vUv.x - head;
          float trail = smoothstep(-0.32, 0.0, d) * step(d, 0.0);
          vec3 col = mix(vec3(1.0, 0.42, 0.1), vec3(0.55, 0.75, 1.0), vUv.x);
          gl_FragColor = vec4(col * (0.7 + trail * 1.8), (0.16 + trail) * uOn);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    globe.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, high ? 0.007 : 0.009, 5, false), mat));
    return mat;
  });

  /* ---------- Bloom on capable desktops ---------- */
  let composer = null;
  if (high) {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js')
      ]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.22));
      composer.addPass(new OutputPass());
    } catch (_) {
      composer = null;
    }
  }

  /* ---------- Sizing, scroll and DOM anchors ---------- */
  let width = 0;
  let height = 0;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === width && Math.abs(h - height) < 2) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const sections = SECTION_IDS.map((id) => document.getElementById(id));
  let tops = [];
  function measure() {
    const y = window.scrollY;
    tops = sections.map((el, i) => (el ? el.getBoundingClientRect().top + y : (i ? tops[i - 1] + 800 : 0)));
    dirty = true;
  }
  function stage() {
    const v = window.scrollY + height * 0.3;
    for (let i = tops.length - 1; i >= 0; i--) {
      if (v >= tops[i]) {
        const next = i + 1 < tops.length ? tops[i + 1] : tops[i] + height;
        return i + clamp01((v - tops[i]) / Math.max(1, next - tops[i]));
      }
    }
    return 0;
  }
  function sample(s) {
    const i = Math.min(KEYS.length - 1, Math.floor(s));
    const j = Math.min(KEYS.length - 1, i + 1);
    const f = ease(clamp01(s - i));
    const a = KEYS[i];
    const b = KEYS[j];
    return {
      cam: a.cam.map((v, n) => lerp(v, b.cam[n], f)),
      look: a.look.map((v, n) => lerp(v, b.look[n], f)),
      calm: lerp(a.calm, b.calm, f),
      chaos: lerp(a.chaos, b.chaos, f),
      dim: lerp(a.dim, b.dim, f)
    };
  }
  const tiltEl = document.getElementById('v2-tilt');
  const slotEl = document.getElementById('v2-globe-slot');
  function anchor(el, depth, obj) {
    const r = el.getBoundingClientRect();
    const worldH = 2 * depth * Math.tan((camera.fov * D2R) / 2);
    const worldW = worldH * camera.aspect;
    obj.position.set(((r.left + r.width / 2) / width - 0.5) * worldW, -((r.top + r.height / 2) / height - 0.5) * worldH, -depth);
    return { r, unit: worldH / height };
  }

  let region = document.documentElement.dataset.region === 'in' ? 'in' : 'intl';
  window.addEventListener('rt:region', (event) => { region = event.detail; dirty = true; });

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer.tx = event.clientX / window.innerWidth - 0.5;
    pointer.ty = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  let dirty = true;
  window.addEventListener('scroll', () => { dirty = true; }, { passive: true });
  window.addEventListener('resize', () => { resize(); measure(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(site);
  document.fonts?.ready?.then(measure);
  resize();
  measure();

  /* ---------- Loop ---------- */
  const cur = { calm: 0, chaos: 1, dim: 0, cam: new THREE.Vector3(), look: new THREE.Vector3(), globeY: 0, homeS: 1, hubS: 1, arcs: 1 };
  const goalCam = new THREE.Vector3();
  const goalLook = new THREE.Vector3();
  let first = true;
  let t = 0;
  let last = performance.now();
  let frame = 0;
  let raf = 0;
  let stopped = false;

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.classList.remove('on');
    site.classList.add('no-gl');
  });

  function tick(now) {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (!site.classList.contains('active') || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame++;
    if (reduceMotion && !dirty && !first) return;
    const s = stage();
    if (!high && s > 4.6 && frame % 2) return;
    if (!reduceMotion) t += dt;
    dirty = false;

    const k = sample(s);
    const narrow = camera.aspect < 0.9;
    goalLook.set(narrow ? k.look[0] * 0.25 : k.look[0], k.look[1], k.look[2]);
    goalCam.set(k.cam[0], k.cam[1], k.cam[2]);
    if (narrow) goalCam.sub(goalLook).multiplyScalar(1.45).add(goalLook);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    goalCam.x += pointer.x * 1.2 + (reduceMotion ? 0 : Math.sin(t * 0.21) * 0.35);
    goalCam.y += -pointer.y * 0.7 + (reduceMotion ? 0 : Math.sin(t * 0.17) * 0.18);

    const damp = first || reduceMotion ? 1 : 1 - Math.exp(-dt * 2.4);
    cur.cam.lerp(goalCam, damp);
    cur.look.lerp(goalLook, damp);
    cur.calm += (k.calm - cur.calm) * damp;
    cur.chaos += (k.chaos - cur.chaos) * damp;
    cur.dim += (k.dim - cur.dim) * damp;
    camera.position.copy(cur.cam);
    camera.lookAt(cur.look);
    camera.updateMatrixWorld();

    timeU.value = t;
    updateChart(cur.calm, cur.chaos, t);
    glow.value = 0.32 + cur.chaos * 0.45;
    terrain.morphTargetInfluences[0] = cur.chaos;
    terrainWire.morphTargetInfluences[0] = cur.chaos;
    renderer.toneMappingExposure = 1.12 * (1 - cur.dim * 0.55);
    for (const mesh of shards) {
      mesh.rotation.x += mesh.userData.spin * dt;
      mesh.rotation.y += mesh.userData.spin * 0.7 * dt;
      mesh.position.y = mesh.userData.y + Math.sin(t * 0.5 + mesh.userData.bob) * 0.25;
    }

    // Embers + warm light follow Tilt while the hero is on screen.
    if (tiltEl) {
      const { r, unit } = anchor(tiltEl, 9, emberGroup);
      const onScreen = r.bottom > -40 && r.top < height + 40 && r.width > 0;
      const scale = r.height * unit * 0.55;
      emberGroup.scale.setScalar(scale);
      emberGroup.visible = onScreen;
      emberMat.uniforms.uScale.value = scale;
      emberMat.uniforms.uChaos.value = cur.chaos;
      emberLight.position.copy(emberGroup.position).add(new THREE.Vector3(0, 0, 1.5));
      emberLight.intensity = onScreen ? 34 * cur.chaos : 0;
    }

    // Globe sits in its slot in the "Two paths" section.
    if (slotEl) {
      const { r, unit } = anchor(slotEl, 10, globeHolder);
      const appear = ease(clamp01((height * 1.05 - r.top) / (height * 0.45))) * ease(clamp01((r.bottom + height * 0.05) / (height * 0.45)));
      globeHolder.visible = appear > 0.01;
      globeHolder.scale.setScalar(Math.min(r.width, r.height) * unit * 0.34 * (0.6 + 0.4 * appear));
      const india = region === 'in';
      const target = -((india ? 75 : -20) + 90) * D2R + (reduceMotion ? 0 : Math.sin(t * 0.25) * 0.12);
      const gd = first || reduceMotion ? 1 : 1 - Math.exp(-dt * 2.2);
      globe.rotation.y += (target - globe.rotation.y) * gd;
      cur.homeS += ((india ? 1.7 : 1) - cur.homeS) * gd;
      cur.hubS += ((india ? 0.75 : 1.35) - cur.hubS) * gd;
      cur.arcs += ((india ? 0.45 : 1) - cur.arcs) * gd;
      homeMarker.scale.setScalar(cur.homeS);
      hubMarkers.forEach((m) => m.scale.setScalar(cur.hubS));
      arcMats.forEach((m) => { m.uniforms.uOn.value = cur.arcs * appear; });
      const pulse = (t * 0.7) % 1;
      for (const m of [homeMarker, ...hubMarkers]) {
        m.userData.ring.scale.setScalar(1 + pulse * 2.6);
        m.userData.ring.material.opacity = (1 - pulse) * 0.9;
      }
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);

    if (first) {
      first = false;
      canvas.classList.add('on');
      site.classList.add('gl-on');
    }
  }
  raf = requestAnimationFrame(tick);
}
