/* ── DRONE·I·FY ui: planner → normalizer → FLIGHTSCRIPT runtime ──
   The planner is an LLM agent (/api/plan) when deployed, the onboard compiler
   when local or offline. Both emit the same FLIGHTSCRIPT program;
   normalize() clamps everything to the runtime's vocabulary, so no
   plan ever breaks the animator. */
'use strict';

(() => {

  const $ = (id) => document.getElementById(id);
  const consoleEl = $('console'), scenarioEl = $('scenario'), form = $('launch-form');
  const subtitleEl = $('subtitle'), waypointsEl = $('waypoints'), showbar = $('showbar');
  const toast = $('toast');
  const launchBtn = $('launch-btn');

  let currentScenario = '';

  /* ── FLIGHTSCRIPT normalizer ── */
  const ENTERS = ['launch', 'explode', 'rain', 'swirl', 'drift', 'bloom'];
  const FXS = ['fireworks', 'embers', 'twinkle', 'pyro'];
  const MOTIONS = ['orbit', 'travel', 'pulse', 'wave'];

  const num = (v, lo, hi, dflt) => {
    const n = typeof v === 'number' && isFinite(v) ? v : dflt;
    return Math.max(lo, Math.min(hi, n));
  };

  function normShape(v){
    if (typeof v !== 'string') return null;
    if (v.startsWith('emoji:')){
      /* take the first grapheme — handles flags (🇺🇸), ZWJ sequences, keycaps */
      const raw = v.slice(6).trim();
      const seg = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(raw)][0];
      const g = seg && seg.segment;
      if (g && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g)) return 'emoji:' + g;
      return null;
    }
    return SHAPES.PARAM.includes(v) ? v : null;
  }

  function lumFloor(hex){
    /* drones are lights: lift any color too dark to fly */
    if (!hex) return hex;
    const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const v = Math.max(...ch);
    if (v >= 140) return hex;
    const add = 140 - v;
    return '#' + ch.map(c => Math.min(255, c + add).toString(16).padStart(2, '0')).join('');
  }

  function normHex(h){
    if (typeof h !== 'string') return null;
    let m = h.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(m)) m = '#' + [...m.slice(1)].map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(m) ? m : null;
  }

  function normColor(v){
    if (v === 'sampled' || v === 'rainbow') return v;
    if (typeof v === 'string' && v.startsWith('gradient:')){
      const parts = v.split(':');
      const a = normHex(parts[1]), b = normHex(parts[2]);
      return a && b ? 'gradient:' + a + ':' + b : 'sampled';
    }
    return normHex(v) || 'sampled';
  }

  function normArt(list){
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    let total = 0;
    for (const e of list.slice(0, 16)){
      if (!e || !Array.isArray(e.pts)) continue;
      const pts = [];
      for (const p of e.pts.slice(0, 40)){
        if (!Array.isArray(p) || p.length < 2) continue;
        let x = num(p[0], -30, 130, NaN), y = num(p[1], -30, 130, NaN);
        if (isNaN(x) || isNaN(y)) continue;
        pts.push([x, y]);
      }
      if (pts.length < (e.mode === 'fill' ? 3 : 2)) continue;
      total += pts.length;
      if (total > 340) break;
      out.push({
        mode: e.mode === 'fill' ? 'fill' : 'stroke',
        pts,
        color: lumFloor(normHex(e.color)),
        close: !!e.close,
        weight: num(e.weight, .2, 4, 1),
        depth: e.depth === undefined ? undefined : num(e.depth, 0, 30, 10),
        lift: e.lift === undefined ? undefined : num(e.lift, -20, 20, 0),
      });
    }
    return out.length ? out : null;
  }

  function normAscii(g){
    const rows = g && g.ascii;
    if (!Array.isArray(rows) || !rows.length) return null;
    const clean = rows.slice(0, 30)
      .map(r => typeof r === 'string' ? r.replace(/\t/g, '  ').slice(0, 48) : '')
      .map(r => r.replace(/\s+$/, ''));
    while (clean.length && !clean[0].trim()) clean.shift();
    while (clean.length && !clean[clean.length - 1].trim()) clean.pop();
    let cells = 0;
    clean.forEach(r => { for (const ch of r) if (ch !== ' ' && ch !== '.') cells++; });
    if (cells < 12) return null;
    const palette = {};
    (Array.isArray(g.palette) ? g.palette : []).slice(0, 8).forEach(e => {
      const ch = e && typeof e.ch === 'string' && e.ch.length ? e.ch[0] : null;
      const col = lumFloor(normHex(e && e.color));
      if (ch && col) palette[ch] = col;
    });
    return { rows: clean, palette };
  }

  function normGroup(g){
    const ascii = normAscii(g);
    const art = normArt(g && g.art);
    const shape = normShape(g && g.shape);
    if (!shape && !art && !ascii) return null;
    return {
      shape: shape || 'swarm',
      art,
      ascii,
      at: [num(g.at && g.at[0], -1, 1, 0), num(g.at && g.at[1], -1, 1, 0)],
      scale: num(g.scale, .2, 1.4, 1),
      rotate: num(g.rotate, -180, 180, 0),
      color: normColor(g.color),
      weight: num(g.weight, .2, 3, 1),
      fill: g.fill === 'solid' ? 'solid' : 'outline',
      motion: dedupeMotions(g.motion),
    };
  }

  function dedupeMotions(list){
    const out = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach(m => {
      if (!m || !MOTIONS.includes(m.type) || seen.has(m.type) || out.length >= 2) return;
      seen.add(m.type);
      out.push({
        type: m.type,
        speed: num(m.speed, .2, 3, 1),
        amp: m.type === 'wave' ? num(m.amp, 4, 18, 10) : num(m.amp, .03, .16, .08),
        to: m.type === 'travel' ? [num(m.to && m.to[0], -1, 1, .5), num(m.to && m.to[1], -1, 1, 0)] : undefined,
      });
    });
    return out;
  }

  function normalize(plan){
    const rawActs = Array.isArray(plan) ? plan : (plan && plan.acts);
    const acts = (Array.isArray(rawActs) ? rawActs : []).slice(0, 6)
      .map(a => {
        const groups = (Array.isArray(a && a.groups) ? a.groups : []).slice(0, 3)
          .map(normGroup).filter(Boolean);
        if (!groups.length) return null;
        return {
          caption: String(a.caption || '').slice(0, 90),
          /* no show clock: the choreographer decides; clamp only per-act sanity */
          duration: num(a.duration, 7000, 18000, 9500),
          enter: ENTERS.includes(a.enter) ? a.enter : 'drift',
          fx: FXS.includes(a.fx) ? a.fx : null,
          groups,
        };
      })
      .filter(Boolean);
    return acts.length ? acts : null;
  }

  /* ── mission-control HUD: live telemetry rails + scramble-decode readouts ── */
  const HUD = (() => {
    const GLYPHS = '▚▞▓▒░<>/\\|=+*#10';
    let timer = 0, t0 = 0;

    const ji = (base, spread) => Math.round(base + (Math.random() - .5) * spread);
    const ROWS_L = [
      ['UPLINK',    () => ji(24, 14) + ' MS',                              () => 62 + Math.random() * 24],
      ['FLEET',     () => '600 UNITS · READY',                             () => 100],
      ['GRID SYNC', () => (96 + Math.random() * 3.8).toFixed(1) + ' %',    () => 96 + Math.random() * 4],
      ['WIND',      () => (1.1 + Math.random() * 2.4).toFixed(1) + ' KT',  () => 16 + Math.random() * 22],
      ['BATTERY',   () => ji(95, 3) + ' %',                                () => 93 + Math.random() * 5],
    ];
    const ROWS_R = [
      ['ALT CEILING', () => '420 M',                                       () => 78],
      ['GEOFENCE',    () => 'LOCKED',                                      () => 100],
      ['SAT FIX',     () => ji(16, 3) + ' · RTK',                          () => 84 + Math.random() * 12],
      ['PAYLOAD',     () => 'LED ARRAY OK',                                () => 90],
      ['SHOW CLOCK',  () => 'T-' + String(Math.max(0, 90 - ((performance.now() - t0) / 1000 | 0))).padStart(2, '0') + ' S',
                      () => Math.max(4, 100 - (performance.now() - t0) / 900)],
    ];

    function build(el, rows){
      if (!el) return;
      el.innerHTML = rows.map(r =>
        `<span class="hr-row">${r[0]}<b>--</b><span class="hr-meter"><i></i></span></span>`).join('');
    }
    function tick(){
      [[ $('hud-rail-l'), ROWS_L ], [ $('hud-rail-r'), ROWS_R ]].forEach(([el, rows]) => {
        if (!el) return;
        [...el.children].forEach((row, i) => {
          row.querySelector('b').textContent = rows[i][1]();
          row.querySelector('.hr-meter i').style.width = Math.min(100, rows[i][2]()) + '%';
        });
      });
    }
    function decode(el, text){
      if (!el) return;
      const start = performance.now(), D = 640;
      (function step(){
        const p = Math.min(1, (performance.now() - start) / D);
        const keep = Math.round(text.length * p);
        el.textContent = text.slice(0, keep) +
          [...text.slice(keep)].map(c => c === ' ' ? ' ' : GLYPHS[Math.random() * GLYPHS.length | 0]).join('');
        if (p < 1) requestAnimationFrame(step);
      })();
    }
    function start(){
      t0 = performance.now();
      build($('hud-rail-l'), ROWS_L);
      build($('hud-rail-r'), ROWS_R);
      tick();
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 640);
      decode($('planning-eyebrow'), 'MISSION CONTROL · CHOREOGRAPHY ENGINE ONLINE');
      decode($('planning-title'), 'PLANNING FLIGHT PATH');
    }
    function lock(){
      decode($('planning-eyebrow'), 'SEQUENCE COMMITTED · ALL STATIONS GO');
    }
    function stop(){
      if (timer) clearInterval(timer);
      timer = 0;
    }
    return { start, lock, stop, decode };
  })();

  /* ── planner: streamed thinking + plan; failures surface as an error, never a default show ── */
  function showThought(text){
    const el = $('planning-log');
    if (!el || !text) return;
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
  }

  /* the whole plan, on the pad before takeoff — the choreographer's manifest */
  function showFlightPlan(acts){
    const list = $('planning-plan');
    if (!list) return Promise.resolve();
    HUD.decode($('planning-title'), 'FLIGHT PLAN LOCKED');
    HUD.decode($('planning-sub'), 'fleet ready · standing by to launch');
    HUD.lock();
    $('planning-log').classList.add('done');
    const maxDur = Math.max(...acts.map(a => a.duration));
    list.innerHTML = acts.map((a, i) => {
      const meta = [
        Math.round(a.duration / 1000) + 's',
        a.enter,
        a.fx,
        a.groups.map(g => g.art ? 'custom art' : g.ascii ? 'ascii art' : g.shape.replace('emoji:', '')).join(' + '),
      ].filter(Boolean).join(' · ');
      return `<li style="animation-delay:${140 + i * 150}ms;--dur:${Math.round(a.duration / maxDur * 100)}%">` +
        `<span class="pp-n">[ ${String(i + 1).padStart(2, '0')} ]</span>` +
        `<span class="pp-cap">${a.caption || 'formation'}</span>` +
        `<span class="pp-meta">${meta}</span></li>`;
    }).join('');
    list.hidden = false;
    return new Promise(res => setTimeout(res, 3400));
  }

  async function plan(scenario){
    try {
      const ctrl = new AbortController();
      /* idle watchdog, not a total cap: rich two-figure plans stream for
         minutes — only true silence means the planner died */
      let timer = setTimeout(() => ctrl.abort(), 90000);
      const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 90000); };
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario }),
        signal: ctrl.signal,
      });
      if (r.ok && r.body){
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '', planObj = null;
        for (;;){
          const { done, value } = await reader.read();
          if (done) break;
          alive();
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines){
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.t === 'think') showThought(msg.text);
              if (msg.t === 'plan') planObj = msg.plan;
              if (msg.t === 'error') console.warn('planner error:', msg.error);
            } catch (e) { /* partial line */ }
          }
        }
        clearTimeout(timer);
        /* legacy JSON body (non-streaming deployments) */
        if (!planObj && buf.trim()){
          try { const whole = JSON.parse(buf); planObj = whole.plan || whole; } catch (e) {}
        }
        const acts = normalize(planObj);
        if (acts) return acts;
      }
      clearTimeout(timer);
    } catch (e) { console.warn('planner unreachable:', e && e.message); }
    /* no silent default show — the launch flow surfaces the failure */
    return null;
  }

  /* ── show flow ── */
  async function launch(scenario){
    currentScenario = (scenario || '').trim();
    if (!currentScenario) return;
    AUDIO.begin();
    launchBtn.disabled = true;
    launchBtn.querySelector('.launch-word').textContent = 'PLANNING…';
    const planningEl = $('planning');
    $('planning-log').textContent = '';
    $('planning-log').classList.remove('done');
    $('planning-plan').hidden = true;
    $('planning-title').textContent = 'PLANNING FLIGHT PATH';
    $('planning-sub').textContent = 'choreographing your fleet';
    planningEl.hidden = false;
    HUD.start();

    const acts = await plan(currentScenario);

    if (!acts){
      /* no fallback show — say it went wrong and hand the console back */
      planningEl.hidden = true;
      HUD.stop();
      launchBtn.disabled = false;
      launchBtn.querySelector('.launch-word').textContent = 'LAUNCH';
      toast.textContent = '⚠ something went wrong while planning your show — please try again';
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 3600);
      return;
    }

    await showFlightPlan(acts);

    planningEl.hidden = true;
    HUD.stop();
    launchBtn.disabled = false;
    launchBtn.querySelector('.launch-word').textContent = 'LAUNCH';
    consoleEl.classList.add('away');
    const homeReel = $('home-reel');
    if (homeReel) homeReel.pause();
    showbar.hidden = false;
    waypointsEl.hidden = false;
    history.replaceState(null, '', '#' + encodeURIComponent(currentScenario));

    ENGINE.play(acts, {
      onScene(act, i, total){
        if (waypointsEl.children.length !== total){
          waypointsEl.innerHTML = Array.from({ length: total }, () => '<i class="wp"></i>').join('');
        }
        subtitleEl.textContent = act.caption;
        subtitleEl.hidden = false;
        subtitleEl.classList.add('on');
        [...waypointsEl.children].forEach((el, k) => {
          el.className = 'wp' + (k < i ? ' done' : k === i ? ' now' : '');
        });
        AUDIO.tick();
      },
      onEnd(){
        subtitleEl.classList.remove('on');
        setTimeout(() => { if (!ENGINE.playing()) backToConsole(); }, 2200);
      },
    });
  }

  function backToConsole(){
    ENGINE.stop();
    consoleEl.classList.remove('away');
    const homeReel = $('home-reel');
    if (homeReel) homeReel.play().catch(() => {});
    showbar.hidden = true;
    waypointsEl.hidden = true;
    subtitleEl.classList.remove('on');
  }

  /* ── wiring ── */
  form.addEventListener('submit', (e) => { e.preventDefault(); launch(scenarioEl.value); });
  scenarioEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); launch(scenarioEl.value); }
  });

  document.querySelectorAll('.chip:not(.surprise)').forEach((c) =>
    c.addEventListener('click', () => { scenarioEl.value = c.textContent; launch(c.textContent); }));

  $('surprise').addEventListener('click', () => {
    const pick = COMPILER.SURPRISES[Math.floor(Math.random() * COMPILER.SURPRISES.length)];
    scenarioEl.value = pick;
    launch(pick);
  });

  let paused = false;
  $('pause-btn').addEventListener('click', () => {
    paused = !paused;
    ENGINE.pause(paused);
    $('pause-btn').textContent = paused ? '▶' : '⏸';
  });
  $('replay-btn').addEventListener('click', () => { paused = false; $('pause-btn').textContent = '⏸'; launch(currentScenario); });
  $('new-btn').addEventListener('click', backToConsole);

  /* ── boot ── */
  ENGINE.boot();

  const shared = decodeURIComponent((location.hash || '').slice(1)).trim();
  if (shared){
    scenarioEl.value = shared;
    setTimeout(() => launch(shared), 900);
  }
})();
