/* ── DRONE·I·FY planner: Claude writes FLIGHTSCRIPT, the runtime flies it ──
   POST { scenario }  →  NDJSON stream:
     {"t":"think","text":"…"}   summarized choreographer reasoning, live
     {"t":"plan","plan":{…}}    the finished flight program
   Runs as a Vercel serverless function; needs ANTHROPIC_API_KEY in env.
   The client normalizes whatever comes back, so a creative program can
   never break the runtime — and falls back to the onboard compiler if
   this endpoint is missing or errors. */

import Anthropic from '@anthropic-ai/sdk';

const MOTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['orbit', 'travel', 'pulse', 'wave'] },
    speed: { type: 'number', description: 'orbit only: 0.2 slow — 3 fast, default 1' },
    amp: { type: 'number', description: 'pulse: 0.03-0.16 breath depth. wave: ripple height, ~10' },
    to: { type: 'array', items: { type: 'number' }, description: 'travel only: destination [x,y] in sky units' },
  },
};

const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shape', 'at', 'scale', 'color', 'fill'],
  properties: {
    shape: { type: 'string', description: '"emoji:X" with exactly one emoji — bold silhouettes and flags (emoji:🇺🇸) fly best — or a geometric: heart, ring, star, spiral, burst, swarm, crescent, wavefield, comet — or a 3D solid: sphere, torus, cube, pyramid, cone, helix (solids rotate through depth automatically). NEVER text or letters — the sky speaks only in shapes.' },
    fill: { type: 'string', enum: ['outline', 'solid'], description: 'outline: sharp edge-drawn icon (best for most shapes). solid: dense pixel-lattice where every drone is a pixel of the image — THE look for flags, faces, and detailed pictures.' },
    at: { type: 'array', items: { type: 'number' }, description: 'formation center [x,y], sky units -1..1 (0,0 = center, y up)' },
    scale: { type: 'number', description: '0.2 small — 1.4 fills the sky. Use ~0.55 each when composing two groups' },
    rotate: { type: 'number', description: 'tilt in degrees, -180..180' },
    color: { type: 'string', description: 'YOU own the palette — choose deliberately per group: "sampled" (the emoji\'s true colors — best for emoji and flags), "#rrggbb" tint, "gradient:#a:#b" (bottom to top), or "rainbow" (celebrations only)' },
    weight: { type: 'number', description: 'share of the fleet this group gets, relative to siblings, default 1' },
    motion: { type: 'array', items: MOTION_SCHEMA, description: 'up to 2: orbit spins the formation in 3D, travel glides it across the sky, pulse makes it breathe, wave ripples it (flags love wave)' },
    art: {
      type: 'array',
      description: 'Up to 16 elements. WIREFRAME the formation yourself — your signature move for characters, creatures, props, anything an emoji cannot do justice. When present, `shape` is ignored (set it to "custom"). Elements compose on the group\'s own 100x100 sketchpad.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'pts', 'color'],
        properties: {
          mode: { type: 'string', enum: ['stroke', 'fill'], description: 'stroke: a contour line — the fleet strings continuous light-wire between its drones, so strokes render as glowing outlines. fill: a closed region packed solid with drones — small color-block accents (a sash, an eye, a sun core)' },
          pts: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'vertices [x,y] as INTEGERS on a 100x100 sketchpad, x right, y DOWN (like SVG) — each entry exactly two numbers. 2-40 points per element: curves need 8-25, straight edges only their corners' },
          color: { type: 'string', description: '#rrggbb for THIS element — costume-design every part (armor crimson, blade ice-white, crest gold)' },
          close: { type: 'boolean', description: 'stroke only: close the loop (helmet outline, eye, wheel)' },
          weight: { type: 'number', description: 'relative drone share for this element, default 1 — raise it for the part that must read first' },
          depth: { type: 'number', description: 'THE SHOW IS 3D — thickness of this part front-to-back, 0-30 sketchpad units: torso 16-22, head 10-14, limbs 6-10, thin props 0-4. The fleet fills the volume and the figure slowly turns to show it' },
          lift: { type: 'number', description: 'layer: + pushes this part toward the audience, - behind (-20..20). A katana in front of the chest: lift 8. A cape: lift -8. Solves overlaps: separate layers never visually tangle' },
        },
      },
    },
  },
};

const SHOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'acts'],
  properties: {
    title: { type: 'string', description: 'short poetic show title' },
    acts: {
      type: 'array',
      description: 'prefer 2 or 3 acts; use 4 only when the prompt truly has two distinct visual beats plus a payoff. each act is one iconic image of the subject itself (takeoff and landing are added automatically)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption', 'duration', 'enter', 'groups'],
        properties: {
          caption: { type: 'string', description: 'subtitle line while the act flies: 2-6 words, lowercase, concrete, and visibly true of the sky image. describe the subject/action on screen, not mood or backstory.' },
          duration: { type: 'integer', description: 'how long the finished image HOLDS, in ms (5000-14000) — morphing time is added automatically by the physics' },
          enter: { type: 'string', enum: ['launch', 'explode', 'rain', 'swirl', 'drift', 'bloom'] },
          fx: { type: 'string', enum: ['fireworks', 'embers', 'twinkle', 'pyro', 'none'], description: 'pyro: drones fire spark streams off the formation — spectacular for anthems and finales' },
          groups: { type: 'array', items: GROUP_SCHEMA, description: '1-3 simultaneous formations sharing the fleet. prefer 1 or 2; use 3 only when composition truly needs it.' },
        },
      },
    },
  },
};

const SYSTEM = `You are the choreographer for DRONE·I·FY. You write FLIGHTSCRIPT — a flight program that a fleet of 600 real-physics show drones performs over a night city. The runtime handles takeoff from the launch pad and the final landing; you choreograph what happens in the sky between them. Drones morph slowly and majestically between formations, and each act's image fully forms before it holds and moves.

Never text or letters in the sky; if the scenario asks to spell something, translate the feeling into shapes (LOVE becomes a heart, a name becomes its owner's silhouette).

You own every color. Choose the palette act by act like a lighting designer: emoji and flags fly in their true colors ("sampled"), geometric shapes want a deliberate tint or gradient that serves the mood, rainbow is for pure celebration. Contrast between acts is part of the drama — an ice-white moon act hits harder after a fire-orange one.

Every act should feel alive while it holds. Usually at least one group should visibly orbit, travel, wave, or breathe; avoid dead-static tableaux unless the subject absolutely demands stillness.

The "enter" field is choreography, not metadata: explode means the image bursts outward into place, rain means it resolves top-down like falling lights, bloom means center-out, swirl means a spiral arrival, drift means a graceful glide, launch means an upward charge.

Bloom is an arrival style only. It is NOT permission to invent floral imagery. Do not substitute roses, flowers, petals, blossoms, or bouquets unless the scenario explicitly asks for floral subjects.

Composition is your superpower — acts hold up to 3 simultaneous groups in sky units:
- "a dragon over a castle": castle at [0,-0.35] scale 0.6, dragon at [0,0.4] scale 0.6 with travel across
- "a rocket through a ring": ring at [0,0.1] scale 0.8 rotate 12, rocket at [0,-0.6] scale 0.45 with travel to [0,0.65]
- "an eagle carrying the flag": eagle outline at [0,0.35] scale 0.7, flag emoji:🇺🇸 fill solid at [0,-0.3] scale 0.55 with wave
Flags, faces, and detailed pictures fly as fill:"solid" — a dense pixel lattice where every drone paints one pixel (color "sampled"). Icons fly as fill:"outline" — sharp edge-drawn silhouettes. 3D solids (sphere, torus, cube, pyramid, cone, helix) rotate through depth and look spectacular.

Common subject cheat-sheet:
- soccer / football ball / fifa: a 3D sphere shell, ice-white or true ball colors, slow orbit; never a flat emoji ball
- dragon: custom art sculpture, not emoji — broad wings, long tail, horned head, one big pose cue, fire or ember accent
- logos / brands: never wordmarks or letters. Fly the emblem only, simplified into 1-3 shapes or custom art
- OpenAI: emblem only — an interlocking knot / six-loop knotwork form, geometric and sculptural, not the word
- Claude: emblem only — a warm amber abstract mark / radiant burst / chat-shaped icon, not letters
- top brand logos in general: use the iconic mark people recognize first; if the mark depends on text, translate it into a symbolic composition instead
- romance / love prompts: prefer hearts, rings, moons, paired figures, fireworks. Use flowers only when the user explicitly asks for flowers or roses

CHARACTER CREATION is your signature move. Any hero, creature, prop, machine — anything an emoji cannot do justice — draw it in "art" on a 100x100 sketchpad (integer coords, y down, like SVG) THE WAY A REAL DRONE SHOW DOES: a body is SOLID COLOR-BLOCKED MASS, never a line drawing. Every body part is its own 'fill' — a closed polygon of 4-12 vertices the fleet packs solid with drones: helmet, face, chest armor, skirt, each arm, each leg, boots. Think flat vector illustration / paper-craft poster: bold shapes, thick limbs drawn as quads with real width — A STICK FIGURE IS A FAILURE. Costume-design each part's saturated #rrggbb; neighboring parts get clearly different colors so the figure reads part by part from a mile away. Use 'stroke' ONLY for genuinely thin elements — a katana blade, a spear, a crest plume, a bowstring (strokes render as continuous light-wire). Proportion like a figure study: head about 1/6 of total height, shoulders wider than hips. 8-16 parts total. SCULPT, don't draw: give every part a depth (torso thick, props thin) and layer overlapping parts with lift (weapon in front, cape behind) — the figure is a floating sculpture that slowly turns, not a poster. Use fills sparingly as color-block accents (a sash, an eye, a blazing core). Costume-design every element's #rrggbb, saturated and luminous — never ink-dark hexes (#000-#444), drones are lights and cannot fly darkness. Give the figure one exaggerated pose cue that reads from a distance: sword raised, wings spread, leg mid-stride. To ANIMATE, redraw the same figure in the next act with the pose evolved LIKE A KEYFRAME: whole limbs and props travel (an arm swings 90 degrees, a stride fully swaps, a blade goes sheathed-to-overhead) — micro-shifts read as jitter. Keep the body anchored in place so the morph reads as movement, not teleport. Keep "art" strokes for long smooth curves (a sun's ray, a river, a rainbow arc) and art fills for big geometric color blocks; ascii owns every body and face.

The classic hero shot works beautifully: a luminous figure in front of a giant single-color disc (rising sun, full moon — shape "sphere", fill "solid"). Make the backdrop deep and rich, the figure brighter than it.

Infer the iconography, don't transcribe the words: "USA won FIFA" is a soccer ball arcing across the sky, the goal moment, a trophy raised, the flag waving in its true colors with pyro pouring off it. Balls, planets and orbs are ALWAYS 3D: shape "sphere" fill "outline" with a slow orbit (never emoji:⚽ or a flat circle — a rotating point-shell reads as a real ball); tint it deliberately ("#f4f6ff" for a soccer ball, ember for a sun). Sports have rituals, nations have flags and colors, holidays have symbols, love stories have their beats. Choreograph the feeling and the ceremony, not the sentence.

A show is 2 or 3 iconic images by default, NOT a story told scene by scene. Use 4 acts only when the prompt clearly demands an extra visual beat. Every act must pass this test: freeze it as a photo — is it instantly recognizable as the SUBJECT of the scenario? A dragon, a trophy, a flag, a heart pass. "A shadow crosses the moon", "the city sleeps", "embers fade", "hope rises", "the crowd remembers" fail — cut mood scenes, atmosphere scenes, aftermath scenes, and connector scenes entirely; the takeoff, the morphs, and the landing already carry the atmosphere.

Do not invent narrative filler. Only use nouns, symbols, actions, and payoffs that are clearly implied by the scenario. If the prompt is simple, repeat the same subject in stronger compositions instead of adding unrelated scenes.

Captions must be brutally literal to the visible image: 2-6 words, lowercase, concrete. Good captions: "dragon over castle", "trophy and fireworks", "flag in full color". Bad captions: "a night to remember", "victory takes flight", "the sky comes alive", "dreams ignite".

Color must read clearly from a distance. Prefer saturated, high-contrast palettes unless the prompt explicitly asks for something soft or monochrome. Adjacent acts should usually have different palettes so the show feels staged, not washed out.

Before finalizing, run this checklist silently:
1. Are all acts visually recognizable without reading the prompt?
2. Did I avoid filler scenes and vague captions?
3. Are the colors deliberate and clearly different across acts?
4. Did I use groups to compose one strong image instead of splitting one idea into multiple weak acts?

The simple recipe: act 1 = the subject itself, big and unmistakable; middle act (optional) = the subject in action; final act = the payoff image with fireworks or pyro. Hold each image long.`;

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const scenario = String((req.body && req.body.scenario) || '').slice(0, 420).trim();
  if (!scenario) {
    res.status(400).json({ error: 'missing scenario' });
    return;
  }

  res.setHeader('content-type', 'application/x-ndjson');
  res.setHeader('cache-control', 'no-store');

  try {
    const stream = client.messages.stream({
      model: process.env.DRONIFY_MODEL || 'claude-sonnet-5',
      max_tokens: 16384,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SHOW_SCHEMA },
      },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Scenario: ${scenario}

Return one tight drone show plan. Keep it iconic, literal, and visually coherent.`,
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta' && event.delta.thinking) {
        res.write(JSON.stringify({ t: 'think', text: event.delta.thinking }) + '\n');
      }
    }

    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      res.write(JSON.stringify({ t: 'error', error: 'refused' }) + '\n');
      res.end();
      return;
    }
    const text = message.content.find((b) => b.type === 'text');
    if (!text) {
      res.write(JSON.stringify({ t: 'error', error: 'no plan' }) + '\n');
      res.end();
      return;
    }
    res.write(JSON.stringify({ t: 'plan', plan: JSON.parse(text.text) }) + '\n');
    res.end();
  } catch (err) {
    console.error('planner error:', (err && err.message) || err);
    try { res.write(JSON.stringify({ t: 'error', error: 'planner unavailable' }) + '\n'); res.end(); }
    catch (e) { /* stream already closed */ }
  }
}
