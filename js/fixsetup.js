// "Zet het team goed": a situation where 1 or 2 teammates stand clearly wrong
// (sometimes a third one a bit off). The player drags at most 3 teammates to a
// better spot. Every teammate is judged with the normal judge (JO.judge.rateMate).
//
// Making such a situation needs many judge calls (up to a few seconds on a
// tablet), so it is built in small steps: generateAsync runs the steps in the
// background between other work, generate runs them all at once (tests).
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const MAX_MOVES = 3;
  const MIN_SHIFT = 5;   // a wrong player stands at least this far (m) from any good spot
  const MOVED = 1;       // a player counts as moved after this many meters

  const isCarrier = (sc, i) => sc.poss === 'us' && sc.carrier.idx === i;
  const movable = sc => sc.mates.map((m, i) => i).filter(i => !isCarrier(sc, i));
  const reachOf = (sc, i) => JO.judge.reach(JO.judge.asMate(sc, i));
  const freeSpot = (sc, i, P) => C.dist(P, sc.ball) > 2.2 &&
    !sc.opps.some(o => C.dist(o, P) < 2.2) && !sc.mates.some((m, k) => k !== i && C.dist(m, P) < 2.2);
  const nearestGood = (r, P) => r.zone.length ? Math.min(...r.zone.map(z => C.dist(z, P))) : 0;
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
  const labelOf = tags => tags.length ? lower(JO.judge.TAGS[tags[0]].label) : '';

  // ---------- making a situation (as steps: every `yield` is a pause) ----------
  // Step 1: every teammate to their best spot, until the whole team stands well.
  function* clean(sc) {
    for (let round = 0; round < 3; round++) {
      let changed = false;
      for (const i of movable(sc)) {
        const r = JO.judge.rateMate(sc, i); yield;
        if (r.rating !== 'goed') { sc.mates[i].x = r.best.x; sc.mates[i].y = r.best.y; changed = true; }
      }
      if (!changed) return true;
    }
    return false;
  }

  // Step 2: move player i to a spot that is rated `want` (and clearly away from
  // the good spots when want = 'beter'). Returns the reasons (tags) or null.
  function* displace(sc, i, R, want) {
    const m = sc.mates[i], home = { x: m.x, y: m.y };
    const reach = reachOf(sc, i);
    const [lo, hi] = want === 'beter' ? [0.5 * reach, 0.9 * reach] : [3, 5];
    // the good spots seen from the clean spot: a wrong spot must be clearly away
    // from them (cheap check first, the judge only for the spots that pass)
    let zone0 = [];
    if (want === 'beter') { zone0 = JO.judge.rateMate(sc, i).zone; yield; }
    let judged = 0;
    for (let t = 0; t < 60 && judged < 6; t++) {
      const a = R() * Math.PI * 2, d = R.range(lo, hi);
      const P = C.clampToField({ x: home.x + Math.cos(a) * d, y: home.y + Math.sin(a) * d });
      if (!freeSpot(sc, i, P)) continue;
      if (zone0.some(z => C.dist(z, P) < MIN_SHIFT + 1)) continue;
      judged++;
      m.x = +P.x.toFixed(2); m.y = +P.y.toFixed(2);
      const r = JO.judge.rateMate(sc, i); yield;
      if (want === 'beter' && r.rating === 'beter' && r.tags.length && nearestGood(r, m) >= MIN_SHIFT) return r.tags;
      if (want === 'oke' && r.rating === 'oke') return r.tags;
    }
    m.x = home.x; m.y = home.y;
    return null;
  }

  function* make(sc, R) {
    if (!(yield* clean(sc))) return null;
    const ids = movable(sc).sort(() => R() - 0.5);
    const nWrong = R() < 0.5 ? 1 : 2;
    const wrong = [], why = {};
    for (const i of ids) {
      if (wrong.length >= nWrong) break;
      const tags = yield* displace(sc, i, R, 'beter');
      if (tags) { wrong.push(i); why[i] = tags; }
    }
    if (wrong.length !== nWrong) return null;
    // sometimes a third player stands a bit off (fixing it is a bonus, not needed)
    const off = [];
    if (R() < 0.3) {
      const i = ids.find(k => !wrong.includes(k));
      if (i != null && (yield* displace(sc, i, R, 'oke'))) off.push(i);
    }
    // final check: only the wrong ones are wrong, everybody else stands well
    for (const i of movable(sc)) {
      const r = JO.judge.rateMate(sc, i).rating; yield;
      const want = wrong.includes(i) ? 'beter' : off.includes(i) ? 'oke' : 'goed';
      if (r !== want) return null;
    }
    sc.type = 'fix';
    sc.fix = { wrong, off, why };
    sc.title = 'Zet het team goed';
    sc.promptRaw = '1 of 2 spelers staan niet goed. Sleep ze naar een betere plek (maximaal ' + MAX_MOVES + ' spelers).';
    sc.prompt = sc.promptRaw;
    return sc;
  }

  // Try a few seeds until a good "zet het team goed" situation comes out.
  function* steps(opts) {
    for (let k = 0; k < 8; k++) {
      const seed = ((opts.seed >>> 0) + k * 7919) >>> 0;
      const base = JO.gen.generate(Object.assign({}, opts, { seed, skipRelevance: true }));
      yield;
      const sc = yield* make(base, C.rng(seed ^ 0x5f3759df));
      if (sc) return sc;
    }
    return null;
  }

  // All steps at once (tests, coach panel).
  function generate(opts) {
    const it = steps(opts);
    let s = it.next();
    while (!s.done) s = it.next();
    return s.value;
  }

  // Steps in the background: at most `budget` ms at a time, then the browser
  // gets time to draw and handle dragging. done(sc or null) when finished.
  // Returns a function that cancels the work.
  function generateAsync(opts, done, budget) {
    const it = steps(opts);
    let stopped = false;
    const run = () => {
      if (stopped) return;
      const t0 = Date.now();
      let s;
      do { s = it.next(); } while (!s.done && Date.now() - t0 < (budget || 25));
      if (s.done) done(s.value);
      else setTimeout(run, 15);
    };
    setTimeout(run, 0);
    return () => { stopped = true; };
  }

  // ---------- rating an answer ----------
  // pos = where every teammate stands after the player is done. Each teammate is
  // judged like the player in a normal situation: the move from where they
  // started to where they are now, with all the others at their new spots.
  function rate(sc, pos) {
    const f = Object.assign({}, sc, { mates: sc.mates.map((m, i) => Object.assign({}, m, { x: pos[i].x, y: pos[i].y })) });
    const nameOf = i => i === sc.me ? 'Jij' : (sc.mates[i].name || C.POS_NAME[sc.mates[i].pos]);
    const players = movable(sc).map(i => {
      const view = Object.assign({}, f, { mates: f.mates.map((m, k) => k === i ? Object.assign({}, m, { x: sc.mates[i].x, y: sc.mates[i].y }) : m) });
      const r = JO.judge.rateMate(view, i, pos[i]);
      return {
        i, name: nameOf(i), rating: r.rating, zone: r.zone, tags: r.tags,
        wrong: sc.fix.wrong.includes(i), off: sc.fix.off.includes(i),
        moved: C.dist(sc.mates[i], pos[i]) >= MOVED
      };
    });
    const wrong = players.filter(p => p.wrong);
    const fixed = wrong.filter(p => p.rating === 'goed');
    const almost = wrong.filter(p => p.rating === 'oke');
    // made worse: a player you moved who now stands worse than at the start
    // (good -> not good, a bit off -> wrong), or anyone else who now stands wrong
    const startRank = p => p.off ? 1 : 2, rank = { goed: 2, oke: 1, beter: 0 };
    const worse = players.filter(p => !p.wrong && (p.rating === 'beter' || (p.moved && rank[p.rating] < startRank(p))));
    const rating = fixed.length === wrong.length && !worse.length ? 'goed'
      : fixed.length || almost.length ? 'oke' : 'beter';

    const lines = [];
    wrong.forEach(p => {
      const was = labelOf(sc.fix.why[p.i] || []);
      if (p.rating === 'goed') lines.push(p.name + ' stond niet goed (' + was + ') en staat nu goed.');
      else if (p.rating === 'oke') lines.push(p.name + ' staat nu bijna goed. Het gele gebied was nog beter.');
      else lines.push(p.name + ' stond niet goed: ' + was + '.' + (p.moved ? ' Nog steeds niet goed.' : ''));
    });
    worse.forEach(p => lines.push(p.name + (p.rating === 'oke' ? ' stond goed, maar nu iets minder goed' : ' stond goed, maar nu niet meer') +
      (p.tags.length ? ' (' + labelOf(p.tags) + ')' : '') + '.'));
    players.filter(p => p.off && p.moved && p.rating === 'goed').forEach(p => lines.push(p.name + ' stond een beetje scheef. Goed gezien!'));
    return { rating, players, lines, fixed: fixed.length, nWrong: wrong.length };
  }

  // ---------- playing it out ----------
  // Plays the situation forward from setup `pos` (default: the setup at the
  // start). With `walk`, the frames first show the dragged players walking from
  // their old spot to their new one. We have the ball: our player on the ball
  // makes the best choice. They have the ball: they play their most dangerous option.
  function play(sc, pos, walk) {
    pos = pos || sc.mates;
    const f = Object.assign({}, sc, { mates: sc.mates.map((m, i) => Object.assign({}, m, { x: pos[i].x, y: pos[i].y })) });
    let sim;
    if (sc.poss === 'us') {
      const v = JO.judge.asMate(f, sc.carrier.idx);
      sim = JO.playout.simulate(v, JO.judge.analyse(v).best, sc.seed);
    } else {
      const me = f.mates[sc.me];
      sim = JO.playout.simulate(f, { type: 'move', x: me.x, y: me.y }, sc.seed);
    }
    if (!walk) return sim;
    const far = Math.max(0, ...sc.mates.map((m, i) => C.dist(m, pos[i])));
    const start = {
      ms: 0, mates: sc.mates.map(m => ({ x: m.x, y: m.y })), opps: sc.opps.map(o => ({ x: o.x, y: o.y })),
      ball: { x: sc.ball.x, y: sc.ball.y }, holder: { team: sc.carrier.team, idx: sc.carrier.idx }, note: ''
    };
    const walked = Object.assign({}, sim.frames[0], { ms: C.clamp(far / 7.5 * 1000, 400, 1600) });
    return { frames: [start, walked].concat(sim.frames.slice(1)), outcome: sim.outcome };
  }

  JO.fix = { MAX_MOVES, MIN_SHIFT, MOVED, generate, generateAsync, rate, play, movable, reachOf };
})();
