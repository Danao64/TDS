/* Moteur de génération de planning — équipe en cycle (J1 / J2 / J3-N / OFF…).
 * Module sans dépendance : fonctionne dans le navigateur (window.Planner) et sous Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Planner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Tableaux horaires (note de service TDS LFBO, vacations élémentaires J1-1 … J3-10) ----------
   * Période d'option (avec J0 / JE), pages 3 à 5 : grille « NORMALE AVEC TDS OPTION 1 ». */
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

  // Période creuse (hors période d'option, « TDS socle hors option 1 »), pages 6 à 8.
  const DEFAULT_TABLES_CREUSE = {
    weekday: {
      J1: ['07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '06:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00'],
      J2: ['11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '10:00-19:00', '09:00-18:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00']
    },
    saturday: {
      J1: ['07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '08:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00'],
      J2: ['11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '08:00-17:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '15:00-00:00', '16:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00']
    },
    sunday: {
      J1: ['07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '08:00-16:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00', '07:00-15:00'],
      J2: ['11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '08:30-16:00', '11:00-20:00', '11:00-20:00', '11:00-20:00', '11:00-20:00'],
      J3: ['20:00-07:00', '20:00-07:00', '20:00-07:00', '15:00-00:00', '17:00-00:00', '16:30-23:30', '15:00-00:00', '15:00-00:00', '15:00-00:00', '15:00-00:00']
    }
  };
  // Grille du jour : période d'option → cfg.tables ; sinon période creuse → cfg.tablesCreuse.
  function tablesFor(cfg, k) {
    return inPeriods(k, cfg.cycle && cfg.cycle.optionPeriods) ? cfg.tables : (cfg.tablesCreuse || DEFAULT_TABLES_CREUSE);
  }
  // Horaire du J0 (JE de la note de service) : 10h00-18h30 du lundi au samedi, 10h00-18h00 le dimanche et les fériés.
  function j0RangeFor(cfg, dt) {
    return dt === 'sunday' ? (cfg.j0RangeSunday || '10:00-18:00') : (cfg.j0Range || '10:00-18:30');
  }
  function periodOf(cfg, k) { return inPeriods(k, cfg.cycle && cfg.cycle.optionPeriods) ? 'option' : 'creuse'; }

  /* ---------- Quotas d'absences et besoin de couverture (note de service TDS LFBO, page 9) ----------
   * « Période normale » de la note = période d'option ; sinon période creuse.
   * Alpha : nombre d'absences accordables par vacation selon le cardinal d'équipe (nombre d'agents hors renforts).
   * Bêta : périodes de bureau ; les récups RS peuvent être prises sur bêta s'il n'est pas consommé (sauf cardinal 6).
   * Un alpha peut dépendre de la vacation (période creuse, cardinal 8, samedi / dimanche). */
  const DEFAULT_QUOTAS = {
    normal: {
      8: { weekday: { alpha: 2, beta: 1 }, saturday: { alpha: 3, beta: 0 }, sunday: { alpha: 3, beta: 0 } },
      7: { weekday: { alpha: 2, beta: 0.66 }, saturday: { alpha: 3, beta: 0 }, sunday: { alpha: 3, beta: 0 } },
      6: { weekday: { alpha: 2, beta: 0.66 }, saturday: { alpha: 2, beta: 0 }, sunday: { alpha: 2, beta: 0 } }
    },
    creuse: {
      8: { weekday: { alpha: 3, beta: 0 }, saturday: { alpha: { J1: 4, J2: 3, J3: 4 }, beta: 0 }, sunday: { alpha: { J1: 4, J2: 4, J3: 3 }, beta: 0 } },
      7: { weekday: { alpha: 3, beta: 0 }, saturday: { alpha: 3, beta: 0 }, sunday: { alpha: 3, beta: 0 } },
      6: { weekday: { alpha: 2, beta: 0 }, saturday: { alpha: 2, beta: 0 }, sunday: { alpha: 2, beta: 0 } }
    }
  };
  // Valeur du BC (besoin de couverture) par vacation : en dessous, l'effectif est « dégradé » (§ 2.9).
  const DEFAULT_BC = {
    normal: { weekday: { J1: 7, J2: 7, J3: 7 }, saturday: { J1: 5, J2: 6, J3: 5 }, sunday: { J1: 5, J2: 6, J3: 6 } },
    creuse: { weekday: { J1: 6, J2: 6, J3: 6 }, saturday: { J1: 5, J2: 6, J3: 5 }, sunday: { J1: 5, J2: 6, J3: 6 } }
  };
  // Types d'absence décomptés sur le quota alpha (réglable) : congés et récups ; formations et autres absences non comptées.
  const DEFAULT_QUOTA_TYPES = ['CF', 'CYC', 'RS', 'RMT', 'RPT', 'REC'];
  function quotaKey(cfg, k) { return periodOf(cfg, k) === 'option' ? 'normal' : 'creuse'; }
  function cardinalOf(cfg) { return cfg.agents.filter(function (a) { return !a.renfort; }).length; }
  // Quota du jour : { alpha, beta, cardinal } ou null si le cardinal n'est pas prévu par la note (6, 7 ou 8).
  function quotaFor(cfg, k, role, dt) {
    const card = cardinalOf(cfg), q = ((cfg.quotas || DEFAULT_QUOTAS)[quotaKey(cfg, k)] || {})[card];
    if (!q || !q[dt]) return null;
    const a = q[dt].alpha;
    return { alpha: typeof a === 'object' ? a[role] : a, beta: q[dt].beta || 0, cardinal: card };
  }
  function bcFor(cfg, k, role, dt) {
    const b = ((cfg.bc || DEFAULT_BC)[quotaKey(cfg, k)] || {})[dt];
    return b && b[role] !== undefined ? b[role] : null;
  }
  // Contrôle du quota d'un jour : absTypes = types des agents absents (hors renforts). RS d'abord sur bêta (entier) si cardinal ≠ 6.
  function quotaCheck(cfg, k, role, dt, absTypes) {
    const q = quotaFor(cfg, k, role, dt);
    if (!q || q.alpha === undefined) return null;
    const counted = cfg.quotaTypes || DEFAULT_QUOTA_TYPES;
    let rs = 0, other = 0;
    absTypes.forEach(function (t) { if (counted.indexOf(t) < 0) return; if (t === 'RS') rs++; else other++; });
    const onBeta = q.cardinal === 6 ? 0 : Math.min(rs, Math.floor(q.beta));
    const used = other + rs - onBeta;
    return { alpha: q.alpha, beta: q.beta, cardinal: q.cardinal, used: used, onBeta: onBeta, over: Math.max(0, used - q.alpha) };
  }

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
    // congés : fractionné (CF, type par défaut, ancien « C ») ou cycle complet (Cyc)
    c: 'CF', cf: 'CF', conge: 'CF', conges: 'CF', cp: 'CF', fractionne: 'CF', 'conge fractionne': 'CF',
    cyc: 'CYC', cycle: 'CYC', 'conge cycle': 'CYC',
    // récupérations : RS, RMT, RPT (règles propres à venir) ; REC = récup non précisée (anciennes demandes)
    rs: 'RS', rmt: 'RMT', rpt: 'RPT',
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
  const ABSENCE_TYPES = ['CF', 'CYC', 'RS', 'RMT', 'RPT', 'REC', 'FORM', 'ABS'];
  // Libellé affiché dans le planning (une formation affiche son code, ex. « GB »)
  const ABSENCE_CODE = { CF: 'CF', CYC: 'Cyc', RS: 'RS', RMT: 'RMT', RPT: 'RPT', REC: 'REC', FORM: 'FORM', ABS: 'ABS' };
  function absenceLabel(type, value) {
    const v = String(value || '').trim();
    return type === 'FORM' && v ? v : ABSENCE_CODE[type] || type;
  }
  // Cycle (6 jours, du J1 au 6e jour) contenant la date k
  function cycleSpan(cfg, k) {
    const L = cfg.cycle.normal.length, pos = ((daysBetween(cfg.cycle.anchor, k) % L) + L) % L, start = addDays(k, -pos);
    return [start, addDays(start, L - 1)];
  }
  // Période réellement couverte par une demande : un congé cycle s'étend aux cycles complets touchés.
  function requestSpan(cfg, r) {
    const type = normalizeType(r.type), from = normalizeDate(r.from);
    let to = normalizeDate(r.to) || from;
    if (!type || !from) return null;
    if (to < from) to = from;
    if (type === 'CYC') return { type: type, from: cycleSpan(cfg, from)[0], to: cycleSpan(cfg, to)[1] };
    return { type: type, from: from, to: to };
  }

  function indexRequests(cfg, requests, fromKey, toKey_, warnings) {
    const ids = {};
    cfg.agents.forEach(function (a) { ids[a.id.toUpperCase()] = a.id; });
    const idx = { absent: new Map(), absType: new Map(), renfort: new Set(), cdt: new Set(), prefs: new Map(), fixed: new Map() };
    const unknown = new Set();
    (requests || []).forEach(function (r) {
      const id = ids[String(r.agent || '').trim().toUpperCase()];
      if (!id) { if (r.agent) unknown.add(r.agent); return; }
      const sp = requestSpan(cfg, r);
      if (!sp) return;
      const type = sp.type, from = sp.from, to = sp.to;
      let k = from < fromKey ? fromKey : from;
      const end = to > toKey_ ? toKey_ : to;
      for (let n = 0; k <= end && n < 400; n++, k = addDays(k, 1)) {
        const key = id + '|' + k;
        if (ABSENCE_TYPES.indexOf(type) >= 0) { idx.absent.set(key, absenceLabel(type, r.value)); idx.absType.set(key, type); }
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

  // Jours « équivalents » pour l'équité : les absences comptent comme de la présence pour les charges
  // (nuits, N1, repas, soirées…) afin qu'un agent absent rattrape ensuite ; pas pour les heures
  // (un congé est crédité comme du temps de travail).
  function effDays(c, cfg, key) {
    const credit = cfg.absenceCredit === undefined ? 1 : +cfg.absenceCredit;
    return c.days + (key === 'hours' ? 0 : credit) * c.absDays;
  }

  /* ---------- Génération d'un mois ---------- */
  const DEFAULT_WEIGHTS = { hours: 0.125, night: 8, evening: 1, late: 3, early: 2, nightWE: 2, n1: 8, meal: 2, j2tot: 25, pref: 40, n1Extra: 40 };
  // Rythme de rattrapage : l'équité se fait sur l'année, pas en un mois. Au plus maxNightsMonth nuits par agent et par mois,
  // une N1 par mois (une 2e seulement exceptionnellement, coût n1Extra), jamais plus de maxN1Month.
  const CAP_PENALTY = 1e4;
  function caps(cfg) { return { nights: cfg.maxNightsMonth === undefined ? 3 : +cfg.maxNightsMonth, n1: cfg.maxN1Month === undefined ? 2 : +cfg.maxN1Month }; }

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
    const CAP = caps(cfg);
    const monthN = {}, monthN1 = {}; // nuits et N1 de chaque agent dans le mois en cours
    cfg.agents.forEach(function (a) { monthN[a.id] = 0; monthN1[a.id] = 0; });
    const n1Cost = function (id, cnt) { const c = cnt === undefined ? monthN1[id] : cnt; return c >= CAP.n1 ? CAP_PENALTY : (c >= 1 ? W.n1Extra : 0); };
    const pinned = {}; // date -> agents dont la vacation est imposée ou verrouillée (intouchables au lissage)

    function availability(k) {
      const avail = [], absent = {}, absType = {};
      cfg.agents.forEach(function (a) {
        const key = a.id + '|' + k;
        if (idx.absent.has(key)) {
          // congé cycle : affiché seulement sur les jours officiellement travaillés (J1, J2, J3) ;
          // le 6e jour (J0 en période d'option), l'agent n'est pas disponible mais rien n'est affiché
          if (idx.absType.get(key) === 'CYC' && roles[k] !== 'J1' && roles[k] !== 'J2' && roles[k] !== 'J3') return;
          absent[a.id] = idx.absent.get(key); absType[a.id] = idx.absType.get(key); return;
        }
        if (renfortIds.has(a.id) && !idx.renfort.has(key)) return;
        avail.push(a.id);
      });
      return { avail: avail, absent: absent, absType: absType };
    }
    function applyAssign(day, id, kind, rank, rangeStr) {
      day.assign[id] = { slot: kind === 'J0' ? 'J0' : kind + '-' + rank, kind: kind, rank: rank, range: rangeStr };
      const m = slotMetrics(kind, rank, rangeStr, day.dayType, cfg);
      addAssignment(counters[id], m, day.dayType);
      monthN[id] += m.night;
    }
    function flag(day, id, f) { day.assign[id][f] = true; counters[id][f] += 1; if (f === 'n1') monthN1[id] += 1; }

    // Résout les vacations J1/J2/J3 d'un jour SANS modifier les compteurs (sert aussi aux simulations).
    function solve(k, dt, kind, avail, fixedList, opts) {
      opts = opts || {};
      const out = { items: [], warnings: [] };
      const table = tablesFor(cfg, k)[dt][kind], n = avail.length;
      const rangeOf = function (rank) { return table[Math.min(rank, table.length) - 1]; };
      if (n > table.length) out.warnings.push('Plus d\'agents (' + n + ') que d\'horaires définis (' + table.length + ') : le dernier horaire est répété.');
      const slots = [];
      for (let r = 1; r <= n; r++) slots.push({ rank: r, range: rangeOf(r) });
      const fixedRank = new Set(), taken = {}, free = [];
      (fixedList || []).forEach(function (f) { fixedRank.add(f.rank); taken[f.id] = true; f.pinned = true; out.items.push(f); });
      avail.forEach(function (id) {
        if (taken[id]) return;
        const f = idx.fixed.get(id + '|' + k);
        if (f) {
          const mm = /^(J[123])-(\d+)$/.exec(f);
          if (mm && mm[1] === kind && +mm[2] <= n && !fixedRank.has(+mm[2])) {
            fixedRank.add(+mm[2]);
            out.items.push({ id: id, rank: +mm[2], range: rangeOf(+mm[2]), pinned: true });
            return;
          }
          out.warnings.push('Créneau imposé « ' + f + ' » inapplicable pour ' + id + ' ce jour.');
        }
        free.push(id);
      });
      const freeSlots = slots.filter(function (s) { return !fixedRank.has(s.rank); });

      // taux d'équipe (hors renforts) : l'écart se mesure par jour travaillé (N1 et repas compris : chaque agent,
      // chef de tour ou non, doit en faire autant)
      const rt = {};
      ['hours', 'nights', 'evenings', 'late', 'early', 'nightWE', 'n1', 'meal'].forEach(function (key) {
        let s = 0, d = 0;
        regular.forEach(function (id) { s += counters[id][key]; d += effDays(counters[id], cfg, key); });
        rt[key] = d ? s / d : 0;
      });
      const dev = function (id, key) { return renfortIds.has(id) ? 0 : counters[id][key] - rt[key] * effDays(counters[id], cfg, key); };

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
              if (!renfortIds.has(id) && monthN[id] >= CAP.nights) c += CAP_PENALTY;   // plafond mensuel de nuits
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
              const c = W.n1 * dev(a.id, 'n1') + n1Cost(a.id) + W.meal * dev(b.id, 'meal') + jn(a, 'n') + jn(b, 'm');
              if (!best || c < best.c) best = { a: a, b: b, c: c };
            });
          });
          best.a.n1 = true; best.b.meal = true;
        } else {
          if (!hasN1 && cand.length) {
            cand.sort(function (a, b) { return W.n1 * dev(a.id, 'n1') + n1Cost(a.id) + jn(a, 'n') - W.n1 * dev(b.id, 'n1') - n1Cost(b.id) - jn(b, 'n'); });
            cand[0].n1 = true;
          }
          const c2 = plain();
          if (!hasMeal && c2.length) {
            c2.sort(function (a, b) { return dev(a.id, 'meal') + jn(a, 'm') - dev(b.id, 'meal') - jn(b, 'm'); });
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
      const day = { date: k, dayType: dt, role: role, period: periodOf(cfg, k), assign: {}, absent: {}, absentType: {}, prefs: [], warnings: [], lockedAgents: {}, cdt: {} };
      days.push(day);
      byDate[k] = day;
      if (role === 'OFF') continue;

      const av = availability(k), avail = av.avail;
      day.absent = av.absent; day.absentType = av.absType;
      Object.keys(av.absent).forEach(function (id) { counters[id].absDays += 1; });
      avail.forEach(function (id) {
        if (cdtOf(id, k)) day.cdt[id] = true;
        (idx.prefs.get(id + '|' + k) || []).forEach(function (p) { day.prefs.push(p); });
      });

      // Journée figée : conservée telle quelle (vacations, N1, repas, verrous), seuls les compteurs sont mis à jour
      const prevF = prevByDate && prevByDate[k];
      if (prevF && prevF.frozen) {
        if (prevF.role !== role) {
          day.warnings.push('Journée figée ignorée : le rôle du jour a changé (' + prevF.role + ' → ' + role + ').');
        } else {
          day.frozen = true;
          Object.keys(prevF.assign).forEach(function (id) {
            const a = prevF.assign[id];
            if (!counters[id]) { day.warnings.push('Journée figée : agent ' + id + ' inconnu, vacation retirée.'); return; }
            applyAssign(day, id, a.kind, a.rank, a.range);
            if (a.n1) flag(day, id, 'n1');
            if (a.meal) flag(day, id, 'meal');
            if (avail.indexOf(id) < 0) day.warnings.push('Journée figée : ' + id + ' est indisponible d\'après les demandes (vacation conservée).');
          });
          if (role !== 'J0') avail.forEach(function (id) { if (!day.assign[id]) day.warnings.push('Journée figée : ' + id + ' est disponible mais n\'a pas de vacation.'); });
          if (prevF.nextNight) day.nextNight = prevF.nextNight.slice();
          if (prevF.lockedAgents) day.lockedAgents = Object.assign({}, prevF.lockedAgents);
          continue;
        }
      }

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
        applyAssign(day, pick, 'J0', 1, j0RangeFor(cfg, dt));
        continue;
      }

      const kind = role; // J1 | J2 | J3
      const table = tablesFor(cfg, k)[dt][kind], n = avail.length;
      const qc = quotaCheck(cfg, k, kind, dt, Object.keys(av.absent).filter(function (id) { return !renfortIds.has(id); }).map(function (id) { return av.absType[id]; }));
      if (qc && qc.over) day.warnings.push('Quota d\'absences dépassé : ' + qc.used + ' absence(s) décomptée(s) pour un alpha de ' + qc.alpha + ' (cardinal ' + qc.cardinal + ').');
      day.bc = bcFor(cfg, k, kind, dt);
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
      pinned[k] = {};
      res.items.forEach(function (it) {
        if (it.pinned) pinned[k][it.id] = true;
        applyAssign(day, it.id, kind, it.rank, it.range);
        if (it.n1) flag(day, it.id, 'n1');
        if (it.meal) flag(day, it.id, 'meal');
      });
    }

    /* ---------- Lissage du mois ----------
     * L'affectation jour par jour est gloutonne : elle ne voit pas la fin du mois. On reprend donc le mois
     * entier et on échange des vacations (ou la N1 / le repas) entre deux agents d'un même jour tant que
     * cela réduit l'écart global au taux d'équipe (somme pondérée des écarts au carré), sans toucher aux
     * journées figées, vacations verrouillées ou imposées, au rang 1 chef de tour, ni au J0 après N1. */
    (function refine() {
      const KEYS = [['hours', 'hours'], ['nights', 'night'], ['evenings', 'evening'], ['late', 'late'], ['early', 'early'], ['nightWE', 'nightWE'], ['n1', 'n1'], ['meal', 'meal']];
      const rt = {};
      KEYS.forEach(function (kw) {
        let s = 0, d = 0;
        regular.forEach(function (id) { s += counters[id][kw[0]]; d += effDays(counters[id], cfg, kw[0]); });
        rt[kw[0]] = d ? s / d : 0;
      });
      const load = function (id) { // écart global d'un agent
        const c = counters[id];
        let f = 0;
        KEYS.forEach(function (kw) { const d = c[kw[0]] - rt[kw[0]] * effDays(c, cfg, kw[0]); f += W[kw[1]] / 2 * d * d; });
        if (!renfortIds.has(id)) {
          f += Math.max(0, monthN[id] - CAP.nights) * CAP_PENALTY;
          for (let x = 1; x < monthN1[id]; x++) f += n1Cost(id, x);   // 2e N1 : exceptionnelle ; au-delà du plafond : interdite
        }
        return f;
      };
      const metricsOf = function (day, a) { return slotMetrics(a.kind, a.rank, a.range, day.dayType, cfg); };
      const count = function (day, id, sign) { // ajoute (+1) ou retire (-1) la vacation des compteurs
        const a = day.assign[id], m = metricsOf(day, a), c = counters[id];
        c.hours += sign * m.hours; c.nights += sign * m.night; c.evenings += sign * m.evening; c.nightWE += sign * m.nightWE;
        c.late += sign * m.late; c.early += sign * m.early;
        if (a.n1) c.n1 += sign;
        if (a.meal) c.meal += sign;
        monthN[id] += sign * m.night;
        if (a.n1) monthN1[id] += sign;
      };
      const isNight = function (day, id) { const a = day && day.assign[id]; return !!a && a.kind === 'J3' && a.rank <= cfg.nightCount; };
      // règles souples d'un agent ce jour-là : souhaits / évitements, J2 tôt la veille d'une nuit
      const soft = function (day, id) {
        const a = day.assign[id], m = metricsOf(day, a);
        let c = 0;
        (idx.prefs.get(id + '|' + day.date) || []).forEach(function (p) { if (matchesPref(p.value, m)) c += (p.type === 'VEUT' ? -W.pref : W.pref); });
        if (day.role === 'J3' && m.night) {
          const pd = byDate[addDays(day.date, -1)];
          if (pd && pd.role === 'J2' && !isEarlyJ2(pd.assign[id], cfg)) c += W.j2tot;
        }
        if (day.role === 'J2' && !isEarlyJ2(a, cfg)) {
          const nd = byDate[addDays(day.date, 1)];
          const nightNext = nd ? isNight(nd, id) : (day.nextNight || []).indexOf(id) >= 0;
          if (nightNext) c += W.j2tot;
        }
        return c;
      };
      const j0After = function (day) { // agent du J0 qui clôt le cycle de ce J3
        for (let b = 1; b <= 7; b++) {
          const nd = byDate[addDays(day.date, b)];
          if (nd && nd.role === 'J0') return Object.keys(nd.assign)[0] || null;
          if (nd && nd.role === 'J1') return null;
        }
        return null;
      };
      const cost = function (day, a, b) { return load(a) + load(b) + soft(day, a) + soft(day, b); };
      const EPS = 1e-6;
      // essaie une modification ; la garde si elle améliore, sinon l'annule
      const attempt = function (day, a, b, apply, undo) {
        const before = cost(day, a, b);
        count(day, a, -1); count(day, b, -1);
        apply();
        count(day, a, 1); count(day, b, 1);
        if (cost(day, a, b) < before - EPS) return true;
        count(day, a, -1); count(day, b, -1);
        undo();
        count(day, a, 1); count(day, b, 1);
        return false;
      };
      const work = days.filter(function (d) { return !d.frozen && (d.role === 'J1' || d.role === 'J2' || d.role === 'J3') && pinned[d.date]; });
      let improved = true, pass = 0;
      while (improved && pass++ < 60) {
        improved = false;
        work.forEach(function (day) {
          const free = Object.keys(day.assign).filter(function (id) { return !pinned[day.date][id] && !renfortIds.has(id); }).sort();
          const cdtHere = function (id) { return !!day.cdt[id]; };
          const j0id = day.role === 'J3' ? j0After(day) : null;
          for (let i = 0; i < free.length; i++) {
            for (let j = i + 1; j < free.length; j++) {
              const a = free[i], b = free[j], x = day.assign[a], y = day.assign[b];
              // 1) échange des deux vacations complètes (N1 / repas suivent la vacation)
              const cdtOk = (x.rank !== 1 || !cdtHere(a) || cdtHere(b)) && (y.rank !== 1 || !cdtHere(b) || cdtHere(a));
              const j0Ok = !j0id || !((j0id === a && y.n1) || (j0id === b && x.n1));
              if (cdtOk && j0Ok && (x.range !== y.range || !!x.n1 !== !!y.n1 || !!x.meal !== !!y.meal || isNight(day, a) !== isNight(day, b))) {
                const sw = function () { const t = day.assign[a]; day.assign[a] = day.assign[b]; day.assign[b] = t; };
                if (attempt(day, a, b, sw, sw)) { improved = true; continue; }
              }
              // 2) nuit : la N1 ou le repas change d'agent (les rangs restent en place)
              if (day.role === 'J3' && isNight(day, a) && isNight(day, b)) {
                const p = day.assign[a], q = day.assign[b];
                const flags = function (pa, pb) { return function () { p.n1 = pa[0]; p.meal = pa[1]; q.n1 = pb[0]; q.meal = pb[1]; ['n1', 'meal'].forEach(function (f) { if (!p[f]) delete p[f]; if (!q[f]) delete q[f]; }); }; };
                const cur = [[!!p.n1, !!p.meal], [!!q.n1, !!q.meal]];
                if ((cur[0][0] !== cur[1][0] || cur[0][1] !== cur[1][1]) && !(j0id && ((j0id === a && q.n1) || (j0id === b && p.n1)))) {
                  if (attempt(day, a, b, flags(cur[1], cur[0]), flags(cur[0], cur[1]))) improved = true;
                }
              }
            }
          }
        });
      }
      // le plan de nuit mémorisé la veille suit l'équipe de nuit finale
      days.forEach(function (d) {
        const nd = byDate[addDays(d.date, 1)];
        if (d.role !== 'J2' || d.frozen || !d.nextNight || !nd || nd.role !== 'J3' || !Object.keys(nd.assign).length) return;
        d.nextNight = Object.keys(nd.assign).filter(function (id) { return isNight(nd, id); }).sort();
      });
    })();
    cfg.agents.forEach(function (a) {
      if (a.renfort) return;
      if (monthN[a.id] > CAP.nights) warnings.push(a.id + ' : ' + monthN[a.id] + ' nuits ce mois (plafond ' + CAP.nights + ', dépassement inévitable : effectif insuffisant ou journées imposées).');
      if (monthN1[a.id] > CAP.n1) warnings.push(a.id + ' : ' + monthN1[a.id] + ' N1 ce mois (plafond ' + CAP.n1 + ', dépassement inévitable).');
    });
    days.forEach(checkCdt);
    return { month: month, days: days, warnings: warnings, generatedAt: new Date().toISOString() };
  }

  /* ---------- Contrôle d'effectif des demandes (à la saisie, avant génération) ----------
   * Pour chaque jour de cycle entre from et to : agents disponibles (hors absents, renforts seulement les jours
   * saisis), présence d'un chef de tour, et problèmes : effectif < minimum, aucun CDT, nuits non couvertes. */
  function staffingCheck(cfg, requests, from, to) {
    const out = {}, warnings = [];
    if (!from || !to || to < from) return out;
    const idx = indexRequests(cfg, requests, from, to, warnings);
    const roles = buildRoles(cfg.cycle, from, to);
    const hol = holidaySet(from, to, cfg.holidays);
    for (let k = from, g = 0; k <= to && g < 800; k = addDays(k, 1), g++) {
      const role = roles[k];
      if (role !== 'J1' && role !== 'J2' && role !== 'J3') continue;
      const avail = [], absTypes = [];
      let cdt = false;
      const dt = dayType(k, hol);
      cfg.agents.forEach(function (a) {
        const key = a.id + '|' + k;
        if (idx.absent.has(key)) { if (!a.renfort) absTypes.push(idx.absType.get(key)); return; }
        if (a.renfort && !idx.renfort.has(key)) return;
        avail.push(a.id);
        if (a.cdt || idx.cdt.has(key)) cdt = true;
      });
      const problems = [];
      const quota = quotaCheck(cfg, k, role, dt, absTypes);
      if (quota && quota.over) problems.push('quota d\'absences dépassé : ' + quota.used + ' pour un alpha de ' + quota.alpha);
      if (avail.length < cfg.minStaff) problems.push(avail.length + ' agent(s) pour ' + cfg.minStaff + ' minimum');
      if (!cdt && avail.length) problems.push('aucun chef de tour');
      if (role === 'J3' && avail.length < cfg.nightCount) problems.push('nuits non couvertes');
      out[k] = { role: role, dayType: dt, avail: avail, cdt: cdt, problems: problems, quota: quota, bc: bcFor(cfg, k, role, dt) };
    }
    return out;
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

  /* ---------- Impact d'un échange sur l'équité ----------
   * counters : compteurs cumulés (période d'équité) incluant déjà le jour. Renvoie la variation de l'écart global
   * (somme pondérée des écarts au carré au taux d'équipe) pour les deux agents : < 0 = l'échange rééquilibre. */
  const SWAP_KEYS = [['hours', 'hours', 'hours'], ['nights', 'night', 'night'], ['evenings', 'evening', 'evening'], ['late', 'late', 'late'], ['early', 'early', 'early'], ['nightWE', 'nightWE', 'nightWE'], ['n1', 'n1', null], ['meal', 'meal', null]];
  function swapImpact(cfg, counters, day, a, b) {
    const W = Object.assign({}, DEFAULT_WEIGHTS, cfg.weights || {});
    const x = day.assign[a], y = day.assign[b];
    if (!x || !y) return 0;
    const reg = cfg.agents.filter(function (g) { return !g.renfort && counters[g.id]; }).map(function (g) { return g.id; });
    const mx = slotMetrics(x.kind, x.rank, x.range, day.dayType, cfg), my = slotMetrics(y.kind, y.rank, y.range, day.dayType, cfg);
    const val = function (m, as, key) { return key[2] ? m[key[2]] : (as[key[0]] ? 1 : 0); };
    let delta = 0;
    SWAP_KEYS.forEach(function (key) {
      let s = 0, d = 0;
      reg.forEach(function (id) { s += counters[id][key[0]]; d += effDays(counters[id], cfg, key[0]); });
      const rate = d ? s / d : 0;
      const diff = val(my, y, key) - val(mx, x, key); // ce que a gagne (et b perd) en prenant la vacation de b
      if (!diff) return;
      [[a, diff], [b, -diff]].forEach(function (p) {
        if (reg.indexOf(p[0]) < 0) return;
        const dev = counters[p[0]][key[0]] - rate * effDays(counters[p[0]], cfg, key[0]);
        delta += W[key[1]] / 2 * ((dev + p[1]) * (dev + p[1]) - dev * dev);
      });
    });
    return delta;
  }

  /* ---------- Mail de dépôt des demandes d'absence ---------- */
  const MAIL_TITLES = { C: 'Congés', REC: 'Récupérations', FORM: 'Formations', ABS: 'Autres absences' };
  const MAIL_GROUP = { CF: 'C', CYC: 'C', RS: 'REC', RMT: 'REC', RPT: 'REC', REC: 'REC', FORM: 'FORM', ABS: 'ABS' };
  const MAIL_SUB = { CF: 'CF', CYC: 'congé cycle', RS: 'RS', RMT: 'RMT', RPT: 'RPT' };
  function fmtFr(k) { return k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4); }
  // opts : types, from, to, onlyUnsent, greeting, signature, subject
  function buildLeaveMail(cfg, requests, opts) {
    opts = opts || {};
    const types = opts.types && opts.types.length ? opts.types : Object.keys(MAIL_TITLES);
    const items = [];
    (requests || []).forEach(function (r, i) {
      const sp = requestSpan(cfg, r);
      if (!sp) return;
      const group = MAIL_GROUP[sp.type];
      if (!group || types.indexOf(group) < 0) return;
      if (opts.onlyUnsent && r.sent) return;
      if (opts.from && sp.to < opts.from) return;
      if (opts.to && sp.from > opts.to) return;
      const sub = sp.type === 'FORM' ? String(r.value || '').trim() : (MAIL_SUB[sp.type] || '');
      items.push({ i: i, type: group, sub: sub, agent: String(r.agent || '').trim(), from: sp.from, to: sp.to, note: String(r.note || '').trim() });
    });
    if (!items.length) return { subject: '', body: '', included: [], count: 0 };
    items.sort(function (a, b) {
      return a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0;
    });
    const mn = items.reduce(function (m, x) { return x.from < m ? x.from : m; }, items[0].from);
    const mx = items.reduce(function (m, x) { return x.to > m ? x.to : m; }, items[0].to);
    const roles = buildRoles(cfg.cycle, mn, mx);
    const vacations = function (it) { // vacations de cycle (J1/J2/J3) couvertes par la demande
      if (it.from < cfg.cycle.anchor) return null;
      const list = [];
      for (let k = it.from, g = 0; k <= it.to && g < 800; k = addDays(k, 1), g++) { if (roles[k] === 'J1' || roles[k] === 'J2' || roles[k] === 'J3') list.push(roles[k]); }
      return list;
    };
    const line = function (it) {
      const v = vacations(it), n = daysBetween(it.from, it.to) + 1;
      let when;
      if (it.from === it.to) when = 'le ' + fmtFr(it.from) + (v ? (v.length ? ' (' + v[0] + ')' : ' (jour OFF)') : '');
      else when = 'du ' + fmtFr(it.from) + ' au ' + fmtFr(it.to) + ' (' + n + ' jours' + (v ? (v.length ? ', dont ' + v.length + ' vacation' + (v.length > 1 ? 's' : '') + ' de cycle' : ', aucune vacation de cycle') : '') + ')';
      return '- ' + it.agent + (it.sub ? ' (' + it.sub + ')' : '') + ' : ' + when + (it.note ? ' — ' + it.note : '');
    };
    const present = [], parts = [];
    ['C', 'REC', 'FORM', 'ABS'].forEach(function (t) {
      const g = items.filter(function (x) { return x.type === t; });
      if (!g.length) return;
      present.push(MAIL_TITLES[t].toLowerCase());
      parts.push(MAIL_TITLES[t].toUpperCase() + ' (' + g.length + ')\n' + g.map(line).join('\n'));
    });
    const greeting = opts.greeting === undefined ? 'Bonjour,' : opts.greeting;
    const signature = opts.signature === undefined ? 'Cordialement,' : opts.signature;
    const lines = [];
    if (greeting) lines.push(greeting, '');
    lines.push('Veuillez trouver ci-dessous les demandes de l\'équipe à enregistrer :', '', parts.join('\n\n'));
    if (signature) lines.push('', signature);
    const period = mn === mx ? 'le ' + fmtFr(mn) : 'du ' + fmtFr(mn) + ' au ' + fmtFr(mx);
    return { subject: opts.subject || ('Demandes de ' + present.join(' / ') + ' — ' + period), body: lines.join('\n'), included: items.map(function (x) { return x.i; }), count: items.length };
  }

  return {
    buildLeaveMail: buildLeaveMail,
    DEFAULT_TABLES: DEFAULT_TABLES, DEFAULT_TABLES_CREUSE: DEFAULT_TABLES_CREUSE, tablesFor: tablesFor, periodOf: periodOf, j0RangeFor: j0RangeFor, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, DAY_TYPE_LABEL: DAY_TYPE_LABEL,
    parseRange: parseRange, fmtRange: fmtRange, parseKey: parseKey, toKey: toKey, addDays: addDays, dow: dow,
    daysBetween: daysBetween, monthRange: monthRange, normalizeDate: normalizeDate, normalizeType: normalizeType,
    normValue: normValue, frenchHolidays: frenchHolidays, holidaySet: holidaySet, dayType: dayType,
    buildRoles: buildRoles, slotMetrics: slotMetrics, computeCounters: computeCounters, generateMonth: generateMonth,
    DEFAULT_QUOTAS: DEFAULT_QUOTAS, DEFAULT_BC: DEFAULT_BC, DEFAULT_QUOTA_TYPES: DEFAULT_QUOTA_TYPES,
    quotaFor: quotaFor, bcFor: bcFor, quotaCheck: quotaCheck, cardinalOf: cardinalOf,
    ABSENCE_TYPES: ABSENCE_TYPES, absenceLabel: absenceLabel, cycleSpan: cycleSpan, requestSpan: requestSpan,
    swapAgents: swapAgents, caps: caps, staffingCheck: staffingCheck, swapImpact: swapImpact, checkCdt: checkCdt, effDays: effDays, hungarian: hungarian, ZERO: ZERO
  };
});
