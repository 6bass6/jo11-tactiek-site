// Draws the field (SVG), players and ball; handles dragging and animation.
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const W = C.W, L = C.L, CX = W / 2;
  const NS = 'http://www.w3.org/2000/svg';
  // Players are drawn bigger than real life (so names fit), but small enough that
  // the 5m goals still look right. Dragging uses a larger invisible area.
  const R_PLAYER = 1.05, R_ME = 1.35;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawPitch(g) {
    el('rect', { x: -2, y: -3.5, width: W + 4, height: L + 7, class: 'grass-out' }, g);
    for (let i = 0; i < 8; i++) {
      el('rect', { x: 0, y: i * L / 8, width: W, height: L / 8, class: i % 2 ? 'grass-a' : 'grass-b' }, g);
    }
    el('rect', { x: 0, y: 0, width: W, height: L, class: 'line' }, g);
    el('line', { x1: 0, y1: L / 2, x2: W, y2: L / 2, class: 'line' }, g);
    el('circle', { cx: CX, cy: L / 2, r: 0.35, class: 'spot' }, g);
    [C.KEEPER_ZONE, L - C.KEEPER_ZONE].forEach(y => {
      el('line', { x1: 0, y1: y, x2: W, y2: y, class: 'zone-line' }, g);
      [0, W].forEach(x => el('path', { d: `M${x - 0.7},${y + 0.6} L${x},${y - 0.8} L${x + 0.7},${y + 0.6} Z`, class: 'cone' }, g));
    });
    [9, L - 9].forEach(y => el('circle', { cx: CX, cy: y, r: 0.3, class: 'spot' }, g));
    // goals (5m wide)
    // goals: 5m wide (pupillendoel), net behind the line, posts on the line
    [[0, -1], [L, 1]].forEach(([y, dir]) => {
      const x0 = CX - C.GOAL_W / 2, x1 = CX + C.GOAL_W / 2, d = 1.2 * dir;
      el('rect', { x: x0, y: Math.min(y, y + d), width: C.GOAL_W, height: Math.abs(d), class: 'goal-net' }, g);
      for (let x = x0 + 0.5; x < x1; x += 0.5) el('line', { x1: x, y1: y, x2: x, y2: y + d, class: 'net-line' }, g);
      el('line', { x1: x0, y1: y + d / 2, x2: x1, y2: y + d / 2, class: 'net-line' }, g);
      el('path', { d: `M${x0},${y} L${x0},${y + d} L${x1},${y + d} L${x1},${y}`, class: 'goal-frame' }, g);
      el('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'goal-mouth' }, g);
      [x0, x1].forEach(x => el('circle', { cx: x, cy: y, r: 0.28, class: 'post' }, g));
    });
  }

  function Field(container, opts) {
    opts = opts || {};
    const svg = el('svg', { viewBox: `-1.8 -3.2 ${W + 3.6} ${L + 6.4}`, class: 'field' });
    container.innerHTML = '';
    container.appendChild(svg);
    const defs = el('defs', {}, svg);
    [['arrow-me', 'arrow-me'], ['arrow-best', 'arrow-best'], ['arrow-them', 'arrow-them']].forEach(([id, cls]) => {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
    });
    const gPitch = el('g', {}, svg);
    drawPitch(gPitch);
    const gUnder = el('g', {}, svg);
    const gPlayers = el('g', {}, svg);
    const gBall = el('g', {}, svg);
    const gTop = el('g', {}, svg);
    const gNote = el('g', {}, svg);

    let sc = null, nodes = null, ballNode = null;
    let cur = null; // current drawn frame
    let input = null;

    function ballDrawPos(frame) {
      const b = frame.ball;
      if (!frame.holder) return { x: b.x, y: b.y };
      const p = (frame.holder.team === 'us' ? frame.mates : frame.opps)[frame.holder.idx];
      if (!p || C.dist(p, b) > 0.5) return { x: b.x, y: b.y };
      const dy = frame.holder.team === 'us' ? -1 : 1;
      let x = b.x + 0.75, y = b.y + dy * 1.15;
      x = C.clamp(x, -0.5, W + 0.5); y = C.clamp(y, -0.8, L + 0.8);
      return { x, y };
    }

    function setScenario(s) {
      sc = s;
      gPlayers.innerHTML = ''; gBall.innerHTML = ''; gUnder.innerHTML = ''; gTop.innerHTML = ''; gNote.innerHTML = '';
      nodes = { mates: [], opps: [] };
      s.opps.forEach(p => {
        const g = el('g', { class: 'player opp' }, gPlayers);
        el('circle', { r: R_PLAYER, class: 'body' }, g);
        nodes.opps.push(g);
      });
      s.mates.forEach((p, i) => {
        const isMe = i === s.me;
        const g = el('g', { class: 'player mate' + (isMe ? ' me' : '') }, gPlayers);
        if (isMe) el('circle', { r: R_ME + 0.8, class: 'halo' }, g);
        el('circle', { r: isMe ? R_ME : R_PLAYER, class: 'body' }, g);
        const t = el('text', { y: 0.32, class: 'pos' }, g);
        t.textContent = p.pos;
        const n = el('text', { y: (isMe ? R_ME : R_PLAYER) + 1.45, class: 'name' }, g);
        n.textContent = isMe ? 'JIJ' : (p.name || p.pos).slice(0, 9);
        if (isMe) el('circle', { r: 4, class: 'hit' }, g);
        nodes.mates.push(g);
      });
      ballNode = el('g', { class: 'ball' }, gBall);
      el('circle', { r: 1.6, class: 'ball-ring' }, ballNode);
      el('circle', { r: 0.8, class: 'ball-body' }, ballNode);
      el('path', { d: 'M0,-0.3 L0.29,-0.09 L0.18,0.25 L-0.18,0.25 L-0.29,-0.09 Z', class: 'ball-dot' }, ballNode);
      el('circle', { r: 3.4, class: 'hit' }, ballNode);
      cur = initialFrame(s);
      draw(cur);
    }

    function initialFrame(s) {
      return {
        mates: s.mates.map(p => ({ x: p.x, y: p.y })), opps: s.opps.map(p => ({ x: p.x, y: p.y })),
        ball: { x: s.ball.x, y: s.ball.y }, holder: { team: s.carrier.team, idx: s.carrier.idx }
      };
    }

    function draw(f, ballOverride) {
      f.mates.forEach((p, i) => nodes.mates[i].setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`));
      f.opps.forEach((p, i) => nodes.opps[i].setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`));
      const b = ballOverride || ballDrawPos(f);
      ballNode.setAttribute('transform', `translate(${b.x.toFixed(2)},${b.y.toFixed(2)})`);
    }

    function reset() {
      if (!sc) return;
      stopAnim();
      gUnder.innerHTML = ''; gTop.innerHTML = ''; gNote.innerHTML = '';
      cur = initialFrame(sc);
      draw(cur);
    }

    // ---------- overlays ----------
    function line(g, a, b, cls, marker) {
      const attrs = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls };
      if (marker) attrs['marker-end'] = `url(#${marker})`;
      return el('line', attrs, g);
    }

    function showActionIn(layer, a) {
      const g = showAction(a, 'me');
      layer.appendChild(g);
    }

    function showAction(a, kind) {
      // kind: 'me' (player's choice) or 'best'
      const me = sc.mates[sc.me];
      const g = el('g', { class: 'action-' + kind }, kind === 'best' ? gTop : gUnder);
      const marker = kind === 'best' ? 'arrow-best' : 'arrow-me';
      if (a.type === 'pass' || a.type === 'shot') {
        const from = sc.carrier.idx === sc.me ? me : sc.mates[sc.carrier.idx];
        line(g, from, a, 'arrow ' + kind, marker);
        if (a.type === 'pass' && a.to != null) el('circle', { cx: a.x, cy: a.y, r: 1.9, class: 'target ' + kind }, g);
        if (a.run) {
          line(g, me, a.run, 'arrow run ' + kind, marker);
          el('circle', { cx: a.run.x, cy: a.run.y, r: kind === 'best' ? 1.6 : 1.4, class: 'ghost ' + kind }, g);
        }
      } else {
        line(g, me, a, 'arrow run ' + kind, marker);
        el('circle', { cx: a.x, cy: a.y, r: kind === 'best' ? 1.6 : 1.4, class: 'ghost ' + kind }, g);
      }
      return g;
    }

    // All good options: several yellow arrows (with the ball) or a yellow area
    // (where to stand). The very best one gets the arrow.
    function showGood(res) {
      const me = sc.mates[sc.me];
      const g = el('g', { class: 'good' }, gUnder);
      if (res.run && res.run.rating !== 'goed' && res.rating !== 'beter') {
        const zg = el('g', { class: 'good-zone' }, g);
        res.run.zone.forEach(z => el('circle', { cx: z.x, cy: z.y, r: 1.0 }, zg));
      }
      if (res.zone && res.zone.length) {
        const zg = el('g', { class: 'good-zone' }, g);
        res.zone.forEach(z => el('circle', { cx: z.x, cy: z.y, r: 1.0 }, zg));
        showAction(res.best, 'best');
      } else {
        (res.good && res.good.length ? res.good : [res.best]).forEach((a, i) => {
          const gg = showAction(a, 'best');
          if (i > 0) gg.classList.add('alt');
        });
      }
    }

    function clearOverlays() { gUnder.innerHTML = ''; gTop.innerHTML = ''; gNote.innerHTML = ''; }

    function note(text, at) {
      gNote.innerHTML = '';
      if (!text) return;
      const p = { x: C.clamp(at.x, 6, W - 6), y: C.clamp(at.y - 3.2, 2, L - 2) };
      const g = el('g', { class: 'note', transform: `translate(${p.x},${p.y})` }, gNote);
      const w = Math.max(6, text.length * 0.95 + 2);
      el('rect', { x: -w / 2, y: -1.6, width: w, height: 2.9, rx: 1.2 }, g);
      const t = el('text', { y: 0.5 }, g);
      t.textContent = text;
    }

    // ---------- animation ----------
    let animToken = 0;
    function stopAnim() { animToken++; }

    function animate(frames, done) {
      const token = ++animToken;
      gNote.innerHTML = '';
      let i = 1, start = null, from = frames[0];
      cur = frames[0];
      draw(cur);
      const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      function step(ts) {
        if (token !== animToken) return;
        if (i >= frames.length) { if (done) done(); return; }
        const to = frames[i];
        if (start == null) start = ts;
        const t = Math.min(1, (ts - start) / Math.max(1, to.ms));
        const e = 0.5 * t + 0.5 * ease(t); // smooth, but no slow start
        const mix = (a, b) => ({ x: C.lerp(a.x, b.x, e), y: C.lerp(a.y, b.y, e) });
        const fb = ballDrawPos(from), tb = ballDrawPos(to);
        draw({
          mates: from.mates.map((p, k) => mix(p, to.mates[k])),
          opps: from.opps.map((p, k) => mix(p, to.opps[k])),
          ball: mix(from.ball, to.ball), holder: null
        }, { x: C.lerp(fb.x, tb.x, t), y: C.lerp(fb.y, tb.y, t) });
        if (t >= 1) {
          cur = to;
          if (to.note) note(to.note, to.ball);
          from = to; i++; start = null;
          setTimeout(() => requestAnimationFrame(step), to.note ? 450 : 40);
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    // ---------- dragging ----------
    function toSvg(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }

    function enableInput(onAction) {
      input = { onAction, dragging: null, pass: null };
      const meNode = nodes.mates[sc.me];
      const iCarry = sc.poss === 'us' && sc.carrier.idx === sc.me;
      meNode.classList.add('draggable');
      if (iCarry && !sc.onlyDribble) ballNode.classList.add('draggable');
      else ballNode.classList.remove('draggable');

      const start = (what) => (evt) => {
        if (!input) return;
        evt.preventDefault();
        evt.stopPropagation();
        svg.setPointerCapture && svg.setPointerCapture(evt.pointerId);
        input.dragging = what;
        input.pointerId = evt.pointerId;
        gUnder.innerHTML = '';
        const me = sc.mates[sc.me];
        if (what === 'ball') input.pass = null;
        const reach = input.pass ? JO.judge.RUN_REACH : JO.judge.reach(sc);
        el('circle', { cx: me.x, cy: me.y, r: what === 'ball' ? 0.01 : reach, class: 'reach' }, gUnder);
        if (sc.keepAway) el('circle', { cx: sc.ball.x, cy: sc.ball.y, r: sc.keepAway, class: 'keepaway' }, gUnder);
        move(evt);
      };
      // The ball sits right next to the player, so decide by distance which one
      // the finger or mouse grabbed: the player, or (if you may pass) the ball.
      meNode.onpointerdown = null;
      ballNode.onpointerdown = null;
      const canBall = iCarry && !sc.onlyDribble;
      svg.onpointerdown = (evt) => {
        if (!input) return;
        const p = toSvg(evt);
        const dMe = C.dist(p, cur.mates[sc.me]);
        const dBall = canBall ? C.dist(p, ballDrawPos(cur)) : 1e9;
        if (dBall < 3 && dBall < dMe) start('ball')(evt);
        else if (dMe < 4) start('me')(evt);
      };
      svg.onpointermove = move;
      svg.onpointerup = end;
      svg.onpointercancel = end;
    }

    function constrainMe(p) {
      const me = sc.mates[sc.me];
      const reach = input && input.pass ? JO.judge.RUN_REACH : JO.judge.reach(sc);
      let q = C.towards(me, p, Math.min(reach, C.dist(me, p)));
      if (sc.keepAway && C.dist(q, sc.ball) < sc.keepAway) {
        const d = C.dist(q, sc.ball) || 0.01;
        q = { x: sc.ball.x + (q.x - sc.ball.x) / d * sc.keepAway, y: sc.ball.y + (q.y - sc.ball.y) / d * sc.keepAway };
      }
      return C.clampToField(q);
    }

    let dragLayer = null;
    function move(evt) {
      if (!input || !input.dragging) return;
      evt.preventDefault();
      const p = toSvg(evt);
      if (dragLayer) dragLayer.remove();
      dragLayer = el('g', {}, gTop);
      const me = sc.mates[sc.me];
      if (input.dragging === 'me' && input.pass) {
        // running after the pass: the ball is on its way to the pass target
        const q = constrainMe(p);
        const f = C.clone(cur);
        f.mates[sc.me] = q;
        draw(f, { x: input.pass.x, y: input.pass.y });
        showActionIn(dragLayer, Object.assign({}, input.pass, { run: q }));
        input.last = q;
      } else if (input.dragging === 'me') {
        const q = constrainMe(p);
        const f = C.clone(cur);
        f.mates[sc.me] = q;
        const carrying = sc.poss === 'us' && sc.carrier.idx === sc.me;
        if (carrying) f.ball = { x: q.x, y: q.y };
        draw(f);
        line(dragLayer, me, q, 'arrow me', 'arrow-me');
        input.last = q;
      } else {
        const q = { x: C.clamp(p.x, -0.5, W + 0.5), y: C.clamp(p.y, -1.2, L + 0.5) };
        const a = JO.judge.ballAction(sc, q);
        const tgt = a.type === 'pass' && a.to != null ? sc.mates[a.to] : q;
        draw(cur, q);
        line(dragLayer, me, tgt, 'arrow me', 'arrow-me');
        if (a.type === 'pass' && a.to != null) el('circle', { cx: tgt.x, cy: tgt.y, r: 1.9, class: 'target me' }, dragLayer);
        if (a.type === 'shot') el('rect', { x: CX - C.GOAL_W / 2, y: -1.4, width: C.GOAL_W, height: 1.4, class: 'goal-hl' }, dragLayer);
        input.last = q;
      }
    }

    function end(evt) {
      if (!input || !input.dragging) return;
      const what = input.dragging;
      input.dragging = null;
      if (dragLayer) { dragLayer.remove(); dragLayer = null; }
      const me = sc.mates[sc.me];
      const p = input.last;
      gUnder.innerHTML = '';
      if (what === 'me' && input.pass) {
        // pass and run (a run of less than 1 m = no run)
        const action = Object.assign({}, input.pass);
        if (p && C.dist(me, p) >= 1) action.run = { x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
        const f = C.clone(cur);
        if (action.run) f.mates[sc.me] = { x: action.run.x, y: action.run.y };
        draw(f, { x: action.x, y: action.y });
        showAction(action, 'me');
        input.onAction(action);
        return;
      }
      if (!p || C.dist(me, p) < 1) { draw(cur); return; }
      let action;
      if (what === 'me') {
        const carrying = sc.poss === 'us' && sc.carrier.idx === sc.me;
        action = { type: carrying ? 'dribble' : 'move', x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
        const f = C.clone(cur);
        f.mates[sc.me] = { x: p.x, y: p.y };
        if (carrying) f.ball = { x: p.x, y: p.y };
        draw(f);
      } else {
        action = JO.judge.ballAction(sc, p);
        action.x = +action.x.toFixed(2); action.y = +action.y.toFixed(2);
        if (action.type === 'pass') input.pass = action; // now you may also drag yourself: the run
        draw(cur);
      }
      showAction(action, 'me');
      input.onAction(action);
    }

    // ---------- "zet het team goed": drag teammates ----------
    // Any teammate except the ball carrier can be dragged, each within their own
    // running reach from where they started; at most JO.fix.MAX_MOVES players.
    // onChange({ positions, moved }) after every drag, or ({ limit: true }).
    let gFix = null;
    function drawMoves(g, positions, kind) {
      sc.mates.forEach((m, i) => {
        if (C.dist(m, positions[i]) < JO.fix.MOVED) return;
        line(g, m, positions[i], 'arrow run ' + kind, kind === 'best' ? 'arrow-best' : 'arrow-me');
      });
    }
    function movedCount(f) { return sc.mates.filter((m, i) => C.dist(m, f.mates[i]) >= JO.fix.MOVED).length; }

    function enableFix(onChange) {
      input = { fix: true, onChange, dragging: null };
      const can = JO.fix.movable(sc);
      can.forEach(i => nodes.mates[i].classList.add('draggable'));
      ballNode.classList.remove('draggable');
      if (gFix) gFix.remove();
      gFix = el('g', {}, gUnder);
      svg.onpointerdown = (evt) => {
        if (!input) return;
        const p = toSvg(evt);
        let bi = -1, bd = 3.5;
        can.forEach(i => { const d = C.dist(p, cur.mates[i]); if (d < bd) { bd = d; bi = i; } });
        if (bi < 0) return;
        const isMoved = C.dist(sc.mates[bi], cur.mates[bi]) >= JO.fix.MOVED;
        if (!isMoved && movedCount(cur) >= JO.fix.MAX_MOVES) { onChange({ limit: true }); return; }
        evt.preventDefault();
        svg.setPointerCapture && svg.setPointerCapture(evt.pointerId);
        input.dragging = bi;
        const m = sc.mates[bi];
        input.reachNode = el('circle', { cx: m.x, cy: m.y, r: JO.fix.reachOf(sc, bi), class: 'reach' }, gUnder);
        fixMove(evt);
      };
      svg.onpointermove = fixMove;
      svg.onpointerup = svg.onpointercancel = (evt) => {
        if (!input || input.dragging == null) return;
        const i = input.dragging;
        input.dragging = null;
        if (input.reachNode) { input.reachNode.remove(); input.reachNode = null; }
        // dropped (almost) on the old spot: back to the start
        if (C.dist(sc.mates[i], cur.mates[i]) < JO.fix.MOVED) { cur.mates[i] = { x: sc.mates[i].x, y: sc.mates[i].y }; draw(cur); }
        redrawMoves();
        onChange({ positions: cur.mates.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })), moved: movedCount(cur) });
      };
    }

    function fixMove(evt) {
      if (!input || input.dragging == null) return;
      evt.preventDefault();
      const i = input.dragging, m = sc.mates[i], p = toSvg(evt);
      let q = C.towards(m, p, Math.min(JO.fix.reachOf(sc, i), C.dist(m, p)));
      if (sc.keepAway && C.dist(q, sc.ball) < sc.keepAway) {
        const d = C.dist(q, sc.ball) || 0.01;
        q = { x: sc.ball.x + (q.x - sc.ball.x) / d * sc.keepAway, y: sc.ball.y + (q.y - sc.ball.y) / d * sc.keepAway };
      }
      cur.mates[i] = C.clampToField(q);
      draw(cur);
      redrawMoves();
    }

    function redrawMoves() {
      if (!gFix) return;
      gFix.innerHTML = '';
      drawMoves(gFix, cur.mates, 'me');
    }

    // Feedback: players at their new spots, the player's moves, and the yellow
    // area for every player who stood wrong (or was made worse).
    function showFix(res, positions) {
      stopAnim();
      gUnder.innerHTML = ''; gTop.innerHTML = ''; gNote.innerHTML = '';
      cur = initialFrame(sc);
      cur.mates = positions.map(p => ({ x: p.x, y: p.y }));
      draw(cur);
      const g = el('g', { class: 'good' }, gUnder);
      res.players.filter(p => p.wrong || (p.rating !== 'goed' && !p.off)).forEach(p => {
        const zg = el('g', { class: 'good-zone' }, g);
        p.zone.forEach(z => el('circle', { cx: z.x, cy: z.y, r: 1.0 }, zg));
      });
      drawMoves(el('g', {}, gUnder), positions, 'me');
      res.players.filter(p => p.wrong).forEach(p =>
        el('circle', { cx: sc.mates[p.i].x, cy: sc.mates[p.i].y, r: 1.9, class: 'was-wrong' }, gUnder));
    }

    function disableInput() {
      input = null;
      if (nodes) { nodes.mates.forEach(n => n.classList.remove('draggable')); }
      if (ballNode) ballNode.classList.remove('draggable');
      svg.onpointerdown = svg.onpointermove = svg.onpointerup = svg.onpointercancel = null;
    }

    return { setScenario, reset, enableInput, enableFix, showFix, disableInput, animate, showAction, showGood, clearOverlays, note, stopAnim, svg };
  }

  JO.Field = Field;
})();
