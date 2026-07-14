/* ── DRONE·I·FY stage: the Three.js cinematography layer ──
   The engine simulates the fleet in flat px space (x right, y down,
   z depth −.5...5). The stage lifts that into a true 3D night world —
   perspective camera that lives INSIDE the show, unreal-bloom glow,
   layered city, stars, haze — and films it like a broadcast.
   Exposed as window.STAGE: init(canvas), frame(state). */

import {
  Scene, PerspectiveCamera, WebGLRenderer, FogExp2, Color, Vector3,
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending,
  NormalBlending, CanvasTexture, LineSegments, LineBasicMaterial,
  InstancedMesh, MeshBasicMaterial, BoxGeometry, CylinderGeometry, Matrix4, Quaternion, Euler,
  PlaneGeometry, Mesh, DoubleSide, Group, MathUtils, SRGBColorSpace,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const STAGE = (() => {

  let renderer, scene, camera, composer, bloom;
  let W = 0, H = 0, N = 0;

  /* fleet layers */
  let lights, lightGeo, lightPos, lightCol, lightSize;   // LED points
  let halo, haloCol, haloSize;                            // soft under-bloom
  let trails, trailGeo, trailPos, trailCol;               // motion streaks
  let wires, wireGeo, wirePos, wireCol;                   // stroke light-wire
  let frames, frameDummy;                                 // airframe crosses
  let ghosts, ghostPos, ghostCol;                         // ground reflections

  /* world */
  const world = { cx: 0, groundY: 0, depth: 260 };
  let cityGroup;

  /* camera rig */
  const rig = {
    pos: new Vector3(60, 200, 980),
    look: new Vector3(0, 260, 0),
    focus: new Vector3(0, 260, 0),      // smoothed fleet centroid
    spread: 300,
    a: 0,                                // orbit phase
    shake: 0,
  };

  /* px sim space → world: X centered, Y flipped (up), Z = depth * scale */
  const toX = (x) => x - W / 2;
  const toY = (y) => H - y;
  const toZ = (z) => -z * world.depth + 200;

  function glowTexture(){
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(.22, 'rgba(255,255,255,.92)');
    grad.addColorStop(.5, 'rgba(255,255,255,.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  function pointsMaterial(tex, opacity, opts = {}){
    const alphaClip = opts.alphaClip === undefined ? .01 : opts.alphaClip;
    const blending = opts.blending === undefined ? AdditiveBlending : opts.blending;
    const depthWrite = !!opts.depthWrite;
    const depthTest = opts.depthTest !== false;
    /* size-attenuated, per-point color+size. Core lights can write depth;
       halos stay additive and soft. */
    return new ShaderMaterial({
      uniforms: {
        map: { value: tex },
        uOpacity: { value: opacity },
        uAlphaClip: { value: alphaClip },
      },
      vertexShader: `
        attribute float psize;
        attribute vec3 pcolor;
        varying vec3 vColor;
        void main(){
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (980.0 / max(120.0, -mv.z + 260.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uOpacity;
        uniform float uAlphaClip;
        varying vec3 vColor;
        void main(){
          vec4 t = texture2D(map, gl_PointCoord);
          float alpha = t.a * uOpacity;
          if (alpha < uAlphaClip) discard;
          gl_FragColor = vec4(vColor, alpha);
        }`,
      transparent: true,
      depthWrite,
      depthTest,
      blending,
    });
  }

  /* ── environment ── */
  function buildStars(){
    const n = 1900;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++){
      /* upper dome, far away */
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * .54 + .03;
      const r = 5200 + Math.random() * 1800;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r * (.78 + Math.random() * .12);
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r - 1200;
      const w = .48 + Math.random() * .52;
      const tint = Math.random();
      col[i * 3] = w * (tint > .86 ? 1 : tint < .18 ? .72 : .84);
      col[i * 3 + 1] = w * (tint > .72 ? .9 : .82);
      col[i * 3 + 2] = w * (tint < .12 ? 1 : .96);
      size[i] = 2.4 + Math.random() * 6.2 * (Math.random() < .08 ? 2.6 : 1);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new BufferAttribute(col, 3));
    geo.setAttribute('psize', new BufferAttribute(size, 1));
    scene.add(new Points(geo, pointsMaterial(glowTexture(), .5, { alphaClip: .02 })));
  }

  function buildCity(){
    cityGroup = new Group();
    const mat = new MeshBasicMaterial({ color: 0x060910 });
    const matFar = new MeshBasicMaterial({ color: 0x04060c });
    const winPos = [], winCol = [], winSize = [];
    const lay = (count, z, hMin, hMax, m) => {
      for (let i = 0; i < count; i++){
        const w = 60 + Math.random() * 150;
        const h = hMin + Math.random() * (hMax - hMin);
        const x = (i / count - .5) * (W * 2.6) + (Math.random() - .5) * 120;
        const box = new Mesh(new BoxGeometry(w, h, 90), m);
        box.position.set(x, h / 2, z);
        cityGroup.add(box);
        /* scattered warm windows */
        const nw = Math.floor(Math.random() * 5) + (h > 200 ? 4 : 1);
        for (let k = 0; k < nw; k++){
          winPos.push(x + (Math.random() - .5) * w * .8,
                      12 + Math.random() * (h - 20),
                      z + 46);
          const warm = Math.random() < .8;
          winCol.push(warm ? .9 : .5, warm ? .68 : .72, warm ? .34 : .9);
          winSize.push(6 + Math.random() * 3.5);
        }
      }
    };
    lay(26, -950, 50, 240, mat);
    lay(34, -1400, 110, 460, matFar);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(winPos), 3));
    geo.setAttribute('pcolor', new BufferAttribute(new Float32Array(winCol), 3));
    geo.setAttribute('psize', new BufferAttribute(new Float32Array(winSize), 1));
    const wins = new Points(geo, pointsMaterial(glowTexture(), .5));
    cityGroup.add(wins);
    scene.add(cityGroup);
  }

  function buildGroundAndHorizon(){
    /* matte ground */
    const ground = new Mesh(
      new PlaneGeometry(14000, 6000),
      new MeshBasicMaterial({ color: 0x05060c })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -1, 1600);
    scene.add(ground);

    /* horizon glow: a huge soft gradient card behind the city */
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, 'rgba(64,88,150,.34)');
    grad.addColorStop(.35, 'rgba(38,52,102,.16)');
    grad.addColorStop(1, 'rgba(10,14,34,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 256);
    const tex = new CanvasTexture(c);
    const card = new Mesh(
      new PlaneGeometry(12000, 1500),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    card.position.set(0, 640, -1600);
    scene.add(card);

    /* zenith glow: soft color in the upper sky so the night has depth */
    const sky = document.createElement('canvas');
    sky.width = sky.height = 512;
    const sg = sky.getContext('2d');
    const rg = sg.createRadialGradient(256, 170, 30, 256, 256, 280);
    rg.addColorStop(0, 'rgba(54,88,168,.24)');
    rg.addColorStop(.45, 'rgba(18,28,72,.16)');
    rg.addColorStop(1, 'rgba(2,4,12,0)');
    sg.fillStyle = rg;
    sg.fillRect(0, 0, 512, 512);
    const skyTex = new CanvasTexture(sky);
    const skyCard = new Mesh(
      new PlaneGeometry(15000, 9000),
      new MeshBasicMaterial({ map: skyTex, transparent: true, depthWrite: false, side: DoubleSide })
    );
    skyCard.position.set(0, 2550, -3600);
    scene.add(skyCard);

    /* high haze: faint cloud bands so the sky does not feel empty-black */
    const haze = document.createElement('canvas');
    haze.width = 512; haze.height = 256;
    const hg = haze.getContext('2d');
    const lg = hg.createLinearGradient(0, 256, 0, 0);
    lg.addColorStop(0, 'rgba(14,18,40,0)');
    lg.addColorStop(.35, 'rgba(40,58,110,.10)');
    lg.addColorStop(.7, 'rgba(76,96,154,.08)');
    lg.addColorStop(1, 'rgba(10,14,30,0)');
    hg.fillStyle = lg;
    hg.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 7; i++){
      hg.fillStyle = `rgba(${70 + i * 8}, ${92 + i * 4}, ${150 + i * 6}, ${0.02 + i * 0.005})`;
      hg.beginPath();
      hg.ellipse(60 + i * 70, 70 + (i % 3) * 26, 120 + i * 12, 28 + (i % 2) * 12, (i % 2 ? 1 : -1) * .12, 0, Math.PI * 2);
      hg.fill();
    }
    const hazeTex = new CanvasTexture(haze);
    const hazeCard = new Mesh(
      new PlaneGeometry(14000, 2600),
      new MeshBasicMaterial({ map: hazeTex, transparent: true, depthWrite: false, side: DoubleSide })
    );
    hazeCard.position.set(0, 2050, -3000);
    scene.add(hazeCard);
  }

  /* ── fleet layers ── */
  function buildFleet(n){
    N = n;
    /* LED cores */
    lightGeo = new BufferGeometry();
    lightPos = new Float32Array(N * 3);
    lightCol = new Float32Array(N * 3);
    lightSize = new Float32Array(N);
    lightGeo.setAttribute('position', new BufferAttribute(lightPos, 3));
    lightGeo.setAttribute('pcolor', new BufferAttribute(lightCol, 3));
    lightGeo.setAttribute('psize', new BufferAttribute(lightSize, 1));
    lights = new Points(lightGeo, pointsMaterial(glowTexture(), .94, {
      blending: NormalBlending,
      /* Airframes no longer write depth, so LED cores can depth-sort against
         one another without being covered by dark vehicle geometry. This
         keeps a dense 3D face from becoming a stack of blended white lights. */
      depthWrite: true,
      depthTest: true,
      alphaClip: .14,
    }));
    lights.frustumCulled = false;
    lights.renderOrder = 6;
    scene.add(lights);

    /* wide soft halo (pre-bloom body glow) sharing position buffer */
    const haloGeo = new BufferGeometry();
    haloGeo.setAttribute('position', new BufferAttribute(lightPos, 3));
    haloCol = new Float32Array(N * 3);
    haloSize = new Float32Array(N);
    haloGeo.setAttribute('pcolor', new BufferAttribute(haloCol, 3));
    haloGeo.setAttribute('psize', new BufferAttribute(haloSize, 1));
    halo = new Points(haloGeo, pointsMaterial(glowTexture(), .13, { alphaClip: .01, depthTest: false }));
    halo.frustumCulled = false;
    halo.renderOrder = 5;
    scene.add(halo);

    /* motion trails */
    trailGeo = new BufferGeometry();
    trailPos = new Float32Array(N * 2 * 3);
    trailCol = new Float32Array(N * 2 * 3);
    trailGeo.setAttribute('position', new BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new BufferAttribute(trailCol, 3));
    trails = new LineSegments(trailGeo, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: .5,
      blending: AdditiveBlending, depthWrite: false,
    }));
    trails.frustumCulled = false;
    trails.renderOrder = 4;
    scene.add(trails);

    /* light-wire: consecutive drones on a wireframe stroke link up into
       continuous neon contour lines once the formation locks */
    wireGeo = new BufferGeometry();
    wirePos = new Float32Array(N * 2 * 3);
    wireCol = new Float32Array(N * 2 * 3);
    wireGeo.setAttribute('position', new BufferAttribute(wirePos, 3));
    wireGeo.setAttribute('color', new BufferAttribute(wireCol, 3));
    wires = new LineSegments(wireGeo, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: .8,
      blending: AdditiveBlending, depthWrite: false,
    }));
    wires.frustumCulled = false;
    wires.renderOrder = 7;
    scene.add(wires);

    /* Airframes: a real quadcopter silhouette—cross arms, center body and
       four rotor discs. LEDs render above it, so the vehicle reads without
       swallowing its assigned formation color. */
    const arm = new BoxGeometry(15.5, 1.1, 1.9);
    const arm2 = arm.clone().applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
    const body = new BoxGeometry(4.4, 2.5, 4.4);
    const rotors = [[-7.1, -7.1], [7.1, -7.1], [-7.1, 7.1], [7.1, 7.1]].map(([x, z]) =>
      new CylinderGeometry(3, 3, .38, 12)
        .applyMatrix4(new Matrix4().makeTranslation(x, .1, z)));
    const geo = mergeGeos([arm, arm2, body, ...rotors]);
    frames = new InstancedMesh(geo, new MeshBasicMaterial({
      color: 0x536886, transparent: true, opacity: .62, depthWrite: false,
    }), N);
    frames.frustumCulled = false;
    frames.renderOrder = 2;
    frameDummy = new Matrix4();
    scene.add(frames);

    /* faint ground reflection of the fleet */
    const ghostGeo = new BufferGeometry();
    ghostPos = new Float32Array(N * 3);
    ghostCol = new Float32Array(N * 3);
    const gsize = new Float32Array(N).fill(10);
    ghostGeo.setAttribute('position', new BufferAttribute(ghostPos, 3));
    ghostGeo.setAttribute('pcolor', new BufferAttribute(ghostCol, 3));
    ghostGeo.setAttribute('psize', new BufferAttribute(gsize, 1));
    ghosts = new Points(ghostGeo, pointsMaterial(glowTexture(), .08, { alphaClip: .01 }));
    ghosts.frustumCulled = false;
    scene.add(ghosts);
  }

  function mergeGeos(list){
    /* tiny concat — enough for our 3-box airframe */
    let verts = 0, idx = 0;
    list.forEach(g => { verts += g.attributes.position.count; idx += g.index.count; });
    const pos = new Float32Array(verts * 3);
    const index = new Uint16Array(idx);
    let vo = 0, io = 0;
    list.forEach(g => {
      pos.set(g.attributes.position.array, vo * 3);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
    });
    const out = new BufferGeometry();
    out.setAttribute('position', new BufferAttribute(pos, 3));
    out.setIndex(new BufferAttribute(index, 1));
    return out;
  }

  /* ── init ── */
  function init(canvas, n){
    W = window.innerWidth; H = window.innerHeight;
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);

    scene = new Scene();
    scene.background = new Color(0x02040b);
    scene.fog = new FogExp2(0x050914, .00038);

    camera = new PerspectiveCamera(54, W / H, 1, 12000);
    camera.position.copy(rig.pos);

    buildStars();
    buildCity();
    buildGroundAndHorizon();
    buildFleet(n);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    /* tight bloom: crisp LED cores with a real glare falloff — heavy wash reads childish */
    /* Preserve the LED hue in the core; bloom is a tight glare accent, not a
       white fog pass. This keeps crimson armor and blue fills visibly colored. */
    bloom = new UnrealBloomPass(undefined, .62, .24, .24);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    window.addEventListener('resize', () => {
      W = window.innerWidth; H = window.innerHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
      composer.setSize(W, H);
    });
  }

  /* ── the camera direction: always filming the fleet from inside the show ── */
  const scratchV = new Vector3();
  function directCamera(state, dt){
    const { phase } = state;

    /* smoothed fleet centroid + spread (of airborne, non-parked drones) */
    let cx = 0, cy = 0, cz = 0, m = 0;
    let spread = 0;
    const framed = [];
    const hasFeaturedFigure = phase === 'act' && state.drones.some(d =>
      !d.grounded && !d.park && d.gi >= 0 && d.dim > 1);
    state.drones.forEach(d => {
      if (d.grounded || d.park) return;
      /* Backdrops support the hero; they must not pull the camera wide enough
         to turn a face or body into an unreadable handful of pixels. */
      if (hasFeaturedFigure && d.dim < 1) return;
      /* During a formation, frame the authored stations instead of chasing
         hundreds of aircraft along their transition paths. The audience sees
         one stable stage while the choreography resolves inside it. */
      const useStation = phase === 'act' && d.gi >= 0;
      const x = toX(useStation ? d.tx : d.x);
      const y = toY(useStation ? d.ty : d.y);
      const z = toZ(useStation ? d.tz : d.z);
      framed.push({ x, y, z });
      cx += x; cy += y; cz += z; m++;
    });
    if (m > 8){
      cx /= m; cy /= m; cz /= m;
      framed.forEach(p => {
        spread += Math.abs(p.x - cx) + Math.abs(p.y - cy);
      });
      spread = spread / m * 1.6;
      const k = Math.min(1, dt * (hasFeaturedFigure ? .0045 : .0009));
      rig.focus.x += (cx - rig.focus.x) * k;
      rig.focus.y += (cy - rig.focus.y) * k;
      rig.focus.z += (cz - rig.focus.z) * k;
      rig.spread += (spread - rig.spread) * k;
    } else {
      /* fleet grounded: settle on the pad */
      const k = Math.min(1, dt * .0006);
      rig.focus.x += (0 - rig.focus.x) * k;
      rig.focus.y += (140 - rig.focus.y) * k;
      rig.focus.z += (0 - rig.focus.z) * k;
      rig.spread += (420 - rig.spread) * k;
    }

    rig.a += dt * .000052;                       /* slow, broadcast-crane drift */
    const sway = Math.sin(rig.a * 2.1);

    /* distance framed to the formation size; closer = inside the show */
    const want = MathUtils.clamp(rig.spread * 1.85 + (rig.focus.y - 170) * .44, 520, 1280);

    let px, py, pz;
    if (phase === 'idle' || phase === 'takeoff'){
      /* low and close to the pad, looking up as the fleet climbs */
      px = Math.sin(rig.a * .7) * 260;
      py = Math.max(110, rig.focus.y * .35 + 70);
      pz = rig.focus.z + 760 + sway * 40;
    } else {
      /* airborne: the audience view — low, drifting, looking up at the show.
         narrow arc: a show is choreographed to face its crowd */
      const orbit = Math.sin(rig.a) * .065;      /* restrained ±4° audience drift */
      const breathe = 1 + Math.sin(rig.a * 1.7) * .012;
      px = Math.sin(orbit) * want * breathe;
      py = 170 + Math.sin(rig.a * 1.3) * 8;
      pz = rig.focus.z + Math.cos(orbit) * want * breathe;
    }
    const k2 = Math.min(1, dt * .0011);
    rig.pos.x += (px - rig.pos.x) * k2;
    rig.pos.y += (py - rig.pos.y) * k2;
    rig.pos.z += (pz - rig.pos.z) * k2;

    camera.position.copy(rig.pos);
    scratchV.copy(rig.focus);
    camera.lookAt(scratchV);
  }

  /* ── per-frame fleet update ── */
  const colMemo = new Map();
  function rgb(hex){
    const key = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : '#9fd8ff';
    let v = colMemo.get(key);
    if (!v){
      v = [parseInt(key.slice(1, 3), 16) / 255,
           parseInt(key.slice(3, 5), 16) / 255,
           parseInt(key.slice(5, 7), 16) / 255];
      /* Generated palettes vary wildly. Enforce an LED-output floor here,
         after every simulation and transition, so no valid formation can
         become effectively black against the night sky. */
      const peak = Math.max(...v);
      if (peak < .58){
        const scale = .58 / Math.max(.001, peak);
        v = v.map(c => Math.min(1, c * scale));
      }
      const lum = v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
      if (lum < .22){
        const mix = (.22 - lum) / Math.max(.001, 1 - lum);
        v = v.map(c => c + (1 - c) * mix);
      }
      if (colMemo.size > 4096) colMemo.clear();
      colMemo.set(key, v);
    }
    return v;
  }

  const Q = new Quaternion(), E = new Euler(), S = new Vector3(1, 1, 1), P = new Vector3();
  function frame(state, dt, opts){
    if (!renderer) return;
    directCamera(state, dt);

    const camPos = camera.position;
    const groupDepth = new Map();
    state.drones.forEach((d) => {
      if (d.grounded || d.park || d.gi < 0) return;
      const dx = toX(d.x) - camPos.x;
      const dy = toY(d.y) - camPos.y;
      const dz = toZ(d.z) - camPos.z;
      const cd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let g = groupDepth.get(d.gi);
      if (!g){
        g = { near: cd, far: cd };
        groupDepth.set(d.gi, g);
      } else {
        g.near = Math.min(g.near, cd);
        g.far = Math.max(g.far, cd);
      }
    });

    state.drones.forEach((d, i) => {
      const x = toX(d.x), y = toY(d.y), z = toZ(d.z);
      lightPos[i * 3] = x; lightPos[i * 3 + 1] = y; lightPos[i * 3 + 2] = z;

      const c = rgb(d.color);
      const featured = d.dim > 1;
      const dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
      const cd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let depthCue = 1;
      const g = d.gi >= 0 ? groupDepth.get(d.gi) : null;
      if (g && g.far - g.near > 30){
        const rel = MathUtils.clamp((cd - g.near) / (g.far - g.near), 0, 1);
        depthCue = MathUtils.lerp(1.08, .58, rel);
      }
      /* Props and contour strokes must survive a 3D turn. They are already
         sparse by design, so applying the full far-depth dim makes a blade
         disappear even though every aircraft is still on station. */
      const edgeCue = d.edge ? Math.max(.94, depthCue) : depthCue;
      /* intensity: parked sentries dim; transit dims a touch; arrival + spark burn */
      const transit = d.grounded ? .5 : Math.max(.62, Math.min(1, 1 - (d.lastDist - 16) / 320));
      const breathe = d.grounded ? .35 + .25 * Math.abs(Math.sin(state.now * .0012 + d.phase)) : 1;
      const edgeBoost = d.edge ? 1.38 : 1;
      let wantGlow = (d.park ? .16 : 1.05) * (d.dim === undefined ? 1 : d.dim) * transit * breathe * edgeCue * edgeBoost * (1 + d.spark * 2.2);
      if (!d.grounded && !d.park && d.gi >= 0) wantGlow = Math.max(wantGlow, d.edge ? 1.22 : featured ? .78 : .9);
      const glowSmooth = Math.min(1, dt * .018);
      d.renderGlow = d.renderGlow === undefined ? wantGlow : d.renderGlow + (wantGlow - d.renderGlow) * glowSmooth;
      const glow = d.renderGlow;
      lightCol[i * 3] = c[0] * glow;
      lightCol[i * 3 + 1] = c[1] * glow;
      lightCol[i * 3 + 2] = c[2] * glow;
      const crisp = !d.grounded && !d.park && d.lastDist < 10 ? (d.edge ? .96 : .9) : 1;
      const wantSize = (d.grounded ? 5 : d.park ? 4.5 : d.edge ? 6.8 : featured ? 5.8 : d.gi >= 0 ? 7.1 : 7.9) * crisp * (.9 + edgeCue * .16) * (1 + d.spark * .9);
      const sizeSmooth = Math.min(1, dt * .026);
      d.renderSize = d.renderSize === undefined ? wantSize : d.renderSize + (wantSize - d.renderSize) * sizeSmooth;
      lightSize[i] = d.renderSize;

      const hg = glow * (.64 + edgeCue * .18);
      haloCol[i * 3] = c[0] * hg; haloCol[i * 3 + 1] = c[1] * hg; haloCol[i * 3 + 2] = c[2] * hg;
      const wantHalo = (d.grounded ? 8 : d.edge ? 10.5 : featured ? 7.2 : d.gi >= 0 ? 9.8 : 13) * (.88 + edgeCue * .12);
      d.renderHalo = d.renderHalo === undefined ? wantHalo : d.renderHalo + (wantHalo - d.renderHalo) * sizeSmooth;
      haloSize[i] = d.renderHalo;

      /* A short velocity afterimage makes a sword sweep and limb movement
         readable without leaving residue once the pose locks. */
      const speed = Math.hypot(d.vx || 0, d.vy || 0, d.vz || 0);
      const tr = Math.min(.5, speed * 3.1) * (state.phase === 'takeoff' ? .24 : 1);
      const trailMs = state.phase === 'takeoff'
        ? Math.min(18, speed * 180)
        : Math.min(d.edge ? 115 : 78, speed * 900);
      const j = i * 6;
      trailPos[j] = toX(d.x - (d.vx || 0) * trailMs);
      trailPos[j + 1] = toY(d.y - (d.vy || 0) * trailMs);
      trailPos[j + 2] = toZ(d.z - (d.vz || 0) * trailMs / world.depth);
      trailPos[j + 3] = x; trailPos[j + 4] = y; trailPos[j + 5] = z;
      trailCol[j] = c[0] * tr * .4; trailCol[j + 1] = c[1] * tr * .4; trailCol[j + 2] = c[2] * tr * .4;
      trailCol[j + 3] = c[0] * tr; trailCol[j + 4] = c[1] * tr; trailCol[j + 5] = c[2] * tr;

      /* During takeoff the aircraft—not abstract particles—are the subject.
         Keep a compact but readable quadcopter silhouette even at the back of
         the launch wave; after takeoff it returns to distance-based detail. */
      const vis = MathUtils.clamp((760 - cd) / 500, 0, 1);
      E.set(0, d.phase + state.now * .0004, Math.sin(d.phase + state.now * .001) * .06);
      Q.setFromEuler(E);
      P.set(x, y - 1.2, z);
      const sc = state.phase === 'takeoff' ? Math.max(.7, vis) : (vis > .01 ? vis : .0001);
      S.set(sc, sc, sc);
      frameDummy.compose(P, Q, S);
      frames.setMatrixAt(i, frameDummy);

      /* reflection ghost under airborne drones */
      ghostPos[i * 3] = x; ghostPos[i * 3 + 1] = -y * .18; ghostPos[i * 3 + 2] = z;
      const gr = d.grounded ? 0 : .5 * Math.max(.6, depthCue);
      ghostCol[i * 3] = c[0] * gr; ghostCol[i * 3 + 1] = c[1] * gr; ghostCol[i * 3 + 2] = c[2] * gr;
    });

    /* light-wire pass: link stroke neighbors that are both on station */
    let wn = 0;
    const bySlot = new Map();
    state.drones.forEach(d => {
      if (d.gi >= 0 && d.si >= 0 && d.lastDist < 22) bySlot.set(d.gi * 100000 + d.si * 1000 + d.oi, d);
    });
    bySlot.forEach((d, slot) => {
      const nx = bySlot.get(slot + 1);
      if (!nx) return;
      const j = wn * 6;
      if (j + 5 >= wirePos.length) return;
      wirePos[j] = toX(d.x); wirePos[j + 1] = toY(d.y); wirePos[j + 2] = toZ(d.z);
      wirePos[j + 3] = toX(nx.x); wirePos[j + 4] = toY(nx.y); wirePos[j + 5] = toZ(nx.z);
      const c1 = rgb(d.color), c2 = rgb(nx.color);
      const dimw = (d.dim === undefined ? 1 : d.dim) * (d.edge ? .96 : .5);
      wireCol[j] = c1[0] * dimw; wireCol[j + 1] = c1[1] * dimw; wireCol[j + 2] = c1[2] * dimw;
      wireCol[j + 3] = c2[0] * dimw; wireCol[j + 4] = c2[1] * dimw; wireCol[j + 5] = c2[2] * dimw;
      wn++;
    });
    wireGeo.setDrawRange(0, wn * 2);
    wireGeo.attributes.position.needsUpdate = true;
    wireGeo.attributes.color.needsUpdate = true;

    lightGeo.attributes.position.needsUpdate = true;
    lightGeo.attributes.pcolor.needsUpdate = true;
    lightGeo.attributes.psize.needsUpdate = true;
    halo.geometry.attributes.pcolor.needsUpdate = true;
    halo.geometry.attributes.psize.needsUpdate = true;
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    frames.instanceMatrix.needsUpdate = true;
    ghosts.geometry.attributes.position.needsUpdate = true;
    ghosts.geometry.attributes.pcolor.needsUpdate = true;

    if (!(opts && opts.simOnly)) composer.render();
  }

  return { init, frame };
})();

window.STAGE = STAGE;
