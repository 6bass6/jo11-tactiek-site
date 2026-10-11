// Wedstrijd simulatie: one unique 5-minute match played continuously. The positions of
// all players and the ball at the end of each stretch are where the next stretch starts,
// so nothing jumps. A stop for the player comes when the player has the ball, or when a
// decision moment happens near the player (more often when close, and more often when the
// moment is decisive). Good decisions give points. Other stretches
// are played by the team itself (the player's best move). A formation change is shown as
// the players running to their new places.
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const $ = id => document.getElementById(id);
  const W = C.W, L = C.L, CX = W / 2;
  const MATCH_LEN = 300;        // seconds of match time
  const SEGMENTS = 40;          // stretches of play in a match
  const SEG_LEN = MATCH_LEN / SEGMENTS;
  const NEAR = 22;              // metres: "in the middle of it"
  const POINTS = { goed: 10, oke: 5, beter: 0 };
  const RATING_TEXT = { goed: 'Goed!', oke: 'Oké', beter: 'Kan beter' };
  const POS_CHOICES = ['K', 'LA', 'CV', 'RA', 'LM', 'CM', 'RM', 'SP'];
  const sections = ['scr-code', 'scr-name', 'scr-home', 'scr-game', 'scr-summary'];

  let st = null, field = null, exitTo = null, roster = [];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const randSeed = () => (Math.floor(Math.random() * 2147483647) ^ Date.now()) >>> 0;

  // ---------- start and setup ----------
  function start(player, rosterList, onExit) {
    roster = rosterList;
    exitTo = onExit;
    sections.forEach(s => $(s).classList.add('hidden'));
    $('scr-match').classList.remove('hidden');
    st = null;
    showSetup(player);
  }

  function showSetup(player) {
    stopPlay();
    $('m-setup').classList.remove('hidden');
    $('m-play').classList.add('hidden');
    $('m-setup').innerHTML = `
      <p class="muted">Je speelt ${esc(player.name)}. Kies je positie en de formatie. Tijdens de wedstrijd kun je de formatie altijd wisselen.</p>
      <div class="btn-row"><select id="m-pos">${POS_CHOICES.map(p => `<option value="${p}" ${p === player.main ? 'selected' : ''}>${C.POS_NAME[p]}</option>`).join('')}</select></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="m-begin-132">Begin met 1-3-3-1</button>
        <button class="btn secondary" id="m-begin-143">Begin met 1-4-3</button>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="linkbtn" id="m-exit-setup">Terug</button></div>`;
    $('m-begin-132').onclick = () => begin(player, '1-3-3-1');
    $('m-begin-143').onclick = () => begin(player, '1-4-3');
    $('m-exit-setup').onclick = exit;
    showBoard(player.id);
  }

  // cancels a running match: any stretch still in progress stops
  function stopPlay() {
    if (st) st.token++;
    if (field) field.stopAnim();
  }

  function begin(player, formation) {
    const pos = $('m-pos').value;
    const token = (st ? st.token : 0) + 1;
    // the first kick-off: the team and the opponents in their starting shape
    const sc0 = JO.gen.generate({ mePos: C.formationPos(pos, formation), seed: randSeed(), level: 0, formation, phase: 'hervatting', poss: 'us' });
    JO.gen.assignNames(sc0, roster, player.id);
    st = {
      player, pos, formation, token, seg: 0, clock: 0, mode: 'running', pending: null,
      score: { us: 0, them: 0 }, points: 0, stops: 0, moment: null, kind: null,
      me: sc0.me,
      mates: sc0.mates.map(m => ({ pos: m.pos, x: m.x, y: m.y, name: m.name })),
      opps: sc0.opps.map(o => ({ pos: o.pos, x: o.x, y: o.y })),
      ball: { x: sc0.ball.x, y: sc0.ball.y },
      holder: { team: sc0.carrier.team, idx: sc0.carrier.idx }
    };
    $('m-setup').classList.add('hidden');
    $('m-board').classList.add('hidden');
    $('m-play').classList.remove('hidden');
    $('m-end-row').classList.add('hidden');
    $('m-ticker').innerHTML = '';
    $('m-result').classList.add('hidden');
    $('m-go').classList.add('hidden');
    $('m-undo').classList.add('hidden');
    field = JO.Field($('m-field'));
    ticker('Het fluitsignaal. De wedstrijd is begonnen.');
    renderHead();
    renderFormationButtons();
    nextSegment(token);
  }

  function exit() {
    stopPlay();
    st = null;
    $('scr-match').classList.add('hidden');
    if (exitTo) exitTo();
  }

  // ---------- the state of the match ----------
  // The situation as it is right now, built from the positions the last stretch ended in.
  function scenario() {
    const poss = st.holder.team;
    const ball = { x: st.ball.x, y: st.ball.y };
    const sh = JO.gen.shape(poss === 'us', ball, 0, st.formation);
    const homes = {};
    st.mates.forEach(m => { if (sh[m.pos]) homes[m.pos] = { x: +sh[m.pos].x.toFixed(2), y: +sh[m.pos].y.toFixed(2) }; });
    const me = st.mates[st.me];
    return {
      v: 1, seed: randSeed(), formation: st.formation, templateId: 'wedstrijd', phase: 'aanval',
      title: '', promptRaw: '', context: 'Het spel gaat door.', risk: 1, att: 1, level: 0,
      oppPush: st.score.them < st.score.us ? 1.3 : st.score.them > st.score.us ? 0.8 : 1,
      poss, me: st.me, carrier: { team: poss, idx: st.holder.idx }, ball,
      mates: st.mates.map(m => ({ pos: m.pos, x: m.x, y: m.y, name: m.name })),
      opps: st.opps.map(o => ({ pos: o.pos, x: o.x, y: o.y })),
      home: homes[me.pos], homes, onlyDribble: false, keepAway: 0, restart: false
    };
  }

  // what the situation is called and asked, from the point of view of the player
  function describe(sc) {
    const iCarry = sc.poss === 'us' && sc.carrier.idx === sc.me;
    if (iCarry) return { phase: 'aanval', title: 'Jij hebt de bal', prompt: 'Jij hebt de bal. Wat doe je?' };
    if (sc.poss === 'us') {
      // always name the teammate who has the ball
      const c = sc.mates[sc.carrier.idx];
      const who = c.name || C.POS_NAME[c.pos];
      return { phase: 'aanval', title: who + ' heeft de bal', prompt: who + ' heeft de bal. Waar ga jij heen?' };
    }
    return { phase: 'verdedigen', title: 'Zij hebben de bal', prompt: 'De tegenstander heeft de bal. Wat doe jij?' };
  }

  // the team's own choice for the player: the best move the judge finds
  function bestAction(sc) {
    const me = sc.mates[sc.me];
    return JO.judge.judge(sc, { type: 'move', x: me.x, y: me.y }).best;
  }

  // whoever is closest to the ball holds it when nobody does
  function nearestHolder() {
    let best = null, bd = 1e9;
    st.mates.forEach((m, i) => { const d = C.dist(m, st.ball); if (d < bd) { bd = d; best = { team: 'us', idx: i }; } });
    st.opps.forEach((o, i) => { const d = C.dist(o, st.ball); if (d < bd) { bd = d; best = { team: 'them', idx: i }; } });
    return best;
  }

  // the state after a stretch: the positions where it ended
  function advance(sim) {
    const last = sim.frames[sim.frames.length - 1];
    st.mates.forEach((m, i) => { m.x = last.mates[i].x; m.y = last.mates[i].y; });
    st.opps.forEach((o, i) => { o.x = last.opps[i].x; o.y = last.opps[i].y; });
    st.ball = { x: last.ball.x, y: last.ball.y };
    st.holder = last.holder ? { team: last.holder.team, idx: last.holder.idx } : nearestHolder();
    const holder = st.holder.team === 'us' ? st.mates[st.holder.idx] : st.opps[st.holder.idx];
    st.ball = { x: holder.x, y: holder.y };
    st.kind = sim.outcome.kind;
  }

  // a goal: the team that conceded kicks off from the middle, the players walk there
  function kickoff(team, token, done) {
    const list = team === 'us' ? st.mates : st.opps;
    let best = 0;
    list.forEach((p, i) => { if (C.dist(p, { x: CX, y: L / 2 }) < C.dist(list[best], { x: CX, y: L / 2 })) best = i; });
    const sc = scenario();
    // everybody goes to their own spot for their side of the pitch, the kicker to the middle
    const flip = p => ({ x: W - p.x, y: L - p.y });
    const ourSh = JO.gen.shape(team === 'us', { x: CX, y: L / 2 }, 0, st.formation);
    const theirSh = JO.gen.shape(team === 'them', { x: CX, y: L / 2 }, 0);
    const spot = (sh, p, mirror) => p.pos === 'K' ? { x: CX, y: mirror ? 1.2 : L - 1.2 } : sh[p.pos] ? (mirror ? flip(sh[p.pos]) : sh[p.pos]) : { x: p.x, y: p.y };
    const end = { mates: st.mates.map(m => spot(ourSh, m, false)), opps: st.opps.map(o => spot(theirSh, o, true)), ball: { x: CX, y: L / 2 + (team === 'us' ? 1 : -1)}, holder: { team, idx: best } };
    const start = { mates: sc.mates.map(m => ({ x: m.x, y: m.y })), opps: sc.opps.map(o => ({ x: o.x, y: o.y })), ball: { x: st.ball.x, y: st.ball.y }, holder: null };
    const list2 = team === 'us' ? end.mates : end.opps;
    list2[best] = { x: CX, y: L / 2 + (team === 'us' ? 1 : -1) };
    field.setScenario(sc);
    field.disableInput();
    field.animate([start, Object.assign({}, end, { ms: 1400 })], () => setTimeout(() => {
      if (!st || st.token !== token) return;
      st.holder = { team, idx: best };
      st.ball = { x: CX, y: L / 2 + (team === 'us' ? 1 : -1) };
      st.mates.forEach((m, i) => { m.x = end.mates[i].x; m.y = end.mates[i].y; });
      st.opps.forEach((o, i) => { o.x = end.opps[i].x; o.y = end.opps[i].y; });
      done();
    }, 200));
  }

  // ---------- a stretch of play ----------
  // Playing a stretch: the field animates from where the match is now, to where it ends.
  function playOut(sc, sim, token, after) {
    field.setScenario(sc);
    field.disableInput();
    field.animate(sim.frames, () => setTimeout(() => {
      if (!st || st.token !== token) return;
      advance(sim);
      ticker(fmt(st.clock) + ' · ' + sim.outcome.text);
      if (sim.outcome.kind === 'goal') {
        st.score.us++;
        ticker(fmt(st.clock) + ' · Doelpunt voor ons!');
        renderHead();
        return kickoff('them', token, after);
      }
      if (sim.outcome.kind === 'tegengoal') {
        st.score.them++;
        ticker(fmt(st.clock) + ' · Doelpunt voor de tegenstander.');
        renderHead();
        return kickoff('us', token, after);
      }
      after();
    }, 300));
  }

  function nextSegment(token) {
    if (!st || st.token !== token) return;
    // a formation change first: the players run to their new places
    if (st.pending) {
      const f = st.pending;
      st.pending = null;
      return switchFormation(f, token, () => nextSegment(token));
    }
    if (st.seg >= SEGMENTS) return finish();
    st.seg++;
    st.clock = (st.seg - 1) * SEG_LEN;
    renderHead();
    const sc = scenario();
    const d = describe(sc);
    sc.phase = d.phase; sc.title = d.title; sc.promptRaw = d.prompt;
    const decide = wantsStop(sc);
    $('m-title').textContent = d.title;
    $('m-phase').textContent = fmt(st.clock) + ' · ' + (st.formation === '1-4-3' ? '1-4-3 · ' : '') + C.PHASES[d.phase];
    $('m-context').textContent = sc.context;
    $('m-role').innerHTML = 'Jij bent de <b>' + C.POS_NAME[sc.mates[sc.me].pos] + '</b> (geel).';
    $('m-result').classList.add('hidden');
    renderFormationButtons();
    if (decide) {
      st.mode = 'moment';
      st.stops++;
      st.moment = { sc, action: null };
      $('m-prompt').textContent = d.prompt;
      $('m-hint').textContent = hintFor(sc);
      ticker(fmt(st.clock) + ' · Even stilstaan! Wat doe jij?');
      $('m-go').classList.remove('hidden');
      $('m-undo').classList.remove('hidden');
      $('m-go').disabled = true; $('m-undo').disabled = true;
      field.setScenario(sc);
      field.enableInput(onAction);
      renderHead();
      return;
    }
    // no stop: the team plays on, with the player's best move
    st.mode = 'running';
    $('m-prompt').textContent = 'Het spel gaat verder.';
    $('m-hint').textContent = '';
    $('m-go').classList.add('hidden');
    $('m-undo').classList.add('hidden');
    playOut(sc, JO.playout.simulate(sc, bestAction(sc), sc.seed), token, () => nextSegment(token));
  }

  // does the match stop for the player's decision now? Always when the player has the ball.
  // Otherwise only when the player's move really matters right now (judged in the game
  // logic) and the player is in the middle of the play, never by chance.
  function wantsStop(sc) {
    if (sc.poss === 'us' && sc.carrier.idx === sc.me) return true;
    if (!JO.judge.relevant(sc)) return false;
    return C.dist(sc.mates[sc.me], sc.ball) <= NEAR;
  }

  // the players of the team move to the places of the new formation
  function switchFormation(f, token, done) {
    const sc = scenario();
    const roles = C.FORMATIONS[f].roles;
    const sh = JO.gen.shape(st.holder.team === 'us', { x: st.ball.x, y: st.ball.y }, 0, f);
    // each player gets a place: the keeper first, then the nearest free place
    const assign = [];
    const taken = new Set();
    const ki = st.mates.findIndex(m => m.pos === 'K');
    if (ki >= 0) { assign[ki] = roles.indexOf('K'); taken.add(roles.indexOf('K')); }
    const pairs = [];
    st.mates.forEach((m, i) => { if (assign[i] !== undefined) return; roles.forEach((r, j) => { if (r !== 'K') pairs.push({ d: C.dist(m, sh[r]), i, j }); }); });
    pairs.sort((a, b) => a.d - b.d).forEach(p => {
      if (assign[p.i] !== undefined || taken.has(p.j)) return;
      assign[p.i] = p.j; taken.add(p.j);
    });
    const endMates = st.mates.map((m, i) => { const r = roles[assign[i]]; return { x: +sh[r].x.toFixed(2), y: +sh[r].y.toFixed(2) }; });
    const start = { mates: st.mates.map(m => ({ x: m.x, y: m.y })), opps: st.opps.map(o => ({ x: o.x, y: o.y })), ball: { x: st.ball.x, y: st.ball.y }, holder: null };
    const end = { mates: endMates, opps: start.opps, ball: start.ball, holder: null, ms: 1600 };
    ticker(fmt(st.clock) + ' · Nieuwe formatie: ' + f + '.');
    field.setScenario(sc);
    field.disableInput();
    field.animate([start, end], () => setTimeout(() => {
      if (!st || st.token !== token) return;
      const newMates = new Array(st.mates.length);
      st.mates.forEach((m, i) => { newMates[assign[i]] = { pos: roles[assign[i]], x: endMates[i].x, y: endMates[i].y, name: m.name }; });
      if (st.holder.team === 'us') st.holder.idx = assign[st.holder.idx];
      st.me = assign[st.me];
      st.mates = newMates;
      st.formation = f;
      done();
    }, 200));
  }

  function hintFor(sc) {
    const iCarry = sc.poss === 'us' && sc.carrier.idx === sc.me;
    if (sc.poss === 'them') return 'Wij verdedigen: sleep jezelf naar de plek waar je het meest helpt, of naar de bal om hem af te pakken.';
    if (iCarry) return 'Sleep de bal om te passen of te schieten, of sleep jezelf om te dribbelen.';
    return 'Sleep jezelf naar de beste plek.';
  }

  function onAction(a) {
    st.moment.action = a;
    $('m-go').disabled = false; $('m-undo').disabled = false;
  }

  $('m-undo').onclick = () => {
    if (!st || !st.moment) return;
    st.moment.action = null;
    field.reset();
    field.enableInput(onAction);
    $('m-go').disabled = true; $('m-undo').disabled = true;
  };

  // a short pop-up on the pitch after each decision: "GOED +10 PUNTEN", then it fades
  function popFeedback(rating, pts) {
    const el = document.createElement('div');
    el.className = 'match-pop ' + rating;
    el.textContent = RATING_TEXT[rating].toUpperCase() + ' +' + pts + ' PUNTEN';
    $('m-field').appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // the player's choice at a stop: points, and the match goes on from where it ends
  $('m-go').onclick = () => {
    if (!st || !st.moment || !st.moment.action) return;
    const m = st.moment, sc = m.sc, token = st.token;
    field.disableInput();
    $('m-go').disabled = true; $('m-undo').disabled = true;
    const res = JO.judge.judge(sc, m.action);
    const sim = JO.playout.simulate(sc, m.action, sc.seed);
    const pts = POINTS[res.rating];
    popFeedback(res.rating, pts);
    // a poor answer: keep the situation for the training modes, with its question
    if (res.rating === 'beter') JO.storage.addTrainingSituation(Object.assign({}, sc, { prompt: sc.promptRaw }));
    st.points += pts;
    ticker(fmt(st.clock) + ' · Jouw keuze: ' + RATING_TEXT[res.rating] + ' (+' + pts + ')');
    renderHead();
    st.moment = null;
    $('m-go').classList.add('hidden');
    $('m-undo').classList.add('hidden');
    $('m-prompt').textContent = 'Het spel gaat verder.';
    $('m-hint').textContent = '';
    playOut(sc, sim, token, () => nextSegment(token));
  };

  // ---------- formation can change at will (not during a decision) ----------
  function renderFormationButtons() {
    const b = $('m-formations');
    const now = st.pending || st.formation;
    b.innerHTML = ['1-3-3-1', '1-4-3'].map(f =>
      `<button class="btn small ${f === now ? '' : 'secondary'}" data-f="${f}">${f}</button>`).join('');
    b.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      if (!st || st.mode === 'moment' || btn.dataset.f === now) return;
      st.pending = btn.dataset.f;
      renderFormationButtons();
    });
  }

  // ---------- header, ticker, end ----------
  function renderHead() {
    if (!st) return;
    $('m-score').textContent = 'Wij ' + st.score.us + ' - ' + st.score.them + ' Tegenstander';
    $('m-clock').textContent = fmt(st.clock) + ' / ' + fmt(MATCH_LEN);
    $('m-points').textContent = 'Punten: ' + st.points;
  }

  // the team ranking: each player's best match, the player's own row highlighted
  async function showBoard(playerId) {
    const box = $('m-board');
    let rows = [];
    try { rows = await JO.storage.matchBoard(); } catch (e) { rows = []; }
    box.innerHTML = '<div class="board-title">Ranglijst · beste wedstrijd</div>' +
      (rows.length ? rows.slice(0, 10).map((r, i) =>
        `<div class="board-row ${r.playerId === playerId ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)} <span class="muted">(${r.matches}x)</span></span><b>${r.best} punten</b></div>`).join('')
        : '<p class="muted">Nog geen wedstrijden gespeeld.</p>');
    box.classList.remove('hidden');
  }

  function ticker(text) {
    const t = $('m-ticker');
    const p = document.createElement('div');
    p.textContent = text;
    t.insertBefore(p, t.firstChild);
    while (t.children.length > 6) t.removeChild(t.lastChild);
  }

  function finish() {
    st.mode = 'done';
    st.clock = MATCH_LEN;
    renderHead();
    const s = st.score;
    const word = s.us > s.them ? 'gewonnen' : s.us < s.them ? 'verloren' : 'gelijk gespeeld';
    ticker('Het is afgefloten. Eindstand ' + s.us + ' - ' + s.them + '.');
    $('m-title').textContent = 'Eindstand: ' + s.us + ' - ' + s.them;
    $('m-phase').textContent = '';
    $('m-context').textContent = '';
    $('m-role').textContent = '';
    $('m-prompt').textContent = 'Wedstrijd ' + word + '. Je kreeg ' + st.stops + ' keer een keuze en scoorde ' + st.points + ' punten.';
    JO.storage.addMatch({ id: st.player.id + '-' + Date.now(), playerId: st.player.id, playerName: st.player.name, points: st.points, stops: st.stops, ts: Date.now() })
      .then(() => showBoard(st.player.id));
    $('m-hint').textContent = '';
    $('m-go').classList.add('hidden');
    $('m-undo').classList.add('hidden');
    $('m-result').classList.add('hidden');
    $('m-end-row').classList.remove('hidden');
  }

  $('m-again').onclick = () => { $('m-end-row').classList.add('hidden'); showSetup(st.player); };
  $('m-exit').onclick = exit;

  JO.match = { start };
})();
