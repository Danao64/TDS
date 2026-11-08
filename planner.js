/* Moteur de génération de planning — équipe en cycle (J1 / J2 / J3-N / OFF…).
 * Module sans dépendance : fonctionne dans le navigateur (window.Planner) et sous Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Planner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Tableaux horaires (feuille DATA : « NORMALE AVEC TDS OPTION 1 ») ---------- */
  const DEFAULT_TABLES = {
    weekday: {
      J1: ['07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '06:00-15:00', '08:00-16:00', '07:00-15:00', '07:00-15:00', '07:00-15:00'],
      J2: ['12:00-20:00', '09:00-17:30', '11:30-20:00', '12:00-20:30', '12:00-20:30', '10:00-18:00', '10:00-18:30', '11:30-20:00', '11:30-20:00', '11:30-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '16:00-00:00', '15:30-00:00', '15:30-00:00', '16:00-00:00', '15:30-00:00', '15:30-00:00', '15:30-00:00']
    },
    saturday: {
      J1: ['07:00-14:30', '07:00-14:30', '07:00-14:30', '07:00-14:30', '08:00-14:30', '07:00-14:30', '07:00-16:00', '07:00-14:30', '07:00-14:30', '07:00-14:30'],
      J2: ['12:00-20:00', '08:00-16:00', '12:00-20:00', '13:00-20:00', '11:30-19:30', '13:00-20:00', '12:00-20:00', '12:00-20:00', '12:00-20:00', '12:00-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '17:00-00:00', '17:00-00:00', '17:00-00:00', '17:00-00:00', '17:00-00:00', '17:00-00:00', '17:00-00:00']
    },
    sunday: {
      J1: ['07:00-14:30', '07:00-14:30', '07:00-14:30', '07:00-14:30', '08:00-15:30', '07:00-14:30', '07:00-14:30', '07:00-14:30', '07:00-14:30', '07:00-14:30'],
      J2: ['12:00-20:00', '12:00-19:30', '12:30-20:00', '13:00-20:30', '10:00-17:30', '08:00-14:30', '12:30-20:00', '12:30-20:00', '12:30-20:00', '12:30-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '16:00-00:00', '16:30-00:00', '17:00-00:00', '16:00-00:00', '16:00-00:00', '16:00-00:00', '16:00-00:00']
    }
  };

  const DAY_TYPE_LABEL = { weekday: 'Lundi–vendredi', saturday: 'Samedi', sunday: 'Dimanche / férié' };

  /* ---------- Heures ---------- */
  function parseRange(str) {
    const parts = String(str).replace(/h/gi, ':').split('-').map(function (x) { return x.trim(); });
    if (parts.length !== 2) throw new Error('Plage horaire invalide : ' + str);
    const t = function (x) { const p = x.split(':'); return (+p[0]) * 60 + (+(p[1] || 0)); };
    const s = t(parts[0]);
    let e = t(parts[1]);
    if (e <= s) e += 1440;
    return { start: s, end: e, dur: e - s };
  }
  function fmtRange(str) {
    const r = parseRange(str);
    const f = function (m) { m = m % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + 'h' + String(m % 60).padStart(2, '0'); };
    return f(r.start) + '-' + f(r.end);
  }

  /* ---------- Dates (clé "AAAA-MM-JJ", calculs en UTC) ---------- */
  function parseKey(k) { const p = k.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function toKey(d) { return d.toISOString().slice(0, 10); }
  function addDays(k, n) { const d = parseKey(k); d.setUTCDate(d.getUTCDate() + n); return toKey(d); }
  function dow(k) { return parseKey(k).getUTCDay(); } // 0 = dimanche
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 864e5); }
  function monthRange(month) {
    const p = month.split('-').map(Number);
    const mm = String(p[1]).padStart(2, '0');
    const last = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    return [p[0] + '-' + mm + '-01', p[0] + '-' + mm + '-' + String(last).padStart(2, '0')];
  }
  function serialToKey(n) { return toKey(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5)); }
  function normalizeDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v > 20000 ? serialToKey(v) : null;
    if (v instanceof Date) return toKey(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    if (/^\d{5}$/.test(s)) return serialToKey(+s);
    return null;
  }

  /* ---------- Jours fériés français ---------- */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return toKey(new Date(Date.UTC(y, mo - 1, da)));
  }
  function frenchHolidays(y) {
    const e = easter(y);
    const f = function (m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
    return [f(1, 1), addDays(e, 1), f(5, 1), f(5, 8), addDays(e, 39), addDays(e, 50), f(7, 14), f(8, 15), f(11, 1), f(11, 11), f(12, 25)];
  }
  function holidaySet(fromKey, toKey_, extra) {
    const set = new Set(extra || []);
    for (let y = +fromKey.slice(0, 4); y <= +toKey_.slice(0, 4); y++) frenchHolidays(y).forEach(function (k) { set.add(k); });
    return set;
  }
  function dayType(k, hol) {
    const d = dow(k);
    if (d === 6) return 'saturday';
    if (d === 0 || hol.has(k)) return 'sunday';
    return 'weekday';
  }

  /* ---------- Cycle ---------- */
  function inPeriods(k, periods) {
    return (periods || []).some(function (p) { return k >= p.from && k <= p.to; });
  }
  // anchor = premier jour d'un cycle (J1). Le cycle ne change jamais de longueur.
  // En période d'option, le dernier jour OFF juste avant un J1 devient J0.
  function buildRoles(cycle, fromKey, toKey_) {
    const roles = {};
    const end = addDays(toKey_, 1); // pour connaître le rôle du lendemain du dernier jour
    let pos = cycle.anchor, guard = 0;
    while (pos <= end && guard++ < 20000) {
      for (let i = 0; i < cycle.normal.length; i++) { roles[pos] = cycle.normal[i]; pos = addDays(pos, 1); }
    }
    Object.keys(roles).forEach(function (k) {
      if (k <= toKey_ && roles[k] === 'OFF' && roles[addDays(k, 1)] === 'J1' && inPeriods(k, cycle.optionPeriods)) roles[k] = 'J0';
    });
    return roles;
  }

  /* ---------- Créneaux & métriques ---------- */
  function slotMetrics(kind, rank, rangeStr, dType, cfg) {
    const r = parseRange(rangeStr);
    const m = { hours: r.dur / 60, night: 0, evening: 0, late: 0, early: 0, nightWE: 0, j0: 0 };
    if (kind === 'J3') {
      if (rank <= cfg.nightCount) { m.night = 1; if (dType !== 'weekday') m.nightWE = 1; } else m.evening = 1;
    }
    if (kind === 'J2' && r.end >= 20 * 60 + 30) m.late = 1;
    if (kind === 'J1' && r.start <= 6 * 60 + 30) m.early = 1;
    if (kind === 'J0') m.j0 = 1;
    return m;
  }
  function normValue(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
  function matchesPref(value, m) {
    switch (normValue(value)) {
      case 'nuit': return !!m.night;
      case 'soiree': return !!m.evening;
      case 'tot': return !!m.early;
      case 'tard': return !!m.late;
      case 'j0': return !!m.j0;
      default: return false;
    }
  }

  const ZERO = function () { return { hours: 0, nights: 0, n1: 0, meal: 0, evenings: 0, nightWE: 0, late: 0, early: 0, j0: 0, days: 0, weDays: 0, absDays: 0, prefOk: 0, prefKo: 0 }; };
  function addAssignment(c, m, dType) {
    c.hours += m.hours; c.nights += m.night; c.evenings += m.evening; c.nightWE += m.nightWE;
    c.late += m.late; c.early += m.early; c.j0 += m.j0; c.days += 1;
    if (dType !== 'weekday') c.weDays += 1;
  }

  /* ---------- Demandes ---------- */
  const TYPE_ALIASES = {
    c: 'C', conge: 'C', conges: 'C', cp: 'C',
    rec: 'REC', recup: 'REC', rcp: 'REC', recuperation: 'REC',
    form: 'FORM', formation: 'FORM',
    abs: 'ABS', absence: 'ABS', autre: 'ABS', indispo: 'ABS',
    renfort: 'RENFORT',
    veut: 'VEUT', souhait: 'VEUT', souhaite: 'VEUT',
    evite: 'EVITE', evitement: 'EVITE',
    fixe: 'FIXE', impose: 'FIXE',
    cdt: 'CDT', 'chef de tour': 'CDT', chef: 'CDT'
  };
  function normalizeType(t) { return TYPE_ALIASES[normValue(t)] || null; }
  const ABSENCE_TYPES = ['C', 'REC', 'FORM', 'ABS'];

  function indexRequests(cfg, requests, fromKey, toKey_, warnings) {
    const ids = {};
    cfg.agents.forEach(function (a) { ids[a.id.toUpperCase()] = a.id; });
    const idx = { absent: new Map(), renfort: new Set(), cdt: new Set(), prefs: new Map(), fixed: new Map() };
    const unknown = new Set();
    (requests || []).forEach(function (r) {
      const id = ids[String(r.agent || '').trim().toUpperCase()];
      if (!id) { if (r.agent) unknown.add(r.agent); return; }
      const type = normalizeType(r.type);
      const from = normalizeDate(r.from), to = normalizeDate(r.to) || from;
      if (!type || !from) return;
      let k = from < fromKey ? fromKey : from;
      const end = to > toKey_ ? toKey_ : to;
      for (let n = 0; k <= end && n < 400; n++, k = addDays(k, 1)) {
        const key = id + '|' + k;
        if (ABSENCE_TYPES.indexOf(type) >= 0) idx.absent.set(key, type);
        else if (type === 'RENFORT') idx.renfort.add(key);
        else if (type === 'CDT') idx.cdt.add(key);
        else if (type === 'FIXE') idx.fixed.set(key, String(r.value || '').trim().toUpperCase());
        else {
          if (!idx.prefs.has(key)) idx.prefs.set(key, []);
          idx.prefs.get(key).push({ agent: id, type: type, value: normValue(r.value) });
        }
      }
    });
    if (unknown.size) warnings.push('Demandes ignorées, agent inconnu : ' + Array.from(unknown).join(', '));
    return idx;
  }

  /* ---------- Affectation optimale (algorithme hongrois) ---------- */
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (!used[j]) {
            const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
            if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
            if (minv[j] < delta) { delta = minv[j]; j1 = j; }
          }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
    return ans;
  }
  function jitter(s) { // départage déterministe des égalités
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
    return h / 100003 * 1e-4;
  }

  /* ---------- Compteurs ---------- */
  function computeCounters(days, cfg, base) {
    const out = {};
    cfg.agents.forEach(function (a) { out[a.id] = Object.assign(ZERO(), (base && base[a.id]) || {}); });
    (days || []).forEach(function (d) {
      Object.keys(d.assign || {}).forEach(function (id) {
        const a = d.assign[id];
        if (out[id]) {
          addAssignment(out[id], slotMetrics(a.kind, a.rank, a.range, d.dayType, cfg), d.dayType);
          if (a.n1) out[id].n1 += 1;
          if (a.meal) out[id].meal += 1;
        }
      });
      Object.keys(d.absent || {}).forEach(function (id) { if (out[id]) out[id].absDays += 1; });
      (d.prefs || []).forEach(function (p) {
        if (!out[p.agent]) return;
        const a = d.assign && d.assign[p.agent];
        const j0pref = p.value === 'j0';
        if (j0pref !== (d.role === 'J0')) return; // souhaits J0 : seulement les jours de J0 (et inversement)
        let hit;
        if (j0pref) hit = !!(a && a.kind === 'J0');
        else { if (!a) return; hit = matchesPref(p.value, slotMetrics(a.kind, a.rank, a.range, d.dayType, cfg)); }
        const ok = p.type === 'VEUT' ? hit : !hit;
        if (ok) out[p.agent].prefOk += 1; else out[p.agent].prefKo += 1;
      });
    });
    return out;
  }

  /* ---------- Génération d'un mois ---------- */
  const DEFAULT_WEIGHTS = { hours: 0.125, night: 4, evening: 1, late: 3, early: 2, nightWE: 2, n1: 8, meal: 2, j2tot: 25, pref: 40 };

  function earlyLimit(cfg) {
    const m = /^(\d{1,2})[:h](\d{2})?$/i.exec(String(cfg.j2EarlyMax || '10:00').trim());
    return m ? (+m[1]) * 60 + (+(m[2] || 0)) : 600;
  }
  function isEarlyJ2(a, cfg) { return !!a && a.kind === 'J2' && parseRange(a.range).start <= earlyLimit(cfg); }

  // history : jours déjà générés juste avant le mois (pour les règles qui regardent en arrière).
  // prevByDate : jours du même mois déjà générés (pour conserver les vacations verrouillées).
  function generateMonth(cfg, requests, base, month, prevByDate, history) {
    const range = monthRange(month), from = range[0], to = range[1], next = addDays(to, 1);
    const warnings = [];
    const W = Object.assign({}, DEFAULT_WEIGHTS, cfg.weights || {});
    const hol = holidaySet(from, next, cfg.holidays);
    const roles = buildRoles(cfg.cycle, from, to);
    if (cfg.cycle.anchor > from) warnings.push('La date d\'ancrage du cycle (' + cfg.cycle.anchor + ') est postérieure au début du mois : les jours précédents sont considérés OFF.');
    const idx = indexRequests(cfg, requests, from, next, warnings);
    const regular = cfg.agents.filter(function (a) { return !a.renfort; }).map(function (a) { return a.id; });
    const renfortIds = new Set(cfg.agents.filter(function (a) { return a.renfort; }).map(function (a) { return a.id; }));
    const counters = {};
    cfg.agents.forEach(function (a) { counters[a.id] = Object.assign(ZERO(), (base && base[a.id]) || {}); });
    const agentById = {};
    cfg.agents.forEach(function (a) { agentById[a.id] = a; });
    const cdtOf = function (id, k) { return !!(agentById[id] && agentById[id].cdt) || idx.cdt.has(id + '|' + k); };
    const limit = earlyLimit(cfg);
    const byDate = {};
    (history || []).forEach(function (d) { byDate[d.date] = d; });
    const days = [];

    function availability(k) {
      const avail = [], absent = {};
      cfg.agents.forEach(function (a) {
        const key = a.id + '|' + k;
        if (idx.absent.has(key)) { absent[a.id] = idx.absent.get(key); return; }
        if (renfortIds.has(a.id) && !idx.renfort.has(key)) return;
        avail.push(a.id);
      });
      return { avail: avail, absent: absent };
    }
    function applyAssign(day, id, kind, rank, rangeStr) {
      day.assign[id] = { slot: kind === 'J0' ? 'J0' : kind + '-' + rank, kind: kind, rank: rank, range: rangeStr };
      addAssignment(counters[id], slotMetrics(kind, rank, rangeStr, day.dayType, cfg), day.dayType);
    }
    function flag(day, id, f) { day.assign[id][f] = true; counters[id][f] += 1; }

    // Résout les vacations J1/J2/J3 d'un jour SANS modifier les compteurs (sert aussi aux simulations).
    function solve(k, dt, kind, avail, fixedList, opts) {
      opts = opts || {};
      const out = { items: [], warnings: [] };
      const table = cfg.tables[dt][kind], n = avail.length;
      const rangeOf = function (rank) { return table[Math.min(rank, table.length) - 1]; };
      if (n > table.length) out.warnings.push('Plus d\'agents (' + n + ') que d\'horaires définis (' + table.length + ') : le dernier horaire est répété.');
      const slots = [];
      for (let r = 1; r <= n; r++) slots.push({ rank: r, range: rangeOf(r) });
      const fixedRank = new Set(), taken = {}, free = [];
      (fixedList || []).forEach(function (f) { fixedRank.add(f.rank); taken[f.id] = true; out.items.push(f); });
      avail.forEach(function (id) {
        if (taken[id]) return;
        const f = idx.fixed.get(id + '|' + k);
        if (f) {
          const mm = /^(J[123])-(\d+)$/.exec(f);
          if (mm && mm[1] === kind && +mm[2] <= n && !fixedRank.has(+mm[2])) {
            fixedRank.add(+mm[2]);
            out.items.push({ id: id, rank: +mm[2], range: rangeOf(+mm[2]) });
            return;
          }
          out.warnings.push('Créneau imposé « ' + f + ' » inapplicable pour ' + id + ' ce jour.');
        }
        free.push(id);
      });
      const freeSlots = slots.filter(function (s) { return !fixedRank.has(s.rank); });

      // taux d'équipe (hors renforts) : l'écart se mesure par jour travaillé, ou par nuit pour N1 / repas
      const rt = {};
      ['hours', 'nights', 'evenings', 'late', 'early', 'nightWE', 'n1', 'meal'].forEach(function (key) {
        let s = 0, d = 0;
        regular.forEach(function (id) { s += counters[id][key]; d += counters[id].days; });
        rt[key] = d ? s / d : 0;
      });
      const dev = function (id, key) { return renfortIds.has(id) ? 0 : counters[id][key] - rt[key] * counters[id].days; };
      const devN = function (id, key) {
        let s = 0, d = 0;
        regular.forEach(function (x) { s += counters[x][key]; d += counters[x].nights; });
        return renfortIds.has(id) ? 0 : counters[id][key] - (d ? s / d : 0) * counters[id].nights;
      };

      if (free.length) {
        const needCdt = !fixedRank.has(1);
        const cdtFree = free.some(function (id) { return cdtOf(id, k); });
        const cost = free.map(function (id) {
          return freeSlots.map(function (s) {
            const m = slotMetrics(kind, s.rank, s.range, dt, cfg);
            let c = W.hours * dev(id, 'hours') * m.hours + W.night * dev(id, 'nights') * m.night +
              W.evening * dev(id, 'evenings') * m.evening + W.late * dev(id, 'late') * m.late +
              W.early * dev(id, 'early') * m.early + W.nightWE * dev(id, 'nightWE') * m.nightWE;
            if (m.night) {
              c += W.n1 * dev(id, 'n1') + W.meal * dev(id, 'meal');
              if (opts.plan && opts.plan.indexOf(id) < 0) c += 1e5;      // équipe de nuit prévue la veille
              if (opts.noEarly && opts.noEarly(id)) c += W.j2tot;        // pas de J2 tôt la veille
            }
            if (kind === 'J2' && opts.early && opts.early.has(id) && parseRange(s.range).start <= limit) c -= W.j2tot;
            (idx.prefs.get(id + '|' + k) || []).forEach(function (p) {
              if (matchesPref(p.value, m)) c += (p.type === 'VEUT' ? -W.pref : W.pref);
            });
            if (s.rank === 1 && needCdt && cdtFree && !cdtOf(id, k)) c += 1e6;   // rang 1 = chef de tour
            return c + jitter(id + k + s.rank);
          });
        });
        hungarian(cost).forEach(function (j, i) { out.items.push({ id: free[i], rank: freeSlots[j].rank, range: freeSlots[j].range }); });
      }

      // N1 (reste éveillé) et repas : deux agents différents parmi ceux qui font la nuit
      if (kind === 'J3') {
        const night = out.items.filter(function (it) { return it.rank <= cfg.nightCount; });
        const hasN1 = night.some(function (it) { return it.n1; }), hasMeal = night.some(function (it) { return it.meal; });
        const plain = function () { return night.filter(function (it) { return !it.n1 && !it.meal; }); };
        const jn = function (it, key) { return jitter(it.id + k + key); };
        const cand = plain();
        if (!hasN1 && !hasMeal && cand.length >= 2) {
          let best = null;
          cand.forEach(function (a) {
            cand.forEach(function (b) {
              if (a === b) return;
              const c = W.n1 * devN(a.id, 'n1') + W.meal * devN(b.id, 'meal') + jn(a, 'n') + jn(b, 'm');
              if (!best || c < best.c) best = { a: a, b: b, c: c };
            });
          });
          best.a.n1 = true; best.b.meal = true;
        } else {
          if (!hasN1 && cand.length) {
            cand.sort(function (a, b) { return devN(a.id, 'n1') + jn(a, 'n') - devN(b.id, 'n1') - jn(b, 'n'); });
            cand[0].n1 = true;
          }
          const c2 = plain();
          if (!hasMeal && c2.length) {
            c2.sort(function (a, b) { return devN(a.id, 'meal') + jn(a, 'm') - devN(b.id, 'meal') - jn(b, 'm'); });
            c2[0].meal = true;
          }
        }
        if (night.length && !night.some(function (it) { return it.n1; })) out.warnings.push('Aucun agent pour la N1.');
        if (night.length && !night.some(function (it) { return it.meal; })) out.warnings.push('Pas de repas : un seul agent de nuit.');
      }
      return out;
    }

    for (let k = from; k <= to; k = addDays(k, 1)) {
      const dt = dayType(k, hol);
      const role = roles[k] || 'OFF';
      const day = { date: k, dayType: dt, role: role, assign: {}, absent: {}, prefs: [], warnings: [], lockedAgents: {}, cdt: {} };
      days.push(day);
      byDate[k] = day;
      if (role === 'OFF') continue;

      const av = availability(k), avail = av.avail;
      day.absent = av.absent;
      Object.keys(av.absent).forEach(function (id) { counters[id].absDays += 1; });
      avail.forEach(function (id) {
        if (cdtOf(id, k)) day.cdt[id] = true;
        (idx.prefs.get(id + '|' + k) || []).forEach(function (p) { day.prefs.push(p); });
      });

      if (role === 'J0') {
        const pool0 = avail.filter(function (id) { return !renfortIds.has(id); });
        if (!pool0.length) { day.warnings.push('Aucun agent disponible pour le J0.'); continue; }
        // Règle : l'agent qui a fait la N1 du J3 de ce cycle ne fait pas le J0 de fin de cycle.
        let j3 = null;
        for (let b = 1; b <= 7 && !j3; b++) { const pd = byDate[addDays(k, -b)]; if (pd && pd.role === 'J3') j3 = pd; }
        const n1ids = j3 ? Object.keys(j3.assign).filter(function (id) { return j3.assign[id].n1; }) : [];
        const noN1 = pool0.filter(function (id) { return n1ids.indexOf(id) < 0; });
        const cands = noN1.length ? noN1 : pool0;
        // Souhait J0 = -2, évitement J0 = +2 sur le nombre de J0 déjà faits : la demande est prioritaire
        // tant que l'écart avec l'agent le moins servi reste borné (équité préservée).
        const wants = function (id, t) { return (idx.prefs.get(id + '|' + k) || []).some(function (p) { return p.type === t && p.value === 'j0'; }); };
        const score = function (id) { return counters[id].j0 + (wants(id, 'VEUT') ? -2 : 0) + (wants(id, 'EVITE') ? 2 : 0); };
        cands.sort(function (a, b) { return score(a) - score(b) || counters[a].hours - counters[b].hours || (a < b ? -1 : 1); });
        const imposed = pool0.filter(function (id) { return idx.fixed.get(id + '|' + k) === 'J0'; });
        const pick = imposed.length ? imposed[0] : cands[0];
        if (n1ids.indexOf(pick) >= 0) day.warnings.push('J0 de ' + pick + ' après sa N1 du ' + j3.date + (imposed.length ? ' (créneau imposé).' : ' (aucun autre agent disponible).'));
        if (wants(pick, 'EVITE')) day.warnings.push('Évitement J0 non respecté pour ' + pick + ' (pas d\'autre agent disponible ou écart de J0 trop important).');
        applyAssign(day, pick, 'J0', 1, cfg.j0Range || '10:00-18:30');
        continue;
      }

      const kind = role; // J1 | J2 | J3
      const table = cfg.tables[dt][kind], n = avail.length;
      if (n === 0) { day.warnings.push('Aucun agent disponible.'); continue; }
      if (n < cfg.minStaff) day.warnings.push('Effectif de ' + n + ' < minimum ' + cfg.minStaff + '.');
      if (kind === 'J3' && n < cfg.nightCount) day.warnings.push('Seulement ' + n + ' agent(s) pour ' + cfg.nightCount + ' postes de nuit.');

      // vacations verrouillées (échanges manuels) : conservées, le reste du jour est recalculé autour
      const fixedList = [], usedRank = new Set();
      const prev = prevByDate && prevByDate[k];
      if (prev && prev.role === role) {
        const lk = prev.lockedAgents || (prev.locked ? Object.keys(prev.assign).reduce(function (o, id) { o[id] = true; return o; }, {}) : {});
        Object.keys(lk).forEach(function (id) {
          const a = prev.assign[id];
          if (!a) return;
          if (avail.indexOf(id) < 0) { day.warnings.push('Vacation verrouillée de ' + id + ' retirée : agent indisponible.'); return; }
          if (a.rank > n || usedRank.has(a.rank)) { day.warnings.push('Vacation verrouillée de ' + id + ' (' + a.slot + ') retirée : effectif modifié.'); return; }
          usedRank.add(a.rank);
          fixedList.push({ id: id, rank: a.rank, range: table[Math.min(a.rank, table.length) - 1], n1: !!a.n1, meal: !!a.meal });
          day.lockedAgents[id] = true;
        });
      }

      // J2 tôt la veille d'une nuit : on prévoit l'équipe de nuit du lendemain pour lui réserver les J2 tôt
      const prevDay = byDate[addDays(k, -1)];
      let plan = null, early = null;
      if (kind === 'J3' && prevDay && prevDay.nextNight && !fixedList.length) {
        const T = prevDay.nextNight;
        if (T.length === Math.min(cfg.nightCount, n) && T.every(function (id) { return avail.indexOf(id) >= 0; })) plan = T;
      }
      const noEarly = (kind === 'J3' && prevDay && prevDay.role === 'J2') ? function (id) { return !isEarlyJ2(prevDay.assign[id], cfg); } : null;
      if (kind === 'J2' && roles[addDays(k, 1)] === 'J3') {
        const nk = addDays(k, 1), avN = availability(nk).avail;
        if (avN.length) {
          const today = new Set(avail);
          const dry = solve(nk, dayType(nk, hol), 'J3', avN, [], { noEarly: function (id) { return !today.has(id); } });
          day.nextNight = dry.items.filter(function (it) { return it.rank <= cfg.nightCount; }).map(function (it) { return it.id; });
          early = new Set(day.nextNight);
        }
      }

      const res = solve(k, dt, kind, avail, fixedList, { plan: plan, noEarly: noEarly, early: early });
      res.warnings.forEach(function (w) { day.warnings.push(w); });
      res.items.forEach(function (it) {
        applyAssign(day, it.id, kind, it.rank, it.range);
        if (it.n1) flag(day, it.id, 'n1');
        if (it.meal) flag(day, it.id, 'meal');
      });
    }
    days.forEach(checkCdt);
    return { month: month, days: days, warnings: warnings, generatedAt: new Date().toISOString() };
  }

  /* ---------- Contrôle chef de tour (rang 1) ---------- */
  function checkCdt(day) {
    day.warnings = (day.warnings || []).filter(function (w) { return w.indexOf('CDT : ') !== 0; });
    if (day.role === 'OFF' || day.role === 'J0') return;
    const r1 = Object.keys(day.assign).filter(function (id) { return day.assign[id].rank === 1; })[0];
    if (!r1 || (day.cdt && day.cdt[r1])) return;
    const other = Object.keys(day.assign).some(function (id) { return day.cdt && day.cdt[id]; });
    day.warnings.push('CDT : ' + day.assign[r1].slot + ' (' + r1 + ') n\'est pas chef de tour' + (other ? ' alors qu\'un chef de tour est présent.' : ' (aucun chef de tour disponible ce jour).'));
  }

  /* ---------- Échange manuel ---------- */
  function swapAgents(day, a, b) {
    const x = day.assign[a], y = day.assign[b];
    if (!x || !y) throw new Error('Les deux agents doivent avoir une vacation ce jour.');
    day.assign[a] = y; day.assign[b] = x; // la vacation complète (y compris N1 / repas) change d'agent
    day.lockedAgents = day.lockedAgents || {};
    day.lockedAgents[a] = true; day.lockedAgents[b] = true;
  }

  return {
    DEFAULT_TABLES: DEFAULT_TABLES, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, DAY_TYPE_LABEL: DAY_TYPE_LABEL,
    parseRange: parseRange, fmtRange: fmtRange, parseKey: parseKey, toKey: toKey, addDays: addDays, dow: dow,
    daysBetween: daysBetween, monthRange: monthRange, normalizeDate: normalizeDate, normalizeType: normalizeType,
    normValue: normValue, frenchHolidays: frenchHolidays, holidaySet: holidaySet, dayType: dayType,
    buildRoles: buildRoles, slotMetrics: slotMetrics, computeCounters: computeCounters, generateMonth: generateMonth,
    swapAgents: swapAgents, checkCdt: checkCdt, hungarian: hungarian, ZERO: ZERO
  };
});
