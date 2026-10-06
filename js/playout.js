// Plays a situation forward a few seconds after the player's move, so they see the
// likely effect. Produces keyframes the field can animate, plus an outcome text.
//
// Passes and shots show the MOST LIKELY outcome (a pass that arrives 8 out of 10
// times arrives), so the best choice never "fails by bad luck". The chance is shown.
// Duels (dribbling past an opponent, receiving with an opponent right on you,
// pressing the ball carrier closely) can go either way, with their real chance.
// The same choice in the same situation always plays out the same way.
// Every player keeps moving: players not involved run to a sensible spot for their
// position, given where the ball is now.
window.JO = window.JO || {};
(function () {
  const C = JO.core, J = JO.judge, M = JO.judge.model;
  const W = C.W, L = C.L, CX = W / 2;

  function snap(st, ms, note) {
    return {
      ms,
      mates: st.mates.map(p => ({ x: p.x, y: p.y })),
      opps: st.opps.map(p => ({ x: p.x, y: p.y })),
      ball: { x: st.ball.x, y: st.ball.y },
      holder: st.holder ? { team: st.holder.team, idx: st.holder.idx } : null,
      note: note || ''
    };
  }

  const moveTo = (p, t, max) => { const q = C.towards(p, t, max == null ? 1e9 : max); p.x = q.x; p.y = q.y; };
  const durFor = (meters, speed, min, max) => C.clamp(meters / speed * 1000, min, max);
  const nameOf = (st, i) => st.mates[i].name || st.mates[i].pos;
  const pct = p => Math.round(C.clamp(p, 0, 1) * 10) * 10 + '%';
  const flipP = p => ({ x: W - p.x, y: L - p.y });

  // Scenario view of the current state with player `idx` of `team` on the ball.
  function viewFor(sc, st, team, idx, meIdx) {
    return Object.assign({}, sc, {
      mates: st.mates, opps: st.opps, ball: { x: st.ball.x, y: st.ball.y },
      poss: team, carrier: { team, idx }, me: meIdx == null ? idx : meIdx, keepAway: 0, onlyDribble: false, home: null
    });
  }

  // How a well-organised team reacts when the ball arrives at `target`:
  // the nearest player presses (from the side of his own goal), the second covers a
  // few meters behind him. Returns the players that reacted.
  function teamReact(team, target, ownGoal) {
    const order = team.filter(p => p.pos !== 'K').sort((a, b) => C.dist(a, target) - C.dist(b, target));
    const moved = [];
    if (order[0]) { moveTo(order[0], C.towards(target, ownGoal, 1.8), 3); moved.push(order[0]); }
    if (order[1] && C.dist(order[1], target) < 14) { moveTo(order[1], C.towards(target, ownGoal, 6), 2); moved.push(order[1]); }
    return moved;
  }

  // Everybody not involved moves towards the normal spot for his position, given
  // where the ball is and which team has it (wide and forward with the ball,
  // compact behind the ball without it).
  function flow(st, involved, ms) {
    const att = st.holder ? st.holder.team : null;
    const step = C.clamp(ms / 1000 * 5, 1, 4.5);
    const ourShape = JO.gen.shape(att === 'us', st.ball, 0);
    const theirShape = JO.gen.shape(att === 'them', flipP(st.ball), 0);
    const holderP = st.holder ? (st.holder.team === 'us' ? st.mates : st.opps)[st.holder.idx] : null;
    const attackers = att === 'them' ? st.opps : st.mates;
    const defenders = att === 'them' ? st.mates : st.opps;
    const defGoal = att === 'them' ? C.OUR_GOAL : C.THEIR_GOAL;
    // defenders who mark an attacker keep marking him (one defender per attacker)
    const marks = new Map(), taken = new Set();
    const pairs = [];
    defenders.forEach(d => {
      if (d.pos === 'K' || involved.includes(d)) return;
      attackers.forEach(a => { if (a !== holderP && a.pos !== 'K' && C.dist(d, a) < 4) pairs.push([C.dist(d, a), d, a]); });
    });
    pairs.sort((x, y) => x[0] - y[0]).forEach(([, d, a]) => {
      if (marks.has(d) || taken.has(a)) return;
      marks.set(d, a); taken.add(a);
    });
    const shapeOf = p => (st.mates.includes(p) ? ourShape[p.pos] : flipP(theirShape[p.pos]));
    // attackers first, then defenders react to where they went
    attackers.concat(defenders).forEach(p => {
      if (involved.includes(p) || p === holderP) return;
      const a = marks.get(p);
      let target = a ? C.towards(a, defGoal, 1.5) : shapeOf(p);
      // teammates of the player on the ball keep some distance, so he can pass to them
      if (holderP && attackers.includes(p) && p.pos !== 'K' && C.dist(target, holderP) < 7) {
        const from = C.dist(p, holderP) > 0.5 ? p : target;
        const d = C.dist(from, holderP) || 1;
        target = C.clampToField({ x: holderP.x + (from.x - holderP.x) / d * 7, y: holderP.y + (from.y - holderP.y) / d * 7 });
      }
      moveTo(p, target, p.pos === 'K' ? step * 0.5 : step);
    });
    // keep players from running into each other
    const all = st.mates.concat(st.opps);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j], d = C.dist(a, b);
      if (d > 0.01 && d < 2) {
        const mover = involved.includes(b) || b === holderP ? a : b;
        const other = mover === a ? b : a;
        const q = C.towards(other, mover, 2);
        mover.x = q.x; mover.y = q.y;
      }
    }
  }

  // Receiving with an opponent right on you is a duel: you can lose the ball.
  // Returns the index of the opponent who wins it, or -1.
  function receiveDuel(receiver, opponents, R) {
    let near = -1, nd = 1e9;
    opponents.forEach((o, i) => { const d = C.dist(o, receiver); if (o.pos !== 'K' && d < nd) { nd = d; near = i; } });
    if (near < 0 || nd > 2.2) return -1;
    const pLose = 0.3 * Math.pow(M.pressure(receiver, opponents), 1.5);
    return R() < pLose ? near : -1;
  }

  // Our player `ci` on the ball does action `a`. Returns { end, text, kind, chance }.
  function execOurs(sc, st, ci, a, frames, R) {
    const carrier = st.mates[ci];
    const v = viewFor(sc, st, 'us', ci);
    if (a.type === 'shot') {
      const e = M.evalShot(v, carrier, a, st.opps);
      const len = C.dist(carrier, a);
      const ms = durFor(len, 26, 250, 650);
      if (e.pGoal >= 0.4) {
        st.ball = { x: C.clamp(a.x, CX - 2.2, CX + 2.2), y: -0.6 }; st.holder = null;
        frames.push(snap(st, ms, 'GOAL!'));
        return { end: true, text: 'Doelpunt! ⚽', kind: 'goal', chance: 'Kans op een doelpunt: ' + pct(e.pGoal) + '.' };
      }
      const k = st.opps.find(o => o.pos === 'K');
      if (e.pGoal >= 0.12 && k) {
        moveTo(k, { x: C.clamp(a.x, CX - 2.5, CX + 2.5), y: Math.max(0.8, k.y) }, 3);
        st.ball = { x: k.x, y: k.y + 0.5 }; st.holder = { team: 'them', idx: st.opps.indexOf(k) };
        frames.push(snap(st, ms, 'Gered'));
        return { end: true, text: 'Het schot werd gestopt door de keeper.', kind: 'kans', chance: 'Kans op een doelpunt: ' + pct(e.pGoal) + '.' };
      }
      st.ball = { x: a.x + (a.x < CX ? -4.5 : 4.5), y: -1 }; st.holder = null;
      frames.push(snap(st, ms, 'Naast'));
      return { end: true, text: 'Het schot ging naast: van hier is scoren erg moeilijk.', kind: 'mis', chance: 'Kans op een doelpunt: ' + pct(e.pGoal) + '.' };
    }
    if (a.type === 'dribble') {
      const e = M.evalDribble(v, carrier, a, st.opps);
      const len = C.dist(carrier, a);
      const ms = durFor(len, 7.5, 400, 1050);
      const chance = 'Kans dat je de bal houdt: ' + pct(1 - e.risk) + '.';
      // clearly too risky: lost. Some risk: a duel that can go either way.
      const duel = e.risk >= 0.15 && e.risk < 0.5;
      if (e.risk >= 0.5 || (duel && R() < e.risk)) {
        let best = null, bd = 1e9;
        st.opps.forEach((o, i) => { const s = C.segInfo(o, carrier, a); if (s.d < bd) { bd = s.d; best = { i, point: s.point }; } });
        moveTo(carrier, best.point, len);
        moveTo(st.opps[best.i], best.point, 6);
        st.ball = { x: best.point.x, y: best.point.y }; st.holder = { team: 'them', idx: best.i };
        flow(st, [carrier, st.opps[best.i]], ms);
        frames.push(snap(st, ms, duel ? 'Duel verloren' : 'Bal afgepakt'));
        return { end: true, text: duel ? 'Een tegenstander won het duel en pakte de bal af.' : 'Een tegenstander pakte de bal af.', kind: 'verlies', chance, unlucky: duel };
      }
      moveTo(carrier, a);
      st.ball = { x: carrier.x, y: carrier.y };
      const reacted = teamReact(st.opps, carrier, C.THEIR_GOAL);
      flow(st, reacted.concat([carrier]), ms);
      frames.push(snap(st, ms, duel ? 'Duel gewonnen' : ''));
      const who = nameOf(st, ci) === 'Jij' ? 'Je' : nameOf(st, ci);
      return { text: duel ? who + ' won het duel en dribbelde verder.' : who + ' dribbelde verder.', kind: 'veilig', chance, luck: duel };
    }
    // pass
    const e = M.evalPass(v, carrier, { x: a.x, y: a.y }, a.to, st.mates, st.opps);
    const len = C.dist(carrier, a);
    const ms = durFor(len, 21, 300, 950);
    const chance = 'Kans dat de pass aankomt: ' + pct(e.success) + '.';
    if (e.success < 0.5) {
      const inter = M.interceptInfo(carrier, a, st.opps);
      let taker, point;
      if (inter.by && inter.p > 0.05) { taker = st.opps.indexOf(inter.by.d); point = inter.by.point; }
      else {
        // nobody on the line: the ball went to space and an opponent got there first
        point = { x: a.x, y: a.y };
        let bd = 1e9;
        st.opps.forEach((o, i) => { const d = C.dist(o, point); if (d < bd) { bd = d; taker = i; } });
      }
      moveTo(st.opps[taker], point, 7);
      st.ball = { x: st.opps[taker].x, y: st.opps[taker].y }; st.holder = { team: 'them', idx: taker };
      if (a.run) moveTo(carrier, a.run, 4); // started the run, but the ball was lost
      const involved = [st.opps[taker], carrier];
      if (e.recvIdx != null) { moveTo(st.mates[e.recvIdx], point, 2); involved.push(st.mates[e.recvIdx]); }
      flow(st, involved, ms);
      frames.push(snap(st, ms, 'Onderschept'));
      const txt = a.to == null ? 'De tegenstander was als eerste bij de bal.' : 'De pass werd onderschept.';
      return { end: true, text: txt, kind: 'verlies', chance };
    }
    const ri = e.recvIdx;
    moveTo(st.mates[ri], a);
    st.ball = { x: a.x, y: a.y }; st.holder = { team: 'us', idx: ri };
    const who = nameOf(st, ri);
    const winner = receiveDuel(st.mates[ri], st.opps, R);
    if (winner >= 0) {
      const o = st.opps[winner];
      moveTo(o, st.mates[ri], C.dist(o, st.mates[ri]) - 0.8);
      st.ball = { x: o.x, y: o.y }; st.holder = { team: 'them', idx: winner };
      flow(st, [o, st.mates[ri]], ms);
      frames.push(snap(st, ms, 'Duel verloren'));
      return { end: true, text: (who === 'Jij' ? 'Je kreeg de bal, maar een tegenstander zat er meteen bovenop en won het duel.' : 'De bal kwam bij ' + who + ', maar een tegenstander zat er meteen bovenop en won het duel.'), kind: 'verlies', chance, unlucky: true };
    }
    const reacted = teamReact(st.opps, { x: a.x, y: a.y }, C.THEIR_GOAL);
    // "geef en ga": the passer runs to where the player chose (pass and run), or,
    // without a chosen run, after a pass forward or in their half sprints on into
    // free space, so they can get the ball back
    const going = [];
    if (a.run) {
      moveTo(carrier, a.run);
      going.push(carrier);
    } else if (carrier.pos !== 'K' && (a.y < carrier.y - 2 || carrier.y < 34)) {
      let bestSpot = null, bestFree = -1;
      [[0, -8], [-5, -7], [5, -7]].forEach(([dx, dy]) => {
        const q = C.clampToField({ x: carrier.x + dx, y: carrier.y + dy });
        const free = Math.min(...st.opps.map(o => C.dist(o, q)));
        if (free > bestFree) { bestFree = free; bestSpot = q; }
      });
      moveTo(carrier, bestSpot, 7);
      going.push(carrier);
    }
    flow(st, reacted.concat([st.mates[ri]], going), ms);
    frames.push(snap(st, ms));
    const free = M.pressure(st.mates[ri], st.opps) < 0.4;
    const txt = who === 'Jij' ? 'Jij kreeg de bal' + (free ? ' en staat vrij.' : '.') : 'De bal kwam aan bij ' + who + (free ? ', die vrij staat.' : '.');
    return { text: txt, kind: 'veilig', chance };
  }

  // Best follow-up for our player on the ball (no "me" restrictions). Like the
  // opponent, a good player picks the most valuable option that will probably
  // work (pass arrives / keeps the ball at least half the time); only when there
  // is no such option the most valuable one.
  function bestOurs(sc, st, ci) {
    const v = viewFor(sc, st, 'us', ci);
    const cands = J.candidates(v);
    let best = null, be = -1e9, safe = null, se = -1e9;
    cands.forEach(c => {
      const e = J.evaluate(v, c);
      if (e.ev > be) { be = e.ev; best = c; }
      const works = c.type === 'shot' || (c.type === 'pass' ? e.success >= 0.5 : (e.risk == null || e.risk < 0.5));
      if (works && e.ev > se) { se = e.ev; safe = c; }
    });
    return safe || best;
  }

  // Opponent with the ball plays his most dangerous option.
  function execTheirs(sc, st, frames, R) {
    const ci = st.holder.idx;
    const v = viewFor(sc, st, 'them', ci, sc.me);
    const { opts } = M.threatOptions(v, st.mates);
    // a good team plays the most dangerous option that will probably work
    const choice = opts.find(o => o.type === 'shot' || o.success >= 0.6) || opts[0];
    const carrier = st.opps[ci];
    if (choice.type === 'shot') {
      const len = C.dist(carrier, C.OUR_GOAL);
      const ms = durFor(len, 26, 250, 650);
      if (choice.success >= 0.4) {
        st.ball = { x: CX + (carrier.x < CX ? 1.5 : -1.5), y: L + 0.6 }; st.holder = null;
        frames.push(snap(st, ms, 'Tegendoelpunt'));
        return { end: true, text: 'De tegenstander scoorde.', kind: 'tegengoal' };
      }
      const k = st.mates.find(m => m.pos === 'K');
      if (k && choice.success >= 0.12) {
        moveTo(k, { x: C.clamp(carrier.x, CX - 2.5, CX + 2.5), y: k.y }, 2.5);
        st.ball = { x: k.x, y: k.y - 0.5 }; st.holder = { team: 'us', idx: st.mates.indexOf(k) };
        frames.push(snap(st, ms, 'Gered'));
        return { end: true, text: 'De tegenstander schoot, maar onze keeper hield hem.', kind: 'gevaar' };
      }
      st.ball = { x: CX + (carrier.x < CX ? -5 : 5), y: L + 1 }; st.holder = null;
      frames.push(snap(st, ms, 'Naast'));
      return { end: true, text: 'De tegenstander kon schieten, maar miste.', kind: 'gevaar' };
    }
    if (choice.type === 'dribble') {
      const len = C.dist(carrier, choice);
      const ms = durFor(len, 7.5, 400, 1050);
      const risk = 1 - choice.success;
      const duel = risk >= 0.15 && risk < 0.5;
      if (choice.success < 0.5 || (duel && R() < risk)) {
        let best = null, bd = 1e9;
        st.mates.forEach((m, i) => { const s = C.segInfo(m, carrier, choice); if (s.d < bd) { bd = s.d; best = { i, point: s.point }; } });
        moveTo(carrier, best.point, len);
        moveTo(st.mates[best.i], best.point, 6);
        st.ball = { x: best.point.x, y: best.point.y }; st.holder = { team: 'us', idx: best.i };
        flow(st, [carrier, st.mates[best.i]], ms);
        frames.push(snap(st, ms, duel ? 'Duel gewonnen' : 'Bal veroverd'));
        const who = nameOf(st, best.i);
        return { end: true, text: (who === 'Jij' ? 'Jij' : who) + (duel ? ' won het duel en pakte de bal af!' : ' pakte de bal af!'), kind: 'gewonnen', luck: duel };
      }
      moveTo(carrier, choice);
      st.ball = { x: carrier.x, y: carrier.y };
      const reacted = teamReact(st.mates, carrier, C.OUR_GOAL);
      flow(st, reacted.concat([carrier]), ms);
      frames.push(snap(st, ms));
      return { text: 'De tegenstander kon met de bal naar voren dribbelen.', kind: 'gevaar' };
    }
    const len = C.dist(carrier, choice);
    const ms = durFor(len, 21, 300, 950);
    if (choice.success < 0.5) {
      let taker = choice.by ? st.mates.indexOf(choice.by.d) : -1;
      let point = choice.by ? choice.by.point : null;
      if (taker < 0) {
        let bd = 1e9;
        st.mates.forEach((m, i) => { const s = C.segInfo(m, carrier, choice); if (s.d < bd) { bd = s.d; taker = i; point = s.point; } });
      }
      moveTo(st.mates[taker], point, 7);
      st.ball = { x: st.mates[taker].x, y: st.mates[taker].y }; st.holder = { team: 'us', idx: taker };
      flow(st, [st.mates[taker], carrier], ms);
      frames.push(snap(st, ms, 'Onderschept'));
      const who = nameOf(st, taker);
      return { end: true, text: (who === 'Jij' ? 'Jij onderschepte' : who + ' onderschepte') + ' de pass!', kind: 'gewonnen' };
    }
    const ri = choice.to;
    st.ball = { x: st.opps[ri].x, y: st.opps[ri].y }; st.holder = { team: 'them', idx: ri };
    const winner = receiveDuel(st.opps[ri], st.mates, R);
    if (winner >= 0) {
      const m = st.mates[winner];
      moveTo(m, st.opps[ri], C.dist(m, st.opps[ri]) - 0.8);
      st.ball = { x: m.x, y: m.y }; st.holder = { team: 'us', idx: winner };
      flow(st, [m, st.opps[ri]], ms);
      frames.push(snap(st, ms, 'Duel gewonnen'));
      const who = nameOf(st, winner);
      return { end: true, text: (who === 'Jij' ? 'Jij zat er meteen bovenop en won' : who + ' zat er meteen bovenop en won') + ' het duel!', kind: 'gewonnen', luck: true };
    }
    const reacted = teamReact(st.mates, st.opps[ri], C.OUR_GOAL);
    flow(st, reacted.concat([st.opps[ri]]), ms);
    frames.push(snap(st, ms));
    const free = M.pressure(st.opps[ri], st.mates) < 0.4;
    return { text: free ? 'De tegenstander speelde een vrije medespeler aan.' : 'De tegenstander speelde de bal door.', kind: free ? 'gevaar' : 'neutraal' };
  }

  function simulate(sc, action, seed) {
    // same situation + same choice = same duels every time
    const runKey = action.run ? [Math.round(action.run.x), Math.round(action.run.y)] : [];
    const R = C.rng(((seed >>> 0) ^ C.hash(JSON.stringify([action.type, Math.round(action.x), Math.round(action.y)].concat(runKey)))) >>> 0);
    const st = {
      mates: sc.mates.map(p => Object.assign({}, p)),
      opps: sc.opps.map(p => Object.assign({}, p)),
      ball: { x: sc.ball.x, y: sc.ball.y },
      holder: { team: sc.carrier.team, idx: sc.carrier.idx }
    };
    const frames = [snap(st, 0)];
    const lines = [];
    let res = null, chance = '';

    if (sc.poss === 'us') {
      if (sc.carrier.idx === sc.me) {
        res = execOurs(sc, st, sc.me, action, frames, R);
        chance = res.chance;
      } else {
        // the player runs (teammates move with him), then the teammate on the ball decides
        const me = st.mates[sc.me];
        const len = C.dist(me, action);
        const ms = durFor(len, 7.5, 400, 1100);
        moveTo(me, action);
        // only the opponent who was marking the player follows him
        const start = sc.mates[sc.me];
        let mi = -1, md = 6;
        st.opps.forEach((o, i) => { const d = C.dist(o, start); if (o.pos !== 'K' && d < md) { md = d; mi = i; } });
        const involved = [me];
        if (mi >= 0) { moveTo(st.opps[mi], C.towards(me, C.THEIR_GOAL, 1.8), Math.min(len * 0.6, 4)); involved.push(st.opps[mi]); }
        flow(st, involved, ms * 0.6);
        frames.push(snap(st, ms));
        const ci = sc.carrier.idx;
        const choice = bestOurs(sc, st, ci);
        const toMe = choice.type === 'pass' && (choice.to === sc.me ||
          (choice.to == null && C.dist(st.mates[sc.me], choice) < 6));
        lines.push(toMe ? nameOf(st, ci) + ' speelde de bal naar jou.' : nameOf(st, ci) + ' koos voor een andere oplossing.');
        res = execOurs(sc, st, ci, choice, frames, R);
      }
      // keep playing (up to two more actions) while we have the ball
      for (let k = 0; k < 2 && !res.end && st.holder && st.holder.team === 'us'; k++) {
        lines.push(res.text);
        const next = bestOurs(sc, st, st.holder.idx);
        if (!next) break;
        res = execOurs(sc, st, st.holder.idx, next, frames, R);
      }
    } else {
      const me = st.mates[sc.me];
      const len = C.dist(me, action);
      const ms = durFor(len, 7.5, 400, 1100);
      moveTo(me, action);
      flow(st, [me, st.opps[sc.carrier.idx]], ms * 0.5);
      frames.push(snap(st, ms));
      const carrier = st.opps[sc.carrier.idx];
      // pressing right on the ball carrier: a duel. Better chance from the goal side.
      const pWin = me.pos !== 'K' && C.dist(me, carrier) < 2.2 ? (me.y >= carrier.y - 0.5 ? 0.3 : 0.15) : 0;
      if (pWin && R() < pWin) {
        moveTo(me, carrier, C.dist(me, carrier) - 0.8);
        st.ball = { x: me.x, y: me.y }; st.holder = { team: 'us', idx: sc.me };
        flow(st, [me, carrier], 500);
        frames.push(snap(st, 500, 'Duel gewonnen'));
        res = { end: true, text: 'Jij won het duel en pakte de bal af! (kans ' + pct(pWin) + ')', kind: 'gewonnen', luck: true };
      } else {
        if (pWin) lines.push('Je zette druk, maar de tegenstander won het duel (jouw kans was ' + pct(pWin) + ').');
        res = execTheirs(sc, st, frames, R);
      }
      for (let k = 0; k < 2 && !res.end && st.holder && st.holder.team === 'them'; k++) {
        lines.push(res.text);
        res = execTheirs(sc, st, frames, R);
      }
    }
    lines.push(res.text);
    if (chance) lines.push(chance);
    const good = ['goal', 'kans', 'veilig', 'gewonnen'].includes(res.kind);
    return { frames, outcome: { text: lines.join(' '), kind: res.kind, good, luck: !!res.luck, unlucky: !!res.unlucky } };
  }

  JO.playout = { simulate };
})();
