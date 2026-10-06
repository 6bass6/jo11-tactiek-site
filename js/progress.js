// Points, badges and levels (shared by the game and the coach panel).
window.JO = window.JO || {};
(function () {
  const C = JO.core;
  const POINTS = { goed: 3, oke: 1, beter: 0 };
  const RATING_TEXT = { goed: 'Goed!', oke: 'Oké', beter: 'Kan beter' };
  const BADGE_NAMES = {
    opbouw: 'Opbouw-baas', aanval: 'Aanvalsleider', balwinst: 'Snelle omschakelaar',
    balverlies: 'Terugsprinter', verdedigen: 'De Muur', hervatting: 'Spelhervattings-pro'
  };
  const TIERS = [{ n: 30, name: 'goud' }, { n: 15, name: 'zilver' }, { n: 5, name: 'brons' }];

  function badgesFor(answers) {
    const goed = {};
    answers.forEach(a => { if (a.rating === 'goed') goed[a.phase] = (goed[a.phase] || 0) + 1; });
    const out = [];
    Object.keys(BADGE_NAMES).forEach(ph => {
      const n = goed[ph] || 0;
      const tier = TIERS.find(t => n >= t.n);
      if (tier) out.push({ phase: ph, name: BADGE_NAMES[ph], tier: tier.name, key: ph + ':' + tier.name });
    });
    return out;
  }

  // Difficulty grows slowly with the number of situations played.
  const levelFor = answers => Math.min(4, Math.floor(answers.length / 25));

  function weekPoints(answers, now) {
    const from = C.startOfWeek(now || Date.now());
    return answers.filter(a => a.ts >= from).reduce((s, a) => s + (a.points || 0), 0);
  }

  const tierIcon = t => ({ goud: '🥇', zilver: '🥈', brons: '🥉' }[t] || '🏅');

  JO.progress = { POINTS, RATING_TEXT, BADGE_NAMES, badgesFor, levelFor, weekPoints, tierIcon };
})();
