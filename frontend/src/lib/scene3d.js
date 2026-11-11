import {
  ACESFilmicToneMapping, Clock, DirectionalLight, Group, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/*
 * Named imports only (no `import * as THREE` handed around): that lets the
 * bundler drop the parts of three.js the hero never uses.
 *
 * Shared runner for the hero's 3D scenes: renderer, studio lighting,
 * pointer parallax, the visibility-aware loop, the frame-time watchdog and
 * full disposal. A scene module only builds its objects and moves them.
 *
 *   mountScene(host, build, { onReady, onSlow, still, startT, interactive })
 *
 * `build({ world, camera, renderer, canvas, host, still })` adds objects to
 * `world` (a group the runner tilts toward the pointer, unless the scene is
 * `interactive` and steers its own view), places the camera, and returns
 * `{ update(t), dispose? }`; update runs every frame with the elapsed time in
 * seconds. `interactive` lets the canvas take pointer input. `still` renders
 * the first frame at `startT` and stops (used to make the poster). Returns a
 * function that stops and disposes everything.
 */
export const mountScene = (host, build, { onReady, onSlow, still = false, startT = 0, interactive = false } = {}) => {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:${interactive ? 'auto' : 'none'};touch-action:pan-y;`;
  host.appendChild(canvas);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 8, 6);
  scene.add(key);

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  const pivot = new Group(); // parallax lives here, the scene's own motion in `world`
  const world = new Group();
  pivot.add(world);
  scene.add(pivot);

  const sceneApi = build({ world, camera, renderer, canvas, host, still });
  // Instanced meshes are culled by a bounding sphere computed once, from
  // wherever the instances start. Scenes move them far from there (a block
  // starts above the frame and drops in), so a mesh could stay culled after
  // it arrives. There are only a few, so skip culling for them.
  world.traverse((o) => {
    if (o.isInstancedMesh) o.frustumCulled = false;
  });

  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  const onPointer = (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new Clock();
  let t = startT;
  const frame = (advance = true) => {
    if (advance) t += Math.min(clock.getDelta(), 0.05);
    sceneApi.update(t);
    tilt.x += (pointer.x * 0.18 - tilt.x) * 0.04;
    tilt.y += (pointer.y * 0.08 - tilt.y) * 0.04;
    if (!interactive) {
      pivot.rotation.y = tilt.x;
      pivot.rotation.x = tilt.y;
    }
    renderer.render(scene, camera);
  };

  // Watchdog: 30 frames averaging over 12ms of main-thread time means this
  // device cannot afford the scene; onSlow hands back to the poster.
  let sampled = 0;
  let spent = 0;
  let raf = 0;
  const loop = () => {
    const t0 = performance.now();
    frame();
    if (onSlow && sampled < 30) {
      spent += performance.now() - t0;
      sampled += 1;
      if (sampled === 30 && spent / 30 > 12) {
        cancelAnimationFrame(raf);
        raf = 0;
        onSlow();
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  };

  let onScreen = true;
  const sync = () => {
    if (still) return;
    const run = onScreen && document.visibilityState === 'visible';
    if (run && !raf) {
      clock.getDelta();
      raf = requestAnimationFrame(loop);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);

  frame(false);
  onReady?.();
  sync();

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pointermove', onPointer);
    sceneApi.dispose?.();
    scene.traverse((o) => {
      o.geometry?.dispose();
      [].concat(o.material || []).forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      o.dispose?.();
    });
    env.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
};
