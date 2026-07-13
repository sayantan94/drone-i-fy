# Visual Knowledge Base — design

**Problem.** Generated actors look bad because the planner has no world knowledge of
what subjects look like. `api/plan.js` asks Claude to freehand `art` polygons on a
100×100 sketchpad with a single samurai exemplar as its only reference; the offline
compiler maps nouns to emoji. Nothing in the system knows that Freddie Mercury is a
fist to the sky in a yellow jacket, that the World Cup trophy is two figures hoisting
a globe, or that the Eiffel Tower has a first-floor deck and splayed lattice legs.

**Goal.** A curated dataset of visual descriptions — objects, celebrities, characters,
creatures, landmarks, vehicles, emblems — that the planner retrieves per scenario and
uses to build accurate formations.

## Approaches considered

- **A. Prompt-only:** grow the cheat-sheet inside the system prompt. Rejected: bloats
  every request, doesn't scale past ~20 subjects, no per-scenario relevance.
- **B. Retrieval-injected build sheets (chosen):** a dataset file with per-subject
  structured entries; keyword retrieval injects only the matched entries into the
  planner request. Scales to hundreds of subjects at ~zero cost for unmatched prompts.
- **C. Pre-drawn art library only (`lib:` shapes):** guaranteed fidelity but rigid — no
  pose adaptation, no palette re-costuming, and each celeb would need art per pose.

Chosen design is B with C folded in: every entry carries a text *build sheet*; flagship
entries additionally carry exact, visually verified `art` polygons the planner is told
to start from and adapt (pose keyframes, palette) rather than copy blindly.

## Components

**`data/visual-kb.mjs`** — single-source ESM dataset (must NOT live in `api/`, where
Vercel would treat it as a serverless function). Exports:

- `KB`: array of entries
  `{ id, keys[], kind, name, silhouette, build, pose, animate?, palette?, flyAs?, art? }`
  - `keys`: lowercase match words/phrases (multi-word phrases score higher)
  - `kind`: `celebrity | archetype | character | creature | landmark | vehicle | object | emblem`
  - `silhouette`: the one-sentence recognition contract — what must read at 600 drones
  - `build`: part-by-part recipe (proportion boxes on the 100×100 pad, per-part colors,
    depth/lift) written in the planner's own art vocabulary
  - `pose` / `animate`: signature pose + how to keyframe it across acts
  - `flyAs`: shortcut when custom art is the wrong tool (`emoji:X solid`, `sphere`, …)
  - `art`: exact element array in the engine's `art` schema, for flagship subjects
- `matchKB(text, max=4)`: word-boundary keyword scoring → top entries
- `kbPromptBlock(entries)`: renders matched entries as a `VISUAL REFERENCE` text block

**Celebrity rule** baked into every celeb entry: 600 drones cannot fly a facial
likeness — a celebrity is recognized by silhouette, signature pose, costume colors and
prop (MJ = fedora + toe-stand lean; Chaplin = bowler + cane + splayed feet). Entries
describe exactly those cues and never facial detail.

**`api/plan.js` integration** — `matchKB(scenario)`; when non-empty, append
`kbPromptBlock` to the *user message* (keeps the system prompt stable/cacheable), with
instructions: entries with `art` are trusted starting wireframes to adapt; entries
without are authoritative build sheets that override the model's own guess.

**`kb-preview.html`** — dev-only page that renders every `art` entry through the real
`SHAPES.fromArt` pipeline (same point budgets, colors, relaxation) in a grid. Used with
a headless browser to screenshot and iterate until every figure reads. This is the
dataset's test suite.

**`js/compiler.js` fallback** — index.html exposes the KB via a tiny module-script
shim (`window.VISUAL_KB`); when an offline clause matches a KB entry with `art`, the
compiler emits a custom-art group instead of the emoji, so the no-API path stops
producing flat emoji for marquee subjects (dragon, phoenix, trophy…).

## Testing

1. `kb-preview.html` screenshots — every art entry visually verified.
2. `node --input-type=module` smoke test: `matchKB` hits for a battery of scenarios
   (celebs, landmarks, misspell-adjacent phrasings), empty for irrelevant text.
3. Dev-server E2E: POST `/api/plan` with a KB scenario, confirm injection and that the
   returned plan uses the reference.

## Out of scope

Facial pixel-portraits, per-celeb image sampling, embeddings/semantic retrieval (keyword
match is enough at this scale), and any engine/physics changes.
