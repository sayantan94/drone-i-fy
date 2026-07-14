/* ── DRONE·I·FY shapes: everything becomes a point cloud ──
   A formation is an array of {x, y, z, c} with x,y in [-1, 1] (y up),
   z a small depth jitter, c an optional color hint. No text — the sky
   speaks in shapes: emoji silhouettes and parametric geometry. */
'use strict';

const SHAPES = (() => {

  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const GOLDEN = 0.6180339887498949;
  const GOLDEN_ANGLE = 2.399963229728653;

  const fract = (v) => v - Math.floor(v);
  const seq01 = (i, seed) => fract((i + 1) * seed);
  const discXY = (i, total) => {
    const r = Math.sqrt((i + .5) / Math.max(1, total));
    const a = i * GOLDEN_ANGLE;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const triSample = (i, seedA, seedB) => {
    let u = seq01(i, seedA);
    let v = seq01(i, seedB);
    if (u + v > 1){ u = 1 - u; v = 1 - v; }
    return [u, v];
  };
  const triPoint = (a, b, c, u, v) => [
    a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
    a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
    a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
  ];

  /* sample a drawn glyph the way a real show would fly it.
     outline mode: silhouette + interior edges (sharp icons).
     solid mode: a dense pixel lattice, every drone a pixel of the
     image — the classic flag / picture look. */
  function sampleGlyph(draw, key, keepColor, fill){
    if (cache.has(key)) return cache.get(key);
    const S = 300, BUDGET = 520;
    scratch.width = S; scratch.height = S;
    sctx.clearRect(0, 0, S, S);
    draw(sctx, S);
    const img = sctx.getImageData(0, 0, S, S).data;

    if (fill === 'solid'){
      let pts = [];
      for (let step = 12; step >= 4 && pts.length < BUDGET * .82; step--){
        pts = [];
        for (let y = step / 2; y < S; y += step){
          for (let x = step / 2; x < S; x += step){
            const xi = x | 0, yi = y | 0, i = (yi * S + xi) * 4;
            if (img[i + 3] > 140){
              pts.push({
                x: (xi / S) * 2 - 1, y: 1 - (yi / S) * 2,
                z: (Math.random() - .5) * .1,
                c: keepColor ? rgbHex(img[i], img[i + 1], img[i + 2]) : null,
                edge: false,
              });
            }
          }
        }
        if (pts.length > BUDGET) break;
      }
      return finish(pts, key);
    }
    const on = (x, y) => x >= 0 && y >= 0 && x < S && y < S && img[(y * S + x) * 4 + 3] > 140;
    const lum = (x, y) => { const i = (y * S + x) * 4; return img[i] * .3 + img[i + 1] * .6 + img[i + 2] * .1; };
    /* edge pixels are anti-aliased mud — take the boldest fully-opaque
       color in the neighborhood instead */
    const boldColor = (x, y) => {
      let bi = (y * S + x) * 4, bs = -1;
      for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]){
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const i = (ny * S + nx) * 4;
        if (img[i + 3] < 250) continue;
        const mx = Math.max(img[i], img[i + 1], img[i + 2]);
        const sat = mx - Math.min(img[i], img[i + 1], img[i + 2]);
        const score = sat * 2 + mx;
        if (score > bs){ bs = score; bi = i; }
      }
      return rgbHex(img[bi], img[bi + 1], img[bi + 2]);
    };
    const mk = (x, y) => ({
      x: (x / S) * 2 - 1,
      y: 1 - (y / S) * 2,
      z: (Math.random() - .5) * .18,
      c: keepColor ? boldColor(x, y) : null,
      edge: true,
    });

    /* the silhouette IS the shape: fine-grained boundary scan, then
       farthest-point thinning for perfectly even drone spacing */
    const sil = [], inner = [];
    const E = 2;
    for (let y = 0; y < S; y += E){
      for (let x = 0; x < S; x += E){
        if (!on(x, y)) continue;
        if (!on(x - E, y) || !on(x + E, y) || !on(x, y - E) || !on(x, y + E)){
          sil.push([x, y]);
        } else if (Math.abs(lum(x, y) - lum(Math.min(S - 1, x + E), y)) > 62 ||
                   Math.abs(lum(x, y) - lum(x, Math.min(S - 1, y + E))) > 62){
          inner.push([x, y]);
        }
      }
    }
    /* farthest-point sampling: every next drone goes where coverage is thinnest */
    const fps = (src, count) => {
      if (!src.length || count <= 0) return [];
      const chosen = [src[0]];
      const dist = src.map(p => (p[0] - src[0][0]) ** 2 + (p[1] - src[0][1]) ** 2);
      while (chosen.length < Math.min(count, src.length)){
        let bi = 0, bd = -1;
        for (let i = 0; i < src.length; i++){
          if (dist[i] > bd){ bd = dist[i]; bi = i; }
        }
        const nx = src[bi];
        chosen.push(nx);
        for (let i = 0; i < src.length; i++){
          const dd = (src[i][0] - nx[0]) ** 2 + (src[i][1] - nx[1]) ** 2;
          if (dd < dist[i]) dist[i] = dd;
        }
      }
      return chosen;
    };
    const silQuota = Math.min(sil.length, Math.round(BUDGET * .82));
    const innQuota = Math.min(inner.length, BUDGET - silQuota);
    const pts = fps(sil, silQuota).concat(fps(inner, innQuota)).map(p => mk(p[0], p[1]));
    return finish(pts, key, true);
  }

  function relax(pts){
    /* nudge clumped points apart (bounded drift: silhouette stays put) */
    for (let it = 0; it < 6; it++){
      for (let i = 0; i < pts.length; i++){
        const p = pts[i];
        let fx = 0, fy = 0;
        for (let j = 0; j < pts.length; j++){
          if (j === i) continue;
          const q = pts[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const dd = dx * dx + dy * dy;
          if (dd < .0036 && dd > 1e-9){
            const d = Math.sqrt(dd);
            const f = (.06 - d) / d * .3;
            fx += dx * f; fy += dy * f;
          }
        }
        const ox = p.ox === undefined ? (p.ox = p.x) : p.ox;
        const oy = p.oy === undefined ? (p.oy = p.y) : p.oy;
        p.x += fx; p.y += fy;
        /* leash to the original sample */
        const lx = p.x - ox, ly = p.y - oy;
        const lm = Math.hypot(lx, ly);
        if (lm > .028){ p.x = ox + lx / lm * .028; p.y = oy + ly / lm * .028; }
      }
    }
    return pts;
  }

  function finish(pts, key, dome, noRelax){
    if (pts.length){
      if (!noRelax) relax(pts);
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      const w = Math.max(.001, maxX - minX), h = Math.max(.001, maxY - minY);
      const sc = 1.9 / Math.max(w, h);
      pts.forEach(p => {
        p.x = (p.x - (minX + maxX) / 2) * sc;
        p.y = (p.y - (minY + maxY) / 2) * sc;
        if (dome){
          /* volumetric shell: flat art gets a gentle dome so rotation reveals depth */
          const rr = (p.x * p.x + p.y * p.y) / 2;
          p.z = (Math.random() < .5 ? 1 : -1) * Math.sqrt(Math.max(0, 1 - rr)) * .16;
        }
      });
    }
    cache.set(key, pts);
    return pts;
  }

  function rgbHex(r, g, b){
    /* drones are lights, not paint: boost saturation, then lift brightness */
    const mean = (r + g + b) / 3;
    const sat = c => mean + (c - mean) * 1.55;
    const lift = c => Math.max(0, Math.min(255, Math.round(55 + sat(c) * .85)));
    return '#' + [lift(r), lift(g), lift(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function emoji(ch, fill){
    /* bitmap emoji fonts fail to rasterize at large sizes on some platforms —
       draw small and safe; the sampler rescales the cloud to fill the box */
    return sampleGlyph((ctx, S) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '120px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.save();
      ctx.scale(1.22, 1.22);                     /* finer sampling grid vs glyph */
      ctx.fillText(ch, S / 2 / 1.22, (S / 2 + 5) / 1.22);
      ctx.restore();
    }, 'e:' + (fill || 'outline') + ':' + ch, true, fill);
  }

  /* ── parametric formations ── */
  function fromParam(n, fn, key){
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(fn(i / n, i));
    cache.set(key, pts);
    return pts;
  }
  function fromOrderedParam(n, fn, key, si){
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    for (let i = 0; i < n; i++){
      const p = fn(i / n, i);
      p.si = si;
      p.oi = i;
      pts.push(p);
    }
    cache.set(key, pts);
    return pts;
  }
  const jz = () => (Math.random() - .5) * .16;

  const heart = () => fromOrderedParam(320, t => {
    const a = t * Math.PI * 2;
    return {
      x: Math.pow(Math.sin(a), 3) * .95,
      y: (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17,
      z: jz(), c: null,
    };
  }, 'p:heart', 0);

  const ring = () => fromOrderedParam(280, t => {
    const a = t * Math.PI * 2;
    return { x: Math.cos(a) * .92, y: Math.sin(a) * .92, z: jz(), c: null };
  }, 'p:ring', 0);

  const star = () => fromOrderedParam(320, t => {
    const a = t * Math.PI * 2;
    const r = .38 + .6 * Math.abs(Math.cos((a * 5 + Math.PI) / 2)) ** .3;
    return { x: Math.cos(a) * r * .95, y: Math.sin(a) * r * .95, z: jz(), c: null };
  }, 'p:star', 0);

  const spiral = () => fromOrderedParam(340, t => {
    const a = t * Math.PI * 7;
    const r = .12 + t * .85;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: jz(), c: null };
  }, 'p:spiral', 0);

  const burst = () => fromParam(340, t => {
    const a = t * Math.PI * 2 * 13.7;
    const r = Math.sqrt((t * 997) % 1);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * .95, z: (Math.random() - .5) * .5, c: null };
  }, 'p:burst');

  const swarm = () => fromParam(340, (t, i) => ({
    x: Math.sin(i * 12.9898) * .92,
    y: Math.sin(i * 78.233) * .55 + .1,
    z: Math.sin(i * 39.425) * .3,
    c: null,
  }), 'p:swarm');

  const helix = () => {
    const key = 'p:helix';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const per = 160;
    for (let strand = 0; strand < 2; strand++){
      for (let i = 0; i < per; i++){
        const t = i / Math.max(1, per - 1);
        const a = t * Math.PI * 6 + strand * Math.PI;
        pts.push({
          x: Math.cos(a) * .5,
          y: t * 1.9 - .95,
          z: Math.sin(a) * .42,
          c: null,
          si: strand,
          oi: i,
        });
      }
    }
    cache.set(key, pts);
    return pts;
  };

  const sphere = (fill) => {
    if (fill === 'solid'){
      const key = 'p:sphere:solid';
      if (cache.has(key)) return cache.get(key);
      const pts = [];
      for (let i = 0; i < 420; i++){
        const u = 1 - 2 * ((i + .5) / 420);
        const th = i * GOLDEN_ANGLE;
        const rr = i % 4 === 0 ? .92 : Math.cbrt(seq01(i, .7548776662466927)) * .92;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        pts.push({
          x: Math.cos(th) * s * rr,
          y: u * rr,
          z: Math.sin(th) * s * rr,
          c: null,
        });
      }
      cache.set(key, pts);
      return pts;
    }
    return fromParam(360, (t, i) => {
      /* true fibonacci shell: uniform latitude, golden-angle longitude —
         deriving both from the same sequence collapses the shell to a curve */
      const ph = Math.acos(1 - 2 * (i + .5) / 360);
      const th = i * GOLDEN_ANGLE;
      return { x: Math.sin(ph) * Math.cos(th) * .9, y: Math.cos(ph) * .9, z: Math.sin(ph) * Math.sin(th) * .9, c: null };
    }, 'p:sphere');
  };

  const crescent = () => fromOrderedParam(300, t => {
    const a = (t * 1.45 + .27) * Math.PI * 2 * .69;
    const r = .85 + (Math.random() - .5) * .1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: jz(), c: null };
  }, 'p:crescent', 0);

  const wavefield = () => {
    const key = 'p:wavefield';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const rows = 10, cols = 34;
    for (let row = 0; row < rows; row++){
      for (let col = 0; col < cols; col++){
        const x = col / (cols - 1) * 1.9 - .95;
        pts.push({
          x,
          y: Math.sin(x * 3.4 + row) * .35 + (row - 4.5) * .11,
          z: jz(),
          c: null,
          si: row,
          oi: col,
        });
      }
    }
    cache.set(key, pts);
    return pts;
  };

  const comet = () => {
    const key = 'p:comet';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    for (let i = 0; i < 96; i++){
      const a = i / 96 * Math.PI * 2;
      pts.push({
        x: .6 + Math.cos(a) * .28,
        y: .45 + Math.sin(a) * .28,
        z: jz(),
        c: null,
        si: 0,
        oi: i,
      });
    }
    for (let i = 0; i < 204; i++){
      const t = i / 203;
      pts.push({
        x: .55 - t * 1.5 + (seq01(i, GOLDEN) - .5) * .08 * (1 + t),
        y: .42 - t * 1.06 + (seq01(i, .7548776662466927) - .5) * .07 * (1 + t),
        z: jz() * (1 + t * .6),
        c: null,
        si: 1,
        oi: i,
      });
    }
    cache.set(key, pts);
    return pts;
  };

  /* ── 3D solids: real surface shells that read on camera ── */
  const torus = () => fromParam(380, (t, i) => {
    const u = i * GOLDEN_ANGLE;
    const v = seq01(i, .7548776662466927) * Math.PI * 2;
    const R = .6, r = .28;
    return { x: (R + r * Math.cos(v)) * Math.cos(u), y: r * Math.sin(v) * 1.4, z: (R + r * Math.cos(v)) * Math.sin(u) * .9, c: null };
  }, 'p:torus');

  const cube = () => {
    const key = 'p:cube';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const a = .74, dz = .82, cols = 10, rows = 6;
    const pushFace = (face) => {
      for (let row = 0; row < rows; row++){
        for (let col = 0; col < cols; col++){
          const u = ((col + .5) / cols) * 2 - 1;
          const v = ((row + .5) / rows) * 2 - 1;
          if (face === 0) pts.push({ x: a, y: u * a, z: v * a * dz, c: null });
          if (face === 1) pts.push({ x: -a, y: u * a, z: v * a * dz, c: null });
          if (face === 2) pts.push({ x: u * a, y: a, z: v * a * dz, c: null });
          if (face === 3) pts.push({ x: u * a, y: -a, z: v * a * dz, c: null });
          if (face === 4) pts.push({ x: u * a, y: v * a, z: a * dz, c: null });
          if (face === 5) pts.push({ x: u * a, y: v * a, z: -a * dz, c: null });
        }
      }
    };
    for (let face = 0; face < 6; face++) pushFace(face);
    cache.set(key, pts);
    return pts;
  };

  const pyramid = () => {
    const key = 'p:pyramid';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const baseY = -.7;
    const apex = [0, .88, 0];
    const corners = [
      [-.82, baseY, -.68],
      [.82, baseY, -.68],
      [.82, baseY, .68],
      [-.82, baseY, .68],
    ];
    const addTri = (a, b, c, count) => {
      for (let i = 0; i < count; i++){
        const [u, v] = triSample(i, GOLDEN, .7548776662466927);
        const p = triPoint(a, b, c, u, v);
        pts.push({ x: p[0], y: p[1], z: p[2], c: null });
      }
    };
    addTri(apex, corners[0], corners[1], 72);
    addTri(apex, corners[1], corners[2], 72);
    addTri(apex, corners[2], corners[3], 72);
    addTri(apex, corners[3], corners[0], 72);
    for (let i = 0; i < 72; i++){
      const [dx, dz] = discXY(i, 72);
      pts.push({ x: dx * .82, y: baseY, z: dz * .68, c: null });
    }
    cache.set(key, pts);
    return pts;
  };

  const cone = () => {
    const key = 'p:cone';
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const h = 1.65, baseY = -.82, r = .82, dz = .84;
    for (let i = 0; i < 260; i++){
      const th = seq01(i, GOLDEN) * Math.PI * 2;
      const y01 = 1 - Math.sqrt(1 - seq01(i, .7548776662466927));
      const rr = (1 - y01) * r;
      pts.push({
        x: Math.cos(th) * rr,
        y: baseY + y01 * h,
        z: Math.sin(th) * rr * dz,
        c: null,
      });
    }
    for (let i = 0; i < 92; i++){
      const [dx, dz2] = discXY(i, 92);
      pts.push({ x: dx * r, y: baseY, z: dz2 * r * dz, c: null });
    }
    cache.set(key, pts);
    return pts;
  };

  const PARAM = { heart, ring, star, spiral, burst, swarm, helix, sphere, crescent, wavefield, comet,
                  torus, cube, pyramid, cone };
  const SOLIDS = ['sphere', 'helix', 'torus', 'cube', 'pyramid', 'cone'];

  /* ── art: the planner draws its own characters ──
     elements on a -1..1 canvas (y up): 'stroke' polylines the fleet
     traces, 'fill' polygons it packs solid. Per-element colors let the
     model costume-design a character part by part. */
  function chaikin(pts, closed){
    const out = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++){
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
      out.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    if (!closed){ out.unshift(pts[0]); out.push(pts[n - 1]); }
    return out;
  }

  function strokePoints(e, count){
    let pts = e.pts;
    if (pts.length >= 4 && !e.sharp){ pts = chaikin(chaikin(pts, e.close), e.close); }
    else if (e.close) pts = pts.concat([pts[0]]);
    const segs = [];
    let L = 0;
    const lim = e.close && e.pts.length >= 4 ? pts.length : pts.length - 1;
    for (let i = 0; i < lim; i++){
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, l0: L, l });
      L += l;
    }
    const out = [];
    for (let k = 0; k < count; k++){
      const t = (k + .5) / count * L;
      const s = segs.find(sg => t <= sg.l0 + sg.l) || segs[segs.length - 1];
      const u = s.l ? (t - s.l0) / s.l : 0;
      out.push([s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u]);
    }
    return out;
  }

  function inPoly(x, y, poly){
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = true;
    }
    return inside;
  }

  function fillPoints(e, count){
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    e.pts.forEach(p => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    /* shrink the lattice step until the polygon holds `count` drones */
    for (let step = .3; step > .008; step *= .82){
      const got = [];
      for (let y = minY + step / 2; y <= maxY; y += step){
        const off = ((y / step) | 0) % 2 ? step / 2 : 0;   /* hex-ish packing */
        for (let x = minX + off; x <= maxX; x += step){
          if (inPoly(x, y, e.pts)) got.push([x, y]);
        }
      }
      if (got.length >= count){
        /* The lattice is row-major. Taking got.slice(0, count) amputates the
           bottom of every filled body part whenever this pass yields more
           points than requested. Sample evenly across the full lattice so a
           torso, face or leg always keeps its complete silhouette. */
        const spread = [];
        for (let i = 0; i < count; i++){
          spread.push(got[Math.min(got.length - 1, Math.floor((i + .5) * got.length / count))]);
        }
        return spread;
      }
    }
    return e.pts.slice();
  }

  function fromArt(art){
    const key = 'a:' + JSON.stringify(art);
    if (cache.has(key)) return cache.get(key);
    /* wireframes arrive on a 100x100 sketchpad (integer coords, y down);
       auto-detect and normalize so hand-written -1..1 art still works */
    let big = 0;
    art.forEach(e => e.pts.forEach(p => { big = Math.max(big, Math.abs(p[0]), Math.abs(p[1])); }));
    if (big > 1.5){
      art = art.map(e => Object.assign({}, e, {
        pts: e.pts.map(p => [p[0] / 50 - 1, 1 - p[1] / 50]),
      }));
    }
    const BUDGET = 580;
    const meta = art.map(e => {
      if (e.mode === 'fill'){
        let A = 0;
        for (let i = 0; i < e.pts.length; i++){
          const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
          A += a[0] * b[1] - b[0] * a[1];
        }
        return { score: Math.abs(A) / 2 * 2.6 };
      }
      let L = 0;
      for (let i = 1; i < e.pts.length; i++) L += Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]);
      return { score: L };
    });
    const ssum = meta.reduce((a, m) => a + m.score * 1, 0) || 1;
    const cap = (e, i) => e.mode === 'fill'
      ? Math.round(meta[i].score / 2.6 * 950) + 6
      : Math.round(meta[i].score * 46) + 4;
    const counts = art.map((e, i) =>
      Math.min(cap(e, i), Math.max(4, Math.round(BUDGET * meta[i].score * (e.weight || 1) / ssum))));
    /* hand what the caps clawed back to the fills — bodies stay dense */
    let leftover = BUDGET - counts.reduce((a, b) => a + b, 0);
    for (let r = 0; r < 3 && leftover > 8; r++){
      art.forEach((e, i) => {
        if (e.mode !== 'fill' || leftover <= 0) return;
        const room = cap(e, i) - counts[i];
        const give = Math.min(room, Math.ceil(leftover / 2));
        counts[i] += give; leftover -= give;
      });
    }
    const pts = [];
    let strokeId = 0;
    art.forEach((e, i) => {
      const count = counts[i];
      let raw;
      let contourStroke = -1;
      if (e.mode === 'fill'){
        /* Filled parts still need a readable silhouette. Reserve a modest
           perimeter ring, then pack the rest inside it. The perimeter is a
           softer light-wire (contour, not a prop edge), so limbs look cut
           cleanly without turning the whole person into line art. */
        const boundaryCount = count >= 10
          ? Math.min(Math.max(6, Math.round(count * .22)), Math.floor(count * .4))
          : 0;
        const boundary = boundaryCount
          ? strokePoints(Object.assign({}, e, { close: true, sharp: true }), boundaryCount)
              .map((p, oi) => [p[0], p[1], true, oi])
          : [];
        if (boundary.length) contourStroke = strokeId++;
        raw = boundary.concat(fillPoints(e, count - boundary.length));
      } else {
        contourStroke = strokeId++;
        raw = strokePoints(e, count);
      }
      /* 3D: each part is a volume (depth = thickness) on its own layer
         (lift: + toward the audience), not a paper cutout */
      const depth = Math.max(0, Math.min(30, e.depth === undefined ? (e.mode === 'fill' ? 12 : 2) : e.depth)) / 50;
      const base = -Math.max(-20, Math.min(20, e.lift === undefined ? (e.mode === 'stroke' ? 6 : 0) : e.lift)) / 50;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      e.pts.forEach(p => {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const rx = Math.max(.001, (maxX - minX) / 2), ry = Math.max(.001, (maxY - minY) / 2);
      let col = e.color || '#f2f4ff';
      {
        /* lights, not paint: lift near-black art colors into the visible */
        const ch = [1, 3, 5].map(k => parseInt(col.slice(k, k + 2), 16));
        const v = Math.max(...ch);
        if (v < 140){
          const add = 140 - v;
          col = '#' + ch.map(c => Math.min(255, c + add).toString(16).padStart(2, '0')).join('');
        }
      }
      raw.forEach((p, oi) => {
        const contour = e.mode === 'fill' && !!p[2];
        const nx = (p[0] - cx) / rx;
        const ny = (p[1] - cy) / ry;
        const round = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx * .72 + ny * ny)));
        const thickness = e.mode === 'fill'
          ? depth * (.32 + round * .68)
          : Math.max(.04, depth * .7);
        const wave = seq01(oi, GOLDEN * 1.1739849967) - .5;
        const shell = oi % 5 === 0 ? (wave < 0 ? -.5 : .5) : wave;
        const point = {
          x: p[0],
          y: p[1],
          z: base + shell * thickness,
          c: col,
          /* Stable semantic identity for pose-to-pose morphing. The runtime
             can keep helmet drones on the helmet and blade drones on the
             blade instead of rebuilding the character from arbitrary nearby
             aircraft at every keyframe. */
          part: i,
          /* Normalized coordinates within this part give every aircraft a
             persistent place on the material. A blade point near the guard
             remains near the guard while the entire blade rotates. */
          pu: e.mode === 'fill' ? (p[0] - minX) / Math.max(.001, maxX - minX) : oi / Math.max(1, raw.length - 1),
          pv: e.mode === 'fill' ? (p[1] - minY) / Math.max(.001, maxY - minY) : 0,
          edge: e.mode !== 'fill',
          contour,
        };
        if (e.mode !== 'fill' || contour){
          point.si = contourStroke;
          point.oi = contour ? p[3] : oi;
        }
        pts.push(point);
      });
    });
    return finish(pts.slice(0, 700), key, false, true);
  }

  /* ── ascii: the planner draws a character grid, the fleet flies it ──
     rows of text on a monospace grid; every non-space cell is a drone.
     palette maps grid characters to LED colors. */
  function fromAscii(rows, palette){
    const key = 'x:' + JSON.stringify([rows, palette]);
    if (cache.has(key)) return cache.get(key);
    const XP = .55;                     /* monospace cells are ~half as wide as tall */
    let pts = [];
    const nrows = rows.length;
    let cols = 1;
    rows.forEach(r => { cols = Math.max(cols, r.length); });
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++){
        const ch = row[c];
        if (ch === ' ' || ch === '.') continue;
        pts.push({
          x: (c - (cols - 1) / 2) * XP,
          y: (nrows - 1) / 2 - r,
          z: (Math.random() - .5) * .12,
          c: (palette && palette[ch]) || '#f2f4ff',
          edge: true,
        });
      }
    });
    /* checkerboard-thin oversized grids: halves density, keeps the drawing */
    let parity = 0;
    while (pts.length > 560){
      const grid = pts.filter(p => ((Math.round(p.y * 2) + Math.round(p.x / XP)) % 2 + 2) % 2 === parity);
      if (!grid.length || grid.length === pts.length) break;
      pts = grid.length >= 140 ? grid : pts.slice(0, 560);
      parity = 1 - parity;
    }
    return finish(pts, key, false, true);
  }

  /* shape spec: "emoji:🐉" or a parametric name; fill: 'outline' | 'solid' */
  function get(spec, fill){
    const str = typeof spec === 'string' ? spec : (spec && spec.kind === 'emoji' ? 'emoji:' + spec.value : (spec && spec.value) || 'swarm');
    if (str.startsWith('emoji:')) return emoji(str.slice(6), fill);
    return (PARAM[str] || swarm)(fill);
  }

  return { get, fromArt, fromAscii, PARAM: Object.keys(PARAM), SOLIDS };
})();
