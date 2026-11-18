// Reset Traders v2: the 3D Tilt in the hero.
// He starts as a dark silhouette and ignites, follows the cursor or finger, breathes,
// his flames flicker and shed embers, and he flinches when the audit button is near.
// The picture underneath stays until the first 3D frame is ready.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const lerp = THREE.MathUtils.lerp;
const easeOut = (t) => 1 - (1 - t) ** 3;

export async function mountTilt({ canvas, box, reduce = false, url = 'assets/3d/tilt.glb' }) {
  const small = window.innerWidth < 700;
  // Phones: fewer pixels and no extra smoothing on sharp screens, so it stays fluid.
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: dpr < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(dpr, small ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  // The canvas covers Tilt's box plus room around him (see hero.css): frame his 2-unit height inside it.
  camera.position.set(0, 1.16, 4.97);
  camera.lookAt(0, 1.16, 0);

  scene.add(new THREE.HemisphereLight(0xffe9dc, 0x1a0b10, 0.9));
  const key = new THREE.DirectionalLight(0xfff1e6, 2.1);
  key.position.set(-2.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff4a30, 3.4);
  rim.position.set(2.6, 2.4, -3);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xff5544, 2);
  rim2.position.set(-3, 1.2, -2.5);
  scene.add(rim2);

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(2 / bounds.getSize(new THREE.Vector3()).y);
  bounds.setFromObject(model);
  const mid = bounds.getCenter(new THREE.Vector3());
  model.position.set(-mid.x, -bounds.min.y, -mid.z);
  const rig = new THREE.Group();
  rig.add(model);
  scene.add(rig);

  // Ignite (dark silhouette -> full colour) and glow from the bright flame/eye pixels of his texture.
  const U = { uIgnite: { value: reduce ? 1 : 0 }, uGlow: { value: 1 } };
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.material.onBeforeCompile = (shader) => {
      shader.uniforms.uIgnite = U.uIgnite;
      shader.uniforms.uGlow = U.uGlow;
      shader.fragmentShader = 'uniform float uIgnite;\nuniform float uGlow;\n' + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
  float tiltHot = smoothstep(0.55, 0.95, diffuseColor.g + 0.35 * diffuseColor.r - 0.2);
  vec3 tiltGlow = diffuseColor.rgb * tiltHot * uGlow * uIgnite * 1.5;
  diffuseColor.rgb *= mix(0.03, 1.0, uIgnite);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += tiltGlow;');
    };
    obj.material.needsUpdate = true;
  });

  // Embers rising from his flames.
  const COUNT = small ? 28 : 90;
  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT * 4; i++) seeds[i] = Math.random();
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const emberMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uAlpha: { value: 0 } },
    vertexShader: `
      attribute vec4 aSeed; uniform float uTime, uPR; varying float vLife;
      void main() {
        float life = fract(aSeed.w + uTime * (0.18 + 0.22 * aSeed.y));
        vec3 p = vec3((aSeed.x - 0.5) * 0.9, 1.55 + life * 1.1, (aSeed.z - 0.5) * 0.5);
        p.x += sin(uTime * 2.0 + aSeed.z * 30.0) * 0.08 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (2.0 + 4.0 * aSeed.y) * uPR * (4.0 / -mv.z) * (1.0 - life * 0.6);
        vLife = life;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * smoothstep(0.0, 0.1, vLife) * (1.0 - vLife) * uAlpha;
        gl_FragColor = vec4(mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.33, 0.27), vLife), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  rig.add(embers);

  // Size to the canvas.
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { resize(); if (reduce) renderer.render(scene, camera); }).observe(canvas);
  resize();

  // Pointer: he turns to look at you.
  const look = { x: 0, y: 0, tx: 0, ty: 0, last: 0 };
  window.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect();
    look.tx = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), -1, 1);
    look.ty = THREE.MathUtils.clamp((e.clientY - (r.top + r.height * 0.35)) / (window.innerHeight / 2), -1, 1);
    look.last = performance.now();
  }, { passive: true });

  let afraid = false;
  let hopAt = -1e9;
  const state = { lean: 0 };
  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(box);

  const born = performance.now();
  let first = true;
  function frame(now) {
    if (!reduce) requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const t = (now - born) / 1000;

    // Ignite over 1.4 s, then flicker.
    if (!reduce) U.uIgnite.value = easeOut(Math.min(1, Math.max(0, (t - 0.2) / 1.4)));
    const flicker = 1 + 0.12 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.3) + 0.06 * Math.sin(t * 17.0);
    state.lean = lerp(state.lean, afraid ? 1 : 0, 0.12);
    U.uGlow.value = flicker * lerp(1, 0.35, state.lean);
    emberMat.uniforms.uTime.value = t * (1 + state.lean * -0.6);
    emberMat.uniforms.uAlpha.value = U.uIgnite.value * lerp(1, 0.3, state.lean);

    // Idle when nobody points at him for a while.
    const idle = now - look.last > 3500;
    const tx = idle ? Math.sin(t * 0.5) * 0.35 : look.tx;
    const ty = idle ? Math.sin(t * 0.37) * 0.15 : look.ty;
    look.x = lerp(look.x, tx, 0.06);
    look.y = lerp(look.y, ty, 0.06);

    if (!reduce) {
      rig.rotation.y = look.x * 0.55 - state.lean * 0.25;
      rig.rotation.x = look.y * 0.16 - state.lean * 0.16;
      rig.rotation.z = Math.sin(t * 0.9) * 0.02 + (afraid ? Math.sin(t * 38) * 0.012 : 0);
      const hopT = (now - hopAt) / 480;
      const hopK = hopT >= 0 && hopT < 1 ? Math.sin(hopT * Math.PI) : 0;
      rig.position.y = Math.sin(t * 1.6) * 0.03 + hopK * 0.16;
      rig.position.z = -state.lean * 0.45;
      const breathe = 1 + Math.sin(t * 1.6) * 0.008;
      rig.scale.setScalar(breathe * lerp(1, 0.93, state.lean));
      rig.scale.y *= 1 + hopK * 0.05;
    }

    renderer.render(scene, camera);
    if (first) {
      first = false;
      box.classList.add('gl-on');
    }
  }
  requestAnimationFrame(frame);

  return {
    hop() {
      hopAt = performance.now();
      if (reduce) requestAnimationFrame(frame);
    },
    flinch(on) {
      afraid = Boolean(on);
      if (reduce) requestAnimationFrame(frame);
    }
  };
}
