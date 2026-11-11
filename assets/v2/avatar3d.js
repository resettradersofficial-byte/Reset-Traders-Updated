// Reset Traders v2: a character in 3D for the hijack profile panel.
// Slow turn on its own; drag (mouse or finger) to turn it yourself. Call dispose() on close.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function mountAvatar({ canvas, url, reduce = false, onReady }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1020, 1.0));
  const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  fill.position.set(3, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff5544, 2.2);
  rim.position.set(2.5, 2.2, -3);
  scene.add(rim);

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
  camera.position.set(0, 1.08, 4.4);
  camera.lookAt(0, 1.0, 0);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Drag to turn; otherwise a slow sway.
  let yaw = 0;
  let target = 0;
  let dragging = false;
  let lastX = 0;
  let lastTouch = -1e9;
  const down = (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (!dragging) return; target += (e.clientX - lastX) * 0.012; lastX = e.clientX; lastTouch = performance.now(); };
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  let stopped = false;
  let first = true;
  const born = performance.now();
  function frame(now) {
    if (stopped) return;
    if (!reduce) requestAnimationFrame(frame);
    const t = (now - born) / 1000;
    if (!reduce && !dragging && now - lastTouch > 2500) target = Math.sin(t * 0.45) * 0.6;
    yaw += (target - yaw) * 0.08;
    rig.rotation.y = yaw;
    if (!reduce) rig.position.y = Math.sin(t * 1.4) * 0.015;
    renderer.render(scene, camera);
    if (first) { first = false; onReady?.(); }
  }
  requestAnimationFrame(frame);

  return {
    dispose() {
      stopped = true;
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach((m) => { Object.values(m).forEach((v) => v && v.isTexture && v.dispose()); m.dispose(); });
      });
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
