/* ── DRONE·I·FY audio: silenced by design — the show speaks for itself.
   The engine still calls these hooks; they are deliberate no-ops. ── */
'use strict';

const AUDIO = {
  begin(){},
  hum(){},
  whoosh(){},
  popFar(){},
  tick(){},
  mute(){},
  isMuted: () => true,
};
