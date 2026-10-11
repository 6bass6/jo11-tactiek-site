// POV view: the situation as seen from your own player. You can look around (drag,
// or the turn buttons). Tap the grass to run (or to dribble / pass into space when you
// have the ball), tap a teammate to pass to them, tap the goal to shoot. The choice is
// then played out in the top-down view.
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const W = C.W, L = C.L, CX = W / 2;
  const NS = 'http://www.w3.org/2000/svg';
  // Pinhole camera, standing 1.6 m high. K sets the field of view (about 120 degrees wide).
  const VW = 100, VH = 60, HORIZON = 24, K = 28, EYE = 1.6, MIN_F = 1.2;
  const MAX_PITCH = 16;  // how far you can look up or down (view units)
  const HIT = 3.2;       // how close (view units) a tap must be to a player
  const DRAG = 1.2;      // less movement than this counts as a tap
  const GRID = 5;        // size of the grass squares (m)
  const GRID_X = [-30, W + 30], GRID_Y = [-30, L + 30];

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function Pov(container) {
    container.innerHTML = '<div class="pov-tools">' +
      '<button data-v="left" title="Links kijken">◀</button>' +
      '<button data-v="right" title="Rechts kijken">▶</button>' +
      '<button data-v="goal" title="Kijk naar het doel">Doel</button>' +
      '<button data-v="ball" title="Kijk naar de bal">Bal</button>' +
      '<button data-v="reset" title="Recht vooruit">Reset</button></div>';
    const svg = el('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'pov' });
    container.appendChild(svg);

    // gradients: shirts, skin, shorts, ball and the shadow under each person
    const defs = el('defs', {}, svg);
    const grad = (id, stops, cx, cy) => {
      const g = el('radialGradient', { id, cx: cx || 0.5, cy: cy || 0.5, r: 0.7 }, defs);
      stops.forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a == null ? 1 : a }, g));
    };
    const lin = (id, stops) => {
      const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g));
    };
    lin('povShirtUs', [[0, '#8fb6ff'], [0.45, '#1f5fe0'], [1, '#123a8c']]);
    lin('povShirtThem', [[0, '#ff9a8a'], [0.45, '#d63c3c'], [1, '#8f1f1f']]);
    // goalkeepers wear their own colour, for both teams
    lin('povShirtKeeper', [[0, '#f4ff9a'], [0.45, '#c8e11a'], [1, '#6f8a05']]);
    lin('povShorts', [[0, '#3a3a3a'], [1, '#111']]);
    grad('povSkin', [[0, '#ffe2c4'], [1, '#c98e5f']], 0.35, 0.35);
    grad('povBall', [[0, '#ffffff'], [1, '#b8bec6']], 0.35, 0.35);
    grad('povShadow', [[0, '#000', 0.5], [1, '#000', 0]]);

    const gSky = el('g', {}, svg), gGrass = el('g', {}, svg), gLines = el('g', {}, svg);
    const gGoal = el('g', {}, svg), gPlayers = el('g', {}, svg), gBall = el('g', {}, svg), gMarks = el('g', {}, svg);
    const gMini = el('g', {}, svg); // overview map: where you stand
    el('rect', { x: 0, y: 0, width: VW, height: VH, class: 'pov-sky' }, gSky);
    // solid ground below the horizon: no gaps when a grass square is out of sight
    const ground = el('rect', { x: 0, y: HORIZON, width: VW, height: VH, class: 'pov-base' }, gSky);
    // grass squares are made once and moved on every redraw
    const squares = [];
    for (let x = GRID_X[0]; x < GRID_X[1]; x += GRID) {
      for (let y = GRID_Y[0]; y < GRID_Y[1]; y += GRID) {
        // grass inside the pitch, a different surface outside it, so the edges show
        const cx = x + GRID / 2, cy = y + GRID / 2;
        const inside = cx > 0 && cx < W && cy > 0 && cy < L;
        const shade = !inside ? 'pov-outside' : (Math.round(x / GRID) + Math.round(y / GRID)) % 2 ? 'pov-grass-a' : 'pov-grass-b';
        squares.push({ x, y, node: el('polygon', { class: shade }, gGrass) });
      }
    }

    let sc = null, onAction = null, eye = null, markAction = null, markTap = null;
    const view = { yaw: 0, pitch: 0 }; // yaw 0 = looking up the field at the opponent's goal
    let drag = null;

    function basis() {
      return { fx: Math.sin(view.yaw), fy: -Math.cos(view.yaw), rx: Math.cos(view.yaw), ry: Math.sin(view.yaw) };
    }

    // Screen position of a point at height h (m), seen from the player. null when behind.
    function proj(x, y, h) {
      const b = basis(), dx = x - eye.x, dy = y - eye.y;
      const f = dx * b.fx + dy * b.fy;
      if (f < MIN_F) return null;
      const lat = dx * b.rx + dy * b.ry;
      return { x: VW / 2 + K * lat / f, y: HORIZON + view.pitch + K * (EYE - (h || 0)) / f, f, s: K / f };
    }

    // Field point under a screen position (inverse of proj on the ground).
    function groundAt(sx, sy) {
      const d = sy - HORIZON - view.pitch;
      if (d <= 0.3) return null;
      const f = K * EYE / d, lat = (sx - VW / 2) * f / K, b = basis();
      return { x: eye.x + b.fx * f + b.rx * lat, y: eye.y + b.fy * f + b.ry * lat };
    }

    function toView(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }

    const pts = list => list.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');
    function poly(g, list, fill, cls) {
      if (list.some(p => !p)) return;
      el('polygon', { points: pts(list), fill: fill, class: cls }, g);
    }

    // a line along the field, cut where it runs behind the camera
    function line3d(g, world, cls) {
      let run = [];
      const flush = () => { if (run.length > 1) el('polyline', { points: pts(run), class: cls }, g); run = []; };
      world.forEach(([x, y]) => { const p = proj(x, y, 0); if (p) run.push(p); else flush(); });
      flush();
    }

    // the pitch lines, drawn only along the pitch (nothing outside it)
    function drawLines() {
      gLines.innerHTML = '';
      const fx = []; for (let x = 0; x <= W; x += 0.5) fx.push(x);
      const fy = []; for (let y = 0; y <= L; y += 0.5) fy.push(y);
      // keeper-zone lines and the halfway line
      [C.KEEPER_ZONE, L / 2, L - C.KEEPER_ZONE].forEach(y => line3d(gLines, fx.map(x => [x, y]), 'pov-line'));
      // the edges of the pitch: touchlines and goal lines, thicker
      [0, L].forEach(y => line3d(gLines, fx.map(x => [x, y]), 'pov-boundary'));
      [0, W].forEach(x => line3d(gLines, fy.map(y => [x, y]), 'pov-boundary'));
    }

    // the opponent's goal: posts, bar and net, all in the field's 3D
    function drawGoal() {
      gGoal.innerHTML = '';
      const hw = C.GOAL_W / 2, xl = CX - hw, xr = CX + hw;
      const P = (x, y, h) => proj(x, y, h);
      // both goals: the one you shoot at (top) and your own keeper's goal (bottom)
      [[0, -1.2], [L, 1.2]].forEach(([y, d]) => {
        const y2 = y + d;
        poly(gGoal, [P(xl, y, 0), P(xr, y, 0), P(xr, y2, 0), P(xl, y2, 0)], 'rgba(255,255,255,0.12)');
        poly(gGoal, [P(xl, y2, 0), P(xr, y2, 0), P(xr, y2, 2), P(xl, y2, 2)], 'rgba(255,255,255,0.1)');
        poly(gGoal, [P(xl, y, 0), P(xl, y2, 0), P(xl, y2, 2), P(xl, y, 2)], 'rgba(255,255,255,0.1)');
        poly(gGoal, [P(xr, y, 0), P(xr, y2, 0), P(xr, y2, 2), P(xr, y, 2)], 'rgba(255,255,255,0.1)');
        [xl, xr].forEach(x => {
          const a = P(x, y, 0), b = P(x, y, 2);
          if (a && b) el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'pov-post' }, gGoal);
        });
        const top1 = P(xl, y, 2), top2 = P(xr, y, 2);
        if (top1 && top2) el('line', { x1: top1.x, y1: top1.y, x2: top2.x, y2: top2.y, class: 'pov-post' }, gGoal);
      });
    }

    function drawPerson(t, b) {
      const p = t.p;
      const g = el('g', { class: 'pov-player' }, gPlayers);
      const f0 = proj(p.x, p.y, 0);
      if (!f0) return;
      const s = f0.s;
      // a point on the person, offset sideways (along the view) by `off` metres at height h
      const R = (off, h) => proj(p.x + b.rx * off, p.y + b.ry * off, h);
      el('ellipse', { cx: f0.x, cy: f0.y, rx: 0.5 * s, ry: 0.18 * s, fill: 'url(#povShadow)' }, g);
      const shirt = p.pos === 'K' ? 'url(#povShirtKeeper)' : t.team === 'us' ? 'url(#povShirtUs)' : 'url(#povShirtThem)';
      [-0.13, 0.13].forEach(o => poly(g, [R(o - 0.09, 0), R(o + 0.09, 0), R(o + 0.09, 0.85), R(o - 0.09, 0.85)], 'url(#povShorts)'));
      poly(g, [R(-0.25, 0.85), R(0.25, 0.85), R(0.25, 1.45), R(-0.25, 1.45)], shirt);
      [-0.31, 0.31].forEach(o => poly(g, [R(o - 0.07, 0.85), R(o + 0.07, 0.85), R(o + 0.07, 1.36), R(o - 0.07, 1.36)], shirt));
      const hd = R(0, 1.6);
      if (hd) {
        el('circle', { cx: hd.x, cy: hd.y - 0.05 * s, r: 0.15 * s, fill: '#3b2516' }, g);
        el('circle', { cx: hd.x, cy: hd.y, r: 0.13 * s, fill: 'url(#povSkin)' }, g);
        // names only for players near enough to read them, so far ones do not pile up
        if (t.team === 'us' && p.name && f0.f < 18) {
          const tx = el('text', { x: hd.x, y: hd.y - 0.32 * s, class: 'pov-name', 'font-size': Math.max(1.4, Math.min(3.2, 1.8 * s)) }, g);
          tx.textContent = p.name;
        }
      }
    }

    function draw() {
      if (!sc) return;
      eye = sc.mates[sc.me];
      ground.setAttribute('y', HORIZON + view.pitch);
      squares.forEach(q => {
        const list = [[q.x, q.y], [q.x + GRID, q.y], [q.x + GRID, q.y + GRID], [q.x, q.y + GRID]].map(([x, y]) => proj(x, y, 0));
        if (list.some(p => !p)) { q.node.style.display = 'none'; return; }
        q.node.style.display = '';
        q.node.setAttribute('points', pts(list));
      });
      drawLines();
      drawGoal();
      // players and ball, far first so the close ones are drawn on top
      const b = basis();
      gPlayers.innerHTML = '';
      const things = sc.opps.map(p => ({ p, team: 'them' }));
      sc.mates.forEach((p, i) => { if (i !== sc.me) things.push({ p, team: 'us' }); });
      things.map(t => ({ t, f: (t.p.x - eye.x) * b.fx + (t.p.y - eye.y) * b.fy }))
        .filter(o => o.f >= MIN_F).sort((a, c) => c.f - a.f)
        .forEach(o => drawPerson(o.t, b));
      gBall.innerHTML = '';
      const bp = proj(sc.ball.x, sc.ball.y, 0.11), bg = proj(sc.ball.x, sc.ball.y, 0);
      if (bp && bg) {
        el('ellipse', { cx: bg.x, cy: bg.y, rx: 0.2 * bg.s, ry: 0.07 * bg.s, fill: 'url(#povShadow)' }, gBall);
        // a bigger ball with a dark edge, so it stands out from the white lines and the grass
        el('circle', { cx: bp.x, cy: bp.y, r: Math.max(0.75, 0.22 * bp.s), fill: 'url(#povBall)', stroke: '#1a1a1a', 'stroke-width': 0.12 }, gBall);
      }
      drawMark();
      drawMini();
    }

    // overview in the top right: the pitch from above, your position and where you look
    // overview in the top right: the pitch from above, your position, and what you look at
    function drawMini() {
      gMini.innerHTML = '';
      const ms = 0.4, mx = VW - 2 - W * ms, my = 2;
      const X = x => mx + x * ms, Y = y => my + y * ms;
      el('rect', { x: mx - 1, y: my - 1, width: W * ms + 2, height: L * ms + 2, class: 'pov-mini-bg' }, gMini);
      el('rect', { x: X(0), y: Y(0), width: W * ms, height: L * ms, class: 'pov-mini-pitch' }, gMini);
      el('line', { x1: X(0), y1: Y(L / 2), x2: X(W), y2: Y(L / 2), class: 'pov-mini-line' }, gMini);
      // their goal (top, where we shoot) and ours (bottom)
      el('line', { x1: X(CX - C.GOAL_W / 2), y1: Y(0), x2: X(CX + C.GOAL_W / 2), y2: Y(0), class: 'pov-mini-goal-them' }, gMini);
      el('line', { x1: X(CX - C.GOAL_W / 2), y1: Y(L), x2: X(CX + C.GOAL_W / 2), y2: Y(L), class: 'pov-mini-goal-us' }, gMini);
      const b = basis(), ex = X(eye.x), ey = Y(eye.y);
      // the wedge: roughly what you can see (about 120 degrees, 10 m deep)
      const len = 10 * ms, half = 60 * Math.PI / 180;
      const rot = a => ({ x: b.fx * Math.cos(a) - b.fy * Math.sin(a), y: b.fx * Math.sin(a) + b.fy * Math.cos(a) });
      const r1 = rot(-half), r2 = rot(half);
      const wedge = [[ex, ey], [ex + r1.x * len, ey + r1.y * len], [ex + r2.x * len, ey + r2.y * len]];
      el('polygon', { points: wedge.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), class: 'pov-mini-fov' }, gMini);
      // the arrow: where you look, with a head at the tip
      const tx = ex + b.fx * 7 * ms, ty = ey + b.fy * 7 * ms;
      el('line', { x1: ex, y1: ey, x2: tx, y2: ty, class: 'pov-mini-look' }, gMini);
      el('circle', { cx: tx, cy: ty, r: 0.6, class: 'pov-mini-look-tip' }, gMini);
      el('circle', { cx: ex, cy: ey, r: 1.1, class: 'pov-mini-me' }, gMini);
    }

    // a ring on the ground (or on the receiving teammate) shows the choice
    // the dot is where you tapped; the ring is where you will actually end up (a run is
    // cut short at how far you can run), joined by a dashed line when they differ
    function drawMark() {
      gMarks.innerHTML = '';
      if (!markAction) return;
      const a = markAction;
      const at = a.type === 'pass' && a.to != null ? sc.mates[a.to] : a;
      const p = proj(at.x, at.y, a.type === 'pass' ? 1.8 : 0);
      if (markTap) {
        const t = proj(markTap.x, markTap.y, 0);
        if (t) {
          if (p && C.dist(markTap, at) > 0.8) el('line', { x1: t.x, y1: t.y, x2: p.x, y2: p.y, class: 'pov-mark-line' }, gMarks);
          el('circle', { cx: t.x, cy: t.y, r: Math.max(0.35, 0.3 * t.s), class: 'pov-mark-tap' }, gMarks);
        }
      }
      if (p) el('circle', { cx: p.x, cy: p.y, r: Math.max(0.8, 0.7 * p.s), class: 'pov-mark' }, gMarks);
    }

    // one tap = one choice: the grass, a teammate or the goal
    function actionAt(v) {
      const iCarry = sc.poss === 'us' && sc.carrier.idx === sc.me;
      let hit = -1, hd = HIT;
      sc.mates.forEach((m, i) => {
        if (i === sc.me) return;
        const p = proj(m.x, m.y, 0.9);
        if (p && Math.hypot(p.x - v.x, p.y - v.y) < hd) { hd = Math.hypot(p.x - v.x, p.y - v.y); hit = i; }
      });
      if (hit >= 0) {
        if (!iCarry || sc.onlyDribble) return null;
        const m = sc.mates[hit];
        return { type: 'pass', to: hit, x: m.x, y: m.y };
      }
      const g = groundAt(v.x, v.y);
      if (!g) return null;
      // with the ball: a spot is a pass into space, a dribble, or a shot at the goal
      if (iCarry && !sc.onlyDribble) return JO.judge.ballAction(sc, C.clampToField(g));
      // no ball: run to the spot, within reach (and out of the ball's keep-away zone)
      let q = C.towards(eye, g, Math.min(JO.judge.reach(sc), C.dist(eye, g)));
      if (sc.keepAway && C.dist(q, sc.ball) < sc.keepAway) {
        const d = C.dist(q, sc.ball) || 0.01;
        q = { x: sc.ball.x + (q.x - sc.ball.x) / d * sc.keepAway, y: sc.ball.y + (q.y - sc.ball.y) / d * sc.keepAway };
      }
      q = C.clampToField(q);
      if (C.dist(eye, q) < 1) return null;
      return { type: iCarry ? 'dribble' : 'move', x: +q.x.toFixed(2), y: +q.y.toFixed(2) };
    }

    // looking around: drag sideways to turn, up and down to look up and down; a short tap is a choice
    svg.onpointerdown = (evt) => {
      if (!sc) return;
      evt.preventDefault();
      if (svg.setPointerCapture) svg.setPointerCapture(evt.pointerId);
      const v = toView(evt);
      drag = { x: v.x, y: v.y, yaw: view.yaw, pitch: view.pitch, moved: false };
    };
    svg.onpointermove = (evt) => {
      if (!drag) return;
      const v = toView(evt), dx = v.x - drag.x, dy = v.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG) return;
      drag.moved = true;
      view.yaw = drag.yaw - dx * 0.02;
      view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, drag.pitch + dy));
      draw();
    };
    const endDrag = (evt) => {
      if (!drag) return;
      const was = drag;
      drag = null;
      if (was.moved || !onAction) return;
      const action = actionAt({ x: was.x, y: was.y });
      if (!action) return;
      markTap = groundAt(was.x, was.y);
      markAction = action;
      drawMark();
      onAction(action);
    };
    svg.onpointerup = endDrag;
    svg.onpointercancel = () => { drag = null; };

    // turn buttons
    container.querySelectorAll('.pov-tools button').forEach(btn => {
      btn.onclick = () => {
        if (!sc) return;
        const v = btn.dataset.v;
        if (v === 'left') view.yaw -= Math.PI / 8;
        if (v === 'right') view.yaw += Math.PI / 8;
        if (v === 'goal') view.yaw = Math.atan2(CX - eye.x, eye.y);
        if (v === 'ball') view.yaw = Math.atan2(sc.ball.x - eye.x, -(sc.ball.y - eye.y));
        if (v === 'reset') { view.yaw = 0; view.pitch = 0; }
        draw();
      };
    });

    function setScenario(s) {
      sc = s;
      markAction = null; markTap = null;
      view.yaw = 0; view.pitch = 0;
      draw();
    }

    function enableInput(cb) { onAction = cb; }
    function disableInput() { onAction = null; }
    function reset() { markAction = null; markTap = null; draw(); }

    return { setScenario, enableInput, disableInput, reset, svg };
  }

  JO.Pov = Pov;
})();
