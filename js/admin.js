// Coach panel: overview, common mistakes with replays, players, roster.
(function () {
  const C = JO.core, S = JO.storage, PR = JO.progress, TAGS = JO.judge.TAGS;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
  const fmtDate = ts => new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' ' +
    new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  let answers = [], roster = [], flags = [], tab = 'overzicht', selectedTag = null, replayField = null, replayAnswer = null;
  let flagField = null, flagSel = null;

  const TRAINER = location.hash === '#trainer';
  if (!TRAINER) return;
  $('game-app').classList.add('hidden');
  $('admin-app').classList.remove('hidden');
  $('brand-sub').textContent = 'Trainerspaneel';
  document.title = 'JO11 Trainerspaneel';
  $('hud').innerHTML = '<a class="linkbtn" href="index.html">Naar het spel</a><button class="linkbtn hidden" id="btn-logout">Uitloggen</button>';

  // ---------- login ----------
  if (!S.online) {
    // local mode: the coach code from data/team.js
    $('login-email').classList.add('hidden');
    $('login-intro').textContent = 'Vul de trainerscode in.';
    $('login-code').placeholder = 'Trainerscode';
    $('r-intro').textContent = 'Namen en posities van je spelers. Let op: dit spel draait lokaal, wijzigingen worden alleen bewaard in deze browser op dit apparaat.';
  } else {
    // online: real results of everyone, so no test data or wiping here
    $('demo-card').classList.add('hidden');
    $('r-reset').classList.add('hidden');
    $('code-card').classList.remove('hidden');
  }
  $('login-form').onsubmit = async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    const err = await S.coachLogin($('login-email').value, $('login-code').value);
    if (err) { $('login-error').textContent = err; return; }
    $('login-code').value = '';
    open();
  };
  $('btn-logout').onclick = () => { S.coachLogout(); location.reload(); };
  $('reset-go').onclick = async () => {
    if ($('reset-confirm').value.trim().toUpperCase() !== 'RESET') { $('reset-msg').textContent = 'Typ eerst RESET in het vakje.'; return; }
    try {
      const m = await S.resetScores();
      $('reset-confirm').value = '';
      $('reset-msg').textContent = 'Schone lei: er wordt geteld vanaf ' + fmtDate(m) + '. Alle oude antwoorden zijn bewaard.';
      await load(); buildFilters(); render();
    } catch (e) { $('reset-msg').textContent = 'Niet gelukt: ' + e.message; }
  };
  $('tc-save').onclick = async () => {
    const code = $('tc-new').value.trim();
    if (code.length < 6) { $('tc-msg').textContent = 'De teamcode moet minstens 6 tekens hebben.'; return; }
    if (!confirm('De teamcode veranderen in "' + code + '"? De oude code werkt dan niet meer.')) return;
    try { await S.setTeamCode(code); $('tc-new').value = ''; $('tc-msg').textContent = 'Nieuwe teamcode opgeslagen. Geef hem aan je spelers.'; }
    catch (e) { $('tc-msg').textContent = 'Niet gelukt: ' + e.message; }
  };
  window.addEventListener('hashchange', () => location.reload());

  async function open() {
    $('scr-login').classList.add('hidden');
    $('scr-admin').classList.remove('hidden');
    $('btn-logout').classList.remove('hidden');
    try { await load(); }
    catch (e) {
      console.error(e);
      if (e.status === 401) { S.coachLogout(); location.reload(); return; }
      alert('De gegevens konden niet worden opgehaald: ' + e.message);
    }
    buildFilters();
    render();
  }

  // everything stays stored; the dashboard shows what came after the reset
  async function load() {
    roster = await S.getRoster(); // also refreshes the reset moment
    const since = S.resetAt();
    answers = (await S.getAnswers()).filter(a => a.ts >= since);
    flags = (await S.getFlags()).filter(f => (f.flaggedAt || f.ts || 0) >= since);
    const info = $('reset-info');
    info.classList.toggle('hidden', !since);
    if (since) info.textContent = 'Teller op nul sinds ' + fmtDate(since) + '. Oudere antwoorden blijven bewaard, maar tellen hier niet mee.';
  }

  // ---------- filters ----------
  function buildFilters() {
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    $('f-player').innerHTML = opt('', 'Alle spelers') + roster.map(p => opt(p.id, p.name)).join('');
    $('f-pos').innerHTML = opt('', 'Alle posities') + C.POSITIONS.map(p => opt(p, C.POS_NAME[p])).join('');
    $('f-phase').innerHTML = opt('', 'Alle spelfases') + Object.keys(C.PHASES).map(p => opt(p, C.PHASES[p])).join('');
    ['f-period', 'f-player', 'f-pos', 'f-phase'].forEach(id => { $(id).onchange = () => { selectedTag = null; render(); }; });
  }

  function filtered() {
    const days = +$('f-period').value;
    const from = days ? Date.now() - days * 86400000 : 0;
    const pl = $('f-player').value, pos = $('f-pos').value, ph = $('f-phase').value;
    return answers.filter(a => a.ts >= from && (!pl || a.playerId === pl) && (!pos || a.mePos === pos) && (!ph || a.phase === ph));
  }

  // ---------- tabs ----------
  $('tabs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    tab = b.dataset.tab;
    [...$('tabs').children].forEach(x => x.classList.toggle('active', x === b));
    render();
  };

  function render() {
    ['overzicht', 'fouten', 'spelers', 'meldingen', 'selectie'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== tab));
    $('filters').classList.toggle('hidden', tab === 'selectie' || tab === 'meldingen');
    const list = filtered();
    if (tab === 'overzicht') renderOverview(list);
    if (tab === 'fouten') renderTags(list);
    if (tab === 'spelers') renderPlayers(list);
    if (tab === 'selectie') renderRoster();
    if (tab === 'meldingen') renderFlags();
  }

  function tagCounts(list) {
    const m = {};
    list.forEach(a => (a.tags || []).forEach(t => { m[t] = m[t] || { n: 0, players: new Set() }; m[t].n++; m[t].players.add(a.playerName); }));
    return Object.keys(m).map(t => ({ tag: t, n: m[t].n, players: m[t].players })).sort((a, b) => b.n - a.n);
  }

  function ratingRow(list) {
    const n = list.length;
    const g = list.filter(a => a.rating === 'goed').length, o = list.filter(a => a.rating === 'oke').length, b = n - g - o;
    return { n, g, o, b };
  }

  // ---------- overview ----------
  function renderOverview(list) {
    const r = ratingRow(list);
    const players = new Set(list.map(a => a.playerId));
    $('stats').innerHTML = [
      [r.n, 'situaties gespeeld'], [players.size, 'spelers actief'],
      [pct(r.g, r.n), 'goede keuzes'], [pct(r.b, r.n), '"kan beter"']
    ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

    const groupTable = (keyFn, keys, nameFn) => {
      let html = '<tr><th></th><th>Gespeeld</th><th>Goed</th><th>Kan beter</th><th>Vaakste fout</th></tr>';
      keys.forEach(k => {
        const sub = list.filter(a => keyFn(a) === k);
        if (!sub.length) return;
        const rr = ratingRow(sub);
        const top = tagCounts(sub)[0];
        html += `<tr><td>${esc(nameFn(k))}</td><td>${rr.n}</td><td>${pct(rr.g, rr.n)}</td><td>${pct(rr.b, rr.n)}</td><td>${top ? esc(TAGS[top.tag].label) : '–'}</td></tr>`;
      });
      return html;
    };
    $('t-phase').innerHTML = groupTable(a => a.phase, Object.keys(C.PHASES), k => C.PHASES[k]);
    $('t-pos').innerHTML = groupTable(a => a.mePos, C.POSITIONS, k => C.POS_NAME[k]);

    const tags = tagCounts(list).slice(0, 5);
    $('t-top').innerHTML = tags.length
      ? '<tr><th>Fout</th><th>Aantal</th><th>Wat je kunt zeggen</th></tr>' + tags.map(t =>
        `<tr class="click" data-tag="${t.tag}"><td><b>${esc(TAGS[t.tag].label)}</b></td><td>${t.n}× (${t.players.size} spelers)</td><td>${esc(TAGS[t.tag].tip)}</td></tr>`).join('')
      : '<tr><td class="muted">Nog geen antwoorden in deze periode.</td></tr>';
    [...$('t-top').querySelectorAll('tr.click')].forEach(tr => { tr.onclick = () => gotoTag(tr.dataset.tag); });
  }

  function gotoTag(tag) {
    tab = 'fouten';
    [...$('tabs').children].forEach(x => x.classList.toggle('active', x.dataset.tab === 'fouten'));
    selectedTag = tag;
    render();
  }

  // ---------- mistakes ----------
  function renderTags(list) {
    const tags = tagCounts(list);
    const max = tags.length ? tags[0].n : 1;
    $('t-tags').innerHTML = tags.length
      ? '<tr><th>Fout</th><th>Aantal</th><th style="width:30%"></th><th>Spelers</th></tr>' + tags.map(t =>
        `<tr class="click" data-tag="${t.tag}"><td>${selectedTag === t.tag ? '▶ ' : ''}${esc(TAGS[t.tag].label)}</td><td>${t.n}</td>` +
        `<td><div class="bar" style="width:${Math.round(t.n / max * 100)}%"></div></td><td>${t.players.size}</td></tr>`).join('')
      : '<tr><td class="muted">Geen fouten gevonden met deze filters.</td></tr>';
    [...$('t-tags').querySelectorAll('tr.click')].forEach(tr => { tr.onclick = () => { selectedTag = tr.dataset.tag; render(); }; });

    const card = $('examples-card');
    if (!selectedTag || !tags.find(t => t.tag === selectedTag)) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    $('ex-title').textContent = TAGS[selectedTag].label;
    $('ex-tip').textContent = 'Tip: ' + TAGS[selectedTag].tip;
    const ex = list.filter(a => (a.tags || []).includes(selectedTag)).sort((a, b) => b.ts - a.ts).slice(0, 15);
    $('t-examples').innerHTML = '<tr><th>Speler</th><th>Situatie</th><th>Wanneer</th></tr>' + ex.map(a =>
      `<tr class="click" data-id="${esc(a.id)}"><td>${esc(a.playerName)}<br><span class="muted">${esc(C.POS_NAME[a.mePos])}</span></td><td>${esc(a.title)}</td><td class="muted">${fmtDate(a.ts)}</td></tr>`).join('');
    [...$('t-examples').querySelectorAll('tr.click')].forEach(tr => { tr.onclick = () => showReplay(answers.find(a => a.id === tr.dataset.id)); });
  }

  const describe = (sc, a) => a.type === 'move' ? 'lopen naar een andere plek' : JO.judge.describe(sc, a);

  // Rebuild the situation of a saved answer and judge it with the current rules.
  function rebuild(a) {
    const sc = Object.assign({}, a.scenario);
    sc.mates = sc.mates.map((m, i) => Object.assign({}, m, { name: i === sc.me ? a.playerName : m.name }));
    if (a.type === 'fix') return { sc, res: JO.fix.rate(sc, a.positions) };
    return { sc, res: JO.judge.judge(sc, a.action) };
  }

  function choiceText(sc, a, res) {
    if (a.type === 'fix') return 'Zet het team goed \u2192 ' + esc(PR.RATING_TEXT[res.rating]) + '<br>' + res.lines.map(esc).join('<br>');
    const good = res.zone && res.zone.length ? 'ergens in het gele gebied' : res.goodText;
    return 'Keuze: <b>' + esc(describe(sc, a.action)) + '</b> \u2192 ' + esc(PR.RATING_TEXT[res.rating]) +
      '. Goed was: <b style="color:#ffd60a">' + esc(good) + '</b>.' +
      (res.bestWhy ? '<br><span class="muted">' + esc(res.bestWhy) + '</span>' : '');
  }

  function showReplay(a) {
    if (!a) return;
    replayAnswer = a;
    const { sc, res } = rebuild(a);
    replayAnswer.sc = sc;
    replayAnswer.res = res;
    $('replay-card').classList.remove('hidden');
    $('rp-title').textContent = a.title;
    $('rp-meta').textContent = a.playerName + ' als ' + C.POS_NAME[a.mePos] + ' · ' + fmtDate(a.ts) + ' · ' + sc.context;
    $('rp-prompt').textContent = sc.prompt || '';
    $('rp-choice').innerHTML = choiceText(sc, a, res);
    $('rp-outcome').textContent = '';
    if (!replayField) replayField = JO.Field($('rp-field'));
    drawReplay();
    if (window.innerWidth < 860) $('replay-card').scrollIntoView({ behavior: 'smooth' });
  }

  function drawReplay() {
    const a = replayAnswer;
    replayField.setScenario(a.sc);
    $('rp-mine').classList.toggle('hidden', a.type === 'fix');
    $('rp-best').classList.toggle('hidden', a.type === 'fix');
    if (a.type === 'fix') return replayField.showFix(a.res, a.positions);
    replayField.showGood(a.res);
    replayField.showAction(a.action, 'me');
  }

  function play(which) {
    const a = replayAnswer;
    if (!a || a.type === 'fix') return;
    const action = which === 'best' ? a.res.best : a.action;
    const sim = JO.playout.simulate(a.sc, action, a.sc.seed);
    replayField.reset();
    replayField.showAction(action, which === 'best' ? 'best' : 'me');
    $('rp-outcome').textContent = (which === 'best' ? 'Beste keuze: ' : 'Keuze van de speler: ') + sim.outcome.text;
    replayField.animate(sim.frames, () => setTimeout(drawReplay, 1200));
  }
  $('rp-mine').onclick = () => play('me');
  $('rp-best').onclick = () => play('best');

  // ---------- flags ----------
  function renderFlags() {
    const list = flags.slice().sort((a, b) => b.flaggedAt - a.flaggedAt);
    $('t-flags').innerHTML = list.length
      ? '<tr><th>Speler</th><th>Situatie</th><th>Opmerking</th><th>Wanneer</th></tr>' + list.map(f =>
        '<tr class="click" data-id="' + esc(f.id) + '"><td>' + esc(f.playerName) + '</td><td>' + esc(f.title) + (f.practice ? ' <span class="muted">(oefenpoging)</span>' : '') + '</td><td>' +
        esc(f.comment || '\u2013') + '</td><td class="muted">' + fmtDate(f.flaggedAt) + '</td></tr>').join('')
      : '<tr><td class="muted">Nog geen meldingen.</td></tr>';
    [...$('t-flags').querySelectorAll('tr.click')].forEach(tr => { tr.onclick = () => showFlag(flags.find(f => f.id === tr.dataset.id)); });
  }

  function showFlag(f) {
    if (!f) return;
    flagSel = f;
    const { sc, res } = rebuild(f);
    $('flag-replay-card').classList.remove('hidden');
    $('fl-title').textContent = f.title;
    $('fl-meta').textContent = f.playerName + ' als ' + C.POS_NAME[f.mePos] + ' \u00b7 ' + fmtDate(f.ts) + ' \u00b7 ' + sc.context;
    $('fl-prompt').textContent = sc.prompt || '';
    $('fl-choice').innerHTML = choiceText(sc, f, res);
    $('fl-comment').textContent = f.comment ? 'Opmerking: "' + f.comment + '"' : '';
    if (!flagField) flagField = JO.Field($('fl-field'));
    flagField.setScenario(sc);
    if (f.type === 'fix') return flagField.showFix(res, f.positions);
    flagField.showGood(res);
    flagField.showAction(f.action, 'me');
  }

  $('fl-remove').onclick = async () => {
    if (!flagSel) return;
    await S.removeFlag(flagSel);
    flags = (await S.getFlags()).filter(f => (f.flaggedAt || f.ts || 0) >= S.resetAt());
    flagSel = null;
    $('flag-replay-card').classList.add('hidden');
    renderFlags();
  };

  $('flags-download').onclick = () => {
    const blob = new Blob([JSON.stringify(flags, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'jo11-meldingen-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  // ---------- players ----------
  function renderPlayers(list) {
    const weekFrom = C.startOfWeek(Date.now());
    let html = '<tr><th>Speler</th><th>Gespeeld</th><th>Goed</th><th>Punten deze week</th><th>Zwakste fase</th><th>Vaakste fout</th><th>Laatst</th></tr>';
    roster.forEach(p => {
      const sub = list.filter(a => a.playerId === p.id);
      const rr = ratingRow(sub);
      let weakest = '–', worst = 2;
      Object.keys(C.PHASES).forEach(ph => {
        const s = sub.filter(a => a.phase === ph);
        if (s.length < 3) return;
        const g = s.filter(a => a.rating === 'goed').length / s.length;
        if (g < worst) { worst = g; weakest = C.PHASES[ph]; }
      });
      const top = tagCounts(sub)[0];
      const last = sub.length ? fmtDate(Math.max(...sub.map(a => a.ts))) : '–';
      const week = answers.filter(a => a.playerId === p.id && a.ts >= weekFrom).reduce((s, a) => s + (a.points || 0), 0);
      html += `<tr class="click" data-id="${esc(p.id)}"><td><b>${esc(p.name)}</b><br><span class="muted">${esc(C.POS_NAME[p.main] || '')}</span></td>` +
        `<td>${rr.n}</td><td>${pct(rr.g, rr.n)}</td><td>${week}</td><td>${esc(weakest)}</td><td>${top ? esc(TAGS[top.tag].label) : '–'}</td><td class="muted">${last}</td></tr>`;
    });
    $('t-players').innerHTML = html;
    [...$('t-players').querySelectorAll('tr.click')].forEach(tr => {
      tr.onclick = () => { $('f-player').value = tr.dataset.id; gotoTag(null); };
    });
  }

  // ---------- roster ----------
  let draft = null;
  function renderRoster() {
    if (!draft) draft = roster.map(p => Object.assign({}, p));
    const posOpts = (sel, allowEmpty) => (allowEmpty ? '<option value="">–</option>' : '') +
      C.POSITIONS.map(p => `<option value="${p}" ${p === sel ? 'selected' : ''}>${C.POS_NAME[p]}</option>`).join('');
    $('t-roster').innerHTML = '<tr><th>Naam</th><th>Hoofdpositie</th><th>Tweede positie</th><th></th></tr>' + draft.map((p, i) =>
      `<tr><td><input type="text" data-i="${i}" data-k="name" value="${esc(p.name)}"></td>` +
      `<td><select data-i="${i}" data-k="main">${posOpts(p.main)}</select></td>` +
      `<td><select data-i="${i}" data-k="backup">${posOpts(p.backup, true)}</select></td>` +
      `<td><button class="btn small secondary" data-del="${i}">✕</button></td></tr>`).join('');
    $('t-roster').querySelectorAll('[data-k]').forEach(inp => {
      inp.oninput = inp.onchange = () => { draft[+inp.dataset.i][inp.dataset.k] = inp.value; };
    });
    $('t-roster').querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => { draft.splice(+b.dataset.del, 1); renderRoster(); };
    });
  }
  $('r-add').onclick = () => {
    const ids = draft.map(p => +String(p.id).replace(/\D/g, '') || 0);
    draft.push({ id: 'p' + (Math.max(0, ...ids) + 1), name: 'Nieuwe speler', main: 'CM', backup: '' });
    renderRoster();
  };
  $('r-save').onclick = async () => {
    const clean = draft.filter(p => p.name.trim()).map(p => ({ id: p.id, name: p.name.trim(), main: p.main, backup: p.backup || '' }));
    const ok = await S.saveRoster(clean);
    if (!ok) {
      $('r-msg').innerHTML = '<span style="color:var(--bad)">' + (S.online
        ? 'Opslaan is niet gelukt. Heb je internet? Log anders opnieuw in en probeer het nog eens.'
        : 'Opslaan is niet gelukt: deze browser bewaart niets voor deze pagina (bijvoorbeeld in een privévenster).') + '</span>';
      return;
    }
    roster = (await S.getRoster()); draft = null;
    buildFilters(); renderRoster();
    $('r-msg').textContent = S.online
      ? 'Opgeslagen (' + roster.length + ' spelers). Alle apparaten krijgen deze lijst de volgende keer dat het spel opent.'
      : 'Opgeslagen in deze browser (' + roster.length + ' spelers). Het spel in deze zelfde browser gebruikt nu deze namen.';
  };
  $('r-reset').onclick = async () => {
    if (!confirm('De lijst terugzetten naar de standaardlijst uit het teambestand?')) return;
    await S.resetRoster();
    roster = await S.getRoster(); draft = null;
    buildFilters(); renderRoster();
    $('r-msg').textContent = 'Standaardlijst teruggezet.';
  };

  // ---------- test data ----------
  $('demo-add').onclick = async () => {
    $('demo-msg').textContent = 'Bezig...';
    await new Promise(r => setTimeout(r, 30));
    const list = [];
    for (let i = 0; i < 200; i++) {
      const p = roster[i % roster.length];
      const mePos = Math.random() < 0.7 || !p.backup ? p.main : p.backup;
      const sc = JO.gen.generate({ mePos, seed: (Math.random() * 2e9) >>> 0 });
      JO.gen.assignNames(sc, roster, p.id);
      const cands = JO.judge.candidates(sc);
      const action = cands[Math.floor(Math.random() * cands.length)];
      const res = JO.judge.judge(sc, action);
      const sc2 = C.clone(sc); delete sc2.promptRaw;
      list.push({
        id: 'demo' + i + Date.now().toString(36), ts: Date.now() - Math.random() * 20 * 86400000,
        playerId: p.id, playerName: p.name, mePos, templateId: sc.templateId, phase: sc.phase, title: sc.title,
        rating: res.rating, points: PR.POINTS[res.rating], tags: res.tags, outcome: '', action, best: res.best, good: res.good, scenario: sc2
      });
    }
    await S.addAnswers(list);
    await load();
    $('demo-msg').textContent = '200 testantwoorden toegevoegd.';
  };
  $('demo-clear').onclick = async () => {
    if (!confirm('Alle antwoorden op dit apparaat wissen? Dit kan niet ongedaan worden.')) return;
    await S.clearAnswers();
    await load();
    $('demo-msg').textContent = 'Alle antwoorden gewist.';
  };

  if (S.isCoach()) open();
})();
