import { gsap } from 'gsap';
import {
  BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, InstancedMesh, LineBasicMaterial,
  LineLoop, LineSegments, Matrix4, Mesh, MeshBasicMaterial, QuadraticBezierCurve3, Quaternion, Raycaster, RingGeometry, Shape, SphereGeometry, TubeGeometry,
  Vector2, Vector3,
} from 'three';
import { OUTLINE, ANDAMAN_NICOBAR, NEIGHBOURS } from '../indiaOutline';

/*
 * Hyderabad to Andaman, live. A flat, printed-looking regional map in 3D
 * (India as a thin slab in the page colour with black coastlines,
 * neighbouring land in grey) framed on ManagerXP's two bases. Each
 * base is a red pin with a cluster of active client nodes around it. A
 * pulse races along the route from Hyderabad to Andaman, bursts on arrival
 * and lights up the clients there; a reply runs back and lights up
 * Hyderabad's. It repeats, so the link always reads as live.
 *
 * GSAP plays the entrance and the connection cycle. The visitor can drag to
 * turn the map, hover a pin to lift it, and click a pin to fly to it (click
 * elsewhere, press Escape, or wait, to come back).
 */
const SCALE = 0.19; // scene units per degree
const CENTRE = [82.6, 22.0];
const KX = Math.cos((22 * Math.PI) / 180); // keeps the map's proportions
const HEIGHT = 0.07; // a thin slab: 3D in the tilt, flat like the page
const LIFT = 0;
const TOP = LIFT + HEIGHT + 0.03;
const NEIGHBOUR_HEIGHT = 0.035;

const RED = 0xe5322d;
const INK = 0x0e0e0e;

const x = (lon) => (lon - CENTRE[0]) * SCALE * KX;
const z = (lat) => -(lat - CENTRE[1]) * SCALE;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const BASES = {
  hyderabad: { lonlat: [78.49, 17.39], label: 'Hyderabad', side: 'right' },
  andaman: { lonlat: [92.73, 11.62], label: 'Andaman', side: 'left' },
};
const NOTE = 'ManagerXP base · active clients';
// Client nodes around each base, on land. [longitude, latitude]
const CLIENTS = {
  hyderabad: [[77.55, 17.95], [79.3, 18.25], [79.15, 16.6], [77.85, 16.45], [78.2, 18.75], [79.75, 17.3], [77.2, 17.1], [78.6, 16.0]],
  andaman: [[92.95, 13.28], [92.84, 12.78], [92.82, 12.55], [92.69, 11.95], [92.72, 11.73], [93.0, 12.12], [92.49, 10.63]],
};

// The view frames the two bases; the rest of the map runs off the edges.
const HOME = { yaw: -0.06, pitch: 1.0, dist: 8.7, tx: x(84.6), tz: z(14.6) };

const slab = (points, depth) => {
  const shape = new Shape();
  points.forEach(([lon, lat], i) => (i ? shape.lineTo(x(lon), -z(lat)) : shape.moveTo(x(lon), -z(lat))));
  const bevel = Math.min(0.03, depth * 0.2);
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 1 })
    .rotateX(-Math.PI / 2);
};

export default function india3d({ world, camera, canvas, host, still }) {

  // Land: India (white top, black sides) with the Andaman & Nicobar Islands
  // as real island shapes; neighbouring land lower and grey.
  // The land's top is exactly the page colour, so the map reads as a relief
  // on the page and its cropped edges vanish; black sides and the shadow
  // carry the shape.
  const topMat = new MeshBasicMaterial({ color: 0xf2f2f2, toneMapped: false });
  const sideMat = new MeshBasicMaterial({ color: INK, toneMapped: false });
  const greyTop = new MeshBasicMaterial({ color: 0xe4e4e4, toneMapped: false });
  const greySide = new MeshBasicMaterial({ color: 0xb4b4b4, toneMapped: false });
  const land = new Group();
  // Thin black outline along each coast, like a printed map.
  const outlineMat = new LineBasicMaterial({ color: INK });
  const greyLine = new LineBasicMaterial({ color: 0xa0a0a0 });
  const outline = (pts, y, mat) => {
    const v = pts.map(([lon, lat]) => new Vector3(x(lon), y + 0.002, z(lat)));
    return new LineLoop(new BufferGeometry().setFromPoints(v), mat);
  };
  [OUTLINE, ...ANDAMAN_NICOBAR].forEach((pts) => {
    land.add(new Mesh(slab(pts, HEIGHT), [topMat, sideMat]), outline(pts, HEIGHT + 0.014, outlineMat));
  });
  NEIGHBOURS.forEach((pts) => {
    land.add(new Mesh(slab(pts, NEIGHBOUR_HEIGHT), [greyTop, greySide]), outline(pts, NEIGHBOUR_HEIGHT + 0.007, greyLine));
  });
  land.position.y = LIFT;
  world.add(land);


  // Bases: red pins, a slow pulse ring, and an arrival burst ring.
  // toneMapped off keeps the reds the brand red.
  const red = new MeshBasicMaterial({ color: RED, toneMapped: false });
  const stemGeo = new CylinderGeometry(0.016, 0.016, 0.62, 12).translate(0, 0.31, 0);
  const headGeo = new SphereGeometry(0.085, 28, 18).translate(0, 0.66, 0);
  const ringGeo = new RingGeometry(0.1, 0.12, 48).rotateX(-Math.PI / 2);
  const burstGeo = new RingGeometry(0.1, 0.135, 48).rotateX(-Math.PI / 2);
  const ringMat = () => new MeshBasicMaterial({ color: RED, transparent: true, toneMapped: false, depthWrite: false });
  const bases = Object.entries(BASES).map(([key, b]) => {
    const pos = new Vector3(x(b.lonlat[0]), TOP, z(b.lonlat[1]));
    const pin = new Group();
    pin.position.copy(pos);
    const stem = new Mesh(stemGeo, red);
    const head = new Mesh(headGeo, red);
    pin.add(stem, head);
    const ring = new Mesh(ringGeo, ringMat());
    const burst = new Mesh(burstGeo, ringMat());
    ring.position.copy(pos).setY(TOP + 0.004);
    burst.position.copy(pos).setY(TOP + 0.006);
    ring.visible = false; // no idle pulse: the arrival burst is the only ring
    world.add(pin, ring, burst);
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;'
      + 'font-family:var(--font-display);color:#0e0e0e;background:#f2f2f2;padding:5px 10px 6px;'
      + 'border-left:3px solid #e5322d;line-height:1.15;will-change:transform;';
    // Narrow views (the phone poster) show just the place name, so the two
    // labels never run into each other.
    el.innerHTML = `<div style="font-weight:700;font-size:15px;letter-spacing:-0.01em">${b.label}</div>`
      + (host.clientWidth >= 480 ? `<div style="font-size:12px;color:#5c5c5c;margin-top:1px">${NOTE}</div>` : '');
    host.appendChild(el);
    return { key, side: b.side, pos, pin, ring, burst, el, hover: 0, kick: { v: 0 }, flash: { v: 0 } };
  });
  const byKey = Object.fromEntries(bases.map((b) => [b.key, b]));

  // Active clients: small posts around each base with spokes to it. They
  // light up red when a pulse arrives.
  const clientGeo = new CylinderGeometry(0.022, 0.022, 0.07, 14).translate(0, 0.035, 0);
  const clientMat = new MeshBasicMaterial({ color: 0xffffff });
  const clients = Object.entries(CLIENTS).flatMap(([key, list]) => list.map(([lon, lat], i) => ({
    base: key, pos: new Vector3(x(lon), TOP, z(lat)), heat: { v: 0 }, order: i,
  })));
  const clientMesh = new InstancedMesh(clientGeo, clientMat, clients.length);
  world.add(clientMesh);
  const spokePts = clients.flatMap((c) => [c.pos.clone().setY(TOP + 0.01), byKey[c.base].pos.clone().setY(TOP + 0.01)]);
  const spokes = new LineSegments(new BufferGeometry().setFromPoints(spokePts), new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.28 }));
  world.add(spokes);

  // The route: a faint red line always there, a bright comet that travels
  // it, and a packet at the comet's head.
  const ha = byKey.hyderabad.pos.clone();
  const an = byKey.andaman.pos.clone();
  const mid = ha.clone().add(an).multiplyScalar(0.5);
  mid.y = TOP + ha.distanceTo(an) * 0.42;
  const curve = new QuadraticBezierCurve3(ha, mid, an);
  const SEGS = 200;
  const RADIAL = 10;
  const faint = new Mesh(new TubeGeometry(curve, SEGS, 0.011, 8, false), new MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.3, toneMapped: false }));
  world.add(faint);
  const cometGeo = new TubeGeometry(curve, SEGS, 0.026, RADIAL, false);
  const comet = new Mesh(cometGeo, red);
  world.add(comet);
  const packet = new Mesh(new SphereGeometry(0.06, 24, 16), new MeshBasicMaterial({ color: INK }));
  world.add(packet);

  // GSAP-driven state the frame reads.
  const view = { ...HOME };
  const show = { pins: 0, labels: 0, drift: 1, route: 0 };
  const flow = { head: 0, dir: 1, on: 0 }; // head 0..1 along the route; dir 1 = to Andaman

  const lightUp = (baseKey) => {
    const b = byKey[baseKey];
    gsap.fromTo(b.flash, { v: 1 }, { v: 0, duration: 1.1, ease: 'power2.out' });
    gsap.fromTo(b.kick, { v: 1 }, { v: 0, duration: 0.9, ease: 'elastic.out(1, 0.45)' });
    clients.filter((c) => c.base === baseKey).forEach((c) => {
      gsap.timeline({ delay: 0.06 * c.order })
        .to(c.heat, { v: 1, duration: 0.14, ease: 'power2.out' })
        .to(c.heat, { v: 0, duration: 1.2, ease: 'power2.in' });
    });
  };
  const send = (from) => {
    const b = byKey[from];
    gsap.fromTo(b.kick, { v: 0.6 }, { v: 0, duration: 0.6, ease: 'power3.out' });
  };

  let cycle = null;
  const startCycle = () => {
    cycle = gsap.timeline({ repeat: -1, repeatDelay: 0.5 })
      .call(() => { flow.dir = 1; send('hyderabad'); })
      .fromTo(flow, { head: 0, on: 1 }, { head: 1, duration: 2.1, ease: 'power2.inOut' })
      .call(() => lightUp('andaman'))
      .to(flow, { on: 0, duration: 0.35 })
      .to({}, { duration: 0.7 })
      .call(() => { flow.dir = -1; send('andaman'); })
      .fromTo(flow, { head: 0, on: 1 }, { head: 1, duration: 2.1, ease: 'power2.inOut' })
      .call(() => lightUp('hyderabad'))
      .to(flow, { on: 0, duration: 0.35 })
      .to({}, { duration: 0.6 });
  };

  // The view: an orbit around a target, steered by GSAP and the pointer.
  let focused = null;
  let idleReturn = null;
  const homeTween = (delay = 0) => gsap.to(view, { ...HOME, duration: 1.6, delay, ease: 'power3.inOut', overwrite: 'auto' });
  const unfocus = () => {
    if (!focused) return;
    focused = null;
    idleReturn?.kill();
    homeTween();
    gsap.to(show, { drift: 1, duration: 1.2, delay: 1, overwrite: 'auto' });
  };
  const focusOn = (b) => {
    focused = b;
    gsap.to(show, { drift: 0, duration: 0.6, overwrite: 'auto' });
    gsap.to(view, { tx: b.pos.x, tz: b.pos.z, dist: 4.8, pitch: 0.9, yaw: view.yaw * 0.5, duration: 1.4, ease: 'power3.inOut', overwrite: 'auto' });
    idleReturn?.kill();
    idleReturn = gsap.delayedCall(7, unfocus);
  };

  const ray = new Raycaster();
  const ndc = new Vector2();
  const pickables = bases.flatMap((b) => b.pin.children.map((c) => Object.assign(c, { userData: { base: b } })));
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(pickables, false)[0]?.object.userData.base || null;
  };
  let drag = null;
  let hovered = null;
  const onDown = (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false };
    canvas.setPointerCapture(e.pointerId);
    gsap.killTweensOf(view);
    idleReturn?.kill();
    gsap.to(show, { drift: 0, duration: 0.4, overwrite: 'auto' });
  };
  const onMove = (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      view.yaw = clamp(drag.yaw - dx * 0.005, -0.7, 0.7);
      view.pitch = clamp(drag.pitch + dy * 0.004, 0.62, 1.3);
      canvas.style.cursor = 'grabbing';
      return;
    }
    const b = pick(e);
    if (b !== hovered) {
      if (hovered) gsap.to(hovered, { hover: 0, duration: 0.35, ease: 'power2.out' });
      if (b) gsap.to(b, { hover: 1, duration: 0.35, ease: 'back.out(3)' });
      hovered = b;
    }
    canvas.style.cursor = b ? 'pointer' : 'grab';
  };
  const onUp = (e) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    canvas.releasePointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grab';
    if (wasClick) {
      const b = pick(e);
      if (b && b !== focused) focusOn(b);
      else unfocus();
      return;
    }
    if (!focused) {
      idleReturn?.kill();
      idleReturn = homeTween(3.5);
      gsap.to(show, { drift: 1, duration: 1.5, delay: 5, overwrite: 'auto' });
    }
  };
  const onOutside = (e) => {
    if (focused && e.target !== canvas) unfocus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') unfocus();
  };
  const onLeave = () => {
    if (hovered) gsap.to(hovered, { hover: 0, duration: 0.35 });
    hovered = null;
  };
  if (!still) {
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }

  // Entrance, or a representative finished frame for the poster.
  let intro = null;
  if (still) {
    Object.assign(show, { pins: 1, labels: 1, route: 1 });
    Object.assign(flow, { head: 0.62, dir: 1, on: 1 });
    clients.forEach((c) => { c.heat.v = c.base === 'hyderabad' && c.order % 2 ? 0.6 : 0; });
  } else {
    land.scale.y = 0.001;
    land.position.y = 0;
    Object.assign(view, { pitch: 1.45, dist: 10.5 });
    intro = gsap.timeline({ defaults: { ease: 'power3.inOut' }, onComplete: startCycle })
      .to(view, { pitch: HOME.pitch, dist: HOME.dist, duration: 2.2 }, 0)
      .to(land.scale, { y: 1, duration: 1.3, ease: 'expo.out' }, 0.3)
      .to(land.position, { y: LIFT, duration: 1.3, ease: 'expo.out' }, 0.3)
      .to(show, { pins: 1, duration: 0.9, ease: 'back.out(2.2)' }, 1.0)
      .to(show, { route: 1, duration: 1.0, ease: 'power2.inOut' }, 1.4)
      .to(show, { labels: 1, duration: 0.6, ease: 'power2.out' }, 1.9);
  }

  const target = new Vector3();
  const head = new Vector3();
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const ink = new Color(INK);
  const hot = new Color(RED);
  const col = new Color();
  const faintCount = faint.geometry.index.count;
  const segIdx = RADIAL * 6; // indices per tube segment

  return {
    update(t) {
      const yaw = view.yaw + Math.sin(t * 0.16) * 0.1 * show.drift;
      target.set(view.tx, 0, view.tz);
      camera.position.set(
        view.tx + view.dist * Math.cos(view.pitch) * Math.sin(yaw),
        view.dist * Math.sin(view.pitch),
        view.tz + view.dist * Math.cos(view.pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);

      // Pins: grow in, lift on hover, kick when they send or receive.
      bases.forEach((b, i) => {
        const k = show.pins * (1 + b.hover * 0.28 + b.kick.v * 0.25);
        const ky = show.pins * (1 + b.hover * 0.45 + b.kick.v * 0.35);
        b.pin.scale.set(Math.max(k, 0.0001), Math.max(ky, 0.0001), Math.max(k, 0.0001));
        const pulse = (t * 0.55 + i * 0.5) % 1;
        b.ring.scale.setScalar(1 + pulse * 3.2);
        b.ring.material.opacity = 0.7 * (1 - pulse) * show.pins;
        b.burst.scale.setScalar(1 + (1 - b.flash.v) * 6);
        b.burst.material.opacity = b.flash.v;
      });

      // Route: the faint line draws on during the entrance; the comet and
      // packet run along it, direction set by the cycle.
      faint.geometry.setDrawRange(0, Math.floor((faintCount * show.route) / 3) * 3);
      const along = flow.dir > 0 ? flow.head : 1 - flow.head;
      const tail = 0.24;
      const a = flow.dir > 0 ? clamp(along - tail, 0, 1) : along;
      const b2 = flow.dir > 0 ? along : clamp(along + tail, 0, 1);
      const start = Math.floor(a * SEGS) * segIdx;
      const count = flow.on > 0.01 ? Math.max(0, Math.floor((b2 - a) * SEGS)) * segIdx : 0;
      cometGeo.setDrawRange(start, count);
      curve.getPoint(clamp(along, 0, 1), p);
      packet.position.copy(p);
      packet.scale.setScalar(Math.max(flow.on, 0.0001));

      // Clients: black at rest, red when lit, a little taller while lit.
      clients.forEach((c, i) => {
        const hv = c.heat.v;
        const g = Math.max(show.pins, 0.0001);
        s.set(g, Math.max(g * (1 + hv * 1.6), 0.0001), g);
        clientMesh.setMatrixAt(i, m.compose(c.pos, q, s));
        clientMesh.setColorAt(i, col.copy(ink).lerp(hot, hv));
      });
      clientMesh.instanceMatrix.needsUpdate = true;
      if (clientMesh.instanceColor) clientMesh.instanceColor.needsUpdate = true;
      spokes.material.opacity = 0.28 * show.pins;

      // Labels follow their pin heads on screen.
      camera.updateMatrixWorld();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      bases.forEach((b) => {
        head.copy(b.pos).setY(b.pos.y + 0.66 * (1 + b.hover * 0.45) * show.pins).project(camera);
        const sx = (head.x * 0.5 + 0.5) * w;
        const sy = (-head.y * 0.5 + 0.5) * h;
        const left = b.side === 'left';
        b.el.style.transform = `translate(${sx + (left ? -16 : 16)}px, ${sy}px) translate(${left ? '-100%' : '0'}, -50%)`;
        b.el.style.opacity = String(show.labels * (focused && focused !== b ? 0.35 : 1));
      });
    },
    dispose() {
      intro?.kill();
      cycle?.kill();
      idleReturn?.kill();
      gsap.killTweensOf([view, show, flow, ...bases, ...bases.map((b) => b.kick), ...bases.map((b) => b.flash), ...clients.map((c) => c.heat), land.scale, land.position]);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
      bases.forEach((b) => b.el.remove());
    },
  };
}
