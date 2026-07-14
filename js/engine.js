/* ── DRONE·I·FY engine: the FLIGHTSCRIPT runtime ──
   Executes a flight program: acts of simultaneous formation groups with
   motion modifiers. The planner (the LLM agent or the onboard compiler) writes
   the program; this file flies it like a real show —
   fleet parked on the pad → staggered takeoff → formations → landing —
   with true drone physics: thrust and speed limits, arrival braking,
   neighbor separation, wind. Rendering is delegated to STAGE (Three.js):
   this file owns the simulation, the stage owns the cinematography. */
'use strict';

const ENGINE = (() => {

  const canvas = document.getElementById('sky');
  let W = 0, H = 0;

  const MOBILE = matchMedia('(max-width: 640px)').matches;
  const N = MOBILE ? 300 : 600;

  const PALETTE = ['#ffd9a0', '#9fd8ff', '#ff9de2', '#8affd4', '#c4b5ff', '#ffe66d'];

  /* ── drone physics (px/ms): deliberate, real-show speeds ── */
  const MAX_SPEED = .16;          /* ~155 px/s cruise — alive, not hurried */
  const CLIMB_SPEED = .125;       /* takeoff / landing vertical pace */
  const MAX_THRUST = .00062;      /* motor acceleration limit */
  const ARRIVE_R = 150;           /* braking radius: long, gentle arrivals */
  const SEP_R = 10;               /* personal space */
  const SEP_PUSH = .0009;
  const DRAG = .0013;
  const PHYSICS_STEP = 16;        /* integrate in small slices for stability */
  const DEPTH_SCALE = 260;        /* must match the stage's world-depth scale */
  const LOCK_R = 10;              /* distance at which a drone owns its slot */

  const TAKEOFF_MS = 6500, LANDING_MS = 6500;

  const drones = [];
  let padSlots = [];
  let mode = 'ground';                  /* ground | show */
  let show = null;
  let camT = 0, lastNow = 0, engineNow = 0, windA = 0;
  let onScene = null, onEnd = null;

  /* ── world ── */
  function resize(){
    W = window.innerWidth;
    H = window.innerHeight;
    /* the launch pad: a tidy staging grid on the apron in front of the city */
    padSlots = [];
    const cols = Math.ceil(Math.sqrt(N * 4.2));
    const rows = Math.ceil(N / cols);
    const padW = Math.min(W * .86, cols * 22);
    const x0 = (W - padW) / 2;
    for (let i = 0; i < N; i++){
      const c = i % cols, r = (i / cols) | 0;
      padSlots.push({
        x: x0 + (c + .5) * (padW / cols) + (r % 2) * 5,
        y: H - 8 - r * 5.2,
        z: r / rows - .5,
      });
    }
  }
  window.addEventListener('resize', resize);

  function makeDrones(){
    for (let i = 0; i < N; i++){
      const p = padSlots[i];
      drones.push({
        id: i,
        x: p.x, y: p.y, z: p.z,
        px: p.x, py: p.y, pz: p.z, hasPrev: false,
        vx: 0, vy: 0, vz: 0,
        tx: p.x, ty: p.y, tz: p.z,
        tvx: 0, tvy: 0, tvz: 0,
        gi: -1, bx: 0, by: 0,
        grounded: true, landing: false,
        color: PALETTE[i % PALETTE.length], tcolor: PALETTE[i % PALETTE.length],
        phase: Math.random() * Math.PI * 2,
        strobe: Math.random() * 1700,
        perf: .88 + Math.random() * .28,      /* no two airframes fly alike */
        nx: 0, ny: 0,                          /* turbulence state */
        delay: 0, park: false, locked: false, edge: false, contour: false, part: -1, pu: 0, pv: 0, spark: 0, lastDist: 0,
        sax: 0, say: 0, saz: 0,
      });
    }
  }

  function skyBox(){
    const size = Math.min(W * .84, H * .6);
    return { cx: W / 2, cy: H * .38, s: size / 2 };
  }

  /* ── colors ── */
  function ledColor(hex, fallback){
    const safe = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : (fallback || '#9fd8ff');
    const ch = [1, 3, 5].map(i => parseInt(safe.slice(i, i + 2), 16));
    const peak = Math.max(...ch);
    const lum = ch[0] * .2126 + ch[1] * .7152 + ch[2] * .0722;
    /* Scale dim palettes instead of adding gray. This keeps crimson armor
       saturated while raising it to a real LED-output floor. */
    const scale = Math.max(1, 170 / Math.max(1, peak), 76 / Math.max(1, lum));
    if (scale <= 1.001) return safe.toLowerCase();
    return '#' + ch.map(v => Math.min(255, Math.round(v * scale)).toString(16).padStart(2, '0')).join('');
  }
  function hexLerp(a, b, t){
    a = ledColor(a); b = ledColor(b);
    const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function hueColor(t){
    const h = ((t % 1) + 1) % 1 * 6, k = h | 0, f = h - k;
    const q = Math.round(255 * (1 - f)), u = Math.round(255 * f);
    const rgb = [[255, u, 90], [q, 255, 90], [90, 255, u], [90, q, 255], [u, 90, 255], [255, 90, q]][k];
    return '#' + rgb.map(v => Math.max(90, v).toString(16).padStart(2, '0')).join('');
  }
  function pointColor(p, g, idx, total){
    const c = g.color || 'sampled';
    if (c === 'rainbow') return hueColor(idx / Math.max(1, total));
    if (c.startsWith('gradient:')){
      const parts = c.split(':');
      return hexLerp(parts[1], parts[2], 1 - (p.y + 1) / 2);
    }
    if (/^#[0-9a-f]{6}$/i.test(c)) return ledColor(c);
    return ledColor(p.c, PALETTE[idx % PALETTE.length]);
  }

  function evenPick(list, count){
    if (count >= list.length) return list.slice();
    const out = [];
    for (let i = 0; i < count; i++){
      out.push(list[Math.min(list.length - 1, Math.floor((i + .5) * list.length / count))]);
    }
    return out;
  }

  function trimPoints(list, count){
    if (list.length <= count) return list.slice();
    const ordered = list.some(p => p.si !== undefined && p.si >= 0);
    if (!ordered) return evenPick(list, count);
    const groups = new Map();
    list.forEach(p => {
      const key = p.si === undefined ? -1 : p.si;
      let arr = groups.get(key);
      if (!arr){ arr = []; groups.set(key, arr); }
      arr.push(p);
    });
    const keys = [...groups.keys()].sort((a, b) => a - b);
    const buckets = keys.map(key => groups.get(key).slice().sort((a, b) => (a.oi || 0) - (b.oi || 0)));
    const total = buckets.reduce((sum, arr) => sum + arr.length, 0) || 1;
    let picked = [];
    let left = count;
    buckets.forEach((arr, i) => {
      const want = i === buckets.length - 1 ? left : Math.max(1, Math.round(count * arr.length / total));
      const take = Math.min(arr.length, want, left);
      picked = picked.concat(evenPick(arr, take));
      left -= take;
    });
    if (picked.length < count){
      const leftovers = list.filter(p => !picked.includes(p));
      picked = picked.concat(evenPick(leftovers, Math.min(leftovers.length, count - picked.length)));
    }
    return picked.slice(0, count);
  }

  function enterWave(style, p, idx, total){
    const linear = idx / Math.max(1, total - 1);
    if (style === 'explode') return Math.min(1, Math.hypot(p.x, p.y) * .72 + linear * .16);
    if (style === 'rain') return Math.max(0, Math.min(1, 1 - (p.y + 1) / 2));
    if (style === 'bloom') return Math.min(1, Math.hypot(p.x, p.y) * .78);
    if (style === 'swirl') return (((Math.atan2(p.y, p.x) / (Math.PI * 2)) + 1) % 1) * .86;
    if (style === 'launch') return Math.max(0, Math.min(1, (p.y + 1) / 2));
    return linear * .45 + (p.x + 1) * .16;
  }

  function enterArcSign(style, gi, p){
    if (style === 'explode' || style === 'rain') return p.x >= 0 ? 1 : -1;
    if (style === 'swirl') return p.y >= 0 ? 1 : -1;
    if (style === 'bloom') return p.x * p.y >= 0 ? 1 : -1;
    return gi % 2 ? -1 : 1;
  }

  function enterArcScale(style, p){
    if (style === 'explode') return 1.22 + Math.min(.14, Math.hypot(p.x, p.y) * .12);
    if (style === 'rain') return .72;
    if (style === 'bloom') return 1.08;
    if (style === 'swirl') return 1.16;
    if (style === 'launch') return 1.02;
    return 1;
  }

  /* ── FLIGHTSCRIPT: one act ── */
  function startAct(act){
    const { cx, cy, s } = skyBox();

    /* the act clock starts once the formation has actually formed —
       morph time belongs to physics, `duration` is pure hold time */
    show.formed = false;
    show.formingSince = engineNow;

    if (act.system === 'takeoff'){
      /* rows lift in waves into a loose holding cloud above the city */
      drones.forEach((d, i) => {
        d.gi = -1; d.park = false; d.grounded = false; d.landing = false;
        d.locked = false; d.edge = false; d.contour = false; d.part = -1; d.tvx = 0; d.tvy = 0; d.tvz = 0;
        const cols = 40, col = i % cols, row = (i / cols) | 0;
        d.tx = cx + (col - (cols - 1) / 2) * (s * 2 / cols);
        d.ty = cy + (row - 7) * (s * .09);
        d.tz = (Math.random() - .5) * .2;
        d.tcolor = PALETTE[i % PALETTE.length];
        d.lastDist = 1e9;
        planPath(d, (padSlots[i].z + .5) * 3.2, i % 2 ? -1 : 1, .3);  /* back rows first, near-vertical */
      });
      AUDIO.hum(5.5);
      return;
    }

    if (act.system === 'landing'){
      drones.forEach((d, i) => {
        d.gi = -1; d.park = false; d.landing = true;
        d.locked = false; d.edge = false; d.contour = false; d.part = -1; d.tvx = 0; d.tvy = 0; d.tvz = 0;
        d.tx = padSlots[i].x; d.ty = padSlots[i].y; d.tz = padSlots[i].z;
        d.tcolor = PALETTE[i % PALETTE.length];
        d.lastDist = 1e9;
        planPath(d, Math.random() * 2, i % 2 ? -1 : 1, .4);
      });
      AUDIO.hum(4);
      return;
    }

    const previousGroups = show.groups || [];
    const previousFigure = previousGroups.find(G =>
      G.spec && (G.spec.ascii || G.spec.art));
    show.groups = act.groups.map((g, gi) => {
      /* 3D solids always get a slow yaw — depth is their whole point */
      const motion = (g.motion || []).flatMap(m => {
        if (!g.art) return [Object.assign({}, m)];
        /* Character silhouettes are audience-facing keyframes. Turning them
           edge-on or rippling individual pixels destroys the pose, so keep a
           barely visible breath and let the pose morph provide the action. */
        if (m.type === 'orbit') return [{ type: 'pulse', amp: .018 }];
        if (m.type === 'wave') return [];
        if (m.type === 'pulse') return [Object.assign({}, m, { amp: Math.min(.025, m.amp || .018) })];
        return [Object.assign({}, m)];
      });
      if (SHAPES.SOLIDS.includes(g.shape) && g.fill !== 'solid' && !motion.some(m => m.type === 'orbit')){
        motion.push({ type: 'orbit', speed: .55 });
      }
      return {
        spec: Object.assign({}, g, { motion }),
        /* Planners may list backdrop then figure in one act and reverse that
           order in the next. Match the featured subject semantically so its
           body and prop drones still execute one persistent pose morph. */
        poseMorph: !!(g.ascii || g.art) && !!previousFigure,
        ox: cx + (g.at[0] || 0) * s,
        oy: cy - (g.at[1] || 0) * s * .9,
        ang: (g.rotate || 0) * Math.PI / 180,
        t0: engineNow,
        duration: act.duration,
      };
    });

    const figG = show.groups.findIndex(G => G.spec.ascii || G.spec.art);
    const weights = act.groups.map(g => g.weight || 1);
    const wsum = weights.reduce((a, b) => a + b, 0);
    let alloc = weights.map(w => Math.floor(N * .97 * w / wsum));
    if (figG >= 0 && show.groups.length > 1){
      /* Faces and full-body figures need pixel density far more than a sun or
         moon backdrop does. Give the featured subject a guaranteed majority
         instead of letting planner weights accidentally halve its detail. */
      const total = Math.floor(N * .97);
      const figureShare = Math.floor(total * .78);
      const supportWeight = weights.reduce((sum, w, gi) => sum + (gi === figG ? 0 : w), 0);
      alloc = weights.map((w, gi) => gi === figG
        ? figureShare
        : Math.floor((total - figureShare) * w / Math.max(.001, supportWeight)));
    }

    const free = drones.slice();

    const sampled = show.groups.map((G, gi) => {
      const g = G.spec;
      const A = g.ascii;
      const asciiRows = A && (Array.isArray(A) ? A : A.rows);
      const asciiPal = A && !Array.isArray(A) ? A.palette
        : (Array.isArray(g.palette) ? g.palette.reduce((m, e) => {
            if (e && e.ch && e.color) m[e.ch[0]] = e.color;
            return m;
          }, {}) : null);
      const pts = (asciiRows ? SHAPES.fromAscii(asciiRows, asciiPal)
        : g.art ? SHAPES.fromArt(g.art)
        : SHAPES.get(g.shape, g.fill)).slice();
      return trimPoints(pts, alloc[gi]);
    });

    /* the figure owns its sky: clear backdrop points behind an ascii
       character, dim the rest, float the figure toward the audience */
    if (figG >= 0 && show.groups.length > 1){
      const CS = 30;
      const mask = new Set();
      const GM = show.groups[figG], scM = (GM.spec.scale || 1) * s;
      const cosM = Math.cos(GM.ang), sinM = Math.sin(GM.ang);
      /* the figure owns its whole body, not just its lines: fill each
         column between the figure's top and bottom cells */
      const span = new Map();
      sampled[figG].forEach(p => {
        const cx = Math.round((GM.ox + (p.x * cosM - p.y * sinM) * scM) / CS);
        const cy = Math.round((GM.oy - (p.x * sinM + p.y * cosM) * scM) / CS);
        const sp = span.get(cx);
        if (!sp) span.set(cx, [cy, cy]);
        else { sp[0] = Math.min(sp[0], cy); sp[1] = Math.max(sp[1], cy); }
      });
      span.forEach((sp, cx) => {
        for (let ox = -1; ox <= 1; ox++){
          for (let cy = sp[0] - 1; cy <= sp[1] + 1; cy++) mask.add((cx + ox) + ',' + cy);
        }
      });
      show.groups.forEach((G, gi) => {
        if (gi === figG) return;
        const sc = (G.spec.scale || 1) * s;
        const cos = Math.cos(G.ang), sin = Math.sin(G.ang);
        sampled[gi] = sampled[gi].filter(p =>
          !mask.has(Math.round((G.ox + (p.x * cos - p.y * sin) * sc) / CS) + ',' +
                    Math.round((G.oy - (p.x * sin + p.y * cos) * sc) / CS)));
      });
    }

    show.groups.forEach((G, gi) => {
      const g = G.spec;
      G.zoff = figG < 0 ? 0 : gi === figG ? -.3 : .18;
      const pts = sampled[gi];
      const scale = (g.scale || 1) * s;
      const enter = act.enter || 'drift';

      const members = [];
      /* Assign contour props first and keep their aircraft identity between
         keyframes. A katana should move like one persistent object, not
         dissolve into unrelated body drones and be rebuilt at the endpoint. */
      const assignmentPts = pts.map((p, idx) => ({ p, idx }))
        .sort((a, b) => Number(!!b.p.edge) - Number(!!a.p.edge));
      assignmentPts.forEach(({ p, idx }) => {
        if (!free.length) return;
        const rx = p.x * Math.cos(G.ang) - p.y * Math.sin(G.ang);
        const ry = p.x * Math.sin(G.ang) + p.y * Math.cos(G.ang);
        const bx = rx * scale, by = -ry * scale;
        const px = G.ox + bx, py = G.oy + by;

        let best = 0, bd = 1e18;
        const part = p.part === undefined ? -1 : p.part;
        const preservePart = part >= 0 && free.some(candidate => candidate.part === part);
        const preserveRole = !preservePart && free.some(candidate => candidate.edge === !!p.edge);
        for (let k = 0; k < free.length; k++){
          if (preservePart && free[k].part !== part) continue;
          if (preserveRole && free[k].edge !== !!p.edge) continue;
          let dd = (free[k].x - px) ** 2 + (free[k].y - py) ** 2;
          if (preservePart && Number.isFinite(p.pu) && Number.isFinite(free[k].pu)){
            const du = free[k].pu - p.pu, dv = free[k].pv - p.pv;
            dd += (du * du + dv * dv) * (W + H) ** 2;
          }
          if (dd < bd){ bd = dd; best = k; }
        }
        const d = free.splice(best, 1)[0];
        /* Characters are shallow illuminated bas-reliefs. Full volumetric
           depth creates parallax fuzz at the audience camera and makes a
           clean arm or face look like a cloud. Solids retain full depth. */
        const depthFactor = (g.art || g.ascii) ? .18 : 1;
        d.gi = gi; d.bx = bx; d.by = by; d.bz = p.z * scale * depthFactor;
        /* Plan against this act's slot, never the previous act's endpoint. */
        d.tx = px; d.ty = py; d.tz = d.bz / Math.max(1, s) + (G.zoff || 0);
        d.tvx = 0; d.tvy = 0; d.tvz = 0; d.locked = false;
        d.si = p.si === undefined ? -1 : p.si; d.oi = p.oi || 0;
        d.edge = !!p.edge;
        d.contour = !!p.contour;
        d.part = part;
        d.pu = Number.isFinite(p.pu) ? p.pu : 0;
        d.pv = Number.isFinite(p.pv) ? p.pv : 0;
        d.park = false; d.grounded = false; d.landing = false;
        /* drawn characters keep their costume: element colors beat group washes */
        d.tcolor = ledColor(((g.art || g.ascii) && p.c) ? p.c : pointColor(p, g, idx, pts.length));
        if (d.edge) d.color = d.tcolor;
        d.lastDist = 1e9;
        d.hasPrev = false;
        planPath(d, enterWave(enter, p, idx, pts.length), enterArcSign(enter, gi, p), enterArcScale(enter, p));
        if (G.poseMorph){
          /* A pose change is one synchronized body movement, not another
             formation entrance. Direct paths make the arm and blade sweep
             legible while the torso remains anchored. */
          d.pt = engineNow;
          d.arc = 0;
        }
        d.dim = figG < 0 ? 1 : gi === figG ? 1.15 : .6;
        members.push(d);
      });
      /* synchronized morph: one shared flight time — the image resolves as one */
      let maxDist = 0;
      members.forEach(d => { maxDist = Math.max(maxDist, Math.hypot(d.tx - d.sx, d.ty - d.sy)); });
      const T = G.poseMorph
        ? Math.max(1500, Math.min(3800, maxDist / (MAX_SPEED * .9)))
        : Math.max(1800, Math.min(6000, maxDist / (MAX_SPEED * .82)));
      members.forEach(d => { d.pT = T; });
    });

    /* spare drones tuck low at the flanks, out of the picture */
    free.forEach((d, i) => {
      d.gi = -1; d.park = true; d.grounded = false; d.landing = false;
      d.locked = false; d.edge = false; d.contour = false; d.part = -1; d.tvx = 0; d.tvy = 0; d.tvz = 0;
      const side = i % 2 ? 1 : -1;
      const k = (i / Math.max(1, free.length - 1));
      d.tx = W / 2 + side * (W * .40 + k * W * .07);
      d.ty = H * .72 + Math.sin(i * 2.3) * 18 + k * H * .08;
      d.tcolor = '#2c3350';
      planPath(d, i / Math.max(1, free.length), 1);
    });

    /* Entry arcs already express swirl. Rotating the destination underneath
       an arriving fleet made the image chase a moving target. */
    show.swirl = 0;
  }

  /* ── trajectory choreography: a planned, timed arc for every drone ──
     Real shows pre-plan every path. Each drone departs in a spatial wave,
     flies a smooth bezier toward its slot, and arrives on schedule; the
     physics layer then *tracks* that path under thrust limits, wind and
     turbulence — intention plus texture. */
  function planPath(d, wave01, arcSign, arcScale){
    if (d.gi < 0) d.si = -1;
    const dist = Math.hypot(d.tx - d.x, d.ty - d.y, (d.tz - d.z) * DEPTH_SCALE);
    d.sx = d.x; d.sy = d.y; d.sz = d.z;
    d.pt = engineNow + (wave01 || 0) * 850 + Math.random() * 120;  /* quick spatial ripple; no long dead wait before the image moves */
    d.pT = Math.max(1800, Math.min(8000, dist / (MAX_SPEED * .82)));
    d.arc = arcSign * (.12 + Math.random() * .06) * (arcScale === undefined ? 1 : arcScale);
    d.delay = 0;
    d.dim = 1;
  }

  function carrot(d){
    /* where on its planned path this drone should be right now */
    const raw = (engineNow - d.pt) / d.pT;
    const u = Math.max(0, Math.min(1, raw));
    const e = u * u * (3 - 2 * u);                          /* smoothstep speed profile */
    const dedt = raw > 0 && raw < 1 ? 6 * u * (1 - u) / d.pT : 0;
    const mx = (d.sx + d.tx) / 2, my = (d.sy + d.ty) / 2;
    const dx = d.tx - d.sx, dy = d.ty - d.sy;
    const cxp = mx - dy * d.arc, cyp = my + dx * d.arc;      /* perpendicular arc */
    const a = 1 - e;
    const dbx = 2 * a * (cxp - d.sx) + 2 * e * (d.tx - cxp);
    const dby = 2 * a * (cyp - d.sy) + 2 * e * (d.ty - cyp);
    return {
      x: a * a * d.sx + 2 * a * e * cxp + e * e * d.tx,
      y: a * a * d.sy + 2 * a * e * cyp + e * e * d.ty,
      z: d.sz + (d.tz - d.sz) * e,
      vx: dbx * dedt,
      vy: dby * dedt,
      vz: (d.tz - d.sz) * DEPTH_SCALE * dedt,
      done: u >= 1,
    };
  }

  /* how much of the fleet has locked into its slots */
  function formationProgress(){
    let assigned = 0, arrived = 0, critical = 0, criticalArrived = 0;
    const isFormation = show.groups.length > 0;
    drones.forEach(d => {
      if (d.park || d.grounded || (isFormation && d.gi < 0)) return;
      assigned++;
      const isArrived = isFormation ? d.locked : engineNow >= d.pt && d.lastDist < 12;
      if (isArrived) arrived++;
      if (isFormation && d.edge){ critical++; if (isArrived) criticalArrived++; }
    });
    const progress = assigned ? arrived / assigned : 1;
    return critical && criticalArrived < critical ? Math.min(.93, progress) : progress;
  }

  /* per-frame group transforms → drone targets */
  function groupTargets(dt){
    if (!show.groups.length) return;
    const { s } = skyBox();
    show.groups.forEach(G => {
      /* the shape forms FIRST; motion begins only once the formation is locked */
      const t = show.formed ? engineNow - G.t0 : 0;
      const life = Math.min(1, t / Math.max(1, G.duration));
      let gx = G.ox, gy = G.oy, ang = 0, sc = 1;
      (G.spec.motion || []).forEach(m => {
        if (m.type === 'orbit') ang += t * .00016 * (m.speed || 1);
        if (m.type === 'pulse') sc *= 1 + (m.amp || .07) * Math.sin(t * .0025);
        if (m.type === 'travel' && m.to){
          const e = life * life * (3 - 2 * life);            /* smoothstep */
          gx = G.ox + (m.to[0] - (G.spec.at[0] || 0)) * s * e;
          gy = G.oy - (m.to[1] - (G.spec.at[1] || 0)) * s * .9 * e;
        }
      });
      /* Drawn figures stay square to the audience. Their animation comes
         from deliberate keyframes, not from rocking the whole sculpture. */
      G.gx = gx; G.gy = gy; G.dang = ang; G.dsc = sc;
    });

    drones.forEach(d => {
      if (d.park || d.gi < 0 || d.gi >= show.groups.length) return;
      const G = show.groups[d.gi];
      const oldTx = d.tx, oldTy = d.ty, oldTz = d.tz;
      /* true 3D yaw: orbit spins the formation through depth, like a real show */
      const cos = Math.cos(G.dang), sin = Math.sin(G.dang);
      const rx = d.bx * cos - d.bz * sin;
      const rz = d.bx * sin + d.bz * cos;
      let ty = G.gy + d.by * G.dsc;
      (G.spec.motion || []).forEach(m => {
        if (m.type === 'wave') ty += Math.sin(engineNow * .0022 + d.bx * .025) * (m.amp || 10);
      });
      d.tx = G.gx + rx * G.dsc;
      d.ty = ty;
      d.tz = rz / Math.max(1, s) + (G.zoff || 0);
      if (show.formed && dt > 0){
        d.tvx = (d.tx - oldTx) / dt;
        d.tvy = (d.ty - oldTy) / dt;
        d.tvz = (d.tz - oldTz) * DEPTH_SCALE / dt;
      } else {
        d.tvx = 0; d.tvy = 0; d.tvz = 0;
      }
    });
  }

  /* ── show control: takeoff → acts → landing, the whole shebang ── */
  function play(acts, callbacks){
    onScene = callbacks && callbacks.onScene;
    onEnd = callbacks && callbacks.onEnd;
    /* system-act durations are short holds — the forming itself takes the time */
    const program = [
      { system: 'takeoff', caption: 'fleet spinning up · taking off', duration: 1800, groups: [], enter: 'launch' },
      ...acts,
      { system: 'landing', caption: 'show complete · fleet returning', duration: 2200, groups: [], enter: 'drift' },
    ];
    show = { acts: program, idx: -1, paused: false, until: 0, groups: [], swirl: 0 };
    mode = 'show';
    nextAct();
  }

  function nextAct(){
    show.idx++;
    if (show.idx >= show.acts.length){ endShow(); return; }
    const act = show.acts[show.idx];
    startAct(act);
    if (onScene) onScene(act, show.idx, show.acts.length);
    if (!act.system) AUDIO.whoosh(act.enter);
  }

  function endShow(){
    mode = 'ground';
    groundTargets();
    const cb = onEnd; show = null;
    if (cb) cb();
  }

  function stop(){ show = null; mode = 'ground'; groundTargets(); }
  function pause(v){ if (show) show.paused = v; }
  const playing = () => mode === 'show';

  /* pre-show: the fleet waits on the pad; a few scouts patrol the sky */
  function groundTargets(){
    const { cx, cy, s } = skyBox();
    drones.forEach((d, i) => {
      if (i % 97 === 3){
        /* scout patrol: lazy figure-eight above the city */
        d.gi = -2; d.park = false; d.landing = false; d.grounded = false; d.locked = false; d.edge = false; d.contour = false; d.part = -1;
        const a = camT * .12 + i * 1.3;
        d.tx = cx + Math.sin(a) * s * .9;
        d.ty = cy + Math.sin(a * 2) * s * .3;
        d.tz = Math.cos(a) * .4;
        d.tvx = 0; d.tvy = 0; d.tvz = 0;
        d.tcolor = PALETTE[i % PALETTE.length];
        planPath(d, 0, 1, .5);
        return;
      }
      const p = padSlots[i];
      d.gi = -1; d.park = false; d.landing = true; d.locked = false; d.edge = false; d.contour = false; d.part = -1;
      d.tvx = 0; d.tvy = 0; d.tvz = 0;
      d.tx = p.x; d.ty = p.y; d.tz = p.z;
      d.tcolor = PALETTE[i % PALETTE.length];
      planPath(d, Math.random() * 1.5, i % 2 ? -1 : 1, .4);
    });
  }

  function scoutTargets(dt){
    const { cx, cy, s } = skyBox();
    drones.forEach((d, i) => {
      if (d.gi !== -2) return;
      const oldTx = d.tx, oldTy = d.ty, oldTz = d.tz;
      const a = camT * .12 + i * 1.3;
      d.tx = cx + Math.sin(a) * s * .9;
      d.ty = cy + Math.sin(a * 2) * s * .3;
      d.tz = Math.cos(a) * .4;
      if (dt > 0){
        d.tvx = (d.tx - oldTx) / dt;
        d.tvy = (d.ty - oldTy) / dt;
        d.tvz = (d.tz - oldTz) * DEPTH_SCALE / dt;
      }
    });
  }

  /* ── fx ── */
  function actFx(act, dt){
    const fx = act && act.fx;
    if (!fx) return;
    if (fx === 'fireworks' && Math.random() < dt * .0018){
      const seed = drones[Math.floor(Math.random() * N)];
      drones.forEach(d => {
        if (Math.abs(d.tx - seed.tx) < 70 && Math.abs(d.ty - seed.ty) < 70 && Math.random() < .5){
          d.spark = 1;
        }
      });
      AUDIO.popFar();
    }
    if (fx === 'embers'){
      drones.forEach(d => { if (!d.park && Math.random() < dt * .0004) d.spark = 1; });
    }
    if (fx === 'pyro'){
      /* drone-fired pyrotechnics: bright spark streams pour off the formation */
      drones.forEach(d => {
        if (!d.park && d.lastDist < 14 && Math.random() < dt * .0007){
          d.spark = 1;
        }
      });
      if (Math.random() < dt * .001) AUDIO.popFar();
    }
    if (fx === 'twinkle' && Math.random() < dt * .02){
      drones[Math.floor(Math.random() * N)].spark = 1;
    }
  }

  /* ── physics: thrust-limited seek, separation, wind, ground handling ── */
  const cells = new Map();
  function separatePair(a, b){
    let dx = a.x - b.x, dy = a.y - b.y, dz = (a.z - b.z) * DEPTH_SCALE;
    let dd = Math.hypot(dx, dy, dz);
    if (dd >= SEP_R) return;
    if (dd <= .01){
      const ang = (a.id * 2.399 + b.id * .917) % (Math.PI * 2);
      dx = Math.cos(ang); dy = Math.sin(ang); dz = 0; dd = 1;
    }
    /* station-holding drones are immovable — traffic yields to the
       formation, never the other way around */
    const lockA = a.locked, lockB = b.locked;
    if (lockA && lockB) return;
    const overlap = SEP_R - dd;
    const f = (overlap / SEP_R) * SEP_PUSH;
    const nx = dx / dd, ny = dy / dd, nz = dz / dd;
    if (!lockA){ a.sax += nx * f; a.say += ny * f; a.saz += nz * f; }
    if (!lockB){ b.sax -= nx * f; b.say -= ny * f; b.saz -= nz * f; }
  }
  function separation(){
    cells.clear();
    drones.forEach(d => { d.sax = 0; d.say = 0; d.saz = 0; });
    const CS = 20;
    drones.forEach(d => {
      if (d.grounded) return;
      const cx = Math.floor(d.x / CS), cy = Math.floor(d.y / CS);
      const key = cx + ',' + cy;
      let arr = cells.get(key);
      if (!arr){ arr = []; cells.set(key, arr); }
      arr.push(d);
    });
    const neighbors = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1]];
    cells.forEach((arr, key) => {
      const parts = key.split(',');
      const cx = Number(parts[0]), cy = Number(parts[1]);
      neighbors.forEach(([ox, oy]) => {
        const other = cells.get((cx + ox) + ',' + (cy + oy));
        if (!other) return;
        if (ox === 0 && oy === 0){
          for (let i = 0; i < arr.length; i++){
            for (let j = i + 1; j < arr.length; j++) separatePair(arr[i], arr[j]);
          }
          return;
        }
        for (let i = 0; i < arr.length; i++){
          for (let j = 0; j < other.length; j++) separatePair(arr[i], other[j]);
        }
      });
    });
  }

  function physicsStep(dt){
    windA += dt * .0002;
    const wx = (Math.sin(windA) + Math.sin(windA * 2.7) * .5) * .0018;
    const wy = Math.cos(windA * .8) * .0008;
    separation();

    drones.forEach(d => {
      if (d.grounded){
        /* parked: motors off, just blink */
        d.vx = 0; d.vy = 0; d.vz = 0;
        d.x = d.tx; d.y = d.ty; d.z = d.tz;
        return;
      }
      const stationLocked = d.locked && !!(show && d.gi >= 0);
      if (stationLocked){
        /* A formed picture is a rigid light sculpture. Once an aircraft owns
           its slot it inherits that slot's transform exactly; making hundreds
           of independent controllers chase it is what caused the visible
           rubber-band wobble and torn character silhouettes. */
        const vm = Math.hypot(d.tvx, d.tvy, d.tvz);
        const vk = vm > MAX_SPEED ? MAX_SPEED / vm : 1;
        d.vx = d.tvx * vk; d.vy = d.tvy * vk; d.vz = d.tvz * vk;
        d.x = d.tx; d.y = d.ty; d.z = d.tz;
        d.lastDist = 0;
      } else {
        const finalDist = Math.hypot(d.tx - d.x, d.ty - d.y, (d.tz - d.z) * DEPTH_SCALE);
        /* follow the choreographed path while it runs, then station-keep */
        const c = d.pt !== undefined ? carrot(d) : {
          x: d.tx, y: d.ty, z: d.tz, vx: d.tvx, vy: d.tvy, vz: d.tvz, done: true,
        };
        const trackSlot = c.done || !!(show && show.formed && d.gi >= 0);
        const gx = trackSlot ? d.tx : c.x, gy = trackSlot ? d.ty : c.y, gz = trackSlot ? d.tz : c.z;
        const gvx = trackSlot ? d.tvx : c.vx, gvy = trackSlot ? d.tvy : c.vy, gvz = trackSlot ? d.tvz : c.vz;
        const dx = gx - d.x, dy = gy - d.y, dz = (gz - d.z) * DEPTH_SCALE;
        const dist = Math.hypot(dx, dy, dz) || .001;
        const cap = MAX_SPEED;
        const accel = MAX_THRUST * Math.min(1, d.perf);
        /* Feed the target velocity forward, then close the remaining error at
           a speed from which the aircraft can still stop under max thrust. */
        const closing = Math.min(cap, Math.sqrt(2 * accel * Math.min(dist, ARRIVE_R)), dist / 180);
        let wantX = gvx + dx / dist * closing;
        let wantY = gvy + dy / dist * closing;
        let wantZ = gvz + dz / dist * closing;
        const wantM = Math.hypot(wantX, wantY, wantZ);
        if (wantM > cap){ wantX *= cap / wantM; wantY *= cap / wantM; wantZ *= cap / wantM; }

        d.nx = d.nx * .96 + (Math.random() - .5) * .0016;
        d.ny = d.ny * .96 + (Math.random() - .5) * .0016;
        let ax = (wantX - d.vx) / Math.max(1, dt) + d.sax + d.nx * .01 + wx * .01;
        let ay = (wantY - d.vy) / Math.max(1, dt) + d.say + d.ny * .01 + wy * .01;
        let az = (wantZ - d.vz) / Math.max(1, dt) + d.saz;
        const am = Math.hypot(ax, ay, az);
        if (am > accel){ ax *= accel / am; ay *= accel / am; az *= accel / am; }
        d.vx += ax * dt; d.vy += ay * dt; d.vz += az * dt;

        const drag = Math.exp(-DRAG * dt);
        d.vx *= drag; d.vy *= drag; d.vz *= drag;
        const speed = Math.hypot(d.vx, d.vy, d.vz);
        if (speed > MAX_SPEED){
          d.vx *= MAX_SPEED / speed; d.vy *= MAX_SPEED / speed; d.vz *= MAX_SPEED / speed;
        }
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt / DEPTH_SCALE;

        let arrivedDist = Math.hypot(d.tx - d.x, d.ty - d.y, (d.tz - d.z) * DEPTH_SCALE);
        if (d.gi >= 0 && trackSlot && arrivedDist < LOCK_R){
          d.locked = true;
          d.x = d.tx; d.y = d.ty; d.z = d.tz;
          const targetSpeed = Math.hypot(d.tvx, d.tvy, d.tvz);
          const targetK = targetSpeed > MAX_SPEED ? MAX_SPEED / targetSpeed : 1;
          d.vx = d.tvx * targetK; d.vy = d.tvy * targetK; d.vz = d.tvz * targetK;
          arrivedDist = 0;
        }

        if (mode === 'show' && d.lastDist > 40 && finalDist < 8 && !d.park && !d.landing && Math.random() < .12) d.spark = Math.max(d.spark, .22);
        d.lastDist = arrivedDist;

        /* touch down */
        if (d.landing && c.done && arrivedDist < 3){
          d.grounded = true; d.landing = false;
          d.x = d.tx; d.y = d.ty; d.z = d.tz;
          d.vx = 0; d.vy = 0; d.vz = 0;
        }
      }
      d.phase += dt * .0022;
      if (d.spark > 0) d.spark = Math.max(0, d.spark - dt * .0012);
      /* takeoff glitter curtain: LEDs cycle colors while the fleet climbs */
      const climbing = show && show.acts[show.idx] && show.acts[show.idx].system === 'takeoff';
      if (d.locked && d.gi >= 0){
        /* A station lock includes the light program. Once the aircraft owns
           its pixel, its exact costume color must hold for the whole act. */
        d.color = d.tcolor;
      } else if (climbing && !d.grounded && Math.random() < dt * .0011){
        d.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      } else if (d.color !== d.tcolor){
        /* Thin props need their assigned LED color quickly; a slow costume
           cross-fade made white blades read as missing during the hold. */
        const colorRate = d.edge ? .012 : .0028;
        d.color = hexLerp(d.color, d.tcolor, Math.min(1, dt * colorRate));
        if (d.color.toLowerCase() === d.tcolor.toLowerCase()) d.color = d.tcolor;
      }
    });

  }

  function physics(dt){
    /* Keep the previous rendered frame, not merely the previous 16ms physics
       slice. This gives trails a stable, truthful length on slow frames. */
    drones.forEach(d => {
      d.px = d.x; d.py = d.y; d.pz = d.z; d.hasPrev = true;
    });
    for (let left = dt; left > 0; left -= PHYSICS_STEP){
      physicsStep(Math.min(PHYSICS_STEP, left));
    }
  }

  /* ── frame ── */
  function tick(now){
    const frameDt = Math.min(50, Math.max(0, now - (lastNow || now)));
    lastNow = now;

    const paused = show && show.paused;
    const dt = paused ? 0 : frameDt;
    engineNow += dt;
    camT += dt / 1000;
    const act = show ? show.acts[show.idx] : null;

    if (!paused){
      if (mode === 'ground') scoutTargets(dt);
      if (show){
        if (!show.formed){
          /* wait until the image is properly formed (with a patience cap) */
          const timedOut = engineNow - show.formingSince > 9000;
          const ready = formationProgress() > .94;
          if (ready || timedOut){
            if (show.groups.length){
              /* Finish the last few lagging pixels as one clean lock. This
                 removes the dead pause without ever beginning a broken pose. */
              drones.forEach(d => {
                if (d.gi < 0 || d.park || d.grounded || d.locked) return;
                d.x = d.tx; d.y = d.ty; d.z = d.tz;
                d.vx = d.tvx; d.vy = d.tvy; d.vz = d.tvz;
                d.lastDist = 0; d.locked = true; d.color = d.tcolor;
              });
            }
            show.formed = true;
            show.until = engineNow + act.duration;
            show.groups.forEach(G => { G.t0 = engineNow; });   /* motion starts now */
          }
        } else if (engineNow >= show.until){ nextAct(); }
        if (show && !show.acts[show.idx].system){ groupTargets(dt); actFx(show.acts[show.idx], dt); }
      }
      physics(dt);
    }

    STAGE.frame({ drones, now: engineNow, phase: phase() }, dt);
    requestAnimationFrame(tick);
  }

  function phase(){
    if (mode === 'ground') return 'idle';
    const act = show && show.acts[show.idx];
    return act && act.system ? act.system : 'act';
  }

  function boot(){
    resize();
    STAGE.init(canvas, N);
    if (!drones.length) makeDrones();
    groundTargets();
    drones.forEach((d, i) => {
      if (d.gi === -2) return;
      d.grounded = true;
      d.x = padSlots[i].x; d.y = padSlots[i].y; d.z = padSlots[i].z;
    });
    requestAnimationFrame(tick);
  }

  return { boot, play, stop, pause, playing, count: () => N, TAKEOFF_MS, LANDING_MS,
           _state: () => ({ mode, idx: show ? show.idx : -1, formed: !!(show && show.formed) }),
           _dump: () => drones.filter(d => d.gi >= 0).map(d => ({
             x: Math.round(d.x), y: Math.round(d.y), z: +(d.z || 0).toFixed(2),
             tx: Math.round(d.tx), ty: Math.round(d.ty),
             bx: Math.round(d.bx), by: Math.round(d.by), bz: Math.round(d.bz || 0),
             si: d.si, oi: d.oi, part: d.part, pu: +d.pu.toFixed(3), pv: +d.pv.toFixed(3), c: d.color, tc: d.tcolor,
             ld: Math.round(d.lastDist), locked: d.locked, edge: d.edge,
             speed: +Math.hypot(d.vx, d.vy, d.vz).toFixed(4),
           })) };
})();
