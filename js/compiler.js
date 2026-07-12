/* ── DRONE·I·FY onboard planner: plain words → a FLIGHTSCRIPT program ──
   The instant, offline choreographer. Same DSL as the Claude planner:
   acts of formation groups with motions. No text in the sky — nouns
   become shapes, verbs become entrances and motions, colors tint. */
'use strict';

const COMPILER = (() => {

  const NOUNS = {
    dragon:'🐲', dinosaur:'🦖', unicorn:'🦄', eagle:'🦅', bird:'🐦', owl:'🦉',
    butterfly:'🦋', bee:'🐝', fish:'🐟', shark:'🦈', whale:'🐋', dolphin:'🐬', octopus:'🐙',
    horse:'🐎', lion:'🦁', tiger:'🐯', wolf:'🐺', fox:'🦊', cat:'🐱', dog:'🐶', panda:'🐼',
    elephant:'🐘', turtle:'🐢', snake:'🐍', dove:'🕊️', peacock:'🦚', flamingo:'🦩',
    rocket:'🚀', plane:'✈️', airplane:'✈️', helicopter:'🚁', ufo:'🛸', satellite:'🛰️',
    ship:'⛵', boat:'⛵', sailboat:'⛵', anchor:'⚓', car:'🏎️', train:'🚂',
    castle:'🏰', city:'🏙️', house:'🏠', bridge:'🌉', tower:'🗼', temple:'⛩️',
    mountain:'⛰️', volcano:'🌋', island:'🏝️',
    sun:'☀️', earth:'🌍', galaxy:'🌌',
    cloud:'☁️', rainbow:'🌈', lightning:'⚡', thunder:'⚡', tornado:'🌪️', snowflake:'❄️',
    flower:'🌸', sunflower:'🌻', tulip:'🌷', tree:'🌳', palm:'🌴',
    leaf:'🍁', mushroom:'🍄',
    crown:'👑', diamond:'💎', gem:'💎', key:'🗝️', bell:'🔔', gift:'🎁', balloon:'🎈',
    trophy:'🏆', umbrella:'☂️', hourglass:'⏳',
    skull:'💀', ghost:'👻', alien:'👽', robot:'🤖', wizard:'🧙',
    guitar:'🎸', piano:'🎹', violin:'🎻', music:'🎵', note:'🎵',
    eye:'👁️', hand:'✋', brain:'🧠', infinity:'♾️',
    lantern:'🏮', candle:'🕯️', kite:'🪁',
    fire:'🔥', flame:'🔥',
    football:'⚽', soccer:'⚽', fifa:'⚽', goal:'⚽', basketball:'🏀', cricket:'🏏',
    cup:'🏆', championship:'🏆', medal:'🥇',
  };

  const PARAM_NOUNS = {
    heart:'heart', love:'heart', ring:'ring', circle:'ring', halo:'ring', portal:'ring',
    star:'star', spiral:'spiral', vortex:'spiral', explosion:'burst', burst:'burst',
    firework:'burst', fireworks:'burst', swarm:'swarm', moon:'crescent', crescent:'crescent',
    wave:'wavefield', waves:'wavefield', ocean:'wavefield', sea:'wavefield',
    dna:'helix', helix:'helix', planet:'sphere', saturn:'sphere', sphere:'sphere',
    sun:'sphere', earth:'sphere', orb:'sphere', ball:'sphere', soccer:'sphere', football:'sphere', fifa:'sphere',
    globe:'sphere', world:'sphere', comet:'comet', meteor:'comet',
    cube:'cube', box:'cube', pyramid:'pyramid', torus:'torus', donut:'torus', cone:'cone',
  };

  const TINTS = {
    red:'#ff5d5d', crimson:'#ff4560', pink:'#ff8fc7', orange:'#ff9d47',
    gold:'#ffd75e', golden:'#ffd75e', yellow:'#ffe873', amber:'#ffb547',
    green:'#7dff9b', emerald:'#4de88a', teal:'#4dd8c8', cyan:'#6fe8ff', blue:'#6fa8ff',
    azure:'#7fc7ff', indigo:'#8f8fff', purple:'#b98fff', violet:'#c78fff', magenta:'#ff7ae8',
    white:'#f4f2ff', silver:'#ccd6e8', ice:'#9fd8ff',
  };

  const ENTERS = [
    [/launch|lift|take.?off|blast|rise|rises|ascend/, 'launch'],
    [/explode|explodes|burst|bursts|shatter|erupt/,   'explode'],
    [/rain|rains|fall|falls|falling|snow|drip|pour/,  'rain'],
    [/swirl|swirls|twirl|vortex/,                     'swirl'],
    [/bloom|blooms|grow|grows|open|opens|unfold/,     'bloom'],
  ];

  const STOP = new Set(['the','a','an','of','in','on','over','under','into','onto','across','through',
    'then','and','that','with','to','from','it','its','is','are','was','while','as','at','by','up',
    'down','out','off','very','big','small','giant','tiny','slowly','quickly','sky','night','show',
    'drone','drones','turns','turn','becomes','become']);

  const DEFAULT_GRADIENTS = [
    'gradient:#ff8fc7:#ffd75e',
    'gradient:#6fe8ff:#b98fff',
    'gradient:#7dff9b:#6fa8ff',
    'gradient:#ff9d47:#ff5d5d',
    'gradient:#ffe873:#6fe8ff',
  ];

  const SHAPE_LABELS = {
    heart:'heart', ring:'ring', star:'star', spiral:'spiral', burst:'burst', swarm:'swarm',
    crescent:'moon', wavefield:'wave', helix:'helix', sphere:'sphere', comet:'comet',
    torus:'torus', cube:'cube', pyramid:'pyramid', cone:'cone',
    'emoji:🇺🇸':'flag', 'emoji:🇮🇳':'flag',
  };
  function fallbackTint(lower, shape, idx){
    if (/love|heart|flower/.test(lower) || shape === 'heart') return 'gradient:#ff5d5d:#ff8fc7';
    if (/fire|flame|sun|gold|crown|trophy/.test(lower) || shape === 'burst') return 'gradient:#ff9d47:#ffd75e';
    if (/moon|snow|ice|ocean|sea|wave|rain/.test(lower)) return 'gradient:#6fe8ff:#f4f2ff';
    if (/planet|earth|galaxy|space|cosmic/.test(lower) || shape === 'sphere' || shape === 'torus') return 'gradient:#6fa8ff:#b98fff';
    if (/forest|tree|leaf|emerald/.test(lower)) return 'gradient:#7dff9b:#4dd8c8';
    return DEFAULT_GRADIENTS[idx % DEFAULT_GRADIENTS.length];
  }

  function clauses(text){
    return text.split(/\s*(?:\bthen\b|\band then\b|[.;,!?]|\bwhich\b)\s*/i)
      .map(s => s.trim()).filter(Boolean).slice(0, 4);
  }

  function labelForShape(shape){
    return SHAPE_LABELS[shape] || (shape.startsWith('emoji:') ? 'icon' : shape);
  }

  function visualScore(lower){
    let score = 0;
    if (shapesIn(lower).length) score += 3;
    if (/firework|flag|goal|trophy|heart|dragon|rocket|moon|sun|planet|wave|crown|flower/.test(lower)) score += 2;
    if (/fly|flies|glide|glides|orbit|spin|spins|wave|waves|rise|rises|bloom|blooms|explode|explodes|burst|bursts/.test(lower)) score += 1;
    if (/red|blue|green|gold|golden|rainbow|fire|flame|ice|white|silver|purple|pink|orange/.test(lower)) score += 1;
    return score;
  }

  function makeCaption({ shapes, lower, travels, fx }){
    const labels = shapes.map(labelForShape);
    if (labels.includes('flag')) return fx === 'fireworks' ? 'flag and fireworks' : 'flag in full color';
    if (labels.length >= 2){
      if (/\bover\b|\babove\b/.test(lower)) return `${labels[0]} over ${labels[1]}`;
      if (travels) return `${labels[0]} and ${labels[1]}`;
      return `${labels[0]} with ${labels[1]}`;
    }
    const label = labels[0] || 'light';
    if (fx === 'fireworks') return `${label} and fireworks`;
    if (travels) return `${label} in flight`;
    if (/orbit|spin|spins|rotate|rotates|swirl/.test(lower)) return `spinning ${label}`;
    if (/wave|waves|ripple/.test(lower)) return `${label} in motion`;
    return label;
  }

  function explicitFloralShape(lower){
    if (/\b(sunflower|sunflowers)\b/.test(lower)) return 'emoji:🌻';
    if (/\b(tulip|tulips)\b/.test(lower)) return 'emoji:🌷';
    if (/\b(a|the|one)\s+rose\b|\brose flower\b|\bbouquet of roses\b|\bred rose\b|\bwhite rose\b|\brose\b.*\b(thorn|thorns|petal|petals|stem|bloom|blooms)\b/.test(lower)) return 'emoji:🌹';
    if (/\b(flower|flowers|blossom|blossoms|bouquet|petal|petals)\b/.test(lower)) return 'emoji:🌸';
    return null;
  }

  function shapesIn(lower){
    const floral = explicitFloralShape(lower);
    const words = lower.replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);
    const found = floral ? [floral] : [];
    for (const w of words){
      const base = w.replace(/s$/, '');
      if (PARAM_NOUNS[w] || PARAM_NOUNS[base]){ found.push(PARAM_NOUNS[w] || PARAM_NOUNS[base]); continue; }
      if (NOUNS[w] || NOUNS[base]) found.push('emoji:' + (NOUNS[w] || NOUNS[base]));
    }
    return [...new Set(found)].slice(0, 2);
  }

  function compileClause(raw){
    const lower = ' ' + raw.toLowerCase() + ' ';
    let enter = 'drift';
    for (const [re, name] of ENTERS) if (re.test(lower)) { enter = name; break; }

    let tint = null;
    for (const w in TINTS) if (lower.includes(' ' + w + ' ')) { tint = TINTS[w]; break; }
    if (/rainbow|colorful|colourful/.test(lower)) tint = 'rainbow';
    if (/fire|flame|burn/.test(lower) && !tint) tint = 'gradient:#ff5340:#ffd75e';

    const motion = [];
    if (/orbit|spin|spins|rotate|rotates|swirl|dance/.test(lower)) motion.push({ type: 'orbit', speed: 1 });
    if (/bloom|breathe|pulse|glow|beat/.test(lower)) motion.push({ type: 'pulse', amp: .08 });
    if (/wave|ocean|sea|ripple/.test(lower)) motion.push({ type: 'wave', amp: 10 });
    const through = /\bthrough\b/.test(lower);
    const carries = /\b(carry|carrying|holds?|holding)\b/.test(lower);
    const travels = /fly|flies|swim|swims|glide|glides|sail|sails|cross|across|soar|travels?|launch(?:es)?|rise|rises|shoots?|dives?/.test(lower) || through;

    let fx = null;
    if (/firework|fireworks|celebrate|celebration|finale|win|won|wins|champion|victory/.test(lower)) fx = 'fireworks';
    else if (/fire(?!work)|flame|breathes? fire|burn|ember/.test(lower)) fx = 'embers';
    else if (/twinkle|shimmer|glitter|sparkle/.test(lower)) fx = 'twinkle';

    /* national colors fly as gradients */
    if (!tint){
      if (/\busa\b|\bamerica\b/.test(lower)) tint = 'gradient:#ff5d5d:#6fa8ff';
      else if (/\bindia\b/.test(lower)) tint = 'gradient:#7dff9b:#ff9d47';
      else if (/\bbrazil\b/.test(lower)) tint = 'gradient:#7dff9b:#ffe873';
      else if (/\bfrance\b/.test(lower)) tint = 'gradient:#6fa8ff:#ff5d5d';
      else if (/\bdragon\b/.test(lower)) tint = 'gradient:#ff7b52:#ffc46b';
    }

    let shapes = shapesIn(lower);
    if (/\b(usa?|america|american)\b.*\bflag\b|\bflag\b.*\b(usa?|america|american)\b|stars and stripes/.test(lower)){
      shapes = ['emoji:🇺🇸', ...shapes.filter(s => s !== 'emoji:🇺🇸')].slice(0, 2);
    } else if (/\bindia(n)?\b.*\bflag\b/.test(lower)) shapes = ['emoji:🇮🇳', ...shapes].slice(0, 2);
    if (/win|won|wins|champion|victory/.test(lower) && !shapes.includes('emoji:🏆') && shapes.length < 2){
      shapes.push('emoji:🏆');
    }
    if (!shapes.length){
      const emo = raw.match(/\p{Extended_Pictographic}/u);
      shapes = [emo ? 'emoji:' + emo[0] : ['spiral', 'sphere', 'burst'][raw.length % 3]];
    }

    /* one clause, one act — two nouns become two simultaneous groups */
    const groups = shapes.map((shape, i) => {
      const two = shapes.length === 2;
      const overY = two && /\bover\b|\babove\b/.test(lower);
      const isFlag = /^emoji:\p{Regional_Indicator}/u.test(shape);
      const color = shape.startsWith('emoji:') && !tint ? 'sampled' : (tint || fallbackTint(lower, shape, i));
      const g = {
        shape,
        at: two ? (overY ? [0, i === 0 ? .42 : -.28] : [i === 0 ? -.45 : .45, 0]) : [0, 0],
        scale: two ? .58 : 1,
        rotate: 0,
        color,
        weight: two && i === 1 ? .8 : 1,
        fill: isFlag ? 'solid' : 'outline',   /* flags fly as pixel lattices */
        motion: isFlag ? [{ type: 'wave', amp: 8 }, ...motion].slice(0, 2) : [...motion],
      };
      if (through && two){
        if (i === 0){
          g.at = [-.62, -.06];
          g.motion = g.motion.filter(m => m.type !== 'travel');
          g.motion.push({ type: 'travel', to: [.62, .16] });
        } else {
          g.at = [0, .08];
          g.scale = .76;
          g.rotate = shape === 'ring' || shape === 'torus' ? 12 : 0;
          g.weight = .85;
        }
      } else if (carries && two){
        g.at = i === 0 ? [0, .3] : [0, -.32];
        g.scale = i === 0 ? .68 : .52;
      } else if (travels && i === 0){
        g.at = [-.55, g.at[1]];
        g.motion = g.motion.filter(m => m.type !== 'travel');
        g.motion.push({ type: 'travel', to: [.55, g.at[1]] });
      }
      return g;
    });

    return {
      caption: makeCaption({ shapes, lower, travels, fx }),
      duration: 7500,
      enter,
      fx,
      groups,
      _score: visualScore(lower),
    };
  }

  function compile(text){
    const t = (text || '').trim();
    let acts = clauses(t)
      .filter((raw) => visualScore(' ' + raw.toLowerCase() + ' ') > 0)
      .map(compileClause)
      .filter((act) => act._score > 0);
    if (acts.length > 3) acts = acts.slice(0, 3);
    if (!acts.length) acts.push(compileClause('a sphere of light breathes over the city'));
    const last = acts[acts.length - 1];
    if (last.fx !== 'fireworks'){
      acts.push({
        caption: 'grand finale', duration: 8000, enter: 'explode', fx: 'fireworks',
        groups: [{ shape: 'burst', at: [0, 0], scale: 1.1, rotate: 0, color: 'rainbow', weight: 1, motion: [{ type: 'pulse', amp: .1 }] }],
      });
    }
    return acts.map(({ _score, ...act }) => act);
  }

  const SURPRISES = [
    'a whale swims across the sky, dives through a ring, and bursts into blue fireworks',
    'a phoenix rises in fire, orbits the moon, and becomes a golden crown',
    'a comet crosses the moon, curls into a sphere, and bursts into golden fireworks',
    'a dragon flies over a castle and breathes fire into the night',
    'a rocket launches through a ring, orbits a spinning planet, and explodes into a rainbow burst',
    'a butterfly glides across the sky and unfolds into a glowing spiral galaxy',
    'lightning strikes, a tornado swirls, then a calm ocean wave rolls under the moon',
    'two hearts orbit each other, merge into a sphere, and shatter into golden fireworks',
  ];

  return { compile, SURPRISES };
})();
