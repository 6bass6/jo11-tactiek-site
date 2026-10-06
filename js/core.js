// Shared constants, geometry and random helpers.
// Field coordinates are in meters. x: 0 (left touchline) .. 42.5 (right),
// y: 0 (opponent goal line, top) .. 64 (our goal line, bottom). We attack upwards.
window.JO = window.JO || {};
(function () {
  const W = 42.5, L = 64;
  const GOAL_W = 5;          // pupillendoel 5m x 2m
  const KEEPER_ZONE = 14;     // keepersgebied: up to the cones, about 14m from the goal line
  const RESTART_DIST = 5;     // opponents stay 5m from the ball at every restart

  const POSITIONS = ['K', 'LA', 'CV', 'RA', 'LM', 'CM', 'RM', 'SP'];
  const POS_NAME = {
    K: 'keeper', LA: 'linksachter', CV: 'centrale verdediger', RA: 'rechtsachter',
    LM: 'linkshalf', CM: 'centrale middenvelder', RM: 'rechtshalf', SP: 'spits'
  };
  const MIRROR = { K: 'K', LA: 'RA', RA: 'LA', CV: 'CV', LM: 'RM', RM: 'LM', CM: 'CM', SP: 'SP' };

  const PHASES = {
    opbouw: 'Opbouwen',
    aanval: 'Aanvallen',
    balwinst: 'Omschakelen: bal gewonnen',
    balverlies: 'Omschakelen: bal kwijt',
    verdedigen: 'Verdedigen',
    hervatting: 'Spelhervattingen',
    opstelling: 'Zet het team goed'
  };

  function rng(seed) {
    // mulberry32
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    return next;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Distance from point p to segment a-b, plus position t along it (0..1).
  function segInfo(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    const tc = clamp(t, 0, 1);
    const q = { x: a.x + dx * tc, y: a.y + dy * tc };
    return { d: dist(p, q), t: t, point: q };
  }

  function clampToField(p, margin) {
    const m = margin == null ? 0.8 : margin;
    return { x: clamp(p.x, m, W - m), y: clamp(p.y, m, L - m) };
  }

  function towards(from, to, meters) {
    const d = dist(from, to);
    if (d < 1e-6) return { x: from.x, y: from.y };
    const f = Math.min(1, meters / d);
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function startOfWeek(ts) {
    const d = new Date(ts);
    const day = (d.getDay() + 6) % 7; // monday = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d.getTime();
  }

  // Which position a player gets in the next situation: 60% main, 30% backup
  // (main again if there is no separate backup), 10% a random other outfield
  // position (never keeper). r1 and r2 are random numbers between 0 and 1.
  function pickPosition(player, r1, r2) {
    if (r1 < 0.6) return player.main;
    if (r1 < 0.9) return player.backup || player.main;
    const others = POSITIONS.filter(p => p !== 'K' && p !== player.main && p !== player.backup);
    return others[Math.floor(r2 * others.length)];
  }

  JO.core = {
    W, L, GOAL_W, KEEPER_ZONE, RESTART_DIST, POSITIONS, POS_NAME, MIRROR, PHASES,
    OUR_GOAL: { x: W / 2, y: L }, THEIR_GOAL: { x: W / 2, y: 0 },
    rng, hash, clamp, dist, lerp, segInfo, clampToField, towards, clone, startOfWeek, pickPosition
  };
})();
