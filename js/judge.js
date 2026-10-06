// Judging: a simple football model that scores any move, searches for the best
// move, and turns the comparison into Goed / Oké / Kan beter plus mistake tags.
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const W = C.W, L = C.L, CX = W / 2;
  const RUN_REACH = 12, KEEPER_REACH = 8, DRIBBLE_REACH = 9;

  // ---------- basic model ----------
  // Value of having the ball at p for us (attacking y = 0).
  // Progress up the field plus (discounted) the chance to score from there later.
  // `defenders` (optional): opponents that can block a later shot.
  function vUs(p, defenders) {
    const prog = C.clamp(1 - p.y / L, 0, 1);
    const pr = Math.min(prog, 0.75);
    const blockers = defenders ? defenders.filter(d => d.pos !== 'K' && C.dist(d, p) > 1.5) : [];
    return 0.04 + 0.3 * pr * pr + 0.55 * shotProb(p, C.THEIR_GOAL, blockers, 1);
  }
  const flipP = p => ({ x: W - p.x, y: L - p.y, pos: p.pos });
  const vThem = (p, defenders) => vUs(flipP(p), defenders ? defenders.map(flipP) : null);
  const lossCost = p => 0.03 + 0.8 * vThem(p);

  function pressure(p, defenders) {
    let dmin = 1e9;
    defenders.forEach(d => { const dd = C.dist(p, d); if (dd < dmin) dmin = dd; });
    return C.clamp((6 - dmin) / 4.5, 0, 1);
  }

  // Pressure on an opponent with the ball from our defenders. A defender standing
  // between the ball and our goal counts fully; one chasing from behind much less.
  function pressureGoalSide(p, defenders) {
    let dmin = 1e9;
    defenders.forEach(d => {
      const goalSide = d.y >= p.y - 0.5;
      const dd = C.dist(p, d) / (goalSide ? 1 : 0.55);
      if (dd < dmin) dmin = dd;
    });
    return C.clamp((6 - dmin) / 4.5, 0, 1);
  }

  // Every position has its own area. Leaving it (a back running to the other wing,
  // a defender running to the opponent's goal) is penalised, so players learn
  // their role. sc.home = the normal spot for this position in this situation.
  // Size of each position's area: [sideways, forwards/backwards] in meters.
  // Wide players have a narrow but long area: they keep the width of the team.
  const ROLE_ZONE = {
    K: [5, 5], LA: [5, 11], RA: [5, 11], CV: [7, 8],
    LM: [5, 12], RM: [5, 12], CM: [7, 10], SP: [8, 12]
  };
  const ROLE_R = { K: 5, LA: 9, CV: 9, RA: 9, LM: 10, CM: 10, RM: 10, SP: 11 };
  function roleFactor(sc, P) {
    if (!sc.home) return 1;
    const me = sc.mates[sc.me];
    let z = ROLE_ZONE[me.pos] || [8, 10];
    // with the ball, wide players may also come inside to make space for a teammate
    if (sc.poss === 'us' && ['LA', 'RA', 'LM', 'RM'].includes(me.pos)) z = [9, z[1]];
    const u = Math.hypot((P.x - sc.home.x) / z[0], (P.y - sc.home.y) / z[1]);
    const ex = Math.max(0, u - 1);
    return 1 / (1 + (ex / 0.6) * (ex / 0.6));
  }
  function inRole(sc, P) { return roleFactor(sc, P) > 0.8; }

  // Chance that a pass from a to b is intercepted by one of the defenders.
  function interceptInfo(a, b, defenders, ignore) {
    const len = C.dist(a, b);
    let keep = 1, worst = null, worstP = 0;
    defenders.forEach(d => {
      if (ignore && ignore.includes(d)) return;
      const s = C.segInfo(d, a, b);
      if (s.t < -0.05 || s.t > 1.02) return;
      const tt = C.clamp(s.t, 0, 0.92);
      const reach = 1.2 + 0.1 * len * tt;
      let p = C.clamp(1 - s.d / reach, 0, 1);
      p = 0.92 * Math.pow(p, 0.7);
      // a defender close to the passer can be played around: he only blocks a
      // little (pressing works through `pressure`, not by blocking every line)
      p *= 0.3 + 0.7 * C.clamp((C.dist(d, a) - 1) / 4, 0, 1);
      if (p > worstP) { worstP = p; worst = { d, point: s.point }; }
      keep *= (1 - p);
    });
    let pInt = 1 - keep;
    // long passes are hard at this age: from 20m on they get less accurate
    if (len > 20) pInt = 1 - (1 - pInt) * (1 - Math.min(0.5, (len - 20) * 0.02));
    return { p: C.clamp(pInt, 0, 0.98), by: worst, len };
  }

  function shotProb(from, goal, blockers, keeperFactor) {
    const d = C.dist(from, goal);
    const gl = { x: goal.x - C.GOAL_W / 2, y: goal.y }, gr = { x: goal.x + C.GOAL_W / 2, y: goal.y };
    const a1 = Math.atan2(gl.x - from.x, Math.abs(gl.y - from.y));
    const a2 = Math.atan2(gr.x - from.x, Math.abs(gr.y - from.y));
    const angle = Math.abs(a2 - a1);
    let p = 1.1 * Math.exp(-d / 8) * C.clamp(angle / 0.5, 0, 1);
    blockers.forEach(b => {
      const s = C.segInfo(b, from, goal);
      if (s.t > 0.05 && s.t < 0.95 && s.d < 1.6) p *= 0.45 + 0.35 * (s.d / 1.6);
    });
    return C.clamp(p * (keeperFactor || 1), 0, 0.85);
  }

  // How well our keeper covers a shot from p (lower = better for us).
  function ourKeeperFactor(k, p) {
    if (!k) return 1.3;
    const s = C.segInfo(k, p, C.OUR_GOAL);
    const dGoal = C.dist(k, C.OUR_GOAL);
    let f = 0.6 + 0.8 * C.clamp((s.d - 0.8) / 4, 0, 1);
    if (dGoal > 8) f += 0.25;
    return f;
  }

  function dribbleRisk(a, b, defenders) {
    let keep = 1;
    defenders.forEach(d => {
      const s = C.segInfo(d, a, b);
      const r = d.pos === 'K' ? 5 : 3.2; // a keeper comes out and has hands
      const q = C.clamp(1 - s.d / r, 0, 1) * 0.8;
      keep *= 1 - q;
    });
    return 1 - keep;
  }

  function markedness(o, defenders) {
    const spot = C.towards(o, C.OUR_GOAL, 1.5);
    let m = 0;
    defenders.forEach(d => { m = Math.max(m, C.clamp(1 - C.dist(d, spot) / 4.5, 0, 1)); });
    return m;
  }

  // ---------- our team on the ball ----------
  function ctxMul(sc) { return { risk: sc.risk || 1, att: sc.att || 1 }; }

  function evalPass(sc, from, target, receiverIdx, mates, opps) {
    const k = ctxMul(sc);
    const passer = from;
    const pressP = pressure(passer, opps);
    const inter = interceptInfo(passer, target, opps);
    let race = 1, recvIdx = receiverIdx;
    if (receiverIdx == null) {
      // pass into space: who gets there first?
      let tM = 1e9, tO = 1e9;
      mates.forEach((m, i) => {
        if (m === passer) return;
        const t = C.dist(m, target) / 6.5;
        if (t < tM) { tM = t; recvIdx = i; }
      });
      opps.forEach(o => { tO = Math.min(tO, C.dist(o, target) / 6.5); });
      const ballT = inter.len / 15 + 0.2;
      race = 1 / (1 + Math.exp(-(tO - tM) * 3));
      if (tM > ballT + 2.2) race *= 0.35;
      if (tM > 2.4) race *= 0.2;
    }
    const success = (1 - inter.p) * race * (1 - 0.15 * pressP);
    const rPress = pressure(target, opps);
    const gain = vUs(target, opps) * (1 - 0.35 * rPress) * k.att + 0.02;
    // a teammate with an opponent right on him can lose the ball straight away,
    // unless he can lay it off first time to a free teammate (kaatsen / een-twee)
    let pLoseAfter = 0.3 * Math.pow(rPress, 1.5);
    if (rPress > 0.4 && recvIdx != null) {
      const recv = target;
      const layoff = mates.some(m => m !== mates[recvIdx] && C.dist(m, recv) < 12 &&
        pressure(m, opps) < 0.3 && interceptInfo(recv, m, opps).p < 0.25);
      if (layoff) pLoseAfter *= 0.5;
    }
    const lossAt = inter.by ? inter.by.point : target;
    const ev = success * ((1 - pLoseAfter) * gain - pLoseAfter * lossCost(target) * k.risk)
      - (1 - success) * lossCost(lossAt) * k.risk;
    return { ev, success, pInt: inter.p, race, rPress, len: inter.len, recvIdx, target };
  }

  function evalShot(sc, from, target, opps) {
    const k = ctxMul(sc);
    const blockers = opps.filter(o => o.pos !== 'K');
    let p = shotProb(from, C.THEIR_GOAL, blockers, 1);
    if (pressure(from, opps) > 0.7) p *= 0.75;
    const ev = p * 1.0 - (1 - p) * 0.03 * k.risk;
    return { ev, pGoal: p };
  }

  function evalDribble(sc, from, to, opps) {
    const k = ctxMul(sc);
    const risk = dribbleRisk(from, to, opps);
    // dribbling takes time: opponents close in while you run with the ball
    const len = C.dist(from, to);
    const closed = opps.map(o => Object.assign({}, o, C.towards(o, to, len * 0.6)));
    const press = pressure(to, closed);
    let ev = 0.92 * (1 - risk) * vUs(to, closed) * (1 - 0.35 * press) * k.att - risk * lossCost(to) * k.risk;
    // dribbling back towards our own goal is not what we want to teach
    ev -= 0.007 * Math.max(0, to.y - from.y);
    // dribbling onto the sideline or the goal line: the ball easily goes out
    if (to.x < 2 || to.x > W - 2 || to.y < 2) ev -= 0.02;
    return { ev, risk, press };
  }

  // Off-ball run while a teammate has the ball.
  // ---------- restverdediging ----------
  // Team agreement: when we have the ball, every opponent who stays up front
  // (closer to our goal than the ball, away from the ball, near or in our half)
  // has one of our players near them, not far on the wrong side, for when we
  // lose the ball. Not when the ball is in our own third (build-up).
  const REST_NEAR = 7, REST_WRONG_SIDE = 5, REST_PEN = 0.2;
  const REST_ROLES = ['LA', 'CV', 'RA'];
  function restForwards(sc) {
    const t = (JO.team && JO.team.tactics) || {};
    if (t.restverdediging === 'uit' || sc.poss !== 'us' || sc.ball.y > L - 20) return [];
    return sc.opps.filter(o => o.pos !== 'K' && o.y > sc.ball.y && C.dist(o, sc.ball) > 10 && o.y > L / 2 - 8);
  }
  // How many of them nobody covers, with the player at P (one player per opponent).
  function restOpen(sc, P) {
    const F = restForwards(sc).sort((a, b) => b.y - a.y);
    if (!F.length) return 0;
    const ours = sc.mates.map((m, i) => i === sc.me ? { x: P.x, y: P.y, pos: m.pos, i } : Object.assign({ i }, m))
      .filter(m => m.pos !== 'K' && m.i !== sc.carrier.idx);
    const used = new Set();
    let open = 0;
    F.forEach(o => {
      let bi = -1, bd = REST_NEAR;
      ours.forEach(m => { const d = C.dist(m, o); if (!used.has(m.i) && d <= bd && m.y >= o.y - REST_WRONG_SIDE) { bd = d; bi = m.i; } });
      if (bi < 0) open++; else used.add(bi);
    });
    return open;
  }

  function evalSupport(sc, P) {
    const carrier = sc.mates[sc.carrier.idx];
    const opps = sc.opps;
    const inter = interceptInfo(carrier, P, opps);
    const lane = 1 - inter.p;
    const rPress = pressure(P, opps);
    let score = Math.pow(lane, 1.5) * (0.06 + vUs(P, opps) * (sc.att || 1)) * (1 - 0.45 * rPress);
    let nearMate = 1e9;
    sc.mates.forEach((m, i) => { if (i !== sc.me && i !== sc.carrier.idx) nearMate = Math.min(nearMate, C.dist(m, P)); });
    const dCar = C.dist(carrier, P);
    if (nearMate < 6) score *= 0.6 + 0.4 * nearMate / 6;
    if (dCar < 6) score *= 0.55 + 0.45 * dCar / 6;
    const rf = roleFactor(sc, P);
    score *= rf;
    // our defenders: leaving an opponent who stays up front free costs a lot
    const restO = REST_ROLES.includes(sc.mates[sc.me].pos) ? restOpen(sc, P) : 0;
    score -= REST_PEN * restO;
    return { ev: score, lane, rPress, nearMate, dCar, len: inter.len, role: rf, restOpen: restO };
  }

  // ---------- they have the ball ----------
  // Options the opponent with the ball has, each with a danger value.
  function threatOptions(sc, defenders) {
    const carrier = sc.opps[sc.carrier.idx];
    const pressC = pressureGoalSide(carrier, defenders);
    const ourK = defenders.find(d => d.pos === 'K');
    const opts = [];
    sc.opps.forEach((o, i) => {
      if (i === sc.carrier.idx) return;
      const inter = interceptInfo(carrier, o, defenders);
      const lane = (1 - inter.p) * (1 - 0.25 * pressC);
      const open = 1 - markedness(o, defenders);
      opts.push({ type: 'pass', to: i, x: o.x, y: o.y, success: lane, by: inter.by,
        value: lane * (0.04 + vThem(o, defenders)) * (0.3 + 0.7 * open) });
    });
    const fwd = C.clampToField(C.towards(carrier, C.OUR_GOAL, 8));
    const dr = dribbleRisk(carrier, fwd, defenders);
    opts.push({ type: 'dribble', x: fwd.x, y: fwd.y, success: 1 - dr,
      value: (1 - dr) * vThem(fwd, defenders) * (0.6 + 0.4 * (1 - pressC)) });
    if (C.dist(carrier, C.OUR_GOAL) < 26) {
      const blockers = defenders.filter(d => d.pos !== 'K');
      const p = shotProb(carrier, C.OUR_GOAL, blockers, ourKeeperFactor(ourK, carrier)) * (1 - 0.4 * pressC);
      opts.push({ type: 'shot', x: C.OUR_GOAL.x, y: C.OUR_GOAL.y, success: p, value: p });
    }
    opts.sort((a, b) => b.value - a.value);
    return { opts, pressC };
  }

  function threat(sc, defenders) {
    const { opts, pressC } = threatOptions(sc, defenders);
    const w = [0.55, 0.25, 0.12, 0.08];
    let t = 0;
    w.forEach((wi, i) => { t += wi * (opts[i] ? opts[i].value : 0); });
    return t * (1 - 0.2 * pressC);
  }

  // Where the keeper should stand: on the line from the middle of the goal to the
  // ball. How far out depends on how far up the field the ball is (not how far
  // to the side), and he always stays between the posts sideways.
  function keeperSpot(ball) {
    const up = L - ball.y;
    const out = C.clamp(1.2 + (up - 10) * 0.3, 1.0, C.KEEPER_ZONE - 2);
    const p = C.towards(C.OUR_GOAL, ball, Math.min(out, C.dist(ball, C.OUR_GOAL) - 2));
    p.x = C.clamp(p.x, C.OUR_GOAL.x - C.GOAL_W / 2 + 0.5, C.OUR_GOAL.x + C.GOAL_W / 2 - 0.5);
    p.y = Math.min(p.y, L - 0.8);
    return p;
  }

  // Is the player the outfield teammate closest to the opponent with the ball?
  function closestToBall(sc) {
    const carrier = sc.opps[sc.carrier.idx];
    const dMe = C.dist(sc.mates[sc.me], carrier);
    return !sc.mates.some((m, i) => i !== sc.me && m.pos !== 'K' && C.dist(m, carrier) < dMe - 0.5);
  }

  function otherPresser(sc) {
    const carrier = sc.opps[sc.carrier.idx];
    return sc.mates.some((m, i) => i !== sc.me && m.pos !== 'K' && C.dist(m, carrier) < 5);
  }
  function ballNearMyArea(sc) {
    if (!sc.home) return true;
    const me = sc.mates[sc.me];
    return C.dist(sc.opps[sc.carrier.idx], sc.home) <= (ROLE_R[me.pos] || 10) + 5;
  }

  // Team rule: the teammate closest to the ball presses it. If that is not the
  // player, we assume that teammate steps up to press, so the player's job is to
  // cover or mark instead of running to the ball as well.
  function teamWithPresser(sc) {
    if (closestToBall(sc)) return sc.mates;
    const carrier = sc.opps[sc.carrier.idx];
    let pi = -1, bd = 1e9;
    sc.mates.forEach((m, i) => {
      if (i === sc.me || m.pos === 'K') return;
      const d = C.dist(m, carrier);
      if (d < bd) { bd = d; pi = i; }
    });
    if (pi < 0 || bd > 14) return sc.mates;
    const spot = C.towards(carrier, C.OUR_GOAL, 2);
    return sc.mates.map((m, i) => i === pi ? Object.assign({}, m, { x: spot.x, y: spot.y }) : m);
  }

  function evalDefend(sc, P) {
    // team agreement: at the opponent's goal kick we drop back into our block
    if (sc.dropBack) {
      let score = -0.01 * C.dist(P, sc.home);
      if (sc.keepAway && C.dist(P, sc.ball) < sc.keepAway - 0.1) score -= 1;
      return { ev: score, role: 1 };
    }
    const base = teamWithPresser(sc);
    const defenders = base.map((m, i) => i === sc.me ? Object.assign({}, m, { x: P.x, y: P.y }) : m);
    let score = -threat(sc, defenders);
    const carrier = sc.opps[sc.carrier.idx];
    const me = sc.mates[sc.me];
    // small shape tie-breakers
    if (me.pos !== 'SP' && P.y < carrier.y - 3) score -= 0.006 * (carrier.y - 3 - P.y) / 10;
    let nearMate = 1e9;
    sc.mates.forEach((m, i) => { if (i !== sc.me && m.pos !== 'K') nearMate = Math.min(nearMate, C.dist(m, P)); });
    if (nearMate > 14) score -= 0.004 * (nearMate - 14) / 10;
    if (sc.keepAway && C.dist(P, sc.ball) < sc.keepAway - 0.1) score -= 1;
    // keeper: on the line between ball and the middle of the goal; further out
    // of the goal when the ball is far away, close to the line when it is near
    if (me.pos === 'K') {
      const t = keeperSpot(carrier);
      score -= 0.012 * C.dist(P, t);
    }
    // One player presses, the others cover. Pressing next to a teammate who is
    // already pressing leaves an opponent free.
    const pressing = C.dist(P, carrier) < 4;
    if (pressing && !closestToBall(sc)) score -= 0.03;
    // role: stay in your own area. Exception: the closest player presses the ball,
    // but only when the ball is in or near his own area.
    let rf = roleFactor(sc, P);
    if (pressing && closestToBall(sc) && ballNearMyArea(sc)) rf = 1;
    score -= 0.06 * (1 - rf);
    return { ev: score, role: rf };
  }

  // ---------- actions ----------
  function reach(sc) {
    if (sc.reach) return sc.reach;
    const me = sc.mates[sc.me];
    if (sc.poss === 'us' && sc.carrier.idx === sc.me) return DRIBBLE_REACH;
    return me.pos === 'K' ? KEEPER_REACH : RUN_REACH;
  }

  function isShotTarget(p) {
    return p.y < 2.2 && Math.abs(p.x - CX) < C.GOAL_W / 2 + 0.6;
  }

  // Turn a drop of the ball at point p into an action.
  function ballAction(sc, p) {
    if (isShotTarget(p)) return { type: 'shot', x: p.x, y: Math.max(0, p.y) };
    let best = -1, bd = 3.5;
    sc.mates.forEach((m, i) => { if (i === sc.me) return; const d = C.dist(m, p); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) return { type: 'pass', to: best, x: sc.mates[best].x, y: sc.mates[best].y };
    // ball dropped into space close to yourself, where you are our nearest player:
    // you meant to take the ball with you, so it is a dribble
    const me = sc.mates[sc.me];
    const dMe = C.dist(me, p);
    const mateCloser = sc.mates.some((m, i) => i !== sc.me && C.dist(m, p) < dMe);
    if (!mateCloser && dMe <= DRIBBLE_REACH) {
      const q = C.clampToField(p);
      return { type: 'dribble', x: q.x, y: q.y };
    }
    return { type: 'pass', to: null, x: p.x, y: p.y };
  }

  function evaluate(sc, a) {
    const me = sc.mates[sc.me];
    if (a.type === 'pass') return evalPass(sc, me, { x: a.x, y: a.y }, a.to, sc.mates, sc.opps);
    if (a.type === 'shot') return evalShot(sc, me, { x: a.x, y: a.y }, sc.opps);
    if (a.type === 'dribble') return evalDribble(sc, me, { x: a.x, y: a.y }, sc.opps);
    if (a.type === 'move') return sc.poss === 'us' ? evalSupport(sc, a) : evalDefend(sc, a);
    return { ev: -1 };
  }

  function candidates(sc) {
    const me = sc.mates[sc.me];
    const out = [];
    const R = reach(sc);
    if (sc.poss === 'us' && sc.carrier.idx === sc.me) {
      if (!sc.onlyDribble) {
        sc.mates.forEach((m, i) => {
          if (i === sc.me) return;
          out.push({ type: 'pass', to: i, x: m.x, y: m.y });
          [2.5, 5, 9].forEach(dd => {
            const ahead = C.clampToField({ x: m.x + (CX - m.x) * 0.1, y: m.y - dd });
            out.push({ type: 'pass', to: null, x: ahead.x, y: ahead.y });
          });
        });
        if (C.dist(me, C.THEIR_GOAL) < 32) [-1.6, 0, 1.6].forEach(dx => out.push({ type: 'shot', x: CX + dx, y: 0.5 }));
        // near the goal: balls into the area in front of goal (cross / pull back)
        if (me.y < 22) [[-3, 9], [0, 10], [3, 9], [0, 6], [-4, 5], [4, 5]].forEach(([dx, y]) =>
          out.push({ type: 'pass', to: null, x: CX + dx, y }));
      }
      for (let k = 0; k < 16; k++) {
        const ang = k / 16 * Math.PI * 2;
        [4, 8].forEach(r => {
          const p = C.clampToField({ x: me.x + Math.cos(ang) * r, y: me.y + Math.sin(ang) * r });
          out.push({ type: 'dribble', x: p.x, y: p.y });
        });
      }
    } else {
      const step = R > 14 ? 2 : 1.5;
      for (let dx = -R; dx <= R; dx += step) {
        for (let dy = -R; dy <= R; dy += step) {
          if (dx * dx + dy * dy > R * R) continue;
          const p = C.clampToField({ x: me.x + dx, y: me.y + dy });
          if (me.pos === 'K' && p.y < L - C.KEEPER_ZONE - 6 && sc.poss === 'them') continue;
          // never suggest standing on top of another player
          if (sc.opps.some(o => C.dist(o, p) < 1.6) || sc.mates.some((m, i) => i !== sc.me && C.dist(m, p) < 1.6)) continue;
          out.push({ type: 'move', x: p.x, y: p.y });
        }
      }
    }
    return out;
  }

  function percentile(arr, q) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(q * (s.length - 1))];
  }


  // ---------- tags & explanations ----------
  const TAGS = {
    lijn_dicht: { label: 'Pass door een volle lijn', tip: 'Er stond een tegenstander dicht bij de lijn van je pass. Kijk eerst of de lijn naar je teamgenoot vrij is.' },
    ontvanger_gedekt: { label: 'Pass naar een gedekte speler', tip: 'Je teamgenoot stond meteen onder druk. Zoek een speler die vrij staat.' },
    te_lang: { label: 'Te lange bal', tip: 'Die bal was erg lang, daardoor is hij makkelijk te onderscheppen.' },
    naar_niemand: { label: 'Bal naar niemand', tip: 'Er was niemand van ons die als eerste bij die bal kon komen.' },
    vooruit_kon: { label: 'Kans vooruit gemist', tip: 'Je pass was veilig, maar er was een goede bal naar voren mogelijk.' },
    schieten_kon: { label: 'Niet geschoten', tip: 'Je stond goed om te schieten! Durf dan ook te schieten.' },
    te_ver_schieten: { label: 'Schot van te ver', tip: 'Van zo ver of uit zo\'n lastige hoek is scoren moeilijk. Een pass was beter.' },
    dribbel_in_druk: { label: 'Dribbel in de druk', tip: 'Je dribbelde recht op een tegenstander af. Een pass of een andere kant op was slimmer.' },
    dribbel_kon: { label: 'Ruimte niet gebruikt', tip: 'Er was ruimte om met de bal op te dribbelen.' },
    gevaarlijk_eigen_helft: { label: 'Risico bij eigen doel', tip: 'Balverlies dicht bij ons eigen doel is gevaarlijk. Speel hier op zeker.' },
    eigen_plek: { label: 'Eigen plek verlaten', tip: 'Je ging te ver weg van jouw eigen plek in het team. Blijf in jouw gebied, dan staat het team goed verdeeld.' },
    niet_aanspeelbaar: { label: 'Niet aanspeelbaar', tip: 'Er stond een tegenstander (bijna) in de lijn tussen jou en de bal. Een paar meter opzij en de lijn was vrij geweest.' },
    te_dicht_teamgenoot: { label: 'Te dicht bij teamgenoot', tip: 'Je stond te dicht bij een teamgenoot. Zoek je eigen ruimte, dan maken we het veld groot.' },
    te_dicht_bij_bal: { label: 'Te dicht bij de bal', tip: 'Je kwam te dicht bij de speler met de bal. Geef je teamgenoot ruimte.' },
    bij_tegenstander: { label: 'Naast een tegenstander', tip: 'Je ging vlak bij een tegenstander staan. Zoek een plek waar je vrij staat.' },
    niet_vooruit: { label: 'Te weinig diepte', tip: 'Je kon verder naar voren om de aanval te helpen.' },
    dubbel_druk: { label: 'Met twee druk zetten', tip: 'Een teamgenoot stond dichter bij de bal en zet daar druk. Eén speler zet druk, de rest geeft dekking of dekt een tegenstander.' },
    druk_zetten: { label: 'Geen druk op de bal', tip: 'Jij stond het dichtst bij de bal. Zet druk op de speler met de bal, vanaf de kant van ons doel!' },
    dekken: { label: 'Tegenstander vrij gelaten', tip: 'Er stond een tegenstander vrij bij jou in de buurt. Ga tussen die speler en ons doel staan.' },
    terug_achter_bal: { label: 'Niet terug achter de bal', tip: 'Kom terug achter de bal, tussen de bal en ons doel.' },
    naar_bal_kant: { label: 'Niet meegeschoven', tip: 'Schuif mee naar de kant van de bal, zodat we compact staan.' },
    keeper_positie: { label: 'Keeper niet goed opgesteld', tip: 'Sta als keeper op de lijn tussen de bal en het midden van je doel. Is de bal ver weg, sta dan een stuk voor je doel; komt de bal dichtbij, ga dan terug naar je doel.' },
    terugzakken: { label: 'Niet teruggezakt', tip: 'Bij een achterbal van de tegenstander zakken we terug: loop naar jouw plek rond de middenlijn, zodat we als team compact staan.' },
    afstand_5m: { label: '5 meter afstand', tip: 'Bij een spelhervatting moet je 5 meter van de bal blijven.' },
    restverdediging: { label: 'Restverdediging vergeten', tip: 'Wij hebben de bal, maar een speler van hen staat vrij achter de bal. Blijf als verdediger bij die speler in de buurt, aan de kant van ons doel. Verliezen we de bal, dan kan die speler niet alleen op ons doel af.' },
    blijven_staan: { label: 'Niet doorgelopen na pass', tip: 'Na je pass bleef je stilstaan. Loop meteen door naar een vrije plek, dan kun je de bal terugkrijgen (geef en ga).' },
    slecht_gelopen: { label: 'Na de pass verkeerd gelopen', tip: 'Je pass was goed, maar daarna liep je naar een plek waar je niet goed aanspeelbaar bent. Kijk naar het gele gebied: daar kon je beter naartoe lopen.' }
  };

  const iCarry = sc => sc.poss === 'us' && sc.carrier.idx === sc.me;
  const withMeAt = (sc, P) => sc.mates.map((m, i) => i === sc.me ? Object.assign({}, m, { x: P.x, y: P.y }) : m);
  const theirName = o => 'hun ' + C.POS_NAME[o.pos];

  // `ref` = the good option closest to what the player did (or the best option).
  function tagsFor(sc, action, info, ref, refInfo) {
    const tags = [];
    const me = sc.mates[sc.me];
    const add = t => { if (!tags.includes(t) && tags.length < 2) tags.push(t); };
    if (iCarry(sc)) {
      if (ref.type === 'shot' && action.type !== 'shot') add('schieten_kon');
      if (action.type === 'pass') {
        if (action.to == null && info.race < 0.4) add('naar_niemand');
        if (info.pInt > 0.3) add('lijn_dicht');
        if (info.rPress > 0.6 && action.to != null) add('ontvanger_gedekt');
        if (info.len > 30) add('te_lang');
        if (ref.type === 'pass' && ref.y < me.y - 6 && action.y > me.y - 3 && info.pInt < 0.25) add('vooruit_kon');
      }
      if (action.type === 'shot') add('te_ver_schieten');
      if (action.type === 'dribble' && info.risk > 0.3) add('dribbel_in_druk');
      if (ref.type === 'dribble' && action.type !== 'dribble') add('dribbel_kon');
      if (me.y > 44 && ((info.pInt || 0) > 0.25 || (info.risk || 0) > 0.3)) add('gevaarlijk_eigen_helft');
    } else if (sc.poss === 'us') {
      if ((info.restOpen || 0) > (refInfo.restOpen || 0)) add('restverdediging');
      if (info.lane < 0.8 && refInfo.lane - info.lane > 0.12) add('niet_aanspeelbaar');
      if (info.role < 0.6 && refInfo.role >= 0.8) add('eigen_plek');
      if (info.dCar < 5) add('te_dicht_bij_bal');
      if (info.nearMate < 5) add('te_dicht_teamgenoot');
      if (info.rPress > 0.5 && refInfo.rPress < 0.4) add('bij_tegenstander');
      if (ref.y < action.y - 5) add('niet_vooruit');
    } else {
      const carrier = sc.opps[sc.carrier.idx];
      if (sc.keepAway && C.dist(action, sc.ball) < sc.keepAway - 0.1) add('afstand_5m');
      if (sc.dropBack) { if (C.dist(action, sc.home) > 4) add('terugzakken'); return tags; }
      if (me.pos === 'K') { add('keeper_positie'); return tags; }
      if (C.dist(action, carrier) < 4 && !closestToBall(sc) && C.dist(ref, carrier) >= 4) add('dubbel_druk');
      if (closestToBall(sc) && C.dist(ref, carrier) < 4 && C.dist(action, carrier) > 5) add('druk_zetten');
      if (info.role < 0.6 && refInfo.role >= 0.8) add('eigen_plek');
      if (!tags.includes('druk_zetten') && action.y < carrier.y - 2 && ref.y > action.y + 4) add('terug_achter_bal');
      const defA = withMeAt(sc, action), defB = withMeAt(sc, ref);
      const freeA = sc.opps.some((o, i) => i !== sc.carrier.idx && C.dist(o, ref) < 7 && markedness(o, defA) < 0.3 && markedness(o, defB) > 0.5);
      if (freeA) add('dekken');
      if (Math.abs(action.x - carrier.x) > Math.abs(ref.x - carrier.x) + 6) add('naar_bal_kant');
    }
    return tags;
  }

  function describe(sc, a) {
    if (!a) return '';
    if (a.type === 'pass') {
      const r = a.to != null ? null : evaluate(sc, a).recvIdx;
      const base = a.to != null ? 'pass naar ' + sc.mates[a.to].name
        : r != null ? 'pass in de ruimte voor ' + sc.mates[r].name : 'pass in de ruimte';
      return base + (a.run ? ' en doorlopen' : '');
    }
    if (a.type === 'shot') return 'schieten op doel';
    if (a.type === 'dribble') {
      const me = sc.mates[sc.me];
      const dx = a.x - me.x, dy = a.y - me.y;
      if (-dy > Math.abs(dx) * 0.7) return 'dribbelen naar voren';
      if (dy > Math.abs(dx) * 0.7) return 'terug dribbelen';
      return (Math.abs(a.x - CX) < Math.abs(me.x - CX)) ? 'naar binnen dribbelen' : 'naar buiten dribbelen';
    }
    return 'naar het gele gebied lopen';
  }

  function joinNl(parts, last) {
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' ' + (last || 'en') + ' ' + parts[parts.length - 1];
  }

  // Short reasons, in kids' language, why an option is good.
  function why(sc, a) {
    const info = evaluate(sc, a);
    const me = sc.mates[sc.me];
    const parts = [];
    if (a.type === 'pass') {
      const r = info.recvIdx != null ? sc.mates[info.recvIdx] : null;
      if (a.to == null && r) parts.push(r.name + ' is als eerste bij de bal');
      else if (info.pInt < 0.2) parts.push('de lijn is vrij');
      if (r && info.rPress < 0.35) parts.push(r.name + ' staat vrij');
      if (a.y < me.y - 5) parts.push('de bal gaat naar voren');
      if (Math.abs(a.x - me.x) > 16) parts.push('de bal gaat naar de kant waar ruimte is');
    } else if (a.type === 'shot') {
      parts.push('je staat dicht genoeg bij het doel');
      const blocked = sc.opps.some(o => {
        const s = C.segInfo(o, me, C.THEIR_GOAL);
        return o.pos !== 'K' && s.d < 1.6 && s.t > 0.05;
      });
      if (!blocked) parts.push('er staat niemand tussen jou en het doel');
    } else if (a.type === 'dribble') {
      if (info.risk < 0.15) parts.push('er staat niemand in de weg');
      if (a.y < me.y - 2) parts.push('je komt dichter bij het doel');
    } else if (sc.poss === 'us') {
      const carrier = sc.mates[sc.carrier.idx];
      if (info.lane >= 0.7) parts.push('de lijn naar ' + carrier.name + ' is vrij');
      if (info.rPress < 0.3) parts.push('er staat geen tegenstander vlakbij');
      if (a.y < me.y - 3) parts.push('je staat verder naar voren');
      if (info.role >= 0.8) parts.push('je blijft in jouw gebied als ' + C.POS_NAME[me.pos]);
    } else {
      const carrier = sc.opps[sc.carrier.idx];
      const defNew = withMeAt(sc, a);
      if (sc.dropBack) return 'Je zakt terug naar jouw plek als ' + C.POS_NAME[me.pos] + ', zodat we als team compact staan.';
      if (me.pos === 'K') parts.push(L - sc.ball.y > 20 ? 'je staat op de lijn tussen de bal en het midden van je doel, een stuk voor je doel zodat je een lange bal kunt onderscheppen' : 'je staat op de lijn tussen de bal en het midden van je doel, dicht bij je doel');
      else if (C.dist(a, carrier) < 4) {
        parts.push(a.y >= carrier.y - 0.5 ? 'je zet druk op de bal, vanaf de kant van ons doel' : 'je zet druk op de bal');
      } else {
        const marked = sc.opps.find((o, i) => i !== sc.carrier.idx && C.dist(o, a) < 6 &&
          markedness(o, defNew) > 0.5 && markedness(o, sc.mates) < 0.5);
        if (marked) parts.push('je staat tussen ' + theirName(marked) + ' en ons doel');
        const lane = sc.opps.find((o, i) => {
          if (i === sc.carrier.idx) return false;
          const s = C.segInfo(a, carrier, o);
          return s.d < 1.5 && s.t > 0.15 && s.t < 0.9;
        });
        if (lane) parts.push('je staat in de lijn van een pass naar ' + theirName(lane));
        if (!marked && !lane && a.y > carrier.y + 2) parts.push('je staat tussen de bal en ons doel');
      }
      if (info.role >= 0.8 && me.pos !== 'K') parts.push('je blijft in jouw gebied als ' + C.POS_NAME[me.pos]);
    }
    if (!parts.length) return '';
    const txt = joinNl(parts);
    return txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
  }

  // Score all options and decide which count as good.
  function analyse(sc) {
    const cands = candidates(sc);
    const evals = cands.map(c => evaluate(sc, c).ev);
    let bi = 0;
    evals.forEach((e, i) => { if (e > evals[bi]) bi = i; });
    const bestEv = evals[bi];
    const ref = percentile(evals, 0.3);
    const spread = bestEv - ref;
    let cut = spread < 0.012 ? bestEv - 0.012 : bestEv - Math.max(0.008, 0.2 * spread);
    let okCut = spread < 0.012 ? -1e9 : ref + 0.45 * spread;
    // with the ball there are often several fine options that hardly differ:
    // within 8% of the best is good, within 20% at least oke
    if (sc.poss === 'us' && bestEv > 0) {
      cut = Math.min(cut, 0.92 * bestEv);
      okCut = Math.min(okCut, 0.8 * bestEv);
    }
    return { cands, evals, bi, best: cands[bi], bestEv, ref, spread, cut, okCut };
  }

  function groupKey(sc, a) {
    if (a.type === 'pass') return 'p' + evaluate(sc, a).recvIdx;
    if (a.type === 'shot') return 'shot';
    if (a.type === 'dribble') {
      const me = sc.mates[sc.me];
      return 'd' + Math.round((Math.atan2(a.y - me.y, a.x - me.x) + Math.PI) / (Math.PI / 4)) % 8;
    }
    return 'm';
  }

  function sameAction(a, b) {
    return a.type === b.type && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  }

  function judgeBase(sc, action) {
    const A = analyse(sc);
    const info = evaluate(sc, action);
    let best = A.best, bestEv = A.bestEv;
    if (info.ev > bestEv) { best = action; bestEv = info.ev; }
    let rating = info.ev >= A.cut ? 'goed' : info.ev >= A.okCut ? 'oke' : 'beter';
    // a spot right next to a good spot is "almost good"
    if (rating === 'beter' && action.type === 'move' &&
      A.cands.some((c, i) => A.evals[i] >= A.cut && C.dist(c, action) <= 3)) rating = 'oke';

    // all good options
    const goodIdx = A.evals.map((e, i) => i).filter(i => A.evals[i] >= A.cut).sort((i, j) => A.evals[j] - A.evals[i]);
    let good = [], zone = [];
    if (iCarry(sc)) {
      const seen = new Set();
      goodIdx.forEach(i => {
        const c = A.cands[i];
        const k = c.type === 'dribble' ? 'dribble' : groupKey(sc, c);
        if (seen.has(k) || good.length >= 3) return;
        seen.add(k); good.push(c);
      });
      if (!good.length) good = [best];
    } else {
      zone = goodIdx.map(i => ({ x: A.cands[i].x, y: A.cands[i].y }));
    }

    // compare with the closest good option
    let ref = best;
    if (!iCarry(sc) && zone.length) {
      let bd = 1e9;
      zone.forEach(z => { const d = C.dist(z, action); if (d < bd) { bd = d; ref = { type: 'move', x: z.x, y: z.y }; } });
    } else if (iCarry(sc)) {
      const same = good.find(g => g.type === action.type);
      if (same && action.type !== 'pass') ref = same;
    }
    const refInfo = evaluate(sc, ref);
    const tags = rating === 'goed' ? [] : tagsFor(sc, action, info, ref, refInfo);

    let text;
    if (rating === 'goed') {
      const isBest = sameAction(action, best) || info.ev >= bestEv - 0.003;
      const head = action.type === 'shot' ? 'Goed gezien!' : action.type === 'pass' ? 'Goede pass!'
        : action.type === 'dribble' ? 'Slim gedribbeld!' : sc.poss === 'us' ? 'Goed vrijgelopen!' : 'Goed verdedigd!';
      const myWhy = why(sc, action);
      text = head + (myWhy ? ' ' + myWhy : '') + (isBest ? '' : ' Er waren nog meer goede keuzes, kijk naar het geel.');
    } else {
      const parts = tags.map(t => TAGS[t].tip);
      if (!parts.length) {
        // no specific mistake: say what was better and why
        const w = why(sc, ref);
        const what = ref.type === 'move' ? 'een plek in het gele gebied' : describe(sc, ref);
        text = (rating === 'oke' ? 'Niet slecht! ' : '') + 'Nog beter was ' + what +
          (w ? ': ' + w.charAt(0).toLowerCase() + w.slice(1) : '.');
      } else text = (rating === 'oke' ? 'Niet slecht! ' : '') + parts.join(' ');
    }
    const goodText = iCarry(sc) ? joinNl(good.map(g => describe(sc, g)), 'of') : 'ergens in het gele gebied gaan staan';
    return {
      rating, ev: info.ev, bestEv, tags, text,
      best, bestText: describe(sc, best), bestWhy: why(sc, best),
      good, zone, goodText, info
    };
  }

  // ---------- judging a teammate ----------
  // The same situation, seen as if teammate i were the player: their own normal
  // spot, their own reach. Lets us judge any teammate exactly like the player.
  function asMate(sc, i) {
    const m = sc.mates[i];
    const home = sc.homes ? sc.homes[m.pos] : null;
    const reach = sc.dropBack ? 22 : undefined;
    return Object.assign({}, sc, { me: i, home: home || null, reach });
  }

  // How good is teammate i standing at `spot` (default: where they stand now)?
  // Returns the normal judge result (rating, zone = good spots, text, ...).
  // The ball carrier is not judged (null).
  function rateMate(sc, i, spot) {
    if (sc.poss === 'us' && sc.carrier.idx === i) return null;
    const v = asMate(sc, i);
    const m = sc.mates[i];
    const P = spot || m;
    return judge(v, { type: 'move', x: P.x, y: P.y });
  }

  // ---------- pass and run ----------
  // After a pass the receiver has the ball; the passer can run on (optional).
  // The run is judged like getting free, with the receiver as the new carrier.
  function runView(sc, a) {
    const recv = evaluate(sc, a).recvIdx;
    if (recv == null) return null;
    const mates = sc.mates.map((m, i) => i === recv ? Object.assign({}, m, { x: a.x, y: a.y }) : m);
    return Object.assign({}, sc, { mates, ball: { x: a.x, y: a.y }, carrier: { team: 'us', idx: recv }, onlyDribble: false, keepAway: 0 });
  }

  // A pass shown as good gets a run when standing still after it is clearly worse.
  function withRun(sc, a) {
    if (a.type !== 'pass' || a.run) return a;
    const me = sc.mates[sc.me];
    const v = runView(sc, a);
    const still = v && judgeBase(v, { type: 'move', x: me.x, y: me.y });
    return still && still.rating === 'beter' ? Object.assign({}, a, { run: { x: still.best.x, y: still.best.y } }) : a;
  }

  function judge(sc, action) {
    const res = judgeBase(sc, action);
    if (!iCarry(sc)) return res;
    const me = sc.mates[sc.me];
    // the best answer and the good options shown: passes plus a run where needed
    res.best = withRun(sc, res.best);
    res.bestText = describe(sc, res.best);
    res.good = res.good.map(g => sameAction(g, res.best) ? res.best : withRun(sc, g));
    res.goodText = joinNl(res.good.map(g => describe(sc, g)), 'of');
    if (action.type !== 'pass') return res;
    const v = runView(sc, action);
    if (!v) return res; // pass to nobody: the run does not matter any more
    const spot = action.run || me;
    const rr = judgeBase(v, { type: 'move', x: spot.x, y: spot.y });
    res.run = { rating: rr.rating, zone: rr.zone, best: rr.best, given: !!action.run };
    // running is optional: only a clearly better run that was missed, or a run
    // to a worse spot, costs the "Goed"
    const tag = res.rating === 'beter' ? null // a bad pass: that is the lesson, not the run
      : action.run ? (rr.rating !== 'goed' ? 'slecht_gelopen' : null)
        : (rr.rating === 'beter' ? 'blijven_staan' : null);
    if (tag) {
      if (res.rating === 'goed') res.rating = 'oke';
      res.tags = res.tags.concat(tag);
      res.text += ' ' + TAGS[tag].tip;
    } else if (action.run && res.rating === 'goed') res.text += ' En daarna goed doorgelopen!';
    return res;
  }

  // A situation is only used if the player's choice really matters:
  // a clear difference between good and bad options, and not everything is good.
  // Where to stand: the nearest good spot must be at least this far (m) from where
  // the player starts, so the right answer always takes a real move.
  const MOVE_MIN = { K: 2.5 }, MOVE_MIN_OTHER = 4;
  function startGap(sc, A) {
    const me = sc.mates[sc.me];
    let d = 1e9;
    A.evals.forEach((e, i) => { if (e >= A.cut) d = Math.min(d, C.dist(A.cands[i], me)); });
    return d;
  }

  function relevant(sc) {
    const A = analyse(sc);
    const goodFrac = A.evals.filter(e => e >= A.cut).length / A.evals.length;
    if (iCarry(sc)) return A.spread >= 0.02 && goodFrac <= 0.5;
    const pos = sc.mates[sc.me].pos;
    if (startGap(sc, A) < (MOVE_MIN[pos] || MOVE_MIN_OTHER)) return false;
    if (sc.poss === 'us') return evaluate(sc, A.best).lane >= 0.6 && A.spread >= 0.01 && goodFrac <= 0.45;
    return A.spread >= 0.008 && goodFrac <= 0.45;
  }

  JO.judge = {
    judge, evaluate, candidates, ballAction, isShotTarget, reach, TAGS, analyse, relevant, why, describe, sameAction,
    asMate, rateMate, restOpen, restForwards, startGap, MOVE_MIN, MOVE_MIN_OTHER, runView, RUN_REACH,
    model: {
      keeperSpot, vUs, vThem, lossCost, pressure, pressureGoalSide, interceptInfo, shotProb, dribbleRisk, markedness,
      threat, threatOptions, ourKeeperFactor, evalPass, evalShot, evalDribble, evalSupport, roleFactor
    }
  };
})();
