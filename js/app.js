// Player game: login, rounds of 10 situations, feedback and summary.
(function () {
  const C = JO.core, S = JO.storage, PR = JO.progress;
  const ROUND = 10;
  const FIX_PER_ROUND = 2; // "zet het team goed" situations per round
  const $ = id => document.getElementById(id);
  const screens = ['scr-code', 'scr-name', 'scr-home', 'scr-game', 'scr-summary', 'scr-match'];
  const show = id => screens.forEach(s => $(s).classList.toggle('hidden', s !== id));

  let roster = [], player = null, myAnswers = [], field = null;
  let formation = '1-3-3-1'; // chosen on the start screen; kept for "nog een ronde"
  let mode = 'spel';         // 'spel' (top view) or 'pov' (standing on the field)
  let pov = null;

  // POV: the choice is made from your own spot; the outcome is shown in the top view
  function showPov() {
    if (!pov) pov = JO.Pov($('pov'));
    $('field').classList.add('hidden');
    $('pov').classList.remove('hidden');
    $('g-hint').textContent = 'Tik op het veld om heen te gaan, op een teamgenoot om hem aan te spelen (als jij de bal hebt), of op het doel om te schieten. Tik daarna op Klaar!';
    pov.setScenario(cur.sc);
    pov.enableInput(onAction);
  }
  // after a POV choice: a short pause on the top view so the player can get their bearings,
  // then the replay runs a bit slower than usual
  function paced(sim) {
    if (mode !== 'pov') return sim;
    const f = sim.frames.map((fr, i) => i === 0 ? fr : Object.assign({}, fr, { ms: Math.round(fr.ms * 1.6) }));
    const hold = Object.assign({}, f[0], { ms: 1000 });
    return Object.assign({}, sim, { frames: [f[0], hold].concat(f.slice(1)) });
  }

  function showField() {
    $('pov').classList.add('hidden');
    $('field').classList.remove('hidden');
  }
  let round = null; // { items: [], idx, points, streak, badgesBefore }
  let cur = null;   // { sc, action, result, sim }

  // points and badges count from the coach's reset; the level uses all answers
  const counted = () => myAnswers.filter(a => a.ts >= S.resetAt());

  const randSeed = () => (Math.floor(Math.random() * 2147483647) ^ Date.now()) >>> 0;

  // ---------- header ----------
  function hud() {
    const h = $('hud');
    if (!player) { h.innerHTML = ''; return; }
    let html = `<span class="pill">👤 <b>${esc(player.name)}</b></span>`;
    if (round) html += `<span class="pill">⭐ <b>${round.points}</b></span>` + (round.streak >= 2 ? `<span class="pill">🔥 ${round.streak}</span>` : '');
    html += `<button class="linkbtn" id="btn-menu">Menu</button><button class="linkbtn" id="btn-switch">Wissel</button>`;
    h.innerHTML = html;
    // back to the start screen from any game: pick another mode there
    $('btn-menu').onclick = () => { stopRound(); showHome(); };
    $('btn-switch').onclick = () => { stopRound(); player = null; S.setSession(Object.assign(S.getSession(), { playerId: null })); hud(); showNames(); };
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- login ----------
  $('code-form').onsubmit = async (e) => {
    e.preventDefault();
    $('code-error').textContent = '';
    let ok;
    try { ok = await S.joinTeam($('code-input').value); }
    catch (err) {
      console.error(err);
      $('code-error').textContent = 'Geen verbinding met de server. Heb je internet?';
      return;
    }
    if (ok) {
      S.setSession(Object.assign(S.getSession(), { team: true }));
      showNames();
    } else {
      $('code-error').textContent = 'Die code klopt niet. Vraag het aan je trainer.';
    }
  };

  async function showNames() {
    roster = await S.getRoster();
    const box = $('names');
    box.innerHTML = '';
    roster.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      const b = document.createElement('button');
      b.innerHTML = `${esc(p.name)}<small>${C.POS_NAME[p.main] || ''}</small>`;
      b.onclick = () => pickPlayer(p.id);
      box.appendChild(b);
    });
    $('team-week').textContent = 'Teampunten deze week: ' + await S.teamPoints(C.startOfWeek(Date.now()));
    show('scr-name');
  }

  async function pickPlayer(id) {
    player = roster.find(p => p.id === id);
    S.setSession(Object.assign(S.getSession(), { team: true, playerId: id }));
    hud();
    showHome();
  }

  async function showHome() {
    if (player.ouder) return showParentHome();
    $('home-ouder').classList.add('hidden');
    myAnswers = await S.getMyAnswers(player.id);
    $('home-hello').textContent = 'Hoi ' + player.name + '!';
    const back = player.backup ? ' en soms ' + C.POS_NAME[player.backup] : '';
    $('home-pos').textContent = 'Jij speelt vooral ' + C.POS_NAME[player.main] + back + '.';
    renderBadges($('home-badges'), PR.badgesFor(counted()), []);
    $('home-team').textContent = 'Jouw punten deze week: ' + PR.weekPoints(counted()) + ' · Team: ' + await S.teamPoints(C.startOfWeek(Date.now()));
    show('scr-home');
  }

  // Parents: play as a guest. Every game they pick their own position; nothing is saved
  // and nothing is shared, so parents can play at the same time on their own devices.
  function showParentHome() {
    myAnswers = [];
    $('home-hello').textContent = 'Hoi ' + player.name + '!';
    $('home-pos').textContent = 'Je speelt mee als ouder. Je antwoorden worden niet bewaard.';
    $('home-badges').innerHTML = '';
    $('home-team').textContent = '';
    const sel = $('ouder-pos');
    if (!sel.options.length) sel.innerHTML = C.POSITIONS.map(p => '<option value="' + p + '">' + C.POS_NAME[p] + '</option>').join('');
    sel.value = player.main;
    $('home-ouder').classList.remove('hidden');
    show('scr-home');
  }

  function renderBadges(box, badges, newKeys) {
    box.innerHTML = '';
    badges.forEach(b => {
      const s = document.createElement('span');
      s.className = 'badge ' + b.tier + (newKeys.includes(b.key) ? ' new' : '');
      s.textContent = PR.tierIcon(b.tier) + ' ' + b.name;
      box.appendChild(s);
    });
  }

  // ---------- round ----------
  $('ouder-pos').onchange = () => { player.main = $('ouder-pos').value; };
  $('btn-ouder').onclick = () => { $('ouder-entry').classList.toggle('hidden'); $('ouder-name').focus(); };
  $('ouder-go').onclick = () => {
    player = { id: 'ouder', name: $('ouder-name').value.trim() || 'Ouder', main: 'LM', backup: null, ouder: true };
    hud();
    showHome();
  };
  $('btn-start').onclick = () => { mode = 'spel'; formation = '1-3-3-1'; startRound(); };
  $('btn-start-143').onclick = () => { mode = 'spel'; formation = '1-4-3'; startRound(); };
  $('btn-start-pov').onclick = () => { mode = 'pov'; formation = '1-3-3-1'; startRound(); };
  $('btn-start-match').onclick = () => JO.match.start(player, roster, showHome);
  $('btn-again').onclick = startRound;
  $('btn-stop').onclick = () => { round = null; hud(); showHome(); };

  function startRound() {
    round = { items: [], idx: 0, points: 0, streak: 0, used: [], badgesBefore: PR.badgesFor(counted()).map(b => b.key) };
    // a few "zet het team goed" situations at random places (not the first two);
    // they take a while to make, so they are made in the background now
    // (not in the POV mode: those are about moving teammates from the top view)
    const nFix = mode === 'pov' ? 0 : FIX_PER_ROUND;
    const slots = [2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5).slice(0, nFix);
    round.fix = { at: slots, ready: [], left: nFix, cancel: null, waiting: null };
    prepareFix(round);
    hud();
    show('scr-game');
    if (!field) field = JO.Field($('field'));
    nextSituation();
  }

  function prepareFix(r) {
    if (r !== round || r.fix.left <= 0) return;
    r.fix.left--;
    const mePos = C.formationPos(C.pickPosition(player, Math.random(), Math.random()), formation);
    r.fix.cancel = JO.fix.generateAsync({ mePos, seed: randSeed(), level: PR.levelFor(myAnswers), formation }, sc => {
      if (r !== round) return;
      r.fix.ready.push(sc); // null if it did not work out: a normal situation is used instead
      if (r.fix.waiting) { const w = r.fix.waiting; r.fix.waiting = null; w(); }
      prepareFix(r);
    });
  }

  function stopRound() {
    if (round && round.fix && round.fix.cancel) round.fix.cancel();
    round = null;
    if (field) field.stopAnim();
  }

  function pickMatchSituation() {
    const pool = JO.storage.trainingPool();
    if (!pool.length || Math.random() > 0.35) return null;
    return JSON.parse(JSON.stringify(pool[Math.floor(Math.random() * pool.length)]));
  }

  function nextSituation() {
    if (round.fix.at.includes(round.items.length)) {
      if (!round.fix.ready.length) {
        // still being made: wait a moment
        $('g-title').textContent = 'Even het team neerzetten...';
        $('g-prompt').textContent = ''; $('g-context').textContent = ''; $('g-role').textContent = '';
        $('g-result').classList.add('hidden'); $('g-hint').classList.add('hidden');
        round.fix.waiting = nextSituation;
        return;
      }
      const sc = round.fix.ready.shift();
      if (sc) return startFix(sc);
    }
    const mePos = C.formationPos(C.pickPosition(player, Math.random(), Math.random()), formation);
    // now and then a situation the player got wrong in a match comes back
    const fromMatch = pickMatchSituation();
    const sc = fromMatch || JO.gen.generate({ mePos, seed: randSeed(), level: PR.levelFor(myAnswers), exclude: round.used, formation });
    if (!fromMatch) JO.gen.assignNames(sc, roster, player.id);
    round.used.push(sc.templateId);
    cur = { sc, action: null, practice: false };
    $('g-practice').classList.add('hidden');
    renderProgress();
    $('g-phase').textContent = (sc.formation === '1-4-3' ? '1-4-3 · ' : '') + C.PHASES[sc.phase];
    $('g-title').textContent = sc.title;
    $('g-context').textContent = sc.context;
    $('g-role').innerHTML = 'Jij bent de <b>' + C.POS_NAME[sc.mates[sc.me].pos] + '</b> (geel).';
    $('g-prompt').textContent = sc.prompt;
    const iCarry = sc.poss === 'us' && sc.carrier.idx === sc.me;
    $('g-hint').textContent = sc.onlyDribble ? 'Sleep jezelf (met de bal) om de bal in te dribbelen.'
      : iCarry ? 'Sleep de bal om te passen of te schieten (in het doel), of sleep jezelf om te dribbelen. Na een pass mag je jezelf ook slepen: waar loop je naartoe?'
        : 'Sleep jezelf naar de beste plek.';
    $('g-hint').classList.remove('hidden');
    $('g-result').classList.add('hidden');
    $('g-confirm').classList.remove('hidden');
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
    if (mode === 'pov') showPov();
    else { showField(); field.setScenario(sc); field.enableInput(onAction); }
    if (window.innerWidth < 860) {
      // phone: show the question and the whole field together
      const top = $('g-role').getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  function renderProgress() {
    const p = $('progress');
    p.innerHTML = '';
    for (let i = 0; i < ROUND; i++) {
      const it = document.createElement('i');
      if (round.items[i]) it.className = round.items[i].rating;
      else if (i === round.items.length) it.className = 'now';
      p.appendChild(it);
    }
  }

  // ---------- "zet het team goed" ----------
  function startFix(sc) {
    JO.gen.assignNames(sc, roster, player.id);
    sc.prompt = sc.promptRaw;
    cur = { sc, action: null, practice: false, fix: true, positions: null };
    $('g-practice').classList.add('hidden');
    renderProgress();
    $('g-phase').textContent = 'Zet het team goed · ' + C.PHASES[sc.phase];
    $('g-title').textContent = sc.title;
    $('g-context').textContent = sc.context;
    $('g-role').innerHTML = 'Jij bent de <b>' + C.POS_NAME[sc.mates[sc.me].pos] + '</b> (geel), maar nu ben je ook de trainer.';
    $('g-prompt').textContent = sc.prompt;
    fixInput();
  }

  function fixInput() {
    $('g-hint').textContent = 'Sleep een teamgenoot naar een betere plek. Tik op Klaar! als het team goed staat.';
    $('g-hint').classList.remove('hidden');
    $('g-result').classList.add('hidden');
    $('g-confirm').classList.remove('hidden');
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
    field.setScenario(cur.sc);
    field.enableFix(onFixChange);
    if (window.innerWidth < 860) {
      const top = $('g-role').getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  function onFixChange(e) {
    if (e.limit) {
      $('g-hint').textContent = 'Je mag maximaal ' + JO.fix.MAX_MOVES + ' spelers verplaatsen. Sleep er eerst één terug naar de oude plek, of tik op Opnieuw.';
      return;
    }
    cur.positions = e.positions;
    $('btn-go').disabled = e.moved === 0; $('btn-undo').disabled = e.moved === 0;
  }

  function goFix() {
    field.disableInput();
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
    const sc = cur.sc;
    const res = JO.fix.rate(sc, cur.positions);
    const sim = JO.fix.play(sc, cur.positions, true);
    cur.result = res; cur.sim = sim;
    const makeRecord = pts => ({
      id: sc.seed.toString(36) + Date.now().toString(36),
      ts: Date.now(), playerId: player.id, playerName: player.name, type: 'fix',
      mePos: sc.mates[sc.me].pos, templateId: sc.templateId, phase: 'opstelling', title: sc.title,
      rating: res.rating, points: pts, tags: [], outcome: sim.outcome.kind,
      positions: cur.positions, scenario: compact(sc)
    });
    $('g-confirm').classList.add('hidden');
    if (cur.practice) {
      cur.record = Object.assign(makeRecord(0), { practice: true });
      field.animate(sim.frames, () => setTimeout(() => showFixResult(null), 700));
      return;
    }
    const pts = PR.POINTS[res.rating] + (res.rating === 'goed' && round.streak >= 2 ? 1 : 0);
    round.streak = res.rating === 'goed' ? round.streak + 1 : 0;
    round.points += pts;
    round.items.push({ rating: res.rating, title: sc.title, pts });
    const record = makeRecord(pts);
    cur.record = record;
    myAnswers.push(record);
    if (!player.ouder) S.addAnswer(record); // parents: nothing is saved
    if (sc.poolId && res.rating === 'goed') JO.storage.removeTrainingSituation(sc.poolId);
    hud();
    field.animate(sim.frames, () => setTimeout(() => showFixResult(pts), 700));
  }

  function showFixResult(pts) {
    const res = cur.result;
    const box = $('g-result');
    box.className = 'result ' + res.rating;
    $('r-rating').textContent = PR.RATING_TEXT[res.rating];
    $('r-pts').textContent = pts == null ? 'oefenen' : '+' + pts;
    $('r-outcome').textContent = 'Met jouw opstelling: ' + cur.sim.outcome.text;
    const count = res.fixed + ' van de ' + res.nWrong + (res.nWrong === 1 ? ' speler' : ' spelers') + ' die niet goed stond' + (res.nWrong === 1 ? '' : 'en') + ' heb je goed gezet.';
    $('r-text').innerHTML = [count].concat(res.lines).map(esc).join('<br>');
    $('r-best').innerHTML = res.rating === 'goed' ? '' : 'Goede plekken: <b>het gele gebied</b> bij de spelers met een rode cirkel (waar ze stonden).';
    $('legend-best').classList.add('hidden'); // the white arrows are the player's moves
    $('legend-zone').classList.remove('hidden');
    // compare: the same moment with the old (wrong) setup
    $('btn-best').textContent = 'Bekijk met de oude opstelling';
    $('btn-best').classList.remove('hidden');
    $('btn-mine').textContent = 'Bekijk met jouw opstelling';
    $('btn-mine').classList.add('hidden');
    $('g-hint').classList.add('hidden');
    $('flag-box').classList.add('hidden');
    $('flag-msg').textContent = '';
    $('btn-flag').classList.remove('hidden');
    box.classList.remove('hidden');
    field.showFix(res, cur.positions);
    if (window.innerWidth < 860) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function onAction(a) {
    cur.action = a;
    $('btn-go').disabled = false; $('btn-undo').disabled = false;
  }

  $('btn-undo').onclick = () => {
    if (cur.fix) {
      cur.positions = null;
      field.reset();
      field.enableFix(onFixChange);
      $('g-hint').textContent = 'Sleep een teamgenoot naar een betere plek. Tik op Klaar! als het team goed staat.';
      $('btn-go').disabled = true; $('btn-undo').disabled = true;
      return;
    }
    cur.action = null;
    if (mode === 'pov') { pov.reset(); pov.enableInput(onAction); }
    else { field.reset(); field.enableInput(onAction); }
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
  };

  $('btn-go').onclick = async () => {
    if (cur && cur.fix) { if (cur.positions) goFix(); return; }
    if (!cur || !cur.action) return;
    if (mode === 'pov') {
      // the choice is made; now show the top view and play it out
      pov.disableInput();
      showField();
      field.setScenario(cur.sc);
    }
    field.disableInput();
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
    const sc = cur.sc;
    const res = JO.judge.judge(sc, cur.action);
    const sim = paced(JO.playout.simulate(sc, cur.action, sc.seed));
    cur.result = res; cur.sim = sim;
    const makeRecord = pts => ({
      id: sc.seed.toString(36) + Date.now().toString(36),
      ts: Date.now(), playerId: player.id, playerName: player.name,
      mePos: sc.mates[sc.me].pos, formation: sc.formation, view: mode, templateId: sc.templateId, phase: sc.phase, title: sc.title,
      rating: res.rating, points: pts, tags: res.tags, outcome: sim.outcome.kind,
      action: cur.action, best: res.best, good: res.good, zone: roundPts(res.zone), scenario: compact(sc)
    });
    if (cur.practice) {
      // trying again: show the result, no points and not saved as an answer
      // (it can still be reported with "Klopt dit niet?")
      cur.record = Object.assign(makeRecord(0), { practice: true });
      $('g-confirm').classList.add('hidden');
      field.animate(sim.frames, () => setTimeout(() => showResult(null), 700));
      return;
    }
    const pts = PR.POINTS[res.rating] + (res.rating === 'goed' && round.streak >= 2 ? 1 : 0);
    round.streak = res.rating === 'goed' ? round.streak + 1 : 0;
    round.points += pts;
    round.items.push({ rating: res.rating, title: sc.title, pts });
    const record = makeRecord(pts);
    cur.record = record;
    myAnswers.push(record);
    if (!player.ouder) S.addAnswer(record); // parents: nothing is saved
    if (sc.poolId && res.rating === 'goed') JO.storage.removeTrainingSituation(sc.poolId);
    hud();
    $('g-confirm').classList.add('hidden');
    field.animate(sim.frames, () => setTimeout(() => showResult(pts), 700));
  };

  const roundPts = pts => (pts || []).map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));

  function compact(sc) {
    const c = C.clone(sc);
    delete c.promptRaw;
    return c;
  }

  function showResult(pts) {
    const res = cur.result, sim = cur.sim, sc = cur.sc;
    const box = $('g-result');
    box.className = 'result ' + res.rating;
    $('r-rating').textContent = PR.RATING_TEXT[res.rating];
    $('r-pts').textContent = pts == null ? 'oefenen' : '+' + pts;
    let outcomeText = sim.outcome.text;
    // say it when luck decided the outcome, so the lesson stays right
    if (res.rating !== 'goed' && sim.outcome.good && sim.outcome.luck) outcomeText += ' Dit liep goed af, maar met geluk.';
    if (res.rating === 'goed' && !sim.outcome.good && sim.outcome.unlucky) outcomeText += ' Pech in het duel, maar je keuze was goed.';
    $('r-outcome').textContent = outcomeText;
    $('r-text').textContent = res.text;
    const zone = res.zone && res.zone.length;
    if (res.rating === 'goed' && JO.judge.sameAction(res.best, cur.action)) $('r-best').innerHTML = '';
    else {
      const label = zone ? 'Goede plekken: <b>het gele gebied</b>.' : (res.good.length > 1 ? 'Goede keuzes: ' : 'Goede keuze: ') + '<b>' + esc(res.goodText) + '</b>.';
      $('r-best').innerHTML = label + (res.bestWhy ? ' <span class="why">Waarom de beste? ' + esc(res.bestWhy) + '</span>' : '');
    }
    $('legend-best').classList.remove('hidden');
    $('legend-best').textContent = zone ? 'Beste plek' : (res.good.length > 1 ? 'Goede keuzes' : 'Beste keuze');
    $('legend-zone').classList.toggle('hidden', !zone);
    $('btn-best').textContent = res.rating === 'goed' ? 'Bekijk de beste keuze' : 'Bekijk beste keuze';
    $('btn-mine').textContent = 'Bekijk jouw keuze';
    $('btn-best').classList.toggle('hidden', JO.judge.sameAction(res.best, cur.action));
    $('btn-mine').classList.add('hidden');
    $('g-hint').classList.add('hidden');
    $('flag-box').classList.add('hidden');
    $('flag-msg').textContent = '';
    $('btn-flag').classList.remove('hidden');
    box.classList.remove('hidden');
    drawFeedback();
    if (window.innerWidth < 860) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function drawFeedback() {
    field.reset();
    field.showGood(cur.result);
    field.showAction(cur.action, 'me');
  }

  // "Klopt dit niet?": save the situation with a comment for the coach
  $('btn-flag').onclick = () => { $('flag-box').classList.remove('hidden'); $('btn-flag').classList.add('hidden'); $('flag-text').focus(); };
  $('btn-flag-send').onclick = async () => {
    const r = cur.record;
    await S.addFlag(Object.assign({}, r, { comment: $('flag-text').value.trim(), flaggedAt: Date.now() }));
    $('flag-text').value = '';
    $('flag-box').classList.add('hidden');
    $('flag-msg').textContent = 'Bedankt! De trainer kan dit bekijken.';
  };

  $('btn-best').onclick = () => cur.fix ? fixReplay('old') : replay(cur.result.best, 'best');
  $('btn-mine').onclick = () => cur.fix ? fixReplay('new') : replay(cur.action, 'me');

  // "zet het team goed": play the moment again with the old or the new setup
  function fixReplay(which) {
    const old = which === 'old';
    const sim = old ? JO.fix.play(cur.sc, null, false) : cur.sim;
    field.reset();
    $('r-outcome').textContent = (old ? 'Met de oude opstelling: ' : 'Met jouw opstelling: ') + sim.outcome.text;
    $('btn-best').classList.toggle('hidden', old);
    $('btn-mine').classList.toggle('hidden', !old);
    field.animate(sim.frames, () => setTimeout(() => field.showFix(cur.result, cur.positions), 900));
  }

  function replay(action, kind) {
    const sim = JO.playout.simulate(cur.sc, action, cur.sc.seed);
    field.reset();
    field.showAction(action, kind);
    $('r-outcome').textContent = (kind === 'best' ? 'Met de beste keuze: ' : 'Met jouw keuze: ') + sim.outcome.text;
    $('btn-mine').classList.toggle('hidden', kind === 'me');
    $('btn-best').classList.toggle('hidden', kind === 'best');
    field.animate(sim.frames, () => { setTimeout(drawFeedback, 900); });
  }

  // same situation again, to try other choices (does not count)
  $('btn-retry').onclick = () => {
    field.stopAnim();
    cur.practice = true;
    cur.action = null;
    if (cur.fix) {
      cur.positions = null;
      $('g-practice').classList.remove('hidden');
      return fixInput();
    }
    $('g-result').classList.add('hidden');
    $('g-confirm').classList.remove('hidden');
    $('g-hint').classList.remove('hidden');
    $('g-practice').classList.remove('hidden');
    $('btn-go').disabled = true; $('btn-undo').disabled = true;
    if (mode === 'pov') showPov();
    else { showField(); field.setScenario(cur.sc); field.enableInput(onAction); }
    if (window.innerWidth < 860) {
      const top = $('g-role').getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  };

  $('btn-next').onclick = () => {
    field.stopAnim();
    if (round.items.length >= ROUND) return showSummary();
    nextSituation();
  };

  function showSummary() {
    const goed = round.items.filter(i => i.rating === 'goed').length;
    $('s-score').textContent = round.points + ' punten';
    $('s-sub').textContent = goed + ' van de ' + ROUND + ' keer de goede keuze.' + (goed >= 8 ? ' Top!' : goed >= 5 ? ' Goed bezig!' : ' Blijf oefenen!');
    const badges = PR.badgesFor(counted());
    const newKeys = badges.map(b => b.key).filter(k => !round.badgesBefore.includes(k));
    renderBadges($('s-badges'), badges, newKeys);
    const list = $('s-list');
    list.innerHTML = '';
    round.items.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = `<span><span class="dot ${it.rating}"></span>${esc(it.title)}</span><b>+${it.pts}</b>`;
      list.appendChild(li);
    });
    show('scr-summary');
  }

  // ---------- start ----------
  window.addEventListener('hashchange', () => location.reload());

  (async function init() {
    if (location.hash === '#trainer') return; // coach panel, see admin.js
    let s = S.getSession();
    // online: is the saved team code still right? (the coach can change it)
    if (S.online && S.hasTeam()) {
      try {
        if (!(await S.joinTeam(s.teamCode))) {
          S.setSession(Object.assign(s, { team: false, teamCode: null, playerId: null }));
          $('code-error').textContent = 'De teamcode is veranderd. Vraag de nieuwe code aan je trainer.';
        }
      } catch (e) { console.error('Geen verbinding, de bewaarde selectie wordt gebruikt:', e.message); }
      s = S.getSession();
    }
    roster = await S.getRoster();
    if (S.hasTeam() && s.playerId && roster.find(p => p.id === s.playerId)) return pickPlayer(s.playerId);
    if (S.hasTeam()) return showNames();
    show('scr-code');
  })();
})();
