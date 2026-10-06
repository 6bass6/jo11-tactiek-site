// Turns a template + seed into a concrete situation (positions of all 16 players
// and the ball). Same seed + template + position always gives the same situation.
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const W = C.W, L = C.L, CX = W / 2;
  const ROLES = C.POSITIONS;
  const OUTFIELD = ROLES.filter(r => r !== 'K');
  const MIN_GAP = 2.6; // players never overlap on screen

  // Team shape in the team's own frame (attacking towards y = 0).
  function shape(inPoss, ball, block) {
    let defLine, midGap, spGap, shiftF, xs;
    if (inPoss) {
      defLine = C.clamp(ball.y + 8, 26, 52);
      midGap = 12; spGap = 23; shiftF = 0.25;
      xs = { LA: 5, CV: CX, RA: W - 5, LM: 6, CM: CX, RM: W - 6, SP: CX };
    } else {
      defLine = C.clamp(ball.y + 14, 34, 57);
      midGap = 10; spGap = 20; shiftF = 0.45;
      xs = { LA: 11, CV: CX, RA: W - 11, LM: 10, CM: CX, RM: W - 10, SP: CX };
    }
    defLine = C.clamp(defLine + (block || 0), 8, 58);
    const ys = {
      LA: defLine, CV: defLine + 1.5, RA: defLine,
      LM: defLine - midGap, CM: defLine - midGap + 1, RM: defLine - midGap,
      SP: Math.max(5, defLine - spGap)
    };
    const out = {};
    OUTFIELD.forEach(r => { out[r] = { x: xs[r] + (ball.x - CX) * shiftF, y: ys[r] }; });
    out.K = { x: CX + (ball.x - CX) * 0.15, y: C.clamp(defLine + 12, 55, 61.5) };
    return out;
  }

  const flip = p => ({ x: W - p.x, y: L - p.y });

  function teamFromShape(sh) {
    return ROLES.map(r => ({ pos: r, x: sh[r].x, y: sh[r].y }));
  }

  // Defending team presses the carrier and marks attackers (goal-side).
  function applyPress(def, att, carrierIdx, p, defGoal, skipIdx) {
    const carrier = att[carrierIdx];
    const free = def.map((d, i) => i).filter(i => def[i].pos !== 'K' && i !== skipIdx);
    if (!free.length) return;
    // presser
    free.sort((a, b) => C.dist(def[a], carrier) - C.dist(def[b], carrier));
    const presserIdx = free[0];
    // if the skipped player (the user) is the closest, nobody else presses: that's his job
    const skipCloser = skipIdx != null && C.dist(def[skipIdx], carrier) < C.dist(def[presserIdx], carrier);
    if (!skipCloser) {
      const target = C.towards(carrier, defGoal, C.lerp(7, 1.8, p));
      const pr = def[presserIdx];
      const d = C.dist(pr, target);
      const np = C.towards(pr, target, d > 15 ? d * 0.6 : d);
      pr.x = np.x; pr.y = np.y;
    }
    // markers
    const targets = att.map((a, i) => i).filter(i => i !== carrierIdx && att[i].pos !== 'K');
    const used = new Set();
    free.slice(skipCloser ? 0 : 1).forEach(di => {
      const d = def[di];
      let best = -1, bd = 1e9;
      targets.forEach(ti => {
        if (used.has(ti)) return;
        const dd = C.dist(d, att[ti]);
        if (dd < bd) { bd = dd; best = ti; }
      });
      if (best < 0 || bd > 16) return;
      used.add(best);
      const spot = C.towards(att[best], defGoal, 1.8);
      const f = 0.2 + 0.6 * p;
      const np = C.towards(d, spot, Math.min(8, C.dist(d, spot) * f));
      d.x = np.x; d.y = np.y;
    });
  }

  function keepAway(team, ball, r, exceptIdx) {
    team.forEach((p, i) => {
      if (i === exceptIdx) return;
      const d = C.dist(p, ball);
      if (d < r) {
        const away = d < 0.01 ? { x: p.x + 0.1, y: p.y + 1 } : p;
        const dx = away.x - ball.x, dy = away.y - ball.y, n = Math.hypot(dx, dy) || 1;
        p.x = ball.x + dx / n * r; p.y = ball.y + dy / n * r;
      }
    });
  }

  function separate(all, fixed, post) {
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j];
          const d = C.dist(a, b);
          if (d >= MIN_GAP) continue;
          const push = (MIN_GAP - d) / 2 + 0.01;
          let dx = b.x - a.x, dy = b.y - a.y;
          const n = Math.hypot(dx, dy) || 1;
          if (n < 0.01) { dx = 1; dy = 0.3; }
          const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
          const fa = fixed.has(a), fb = fixed.has(b);
          if (fa && fb) continue;
          const ka = fa ? 0 : (fb ? 2 : 1), kb = fb ? 0 : (fa ? 2 : 1);
          a.x -= ux * push * ka; a.y -= uy * push * ka;
          b.x += ux * push * kb; b.y += uy * push * kb;
        }
      }
      all.forEach(p => {
        if (fixed.has(p)) return;
        p.x = C.clamp(p.x, 0.8, W - 0.8); p.y = C.clamp(p.y, 0.8, L - 0.8);
      });
      if (post) post();
    }
  }

  const byPos = (team, pos) => team.find(p => p.pos === pos);

  // ---------- special layouts ----------
  function cornerFor(R, carrierRole) {
    const ball = { x: 0.6, y: 0.6 };
    const otherWide = carrierRole === 'LM' ? 'RM' : 'LM';
    const spots = {
      SP: { x: CX - 1, y: 5 }, CM: { x: CX + 3, y: 9.5 }, CV: { x: CX - 4.5, y: 10 },
      LA: { x: 8, y: 18 }, RA: { x: W - 9, y: 22 }, K: { x: CX, y: 50 }
    };
    spots[otherWide] = { x: CX + 7, y: 6 };
    spots[carrierRole] = ball;
    const mates = ROLES.map(r => ({ pos: r, x: spots[r].x + (r === carrierRole ? 0 : R.range(-1.5, 1.5)), y: spots[r].y + (r === carrierRole ? 0 : R.range(-1.5, 1.5)) }));
    const boxAtt = mates.filter(m => m.pos !== carrierRole && m.y < 16 && m.pos !== 'K');
    const opps = ROLES.map(r => ({ pos: r, x: CX, y: 10 }));
    byPos(opps, 'K').x = CX + R.range(-1, 0); byPos(opps, 'K').y = 1.2;
    byPos(opps, 'SP').x = CX + R.range(-4, 4); byPos(opps, 'SP').y = R.range(24, 32);
    const defenders = opps.filter(o => o.pos !== 'K' && o.pos !== 'SP');
    defenders.forEach((d, i) => {
      if (i < boxAtt.length && R() < 0.85) {
        const s = C.towards(boxAtt[i], C.THEIR_GOAL, 1.3);
        d.x = s.x + R.range(-0.5, 0.5); d.y = s.y;
      } else {
        const zone = [{ x: CX - 3, y: 2.5 }, { x: CX + 1, y: 7 }, { x: CX - 6, y: 13 }][i % 3];
        d.x = zone.x + R.range(-1, 1); d.y = zone.y + R.range(-1, 1);
      }
    });
    return { ball, mates, opps };
  }

  function cornerAgainst(R, carrierRole) {
    const ball = { x: 0.6, y: L - 0.6 };
    const otherWide = carrierRole === 'RM' ? 'LM' : 'RM';
    const spots = {
      SP: { x: CX - 1, y: L - 5 }, CM: { x: CX + 3, y: L - 9.5 }, CV: { x: CX - 4.5, y: L - 10 },
      RA: { x: 8, y: L - 18 }, LA: { x: W - 9, y: L - 22 }, K: { x: CX, y: 14 }
    };
    spots[otherWide] = { x: CX + 7, y: L - 6 };
    spots[carrierRole] = ball;
    const opps = ROLES.map(r => ({ pos: r, x: spots[r].x + (r === carrierRole ? 0 : R.range(-1.5, 1.5)), y: spots[r].y + (r === carrierRole ? 0 : R.range(-1.5, 1.5)) }));
    const boxAtt = opps.filter(o => o.pos !== carrierRole && o.y > L - 16 && o.pos !== 'K');
    const mates = ROLES.map(r => ({ pos: r, x: CX, y: L - 10 }));
    byPos(mates, 'K').x = CX + R.range(-1, 1); byPos(mates, 'K').y = L - 1.2;
    byPos(mates, 'SP').x = CX + R.range(-4, 4); byPos(mates, 'SP').y = R.range(32, 40);
    const order = ['CV', 'LA', 'RA', 'CM', 'LM', 'RM'];
    order.forEach((r, i) => {
      const m = byPos(mates, r);
      if (i < boxAtt.length) {
        const s = C.towards(boxAtt[i], C.OUR_GOAL, 1.3);
        m.x = s.x + R.range(-0.5, 0.5); m.y = s.y;
      } else {
        const zone = [{ x: CX - 3, y: L - 2.5 }, { x: CX + 1, y: L - 7 }, { x: CX - 6, y: L - 13 }][i % 3];
        m.x = zone.x + R.range(-1, 1); m.y = zone.y + R.range(-1, 1);
      }
    });
    return { ball, mates, opps };
  }

  const isCornerT = t => t.special === 'corner_for' || t.special === 'corner_against';

  // ---------- template selection ----------
  function orientations(t, mePos) {
    const res = [];
    [false, true].forEach(mirror => {
      const meL = mirror ? C.MIRROR[mePos] : mePos;
      if (!t.me.includes(meL)) return;
      if (t.poss === 'us' && !t.meHasBall && !t.carriers.some(c => c !== meL)) return;
      if (t.meHasBall && !t.carriers.includes(meL)) return;
      if (res.length && C.MIRROR[mePos] === mePos) { res.push(mirror); return; }
      res.push(mirror);
    });
    return res;
  }

  function templatesFor(mePos) {
    return JO.templates.filter(t => orientations(t, mePos).length > 0);
  }

  function generateOnce(opts) {
    const seed = (opts.seed >>> 0) || 1;
    const R = C.rng(seed);
    const mePos = opts.mePos;
    let t;
    if (opts.templateId) t = JO.templates.find(x => x.id === opts.templateId);
    if (!t) {
      const all = templatesFor(mePos);
      let pool = all.filter(x => !(opts.exclude || []).includes(x.id));
      if (opts.phase) {
        const ph = pool.filter(x => x.phase === opts.phase);
        if (ph.length) pool = ph;
      }
      if (!pool.length) pool = all;
      t = R.pick(pool);
    }
    const ors = orientations(t, mePos);
    const mirror = ors.length > 1 ? R() < 0.5 : ors[0];
    const meL = mirror ? C.MIRROR[mePos] : mePos;
    const level = opts.level || 0;
    const press = C.clamp((t.press ? R.range(t.press[0], t.press[1]) : 0.5) + level * 0.05, 0, 1);
    const ctx = R.pick(JO.contexts);

    let carrierRole;
    if (t.meHasBall) carrierRole = meL;
    else if (t.poss === 'us') carrierRole = R.pick(t.carriers.filter(c => c !== meL));
    else carrierRole = R.pick(t.carriers);

    let ball, mates, opps;
    // wide players have the ball on their own side of the field
    const sideOf = t.poss === 'us'
      ? { LA: -1, LM: -1, RA: 1, RM: 1 }
      : { LA: 1, LM: 1, RA: -1, RM: -1 }; // opponents face us: their left is our right
    const side = sideOf[carrierRole] || 0;
    if (t.special === 'corner_for') ({ ball, mates, opps } = cornerFor(R, carrierRole));
    else if (t.special === 'corner_against') ({ ball, mates, opps } = cornerAgainst(R, carrierRole));
    else {
      ball = { x: R.range(t.ball[0], t.ball[1]), y: R.range(t.ball[2], t.ball[3]) };
      if ((side < 0 && ball.x > CX + 2) || (side > 0 && ball.x < CX - 2)) ball.x = W - ball.x;
      mates = teamFromShape(shape(t.poss === 'us', ball, t.ourBlock));
      const theirSh = shape(t.poss === 'them', flip(ball), t.oppBlock);
      opps = ROLES.map(r => { const p = flip(theirSh[r]); return { pos: r, x: p.x, y: p.y }; });
      const defTeam = t.poss === 'us' ? opps : mates;
      if (t.special === 'overload') {
        defTeam.forEach(p => { if (p.pos !== 'K') p.x += (ball.x - p.x) * 0.35; });
      }
      if (t.special === 'fewback') {
        opps.forEach(o => {
          if (o.pos === 'K') return;
          if (o.pos === 'CV') { o.x = CX + R.range(-5, 5); o.y = ball.y - R.range(8, 12); }
          else { o.y = Math.max(o.y, ball.y + R.range(3, 10)); }
        });
      }
      // jitter
      mates.concat(opps).forEach(p => {
        const j = p.pos === 'K' ? 1 : 1.6;
        p.x += R.range(-j, j); p.y += R.range(-j, j);
      });
    }

    const carrierTeam = t.poss === 'us' ? mates : opps;
    const carrierIdx = carrierTeam.findIndex(p => p.pos === carrierRole);
    carrierTeam[carrierIdx].x = ball.x; carrierTeam[carrierIdx].y = ball.y;
    const meIdx = mates.findIndex(p => p.pos === meL);
    const me = mates[meIdx];
    // the normal spot for this position in this situation (before the player is
    // moved out of place); used to teach staying in your own area
    // team agreement: drop back at the opponent's goal kick
    const tactics = (JO.team && JO.team.tactics) || {};
    var dropBack = t.id === 'achterbal_tegen' && tactics.achterbalTegen !== 'druk';
    // normal spot of every position (used to judge any teammate the same way)
    const homes = {};
    const homeShape = isCornerT(t) ? null : dropBack ? shape(false, ball, 18) : shape(t.poss === 'us', ball, 0);
    mates.forEach(m => { const h = homeShape ? homeShape[m.pos] : m; homes[m.pos] = { x: +h.x.toFixed(2), y: +h.y.toFixed(2) }; });
    const home = homes[meL];

    if (t.special === 'meInside') me.x += (CX - me.x) > 0 ? 8 : -8;
    if (t.special === 'meWide') me.x = Math.max(me.x, me.pos === 'CM' ? CX + 6 : W - 4);

    // user starts a bit away from his ideal spot
    if (!t.meHasBall && t.meOffset) {
      const a = R() * Math.PI * 2, m = R.range(t.meOffset[0], t.meOffset[1]);
      me.x += Math.cos(a) * m; me.y += Math.sin(a) * m;
    }

    const isCorner = t.special === 'corner_for' || t.special === 'corner_against';
    if (!isCorner) {
      if (t.poss === 'us') applyPress(opps, mates, carrierIdx, press, C.THEIR_GOAL, null);
      else if (dropBack) {
        // the team has already dropped back into its block; only the player still has to
        const block = shape(false, ball, 18);
        mates.forEach((m, i) => {
          if (i === meIdx) return;
          const j = m.pos === 'K' ? 0.5 : 1.5;
          m.x = block[m.pos].x + R.range(-j, j); m.y = block[m.pos].y + R.range(-j, j);
        });
      } else applyPress(mates, opps, carrierIdx, press, C.OUR_GOAL, meIdx);
    }

    const restart = ['sideline', 'corner_for', 'corner_against', 'freekick', 'restart'].includes(t.special);
    if (t.special === 'freekick' && C.dist(ball, C.THEIR_GOAL) < 26) {
      // two-player wall
      const wallC = C.towards(ball, C.THEIR_GOAL, C.RESTART_DIST + 0.5);
      const dx = C.THEIR_GOAL.x - ball.x, dy = C.THEIR_GOAL.y - ball.y, n = Math.hypot(dx, dy);
      const px = -dy / n, py = dx / n;
      const near = opps.filter(o => o.pos !== 'K').sort((a, b) => C.dist(a, wallC) - C.dist(b, wallC)).slice(0, 2);
      near.forEach((o, i) => { const s = i ? 1.1 : -1.1; o.x = wallC.x + px * s; o.y = wallC.y + py * s; });
    }

    const fixed = new Set([carrierTeam[carrierIdx]]);
    if (t.meHasBall) fixed.add(me);
    const all = mates.concat(opps);
    const defTeam = t.poss === 'us' ? opps : mates;
    const post = restart ? () => keepAway(defTeam, ball, C.RESTART_DIST + 0.4, -1) : null;
    if (post) post();
    separate(all, fixed, post);
    all.forEach(p => {
      if (fixed.has(p)) return;
      p.x = C.clamp(p.x, 0.8, W - 0.8); p.y = C.clamp(p.y, 0.8, L - 0.8);
    });

    let sc = {
      v: 1, seed, templateId: t.id, phase: t.phase, title: t.title, promptRaw: t.prompt,
      context: ctx.text, risk: ctx.risk, att: ctx.att, level,
      poss: t.poss, me: meIdx, carrier: { team: t.poss, idx: carrierIdx },
      ball: { x: ball.x, y: ball.y },
      mates: mates.map(p => ({ pos: p.pos, x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      opps: opps.map(p => ({ pos: p.pos, x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      home: { x: +home.x.toFixed(2), y: +home.y.toFixed(2) },
      homes,
      dropBack: dropBack || undefined,
      reach: dropBack ? 22 : undefined,
      onlyDribble: !!t.onlyDribble,
      keepAway: (restart && t.poss === 'them') ? C.RESTART_DIST : 0,
      restart: restart
    };
    if (mirror) sc = mirrorScenario(sc);
    return sc;
  }

  // Try a few seeds until the player's choice really matters in the situation.
  function generate(opts) {
    let sc = null;
    for (let k = 0; k < 10; k++) {
      sc = generateOnce(Object.assign({}, opts, { seed: ((opts.seed >>> 0) + k * 7919) >>> 0 }));
      if (opts.skipRelevance || !JO.judge || JO.judge.relevant(sc)) return sc;
    }
    sc.lowRelevance = true;
    return sc;
  }

  // Texts of a mirrored situation: left becomes right and right becomes left.
  const LR = { linker: 'rechter', rechter: 'linker', links: 'rechts', rechts: 'links', Linker: 'Rechter', Rechter: 'Linker', Links: 'Rechts', Rechts: 'Links' };
  const swapLR = t => typeof t === 'string' ? t.replace(/[Ll]inker|[Rr]echter|[Ll]inks|[Rr]echts/g, w => LR[w]) : t;

  function mirrorScenario(sc) {
    const m = p => Object.assign({}, p, { x: +(W - p.x).toFixed(2), pos: C.MIRROR[p.pos] });
    const home = sc.home ? { x: +(W - sc.home.x).toFixed(2), y: sc.home.y } : null;
    let homes;
    if (sc.homes) {
      homes = {};
      Object.keys(sc.homes).forEach(p => { homes[C.MIRROR[p]] = { x: +(W - sc.homes[p].x).toFixed(2), y: sc.homes[p].y }; });
    }
    const mates = sc.mates.map(m), opps = sc.opps.map(m);
    // keep team arrays in standard role order
    const order = arr => ROLES.map(r => arr.find(p => p.pos === r));
    const om = order(mates), oo = order(opps);
    const meNew = om.indexOf(mates[sc.me]);
    const cTeam = sc.carrier.team === 'us' ? mates : opps;
    const cNew = (sc.carrier.team === 'us' ? om : oo).indexOf(cTeam[sc.carrier.idx]);
    return Object.assign({}, sc, {
      mates: om, opps: oo, me: meNew, carrier: { team: sc.carrier.team, idx: cNew }, home, homes,
      ball: { x: +(W - sc.ball.x).toFixed(2), y: sc.ball.y }, mirrored: true,
      title: swapLR(sc.title), promptRaw: swapLR(sc.promptRaw), context: swapLR(sc.context)
    });
  }

  // Put roster names on our players. The user is "Jij".
  // Every teammate stands on their main or backup position. All lineups where
  // that works are equally likely, so the team changes between situations.
  // The stand-in keeper (JO.team.invalKeeper) only goes in goal when nobody
  // else who keeps is available. If no lineup fits everyone, a lineup with the
  // most players on their own position is used and the rest fill the gaps.
  function assignNames(sc, roster, playerId) {
    const R = C.rng(sc.seed ^ 0x9e3779b9);
    const others = roster.filter(p => p.id !== playerId);
    const spots = sc.mates.map((m, i) => i).filter(i => i !== sc.me);
    const chosen = chooseLineup(spots.map(i => sc.mates[i].pos), others, (JO.team || {}).invalKeeper, R);
    const names = {};
    spots.forEach((i, k) => { if (chosen[k]) names[i] = chosen[k].name; });
    sc.mates.forEach((m, i) => { m.name = i === sc.me ? 'Jij' : (names[i] || m.pos); });
    const me = roster.find(p => p.id === playerId);
    sc.playerName = me ? me.name : '';
    sc.prompt = fillPrompt(sc);
    return sc;
  }

  // positions: one position per spot. Returns one player (or null) per spot.
  function chooseLineup(positions, players, invalKeeperId, R) {
    const keeperFree = players.some(p => p.main === 'K' || p.backup === 'K');
    const fits = (p, pos) => p.main === pos || p.backup === pos ||
      (pos === 'K' && !keeperFree && p.id === invalKeeperId);
    const cands = positions.map(pos => players.filter(p => fits(p, pos)));
    // all lineups with the most players on their own position
    let best = [], bestN = -1;
    const walk = (k, used, cur, n, allowGap) => {
      if (n + (positions.length - k) < bestN) return;
      if (k === positions.length) {
        if (n > bestN) { bestN = n; best = []; }
        best.push(cur.slice());
        return;
      }
      cands[k].forEach(p => { if (!used.has(p.id)) { used.add(p.id); cur.push(p); walk(k + 1, used, cur, n + 1, allowGap); cur.pop(); used.delete(p.id); } });
      if (allowGap) { cur.push(null); walk(k + 1, used, cur, n, allowGap); cur.pop(); }
    };
    walk(0, new Set(), [], 0, false);
    if (!best.length) walk(0, new Set(), [], 0, true);
    const lineup = best[Math.floor(R() * best.length)].slice();
    // fill gaps with the players who are left
    const used = new Set(lineup.filter(Boolean).map(p => p.id));
    const left = players.filter(p => !used.has(p.id)).sort(() => R() - 0.5);
    return lineup.map(p => p || left.shift() || null);
  }

  function fillPrompt(sc) {
    let carrierName = 'de tegenstander';
    if (sc.carrier.team === 'us') carrierName = sc.mates[sc.carrier.idx].name;
    return sc.promptRaw.replace('{carrier}', carrierName);
  }

  JO.gen = { generate, generateOnce, assignNames, chooseLineup, templatesFor, shape };
})();
