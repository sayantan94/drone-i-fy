---
name: visual-kb
description: >
  Work with the DRONE·I·FY visual knowledge base (data/visual-kb.mjs) — the
  world-knowledge dataset that tells the planner what subjects actually look
  like. Use when adding a new subject (celebrity, character, creature,
  landmark, vehicle, object, emblem), fixing a bad-looking formation, tuning
  keyword matching, or previewing wireframe art. Trigger phrases: "add X to
  the kb", "the X formation looks wrong", "new visual entry", "kb preview".
---

# Visual KB — how it works and how to extend it

`data/visual-kb.mjs` is the single source of world knowledge for the show
planner. `api/plan.js` calls `matchKB(scenario)` and injects the matched
entries into Claude's request as a `VISUAL REFERENCE` block, so the planner
draws subjects from ground truth instead of hallucinating anatomy.

Pipeline: scenario → `matchKB` (keyword scoring) → `kbPromptBlock` (renders
entries) → planner draws `art` polygons → `js/shapes.js fromArt` → drones.

## Entry schema

```js
{
  id: 'freddie-mercury',            // kebab-case, unique
  keys: ['freddie mercury', 'freddie'],  // lowercase match phrases; multi-word
                                          // phrases score higher; plurals auto-match
  kind: 'celebrity',                // celebrity | archetype | character | creature |
                                    // landmark | vehicle | object | emblem
  name: 'Freddie Mercury',
  silhouette: '…',   // ONE sentence: what must be recognizable at 600 drones
  build: '…',        // part-by-part recipe in the planner's art vocabulary
  pose: '…',         // the signature frozen pose
  animate: '…',      // how to keyframe it across acts (whole limbs move, body anchored)
  palette: '…',      // named colors with #rrggbb (luminous — never darker than ~#666)
  flyAs: '…',        // optional: when custom art is wrong, e.g. 'emoji:🐢 outline'
  art: [ … ],        // optional: exact wireframe, ONLY after visual verification
}
```

## The craft rules (what makes entries actually work)

- **People are silhouette + pose + costume + prop.** Never facial detail — a
  face is 4 drones. MJ = fedora + toe-stand; Chaplin = bowler + cane + splayed
  feet. If the person has no distinctive look (e.g. Sam Altman), the
  composition carries them: pair with their emblem/rocket/prop.
- **Bodies are solid color-blocked fills**, 4–12 vertices, never line
  drawings. Strokes only for genuinely thin things (blade, mic stand, tether,
  logo rays). Head ≈ 1/6 of figure height.
- **Sharpness:** neighboring parts get clearly different colors; leave 2–4 pad
  units of air between parts that must read separately. Overlapping same-color
  masses = blob.
- **Art coordinates:** integers on a 100×100 pad, x right, **y DOWN** (SVG
  style). Max 16 elements, 40 points per element. `depth` = front-to-back
  thickness (torso 16-22, props 0-4); `lift` = layer (+ toward audience).
- **Animate = keyframes.** The engine morphs between acts; entries should say
  which whole limbs/props travel (arm swings 90°, stride swaps). Micro-shifts
  read as jitter; keep the body anchored so morphs read as movement.

## Add a new entry

1. Grep `data/visual-kb.mjs` for related ids first — update, don't duplicate.
2. Write the entry (build sheet always; art only if it's a flagship subject).
3. Validate: `node --input-type=module -e "import('./data/visual-kb.mjs').then(m => console.log(m.matchKB('<a scenario mentioning it>').map(e=>e.id)))"`
4. If it has `art`, visually verify (step below) before considering it done.

## Preview / verify wireframe art

```bash
node dev.mjs &   # serves the site + /api/plan on :8124
# all art entries through the REAL fromArt sampling:
open http://127.0.0.1:8124/kb-preview.html
# a single entry, big:
open "http://127.0.0.1:8124/kb-preview.html?only=dragon,horse"
```

Headless screenshot (what CI/agents should do):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --window-size=1300,3400 --virtual-time-budget=6000 \
  --screenshot=/tmp/kb.png "http://127.0.0.1:8124/kb-preview.html"
```

Judge each figure by the freeze test: would a stranger name the subject in
one second? If not, fix geometry — don't ship it. Common failures: parts
tangling (add air / different colors), limbs too thin (draw quads with real
width), figure has no read direction (put everything on one clean diagonal).

## Worked examples

**"messi lifts the world cup"** → matches `lionel-messi` + `world-cup-trophy`;
the planner gets both wireframes and typically flies act 1 = trophy huge,
act 2 = the Messi figure hoisting it, pyro finale.

**"a robot dances under the moon"** → matches `robot`; build sheet tells the
planner to move ONE limb per keyframe in big rigid angles (robot motion), pair
with a crescent/sphere moon group.

**"openai logo over the city"** → matches `openai-logo`; six closed diamond
loops rotated 60° apart, mono-white, slow orbit — never letters.

## Matching notes

`matchKB(text, max=4)` — word-boundary matching on normalized text; a
multi-word key beats a single word (`'world cup trophy'` > `'trophy'`).
If a scenario misses an entry it should hit, add the phrasing to `keys`
(don't loosen the matcher).
