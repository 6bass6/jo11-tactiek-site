// Saving roster, answers, reports and login.
//
// Online (JO.config has a Supabase url): the team code is checked by the server,
// answers and reports are sent to the database. Without internet they wait in
// this browser (the "outbox") and are sent later. The coach logs in with email
// and password and reads everything from the database.
// Local (no url, or ?lokaal in the address): everything stays in this browser,
// with the codes and roster from data/team.js (for developing and testing).
// All functions return Promises.
window.JO = window.JO || {};
(function () {
  const P = 'jo11.';
  const read = (k, def) => {
    try { const v = localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
  };
  const cfg = JO.config || {};
  const ONLINE = !!cfg.supabaseUrl && !/[?&]lokaal/.test(location.search);
  const getSession = () => read('session', {});
  const setSession = s => write('session', s);

  // ---------- talking to the server ----------
  async function call(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ apikey: cfg.supabaseKey, 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    const res = await fetch(cfg.supabaseUrl + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.msg || data.error_description || data.error)) || ('fout ' + res.status);
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return data;
  }
  const rpc = (fn, args, token) => call('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {}, token });

  // ---------- outbox: answers and reports waiting to be sent ----------
  let flushing = false;
  async function flush() {
    if (!ONLINE || flushing) return;
    const code = getSession().teamCode;
    if (!code) return;
    flushing = true;
    try {
      let box = read('outbox', []);
      while (box.length) {
        const item = box[0];
        let ok;
        try { ok = await rpc(item.kind === 'flag' ? 'submit_flag' : 'submit_answer', { code, rec: item.rec }); }
        catch (e) { console.error('Versturen mislukt, later opnieuw:', e.message); break; } // no internet: try later
        if (ok !== true) { console.error('De server weigerde een antwoord (teamcode veranderd?)', item.rec.id); break; }
        box = read('outbox', []).filter(x => x.rec.id !== item.rec.id || x.kind !== item.kind);
        write('outbox', box);
      }
    } finally { flushing = false; }
  }
  function queue(kind, rec) {
    const box = read('outbox', []);
    box.push({ kind, rec });
    while (box.length > 3000) box.shift();
    write('outbox', box);
    flush();
  }
  if (ONLINE) {
    window.addEventListener('online', flush);
    setTimeout(flush, 1500);
    setInterval(flush, 60000);
  }

  // answers kept on this device (for the player's progress, also offline)
  function keepLocal(a) {
    const all = read('answers', []);
    all.push(a);
    while (all.length > 2000) all.shift();
    if (!write('answers', all)) { all.splice(0, 300); write('answers', all); }
  }

  // ---------- coach login (online) ----------
  async function coachToken() {
    const s = getSession(), c = s.coachAuth;
    if (!c) return null;
    if (Date.now() < c.expiresAt - 60000) return c.accessToken;
    try {
      const d = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: c.refreshToken } });
      s.coachAuth = { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + d.expires_in * 1000, email: c.email };
      setSession(s);
      return d.access_token;
    } catch (e) {
      console.error('Inlog verlopen:', e.message);
      delete s.coachAuth; setSession(s);
      return null;
    }
  }
  async function coachCall(path, opts) {
    const token = await coachToken();
    if (!token) { const e = new Error('Log opnieuw in als trainer.'); e.status = 401; throw e; }
    return call(path, Object.assign({}, opts, { token }));
  }
  // everything of a table, 1000 rows at a time
  async function coachAll(table, select, order) {
    const out = [];
    for (let from = 0; from < 50000; from += 1000) {
      const rows = await coachCall('/rest/v1/' + table + '?select=' + select + '&order=' + order, { headers: { Range: from + '-' + (from + 999) } });
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  JO.storage = {
    online: ONLINE,
    getSession, setSession,

    // ---------- players ----------
    // true when the team code is right (online: checked by the server)
    async joinTeam(code) {
      code = String(code || '').trim();
      if (!ONLINE) return code.toUpperCase() === String(JO.team.teamCode).toUpperCase();
      const d = await rpc('join_team', { code });
      if (!d) return false;
      write('roster_cache', d.roster || []);
      setSession(Object.assign(getSession(), { team: true, teamCode: code }));
      flush();
      return true;
    },
    // logged in to the team on this device (online: with a code we still have)
    hasTeam() { const s = getSession(); return !!s.team && (!ONLINE || !!s.teamCode); },

    async getRoster() {
      if (!ONLINE) return read('roster', null) || JO.team.roster;
      if (getSession().coachAuth) {
        try { const rows = await coachCall('/rest/v1/team?select=roster'); if (rows.length) return rows[0].roster; } catch (e) { console.error(e.message); }
      }
      const code = getSession().teamCode;
      if (code) {
        try { const d = await rpc('join_team', { code }); if (d) { write('roster_cache', d.roster || []); return d.roster || []; } }
        catch (e) { console.error('Selectie ophalen mislukt, de bewaarde lijst wordt gebruikt:', e.message); }
      }
      return read('roster_cache', []);
    },

    // a player's own answers (online: from the server plus what is still waiting)
    async getMyAnswers(playerId) {
      const local = read('answers', []).filter(a => a.playerId === playerId && !a.practice);
      if (!ONLINE) return local;
      try {
        const server = await rpc('my_answers', { code: getSession().teamCode, player: playerId }) || [];
        const ids = new Set(server.map(a => a.id));
        return server.concat(local.filter(a => !ids.has(a.id))).sort((a, b) => a.ts - b.ts);
      } catch (e) {
        console.error('Antwoorden ophalen mislukt, alleen die van dit apparaat:', e.message);
        return local;
      }
    },
    // points of the whole team since `since` (ms)
    async teamPoints(since) {
      const local = read('answers', []).filter(a => a.ts >= since && !a.practice).reduce((s, a) => s + (a.points || 0), 0);
      if (!ONLINE) return local;
      try {
        const n = await rpc('team_points', { code: getSession().teamCode, since });
        const waiting = read('outbox', []).filter(x => x.kind === 'answer' && x.rec.ts >= since).reduce((s, x) => s + (x.rec.points || 0), 0);
        return n == null ? local : n + waiting;
      } catch (e) { return local; }
    },

    async addAnswer(a) {
      keepLocal(a);
      if (ONLINE) queue('answer', a);
    },
    async addFlag(f) {
      if (ONLINE) return queue('flag', f);
      const all = read('flags', []); all.push(f); while (all.length > 300) all.shift(); write('flags', all);
    },
    waiting() { return read('outbox', []).length; },

    // ---------- coach ----------
    async coachLogin(email, password) {
      if (!ONLINE) {
        if (String(password).trim() !== String(JO.team.coachCode)) return 'Die code klopt niet.';
        setSession(Object.assign(getSession(), { coach: true }));
        return null;
      }
      let d;
      try { d = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password } }); }
      catch (e) { return e.status === 400 ? 'E-mailadres of wachtwoord klopt niet.' : 'Inloggen lukt nu niet: ' + e.message; }
      const s = getSession();
      s.coachAuth = { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + d.expires_in * 1000, email: String(email).trim() };
      setSession(s);
      const ok = await rpc('is_coach', {}, d.access_token).catch(() => false);
      if (ok !== true) { delete s.coachAuth; setSession(s); return 'Dit account is geen trainer van dit team.'; }
      return null;
    },
    coachLogout() {
      const s = getSession();
      delete s.coachAuth; s.coach = false;
      setSession(s);
    },
    isCoach() { const s = getSession(); return ONLINE ? !!s.coachAuth : !!s.coach; },

    async getAnswers() {
      if (!ONLINE) return read('answers', []);
      return (await coachAll('answers', 'data', 'ts.asc')).map(r => r.data);
    },
    async getFlags() {
      if (!ONLINE) return read('flags', []);
      return (await coachAll('flags', 'id,data', 'flagged_at.asc')).map(r => Object.assign({}, r.data, { dbId: r.id }));
    },
    async removeFlag(f) {
      if (!ONLINE) return write('flags', read('flags', []).filter(x => x.id !== f.id));
      await coachCall('/rest/v1/flags?id=eq.' + encodeURIComponent(f.dbId), { method: 'DELETE' });
    },
    // returns true only if the list was saved
    async saveRoster(r) {
      if (!ONLINE) { write('roster', r); return JSON.stringify(read('roster', null)) === JSON.stringify(r); }
      try { return (await coachCall('/rest/v1/rpc/save_roster', { method: 'POST', body: { r } })) === true; }
      catch (e) { console.error('Selectie opslaan mislukt:', e.message); return false; }
    },
    async resetRoster() { try { localStorage.removeItem(P + 'roster'); } catch (e) { /* ignore */ } },
    // online only: a new team code (the old one stops working)
    async setTeamCode(code) {
      await coachCall('/rest/v1/rpc/set_team_code', { method: 'POST', body: { new_code: code } });
      return true;
    },
    // test data (local mode only)
    async addAnswers(list) {
      const all = read('answers', []).concat(list);
      while (all.length > 2000) all.shift();
      write('answers', all);
    },
    async clearAnswers() { write('answers', []); }
  };
})();
