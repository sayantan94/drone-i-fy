/* ── DRONE·I·FY ui: planner → normalizer → FLIGHTSCRIPT runtime ──
   The planner is Claude (/api/plan) when deployed, the onboard compiler
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

  let planner = 'ONBOARD';
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
          duration: num(a.duration, 5000, 16000, 7500),
          enter: ENTERS.includes(a.enter) ? a.enter : 'drift',
          fx: FXS.includes(a.fx) ? a.fx : null,
          groups,
        };
      })
      .filter(Boolean);
    return acts.length ? acts : null;
  }

  /* ── planner: streamed thinking + plan, onboard compiler as fallback ── */
  function showThought(text){
    const el = $('planning-think');
    if (!el || !text.trim()) return;
    thinkBuf = (thinkBuf + text).slice(-600);
    /* show the latest complete-ish fragment, gently */
    const clean = thinkBuf.replace(/\s+/g, ' ').trim();
    el.textContent = clean.slice(-160);
  }
  let thinkBuf = '';

  async function plan(scenario){
    thinkBuf = '';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
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
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines){
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.t === 'think') showThought(msg.text);
              if (msg.t === 'plan') planObj = msg.plan;
            } catch (e) { /* partial line */ }
          }
        }
        clearTimeout(timer);
        /* legacy JSON body (non-streaming deployments) */
        if (!planObj && buf.trim()){
          try { const whole = JSON.parse(buf); planObj = whole.plan || whole; } catch (e) {}
        }
        const acts = normalize(planObj);
        if (acts){ planner = 'CLAUDE'; return acts; }
      }
      clearTimeout(timer);
    } catch (e) { /* offline, local, or slow — fall through to onboard */ }
    planner = 'ONBOARD';
    return normalize(COMPILER.compile(scenario)) || normalize(COMPILER.compile('a sphere of light'));
  }

  /* ── show flow ── */
  async function launch(scenario){
    currentScenario = (scenario || '').trim();
    if (!currentScenario) return;
    AUDIO.begin();
    launchBtn.disabled = true;
    launchBtn.querySelector('.launch-word').textContent = 'PLANNING…';
    const planningEl = $('planning'), reel = $('planning-reel');
    planningEl.hidden = false;
    if (reel){ reel.currentTime = 0; reel.play().catch(() => {}); }

    const acts = await plan(currentScenario);

    planningEl.hidden = true;
    if (reel) reel.pause();
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

  function flash(msg){
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2200);
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
  $('share-btn').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#' + encodeURIComponent(currentScenario);
    try { await navigator.clipboard.writeText(url); flash('SHOW LINK COPIED — SEND IT'); }
    catch (e) { flash(url); }
  });

  /* ── boot ── */
  ENGINE.boot();

  const shared = decodeURIComponent((location.hash || '').slice(1)).trim();
  if (shared){
    scenarioEl.value = shared;
    setTimeout(() => launch(shared), 900);
  }
})();
