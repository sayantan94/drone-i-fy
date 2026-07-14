import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FRAME_MS = 16.7;
const MAX_SPEED = 0.16;

function seededRandom(initial){
  let seed = initial >>> 0;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

async function loadRuntime(){
  const [shapes, engine] = await Promise.all([
    readFile(new URL('../js/shapes.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/engine.js', import.meta.url), 'utf8'),
  ]);
  const pending = [];
  let drones = [];
  let stageNow = 0;

  globalThis.window = { innerWidth: 1440, innerHeight: 900, addEventListener(){} };
  globalThis.document = {
    getElementById(){ return {}; },
    createElement(){ return { getContext(){ return {}; } }; },
  };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = callback => {
    pending.push(callback);
    return pending.length;
  };
  globalThis.STAGE = {
    init(){},
    frame(state){ drones = state.drones; stageNow = state.now; },
  };
  globalThis.AUDIO = { hum(){}, whoosh(){}, popFar(){} };

  // These browser scripts intentionally expose globals rather than modules.
  globalThis.eval(`${shapes}\n${engine}\nglobalThis.__testEngine = ENGINE; globalThis.__testShapes = SHAPES;`);
  return { engine: globalThis.__testEngine, shapes: globalThis.__testShapes, pending, getDrones: () => drones, getStageNow: () => stageNow };
}

const characterArt = [
  { mode: 'fill', pts: [[38, 12], [62, 12], [66, 28], [58, 36], [42, 36], [34, 28]], color: '#ffcf5e', depth: 12 },
  { mode: 'fill', pts: [[34, 36], [66, 36], [70, 65], [30, 65]], color: '#d03028', depth: 18 },
  { mode: 'fill', pts: [[30, 40], [14, 58], [20, 64], [38, 52]], color: '#f05a45', depth: 8, lift: 3 },
  { mode: 'fill', pts: [[62, 42], [78, 22], [84, 27], [68, 54]], color: '#f05a45', depth: 8, lift: 3 },
  { mode: 'fill', pts: [[34, 65], [47, 65], [45, 96], [34, 96]], color: '#8e4b57', depth: 8 },
  { mode: 'fill', pts: [[53, 65], [66, 65], [67, 96], [55, 96]], color: '#8e4b57', depth: 8 },
  { mode: 'stroke', pts: [[82, 28], [96, 4]], color: '#eef4ff', depth: 2, lift: 8 },
];

test('3D characters stay attached through motion and effects without exceeding max speed', async () => {
  const originalRandom = Math.random;
  Math.random = seededRandom(0xdecafbad);

  try {
    const runtime = await loadRuntime();
    const fullFill = runtime.shapes.fromArt([{
      mode: 'fill', pts: [[0, 0], [100, 0], [100, 100], [0, 100]], color: '#ff4560',
    }]);
    assert.ok(Math.min(...fullFill.map(p => p.y)) < -.85 && Math.max(...fullFill.map(p => p.y)) > .85,
      'filled art must cover the complete polygon instead of truncating its lower rows');
    assert.ok(fullFill.some(p => p.contour && p.si >= 0) && fullFill.some(p => !p.contour),
      'filled art must combine a connected perimeter with interior stations');
    const acts = [
      {
        caption: 'character travel', duration: 5000, enter: 'swirl', fx: 'pyro',
        groups: [
          { shape: 'sphere', fill: 'solid', at: [0, 0], scale: 1.15, color: '#b91c1c', motion: [] },
          {
            shape: 'custom', art: characterArt, at: [-0.35, 0.05], scale: 0.9,
            color: 'sampled', motion: [{ type: 'travel', to: [0.35, 0.05] }],
          },
        ],
      },
      {
        caption: 'character orbit', duration: 5000, enter: 'drift', fx: 'fireworks',
        groups: [
          {
            shape: 'custom', art: characterArt, at: [0, 0.05], scale: 0.9,
            color: 'sampled', motion: [{ type: 'orbit', speed: 0.7 }],
          },
          { shape: 'sphere', fill: 'solid', at: [0, 0], scale: 1.15, color: '#b91c1c', motion: [] },
        ],
      },
    ];

    let now = 0;
    let peakSpeed = 0;
    runtime.engine.boot();
    for (let frame = 0; frame < 180; frame++){
      now += FRAME_MS;
      const callbacks = runtime.pending.splice(0);
      callbacks.forEach(callback => callback(now));
      runtime.getDrones().forEach(drone => {
        peakSpeed = Math.max(peakSpeed, Math.hypot(drone.vx, drone.vy, drone.vz || 0));
      });
    }
    const scouts = runtime.getDrones().filter(drone => drone.gi === -2);
    assert.ok(scouts.length > 0, 'idle mode should launch scout drones');
    assert.ok(scouts.every(drone => !drone.grounded), 'scouts must fly rather than teleport as grounded drones');

    runtime.engine.play(acts, {});

    let previousAct = -1;
    let actStartedAt = 0;
    let pauseChecked = false;
    const metrics = new Map();
    const edgeIds = new Map();
    const partIds = new Map();

    for (let guard = 0; guard < 5000; guard++){
      now += FRAME_MS;
      const callbacks = runtime.pending.splice(0);
      callbacks.forEach(callback => callback(now));

      const state = runtime.engine._state();
      if (state.idx !== previousAct){
        previousAct = state.idx;
        actStartedAt = now;
      }

      const drones = runtime.getDrones();
      drones.forEach(drone => {
        peakSpeed = Math.max(peakSpeed, Math.hypot(drone.vx, drone.vy, drone.vz || 0));
      });

      if ((state.idx === 1 || state.idx === 2) && state.formed){
        const assigned = drones.filter(drone => drone.gi >= 0);
        let metric = metrics.get(state.idx);
        if (!metric){
          metric = { formedIn: now - actStartedAt, assigned: assigned.length, minLocked: assigned.length, maxError: 0, maxLockedError: 0 };
          metrics.set(state.idx, metric);
          const figure = assigned.filter(drone => drone.part >= 0);
          assert.ok(figure.length >= 430,
            'a featured character must retain enough of the fleet to read over its backdrop');
          assert.ok(Math.max(...figure.map(drone => drone.tz)) - Math.min(...figure.map(drone => drone.tz)) < .18,
            'a featured character must stay shallow enough to preserve a sharp audience silhouette');
        }
        metric.minLocked = Math.min(metric.minLocked, assigned.filter(drone => drone.locked).length);
        metric.maxError = Math.max(metric.maxError, ...assigned.map(drone => drone.lastDist));
        metric.maxLockedError = Math.max(metric.maxLockedError, ...assigned.filter(drone => drone.locked).map(drone => drone.lastDist));
        assert.ok(assigned.filter(drone => drone.locked).every(drone => drone.color === drone.tcolor), 'locked stations must hold their exact LED color');
        if (state.idx === 1){
          const edgeDrones = assigned.filter(drone => drone.edge);
          assert.ok(edgeDrones.length >= 8, 'thin character props need enough drones to stay legible');
          assert.ok(edgeDrones.every(drone => drone.locked), 'every thin prop station must lock before the act starts');
          assert.ok(edgeDrones.every(drone => /^#[0-9a-f]{6}$/i.test(drone.color)), 'edge LEDs must always have a valid visible color');
        }
        if (!edgeIds.has(state.idx)) edgeIds.set(state.idx, new Set(assigned.filter(drone => drone.edge).map(drone => drone.id)));
        if (!partIds.has(state.idx)){
          const ids = new Map();
          assigned.forEach(drone => {
            if (drone.part < 0) return;
            if (!ids.has(drone.part)) ids.set(drone.part, new Set());
            ids.get(drone.part).add(drone.id);
          });
          partIds.set(state.idx, ids);
        }

        if (state.idx === 1 && !pauseChecked){
          const simBefore = runtime.getStageNow();
          const positionsBefore = assigned.map(d => [d.x, d.y, d.z]);
          runtime.engine.pause(true);
          for (let pausedFrame = 0; pausedFrame < 240; pausedFrame++){
            now += FRAME_MS;
            const pausedCallbacks = runtime.pending.splice(0);
            pausedCallbacks.forEach(callback => callback(now));
          }
          assert.equal(runtime.getStageNow(), simBefore, 'pause must freeze the show clock');
          assigned.forEach((d, i) => {
            assert.deepEqual([d.x, d.y, d.z], positionsBefore[i], 'pause must freeze formation positions');
          });
          assert.equal(runtime.engine._state().idx, 1, 'a paused act must not be skipped');
          runtime.engine.pause(false);
          pauseChecked = true;
        }
      }

      if (state.mode === 'ground' && now > 3000) break;
    }

    assert.equal(runtime.engine._state().mode, 'ground', 'the full show should finish and land');
    assert.ok(pauseChecked, 'pause/resume regression should run during a formed act');
    assert.ok(peakSpeed <= MAX_SPEED + 1e-9, `peak speed ${peakSpeed} exceeded ${MAX_SPEED}`);
    assert.equal(metrics.size, 2, 'both character acts should form');
    for (const [act, metric] of metrics){
      assert.ok(metric.formedIn < 15000, `act ${act} only formed at the patience cap`);
      assert.ok(metric.minLocked / metric.assigned >= 0.96, `act ${act} lost its station locks`);
      assert.ok(metric.maxError < 6, `act ${act} detached by ${metric.maxError.toFixed(2)}px`);
      assert.equal(metric.maxLockedError, 0, `act ${act} let a locked drone drift off station`);
    }
    const firstEdges = edgeIds.get(1), secondEdges = edgeIds.get(2);
    const retainedEdges = [...firstEdges].filter(id => secondEdges.has(id)).length;
    assert.ok(retainedEdges / firstEdges.size >= .8, 'thin props should retain their aircraft identity between keyframes');
    const firstParts = partIds.get(1), secondParts = partIds.get(2);
    firstParts.forEach((ids, part) => {
      const next = secondParts.get(part) || new Set();
      const retained = [...ids].filter(id => next.has(id)).length;
      assert.ok(retained / ids.size >= .72, `body part ${part} dissolved into unrelated aircraft`);
    });
  } finally {
    Math.random = originalRandom;
    delete globalThis.__testEngine;
    delete globalThis.__testShapes;
  }
});
