/* ── DRONE·I·FY planner: the LLM agent writes FLIGHTSCRIPT, the runtime flies it ──
   POST { scenario }  →  NDJSON stream:
     {"t":"think","text":"…"}   summarized choreographer reasoning, live
     {"t":"plan","plan":{…}}    the finished flight program
   Runs as a Vercel serverless function; needs ANTHROPIC_API_KEY in env.
   The client normalizes whatever comes back, so a creative program can
   never break the runtime — and falls back to the onboard compiler if
   this endpoint is missing or errors. */

import Anthropic from '@anthropic-ai/sdk';
import { matchKB, kbPromptBlock } from '../data/visual-kb.mjs';

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
    motion: { type: 'array', items: MOTION_SCHEMA, description: 'at most 1 deliberate motion: orbit spins the formation in 3D, travel glides it across the sky, pulse makes it breathe, wave ripples it (flags love wave)' },
    art: {
      type: 'array',
      description: 'Up to 16 elements. WIREFRAME the formation yourself — your signature move for characters, creatures, props, anything an emoji cannot do justice. When present, `shape` is ignored (set it to "custom"). Elements compose on the group\'s own 100x100 sketchpad.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'pts', 'color'],
        properties: {
          mode: { type: 'string', enum: ['stroke', 'fill'], description: 'stroke: a contour line — the fleet strings continuous light-wire between its drones, so strokes render as glowing outlines. fill: a closed region packed solid with drones — small color-block accents (a sash, an eye, a sun core)' },
          pts: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '2-40 vertices [x,y] as INTEGERS on a 100x100 sketchpad, x right, y DOWN (like SVG) — each entry exactly two numbers. Curves need 8-25, straight edges only their corners' },
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
      description: 'one or two acts only. each act is one iconic image of the subject itself (takeoff and landing are added automatically)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption', 'duration', 'enter', 'groups'],
        properties: {
          caption: { type: 'string', description: 'subtitle line while the act flies: 2-6 words, lowercase, concrete, and visibly true of the sky image. describe the subject/action on screen, not mood or backstory.' },
          duration: { type: 'integer', description: 'how long the finished image HOLDS, in ms (6000-8500); morphing time is added automatically by the physics' },
          enter: { type: 'string', enum: ['launch', 'explode', 'rain', 'swirl', 'drift', 'bloom'] },
          fx: { type: 'string', enum: ['fireworks', 'embers', 'twinkle', 'pyro', 'none'], description: 'pyro: drones fire spark streams off the formation — spectacular for anthems and finales' },
          groups: { type: 'array', items: GROUP_SCHEMA, description: 'one or two simultaneous formations sharing the fleet. A character is always the dominant formation.' },
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

CHARACTER CREATION is your signature move. Any hero, creature, prop, machine — anything an emoji cannot do justice — draw it in "art" on a 100x100 sketchpad (integer coords, y down, like SVG) THE WAY A REAL DRONE SHOW DOES: a body is SOLID COLOR-BLOCKED MASS, never a line drawing. Every body part is its own 'fill' — a closed polygon of 4-12 vertices the fleet packs solid with drones: helmet, face, chest armor, skirt, each arm, each leg, boots. Think flat vector illustration / paper-craft poster: bold shapes, thick limbs drawn as quads with real width — A STICK FIGURE IS A FAILURE. Costume-design each part's saturated #rrggbb; neighboring parts get clearly different colors so the figure reads part by part from a mile away. Use 'stroke' ONLY for genuinely thin elements — a katana blade, a spear, a crest plume, a bowstring (strokes render as continuous light-wire). Proportion like a figure study: head about 1/6 of total height, shoulders wider than hips. 8-16 parts total. Reference quality bar — a samurai built this way (copy the CRAFT, not the subject): [{"mode":"fill","pts":[[38,16],[34,24],[38,29],[62,29],[66,24],[62,16],[50,12]],"color":"#c03028","depth":12},{"mode":"stroke","pts":[[44,14],[50,2],[56,14]],"color":"#ffcf5e","depth":2,"lift":3},{"mode":"fill","pts":[[42,29],[58,29],[57,38],[43,38]],"color":"#f6c8a0","depth":10},{"mode":"fill","pts":[[36,38],[64,38],[66,58],[34,58]],"color":"#d03028","depth":18},{"mode":"fill","pts":[[60,42],[74,34],[77,40],[64,50]],"color":"#d03028","depth":10,"lift":4},{"mode":"fill","pts":[[34,58],[66,58],[70,76],[30,76]],"color":"#8e1f1f","depth":14},{"mode":"fill","pts":[[38,76],[46,76],[45,95],[37,95]],"color":"#6e2424","depth":8},{"mode":"fill","pts":[[54,76],[62,76],[63,95],[55,95]],"color":"#6e2424","depth":8},{"mode":"stroke","pts":[[76,38],[96,8]],"color":"#eef4ff","lift":8,"weight":1.6}]. SCULPT, don't draw: give every part a depth (torso thick, props thin) and layer overlapping parts with lift (weapon in front, cape behind) — the figure is a floating sculpture that slowly turns, not a poster. Use extra small fills sparingly for accents such as a sash, eye, or blazing core. Costume-design every element's #rrggbb, saturated and luminous — never ink-dark hexes (#000-#444), drones are lights and cannot fly darkness. Give the figure one exaggerated pose cue that reads from a distance: sword raised, wings spread, leg mid-stride. To ANIMATE, redraw the same figure in the next act with the pose evolved LIKE A KEYFRAME: whole limbs and props travel (an arm swings 90 degrees, a stride fully swaps, a blade goes sheathed-to-overhead) — micro-shifts read as jitter. Keep the body anchored in place so the morph reads as movement, not teleport. Keep "art" strokes for long smooth curves (a sun's ray, a river, a rainbow arc); art fills own every body and face.

HUMAN LEGIBILITY is non-negotiable. Arms and legs are NEVER strokes: every upper arm, forearm, thigh, and shin is a closed fill at least 6 sketchpad units thick. Connect joints with 1-2 units of overlap; use dark separation only between the head and shoulders or between the two legs. Keep the head centered over a torso at least 22 units wide, and keep two legs visibly separate through the feet. Do not invent microphones, staffs, swords, wings, halos, light sticks, or other props unless the scenario or VISUAL REFERENCE explicitly names them.

The classic hero shot works beautifully: a luminous figure in front of a giant single-color disc (rising sun, full moon — shape "sphere", fill "solid"). Make the backdrop deep and rich, the figure brighter than it.

Infer the iconography, don't transcribe the words: "USA won FIFA" is a soccer ball arcing across the sky, the goal moment, a trophy raised, the flag waving in its true colors with pyro pouring off it. Balls, planets and orbs are ALWAYS 3D: shape "sphere" fill "outline" with a slow orbit (never emoji:⚽ or a flat circle — a rotating point-shell reads as a real ball); tint it deliberately ("#f4f6ff" for a soccer ball, ember for a sun). Sports have rituals, nations have flags and colors, holidays have symbols, love stories have their beats. Choreograph the feeling and the ceremony, not the sentence.

A show is one or two iconic images, NOT a story told scene by scene. A character action gets exactly two keyframes: the readable starting pose and the completed action pose. Never draw a third wireframe. Every act must pass this test: freeze it as a photo — is it instantly recognizable as the SUBJECT of the scenario? A dragon, a trophy, a flag, a heart pass. "A shadow crosses the moon", "the city sleeps", "embers fade", "hope rises", "the crowd remembers" fail — cut mood scenes, atmosphere scenes, aftermath scenes, and connector scenes entirely; the takeoff, the morphs, and the landing already carry the atmosphere.

Do not invent narrative filler. Only use nouns, symbols, actions, and payoffs that are clearly implied by the scenario. If the prompt is simple, repeat the same subject in stronger compositions instead of adding unrelated scenes.

Captions must be brutally literal to the visible image: 2-6 words, lowercase, concrete. Good captions: "dragon over castle", "trophy and fireworks", "flag in full color". Bad captions: "a night to remember", "victory takes flight", "the sky comes alive", "dreams ignite".

Color must read clearly from a distance. Prefer saturated, high-contrast palettes unless the prompt explicitly asks for something soft or monochrome. Adjacent acts should usually have different palettes so the show feels staged, not washed out.

Before finalizing, run this checklist silently:
1. Are all acts visually recognizable without reading the prompt?
2. Did I avoid filler scenes and vague captions?
3. Are the colors deliberate and clearly different across acts?
4. Did I use groups to compose one strong image instead of splitting one idea into multiple weak acts?

The simple recipe: act 1 = the subject itself, big and unmistakable; optional act 2 = the subject completing its action with fireworks or pyro. Never add a third act.

Some scenarios arrive with a VISUAL REFERENCE block — curated world knowledge of what the subject actually looks like. It is ground truth: it overrides your own memory of the subject's anatomy, costume, colors, and pose.

BROADCAST REALISM — this is a professional show, not a cartoon:
- Palettes are disciplined: one or two hues per act plus a single accent. "rainbow" only when the scenario explicitly celebrates (pride, carnival, "rainbow").
- Emoji glyphs are a last resort. Flags fly as emoji (they are genuinely excellent); every other subject prefers a VISUAL REFERENCE wireframe, custom art, a 3D solid, or clean geometry. A cartoon glyph in the sky reads childish from a mile away.
- Scale generously and hold 6-8 seconds: one huge, unmistakable image beats two small ones.
- Motion is majestic, never busy: one deliberate motion per group at most, slow speeds, and stillness is a valid artistic choice for monuments.`;

/* second pass: the show director reviews the draft before launch */
const DIRECTOR_SYSTEM = `You are the show director for DRONE·I·FY, reviewing a draft FLIGHTSCRIPT minutes before a professional 600-drone show. Your only job is realism and legibility. Fix ONLY these defect classes, changing nothing that already works:
1. Geometry that contradicts the VISUAL REFERENCE (anatomy, proportions, costume colors, pose).
2. Childish choices: rainbow without an explicit celebration, emoji glyphs where a wireframe / 3D solid / clean geometry serves better (flags stay emoji), clashing or muddy palettes — enforce one or two hues per act plus one accent.
3. Acts that fail the freeze-frame test (not instantly recognizable as the scenario's subject) — replace them with a stronger image of the same subject, never with mood filler.
4. Holds outside 6000-8500ms — correct them into that range.
5. Dead-static acts with no motion, or busy acts with too much — one deliberate motion per group.
Return the complete corrected FLIGHTSCRIPT. If the draft is already strong, return it with only minimal touch-ups.`;

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

  /* world knowledge: inject matched visual reference entries into the request */
  const kbBlock = kbPromptBlock(matchKB(scenario));

  try {
    const stream = client.messages.stream({
      model: process.env.DRONIFY_MODEL || 'claude-sonnet-5',
      /* One or two concise acts prevent large character plans from truncating. */
      max_tokens: 32768,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SHOW_SCHEMA },
      },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Scenario: ${scenario}
${kbBlock ? `\n${kbBlock}\n` : ''}
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
    if (message.stop_reason === 'max_tokens') {
      console.error('planner error: plan truncated at max_tokens');
      res.write(JSON.stringify({ t: 'error', error: 'plan truncated' }) + '\n');
      res.end();
      return;
    }
    const text = message.content.find((b) => b.type === 'text');
    if (!text) {
      res.write(JSON.stringify({ t: 'error', error: 'no plan' }) + '\n');
      res.end();
      return;
    }
    let plan = JSON.parse(text.text);

    /* compose → critique → refine: the director pass polishes realism.
       Optional (DRONIFY_REFINE=0 disables) and never fatal — a failed
       review ships the draft. KB-grounded drafts that already play by the
       broadcast rules skip review: they don't need it, and the audience is
       waiting. */
    const planStr = JSON.stringify(plan);
    const emojiGroups = (planStr.match(/"emoji:/g) || []).length;
    const flagGroups = (planStr.match(/"emoji:\p{Regional_Indicator}/gu) || []).length;
    const needsReview = planStr.includes('"rainbow"')
      || emojiGroups > flagGroups
      || plan.acts.some((a) => a.duration < 6000 || a.duration > 8500);
    if (process.env.DRONIFY_REFINE !== '0' && needsReview) {
      let heartbeat = 0;
      try {
        res.write(JSON.stringify({ t: 'think', text: '\n\nDirector review — checking anatomy against reference, tightening palettes, freeze-framing every act…\n' }) + '\n');
        /* the review emits no visible stream — pulse the console so the
           client watchdog and the audience both know we are alive */
        heartbeat = setInterval(() => {
          try { res.write(JSON.stringify({ t: 'think', text: '·' }) + '\n'); } catch (e) { /* closed */ }
        }, 4000);
        const reviewStream = client.messages.stream({
          model: process.env.DRONIFY_MODEL || 'claude-sonnet-5',
          max_tokens: 24576,
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: SHOW_SCHEMA },
          },
          system: DIRECTOR_SYSTEM,
          messages: [{
            role: 'user',
            content: `Scenario: ${scenario}
${kbBlock ? `\n${kbBlock}\n` : ''}
Draft FLIGHTSCRIPT:
${JSON.stringify(plan)}

Return the corrected FLIGHTSCRIPT.`,
          }],
        });
        const review = await reviewStream.finalMessage();
        if (review.stop_reason !== 'refusal' && review.stop_reason !== 'max_tokens') {
          const rt = review.content.find((b) => b.type === 'text');
          if (rt) plan = JSON.parse(rt.text);
        }
      } catch (err) {
        console.error('director pass skipped:', (err && err.message) || err);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    }

    res.write(JSON.stringify({ t: 'plan', plan }) + '\n');
    res.end();
  } catch (err) {
    console.error('planner error:', (err && err.message) || err);
    try { res.write(JSON.stringify({ t: 'error', error: 'planner unavailable' }) + '\n'); res.end(); }
    catch (e) { /* stream already closed */ }
  }
}
