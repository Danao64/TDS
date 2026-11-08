/* Interface — Planning TDS. Toutes les données sont stockées dans le navigateur (localStorage). */
(function () {
  'use strict';
  const P = window.Planner;
  const LS = 'tds-planning-v1';
  const DOW = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const TYPES = { C: 'Congé', REC: 'Récup', FORM: 'Formation', ABS: 'Autre absence', RENFORT: 'Renfort disponible', VEUT: 'Souhaite', EVITE: 'Évite', FIXE: 'Créneau imposé', CDT: 'Chef de tour (sur la période)' };
  const COUNTER_FIELDS = [['hours', 'Heures'], ['nights', 'Nuits'], ['n1', 'N1 🌙'], ['meal', 'Repas 🍴'], ['evenings', 'Soirées J3'], ['nightWE', 'Nuits WE/férié'], ['late', 'J2 tardifs'], ['early', 'Débuts tôt'], ['j0', 'J0']];

  /* ---------- État ---------- */
  function defaultState() {
    return {
      version: 1,
      cfg: {
        agents: ['AG1', 'AG2', 'AG3', 'AG4', 'AG5', 'AG6'].map(function (id, i) { return { id: id, renfort: false, cdt: i < 2 }; }),
        tables: JSON.parse(JSON.stringify(P.DEFAULT_TABLES)),
        cycle: {
          anchor: '2027-01-01',
          normal: ['J1', 'J2', 'J3', 'OFF', 'OFF', 'OFF'],
          optionPeriods: []
        },
        holidays: [], minStaff: 4, nightCount: 3, j0Range: '10:00-18:30', j2EarlyMax: '10:00',
        weights: Object.assign({}, P.DEFAULT_WEIGHTS)
      },
      initial: {}, requests: [], months: {}
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return defaultState();
  }
  let state = load();
  function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { toast('Sauvegarde locale impossible : ' + e.message); } }
  const ui = { tab: 'planning', month: state.cfg.cycle.anchor.slice(0, 7), statMonth: null };

  /* ---------- Utilitaires ---------- */
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  const esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4500);
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const num = function (v) { return Math.round(v * 10) / 10; };
  const ids = function () { return state.cfg.agents.map(function (a) { return a.id; }); };

  function initialCounters() {
    const o = {};
    state.cfg.agents.forEach(function (a) { o[a.id] = Object.assign(P.ZERO(), state.initial[a.id] || {}); });
    return o;
  }
  function sortedMonths() { return Object.keys(state.months).sort(); }
  function daysBefore(month) {
    return sortedMonths().filter(function (m) { return m < month; }).reduce(function (acc, m) { return acc.concat(state.months[m].days); }, []);
  }
  function statsFor(month) {
    const before = P.computeCounters(daysBefore(month), state.cfg, initialCounters());
    const after = P.computeCounters(state.months[month].days, state.cfg, before);
    return { before: before, after: after };
  }

  /* ---------- Onglets ---------- */
  function showTab(t) {
    ui.tab = t;
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    ['planning', 'stats', 'requests', 'params', 'data'].forEach(function (n) { $('#tab-' + n).hidden = n !== t; });
    render();
  }
  function render() {
    ({ planning: renderPlanning, stats: renderStats, requests: renderRequests, params: renderParams, data: renderData })[ui.tab]();
  }

  /* =====================================================================
   *  PLANNING
   * ===================================================================== */
  function renderPlanning() {
    const el = $('#tab-planning');
    const mm = state.months[ui.month];
    let html = '<div class="card"><div class="row">' +
      '<label>Mois<input type="month" id="pl-month" value="' + esc(ui.month) + '"></label>' +
      '<button class="btn" data-act="generate">' + (mm ? 'Régénérer le mois' : 'Générer le mois') + '</button>';
    if (mm) {
      html += '<button class="btn sec" data-act="export-csv">Export CSV</button><button class="btn sec" data-act="export-xlsx">Export Excel</button>';
    }
    const rg = P.monthRange(ui.month), opt = optionCovers(rg);
    html += '<label style="flex-direction:row;align-items:center;gap:6px;color:var(--ink)"><input type="checkbox" id="pl-option"' + (opt ? ' checked' : '') + '> Mois en période d\'option (J0 sur le dernier OFF avant chaque J1)</label></div>';
    if (!(state.cfg.cycle.optionPeriods || []).length) html += '<p class="warn">Aucune période d\'option définie : le planning ne contient donc aucun J0. Cochez la case ci-dessus pour ce mois, ou définissez les périodes dans Paramètres.</p>';
    if (mm && mm.stale) html += '<p class="warn">⚠ Un mois précédent a été régénéré depuis : ce mois est à régénérer pour rester équitable.</p>';
    html += '<p class="muted">Cycle ancré au ' + esc(state.cfg.cycle.anchor) + ' · effectif minimum ' + state.cfg.minStaff + ' · ' + state.cfg.agents.length + ' agents. 🌙 = N1 (reste éveillé), 🍴 = repas. Les vacations 🔒 (échange manuel) sont conservées à la régénération.</p></div>';
    if (!mm) {
      el.innerHTML = html + '<p class="muted">Aucun planning pour ce mois. Vérifiez les paramètres et les demandes, puis cliquez sur « Générer le mois ».</p>';
      bindPlanning(); return;
    }
    const warns = [];
    (mm.warnings || []).forEach(function (w) { warns.push(w); });
    mm.days.forEach(function (d) { (d.warnings || []).forEach(function (w) { warns.push(d.date + ' : ' + w); }); });
    if (warns.length) html += '<div class="card"><b class="warn">' + warns.length + ' alerte(s)</b><ul class="alerts">' + warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    html += gridHtml(mm);
    html += swapHtml(mm);
    el.innerHTML = html;
    bindPlanning();
  }
  function slotLabel(as) { return as.slot + (as.n1 ? ' 🌙' : '') + (as.meal ? ' 🍴' : ''); }
  function visibleAgents(mm) {
    return state.cfg.agents.filter(function (a) {
      if (!a.renfort) return true;
      return mm.days.some(function (d) { return d.assign[a.id] || d.absent[a.id]; });
    });
  }
  function gridHtml(mm) {
    let h = '<div class="grid-wrap"><table class="grid"><thead><tr><th class="sticky">Agent</th>';
    mm.days.forEach(function (d) {
      h += '<th class="' + (d.dayType !== 'weekday' ? 'we' : '') + '">' + DOW[P.dow(d.date)] + '<br>' + d.date.slice(8) + '</th>';
    });
    h += '</tr><tr><th class="sticky">Rôle</th>';
    mm.days.forEach(function (d) {
      const n = Object.keys(d.assign).length;
      h += '<th class="role-' + d.role + '">' + d.role + (d.role !== 'OFF' ? '<br><small>' + n + (Object.keys(d.lockedAgents || {}).length || d.locked ? ' 🔒' : '') + '</small>' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    visibleAgents(mm).forEach(function (a) {
      h += '<tr><td class="sticky">' + esc(a.id) + (a.cdt ? ' <small class="muted">CDT</small>' : '') + (a.renfort ? ' <small class="muted">renf.</small>' : '') + '</td>';
      mm.days.forEach(function (d) {
        const as = d.assign[a.id];
        if (as) {
          h += '<td class="k-' + as.kind + ((d.lockedAgents && d.lockedAgents[a.id]) || d.locked ? ' lock' : '') + '" title="' + esc(P.DAY_TYPE_LABEL[d.dayType]) + '"><b>' + esc(slotLabel(as)) + '</b><small>' + P.fmtRange(as.range) + '</small></td>';
        } else if (d.absent[a.id]) {
          h += '<td class="abs">' + esc(d.absent[a.id]) + '</td>';
        } else h += '<td class="off"></td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function swapHtml(mm) {
    const active = mm.days.filter(function (d) { return d.role !== 'OFF' && Object.keys(d.assign).length > 1; });
    if (!active.length) return '';
    return '<div class="card"><h2 style="margin-top:0">Échanger deux agents</h2><div class="row">' +
      '<label>Jour<select id="sw-day">' + active.map(function (d) { return '<option value="' + d.date + '">' + DOW[P.dow(d.date)] + ' ' + d.date.slice(8) + ' · ' + d.role + '</option>'; }).join('') + '</select></label>' +
      '<label>Agent A<select id="sw-a"></select></label><label>Agent B<select id="sw-b"></select></label>' +
      '<button class="btn" data-act="swap">Échanger</button><button class="btn sec" data-act="unlock">Déverrouiller A et B</button></div>' +
      '<p class="muted">L\'échange verrouille uniquement les vacations des deux agents ce jour-là (🔒) : elles sont conservées si vous régénérez le mois, le reste du jour est recalculé autour. La vacation complète change d\'agent (N1 🌙 et repas 🍴 compris).</p></div>';
  }
  function fillSwap() {
    const mm = state.months[ui.month]; const sel = $('#sw-day'); if (!mm || !sel) return;
    const d = mm.days.find(function (x) { return x.date === sel.value; });
    const opts = Object.keys(d.assign).map(function (id) { return '<option>' + esc(id) + '</option>'; }).join('');
    $('#sw-a').innerHTML = opts; $('#sw-b').innerHTML = opts;
    if ($('#sw-b').options.length > 1) $('#sw-b').selectedIndex = 1;
  }
  function optionCovers(rg) {
    return (state.cfg.cycle.optionPeriods || []).some(function (p) { return p.from <= rg[0] && p.to >= rg[1]; });
  }
  function toggleOption(on) {
    const rg = P.monthRange(ui.month);
    let per = [];
    (state.cfg.cycle.optionPeriods || []).forEach(function (p) { // retire le mois des périodes existantes
      if (p.to < rg[0] || p.from > rg[1]) per.push(p);
      else {
        if (p.from < rg[0]) per.push({ from: p.from, to: P.addDays(rg[0], -1) });
        if (p.to > rg[1]) per.push({ from: P.addDays(rg[1], 1), to: p.to });
      }
    });
    if (on) per.push({ from: rg[0], to: rg[1] });
    per.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    const merged = [];
    per.forEach(function (p) { // fusionne les périodes contiguës
      const l = merged[merged.length - 1];
      if (l && P.addDays(l.to, 1) >= p.from) l.to = l.to > p.to ? l.to : p.to; else merged.push({ from: p.from, to: p.to });
    });
    state.cfg.cycle.optionPeriods = merged;
    save(); generate(); // régénère le mois ; les mois suivants (rôles décalés) sont marqués à régénérer
  }
  function bindPlanning() {
    const op = $('#pl-option'); if (op) op.onchange = function () { toggleOption(op.checked); };
    const m = $('#pl-month'); if (m) m.onchange = function () { if (m.value) { ui.month = m.value; renderPlanning(); } };
    const sw = $('#sw-day'); if (sw) { sw.onchange = fillSwap; fillSwap(); }
  }
  function generate() {
    try {
      const prev = {};
      if (state.months[ui.month]) state.months[ui.month].days.forEach(function (d) { prev[d.date] = d; });
      const before = sortedMonths().filter(function (m) { return m < ui.month; });
      const res = P.generateMonth(state.cfg, state.requests, P.computeCounters(daysBefore(ui.month), state.cfg, initialCounters()), ui.month, prev, daysBefore(ui.month).filter(function (x) { return x.date >= P.addDays(P.monthRange(ui.month)[0], -8); }));
      if (before.length) {
        const last = before[before.length - 1];
        const exp = P.toKey(new Date(Date.UTC(+ui.month.slice(0, 4), +ui.month.slice(5, 7) - 2, 1))).slice(0, 7);
        if (last !== exp) res.warnings.push('Le mois ' + exp + ' n\'est pas généré : l\'équité ne le prend pas en compte.');
      }
      state.months[ui.month] = { days: res.days, warnings: res.warnings, generatedAt: res.generatedAt };
      sortedMonths().forEach(function (m) { if (m > ui.month) state.months[m].stale = true; });
      save(); renderPlanning(); toast('Planning de ' + ui.month + ' généré.');
    } catch (e) { toast('Erreur : ' + e.message); }
  }
  function doSwap(unlock) {
    const mm = state.months[ui.month]; const d = mm.days.find(function (x) { return x.date === $('#sw-day').value; });
    try {
      const a = $('#sw-a').value, b = $('#sw-b').value;
      if (unlock) {
        if (d.locked) { d.lockedAgents = Object.keys(d.assign).reduce(function (o, id) { o[id] = true; return o; }, {}); d.locked = false; }
        if (d.lockedAgents) { delete d.lockedAgents[a]; delete d.lockedAgents[b]; }
        toast('Vacations de ' + a + ' et ' + b + ' déverrouillées.');
      } else {
        if (a === b) { toast('Choisissez deux agents différents.'); return; }
        P.swapAgents(d, a, b); toast('Échange effectué : ' + a + ' ↔ ' + b + '.');
      }
      sortedMonths().forEach(function (m) { if (m > ui.month) state.months[m].stale = true; });
      P.checkCdt(d);
      save(); renderPlanning();
    } catch (e) { toast(e.message); }
  }
  function exportRows(mm) {
    const head = ['Agent'].concat(mm.days.map(function (d) { return DOW[P.dow(d.date)] + ' ' + d.date.slice(8); }));
    const rows = [head, ['Rôle'].concat(mm.days.map(function (d) { return d.role; }))];
    visibleAgents(mm).forEach(function (a) {
      rows.push([a.id].concat(mm.days.map(function (d) {
        const as = d.assign[a.id];
        return as ? slotLabel(as) + ' ' + P.fmtRange(as.range) : (d.absent[a.id] || (d.role === 'OFF' ? 'OFF' : ''));
      })));
    });
    return rows;
  }
  function exportCsv() {
    const rows = exportRows(state.months[ui.month]);
    const csv = '﻿' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    download('planning-' + ui.month + '.csv', csv, 'text/csv;charset=utf-8');
  }
  function exportXlsx() {
    if (!window.XLSX) { toast('Bibliothèque Excel indisponible (hors ligne ?). Utilisez l\'export CSV.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportRows(state.months[ui.month])), ui.month);
    const st = statsFor(ui.month);
    const srows = [['Agent'].concat(COUNTER_FIELDS.map(function (f) { return f[1] + ' (cumul)'; })).concat(['Jours', 'Jours WE'])];
    ids().forEach(function (id) { const c = st.after[id]; srows.push([id].concat(COUNTER_FIELDS.map(function (f) { return num(c[f[0]]); })).concat([c.days, c.weDays])); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(srows), 'Stats');
    XLSX.writeFile(wb, 'planning-' + ui.month + '.xlsx');
  }

  /* =====================================================================
   *  STATISTIQUES
   * ===================================================================== */
  function renderStats() {
    const el = $('#tab-stats'); const months = sortedMonths();
    if (!months.length) { el.innerHTML = '<p class="muted">Générez au moins un mois pour voir les statistiques.</p>'; return; }
    if (!ui.statMonth || !state.months[ui.statMonth]) ui.statMonth = months[months.length - 1];
    const st = statsFor(ui.statMonth);
    const reg = state.cfg.agents.filter(function (a) { return !a.renfort; }).map(function (a) { return a.id; });
    const keys = COUNTER_FIELDS.map(function (f) { return f[0]; }).concat(['days', 'weDays']);
    const rate = function (k) { let s = 0, d = 0; reg.forEach(function (id) { s += st.after[id][k]; d += st.after[id].days; }); return d ? s / d : 0; };
    const labels = COUNTER_FIELDS.concat([['days', 'Jours travaillés'], ['weDays', 'Jours WE/férié']]);
    let h = '<div class="card"><div class="row"><label>Cumul jusqu\'à la fin de<select id="st-month">' +
      months.map(function (m) { return '<option' + (m === ui.statMonth ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="muted">Cumul = compteurs initiaux + tous les mois générés jusqu\'au mois choisi. Sous chaque valeur : « ce mois » et l\'écart au taux d\'équipe rapporté aux jours travaillés (rouge = trop chargé, bleu = moins chargé).</p></div>';
    h += '<div class="card" style="overflow:auto"><table class="stats" style="width:100%"><thead><tr><th>Agent</th>' + labels.map(function (l) { return '<th>' + l[1] + '</th>'; }).join('') + '<th>Souhaits OK / KO</th><th>Jours d\'absence</th></tr></thead><tbody>';
    state.cfg.agents.forEach(function (a) {
      const c = st.after[a.id], b = st.before[a.id];
      if (a.renfort && !c.days) return;
      h += '<tr><td>' + esc(a.id) + (a.renfort ? ' <small>renfort</small>' : '') + '</td>';
      keys.forEach(function (k) {
        let cls = '', dv = '';
        const monthV = c[k] - b[k];
        if (!a.renfort && k !== 'days' && k !== 'weDays') {
          const d = c[k] - rate(k) * c.days, thr = k === 'hours' ? 8 : 1;
          dv = (d > 0 ? '+' : '') + num(d);
          if (d >= thr) cls = 'hi'; else if (d <= -thr) cls = 'lo';
        }
        h += '<td class="' + cls + '">' + num(c[k]) + '<small>ce mois ' + num(monthV) + (dv ? ' · écart ' + dv : '') + '</small></td>';
      });
      h += '<td>' + c.prefOk + ' / ' + c.prefKo + '</td><td>' + c.absDays + '</td></tr>';
    });
    h += '<tr><td><i>Taux équipe /jour</i></td>' + keys.map(function (k) { return '<td>' + (k === 'days' || k === 'weDays' ? '' : (Math.round(rate(k) * 1000) / 1000)) + '</td>'; }).join('') + '<td></td><td></td></tr>';
    el.innerHTML = h + '</tbody></table></div>';
    $('#st-month').onchange = function (e) { ui.statMonth = e.target.value; renderStats(); };
  }

  /* =====================================================================
   *  DEMANDES
   * ===================================================================== */
  function renderRequests() {
    const el = $('#tab-requests');
    const agentOpts = function (sel) { return (sel && ids().indexOf(sel) < 0 ? '<option selected>' + esc(sel) + '</option>' : '') + state.cfg.agents.map(function (a) { return '<option' + (a.id === sel ? ' selected' : '') + '>' + esc(a.id) + '</option>'; }).join(''); };
    const typeOpts = function (sel) { return Object.keys(TYPES).map(function (t) { return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + TYPES[t] + '</option>'; }).join(''); };
    let h = '<div class="card"><div class="row"><button class="btn" data-act="req-add">+ Ajouter une demande</button>' +
      '<label>Importer (CSV, XLSX)<input type="file" id="req-file" accept=".csv,.xlsx,.xls"></label>' +
      '<button class="btn sec" data-act="req-template">Télécharger le modèle CSV</button>' +
      '<button class="btn sec danger" data-act="req-clear">Tout supprimer</button></div>' +
      '<p class="muted">Types : congé (C), récup (REC), formation (FORM), autre absence (ABS) → l\'agent ne travaille pas ; <b>Souhaite / Évite</b> avec une valeur parmi <code>nuit</code>, <code>soiree</code>, <code>tot</code>, <code>tard</code>, <code>j0</code> (le souhait ou l\'évitement J0 ne compte que les jours où un J0 existe) ; <b>Créneau imposé</b> avec une valeur du type <code>J2-3</code> ou <code>J0</code> ; <b>Renfort disponible</b> pour les agents marqués « renfort » dans les paramètres : un renfort n\'est <b>jamais</b> planifié en dehors des jours saisis ici. <b>Chef de tour</b> : l\'agent est considéré CDT sur la période, en plus de la case des paramètres.</p></div>';
    h += '<div class="card" style="overflow:auto"><table class="list"><thead><tr><th>Agent</th><th>Du</th><th>Au</th><th>Type</th><th>Valeur</th><th>Note</th><th></th></tr></thead><tbody>';
    state.requests.forEach(function (r, i) {
      h += '<tr data-i="' + i + '"><td><select data-f="agent">' + agentOpts(r.agent) + '</select></td>' +
        '<td><input type="date" data-f="from" value="' + esc(r.from) + '"></td><td><input type="date" data-f="to" value="' + esc(r.to) + '"></td>' +
        '<td><select data-f="type">' + typeOpts(r.type) + '</select></td><td><input data-f="value" list="val-list" value="' + esc(r.value) + '"></td>' +
        '<td><input data-f="note" value="' + esc(r.note) + '"></td><td><button class="x" data-act="req-del" data-i="' + i + '">✕</button></td></tr>';
    });
    if (!state.requests.length) h += '<tr><td colspan="7" class="muted">Aucune demande.</td></tr>';
    el.innerHTML = h + '</tbody></table></div><datalist id="val-list">' + ['nuit', 'soiree', 'tot', 'tard', 'j0', 'J1-1', 'J2-1', 'J3-1'].map(function (v) { return '<option value="' + v + '">'; }).join('') + '</datalist>';
    $('#req-file').onchange = importRequests;
    $$('#tab-requests tbody tr[data-i]').forEach(function (tr) {
      $$('[data-f]', tr).forEach(function (inp) {
        inp.onchange = function () {
          const r = state.requests[+tr.dataset.i]; r[inp.dataset.f] = inp.value;
          if (inp.dataset.f === 'from' && !r.to) { r.to = r.from; }
          save(); if (inp.dataset.f === 'from') renderRequests();
        };
      });
    });
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function rowsToRequests(rows) {
    const norm = P.normValue;
    const hi = rows.findIndex(function (r) { return r.some(function (c) { return /agent|trigramme/.test(norm(c)); }); });
    if (hi < 0) throw new Error('En-tête introuvable : il faut une colonne « agent ».');
    const head = rows[hi].map(norm);
    const col = function (names) { return head.findIndex(function (h) { return names.indexOf(h) >= 0; }); };
    const ci = { agent: col(['agent', 'trigramme']), from: col(['debut', 'du', 'from', 'date']), to: col(['fin', 'au', 'to']), type: col(['type']), value: col(['valeur', 'value', 'detail']), note: col(['note', 'commentaire']) };
    if (ci.from < 0 || ci.type < 0) throw new Error('Colonnes requises : agent, debut (ou date), type.');
    const out = [], rejected = [];
    rows.slice(hi + 1).forEach(function (r, n) {
      if (!r.some(function (c) { return String(c).trim(); })) return;
      const g = function (c) { return c < 0 ? '' : r[c]; };
      const from = P.normalizeDate(g(ci.from)), to = P.normalizeDate(g(ci.to)) || from, type = P.normalizeType(g(ci.type));
      const agent = String(g(ci.agent)).trim();
      if (!from || !type || !agent) { rejected.push('ligne ' + (hi + n + 2)); return; }
      out.push({ agent: agent, from: from, to: to, type: type, value: String(g(ci.value) || '').trim(), note: String(g(ci.note) || '').trim() });
    });
    return { out: out, rejected: rejected };
  }
  function importRequests(e) {
    const f = e.target.files[0]; if (!f) return;
    const done = function (rows) {
      try {
        const res = rowsToRequests(rows);
        const known = {}; ids().forEach(function (id) { known[id.toUpperCase()] = id; });
        let added = 0; const unknown = new Set();
        res.out.forEach(function (r) {
          const k = known[r.agent.toUpperCase()];
          if (k) r.agent = k; else if (r.type !== 'RENFORT') unknown.add(r.agent);
          else if (r.type === 'RENFORT') { state.cfg.agents.push({ id: r.agent.toUpperCase(), renfort: true }); known[r.agent.toUpperCase()] = r.agent.toUpperCase(); r.agent = r.agent.toUpperCase(); }
          state.requests.push(r); added++;
        });
        save(); renderRequests();
        toast(added + ' demande(s) importée(s)' + (res.rejected.length ? ' · ignorées : ' + res.rejected.join(', ') : '') + (unknown.size ? ' · agent(s) inconnu(s) à corriger : ' + Array.from(unknown).join(', ') : '') + '.');
      } catch (err) { toast('Import impossible : ' + err.message); }
    };
    if (/\.csv$/i.test(f.name)) {
      const rd = new FileReader(); rd.onload = function () { done(parseCsv(rd.result)); }; rd.readAsText(f, 'utf-8');
    } else {
      if (!window.XLSX) { toast('Bibliothèque Excel indisponible : utilisez un CSV.'); return; }
      const rd = new FileReader();
      rd.onload = function () {
        const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
        done(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
      };
      rd.readAsArrayBuffer(f);
    }
    e.target.value = '';
  }
  function requestTemplate() {
    const a = ids()[0] || 'AG1', b = ids()[1] || 'AG2';
    const rows = [['agent', 'debut', 'fin', 'type', 'valeur', 'note'],
      [a, '2027-01-12', '2027-01-16', 'C', '', 'congés'],
      [b, '2027-01-19', '2027-01-19', 'REC', '', ''],
      [a, '2027-01-25', '2027-01-25', 'EVITE', 'nuit', ''],
      [b, '2027-01-26', '2027-01-26', 'VEUT', 'tot', ''],
      [a, '2027-06-05', '2027-06-05', 'EVITE', 'j0', ''],
      [b, '2027-01-27', '2027-01-27', 'FIXE', 'J2-1', ''],
      [a, '2027-02-01', '2027-02-05', 'CDT', '', 'fait fonction de chef de tour']];
    download('modele-demandes.csv', '﻿' + rows.map(function (r) { return r.join(';'); }).join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* =====================================================================
   *  PARAMÈTRES
   * ===================================================================== */
  function renderParams() {
    const c = state.cfg, w = Object.assign({}, P.DEFAULT_WEIGHTS, c.weights);
    let h = '<div class="card"><h2 style="margin-top:0">Équipe et compteurs initiaux</h2>' +
      '<p class="muted">Compteurs de départ (cumul avant le premier mois généré, par exemple le report de l\'année précédente). Laisser à 0 pour une équipe qui démarre à zéro.</p>' +
      '<div style="overflow:auto"><table class="list" id="ag-table"><thead><tr><th>Agent</th><th>Renfort</th><th>CDT</th>' + COUNTER_FIELDS.map(function (f) { return '<th>' + f[1] + '</th>'; }).join('') + '<th>Jours</th><th></th></tr></thead><tbody>';
    c.agents.forEach(function (a) { h += agentRow(a); });
    h += '</tbody></table></div><button class="btn sec" data-act="ag-add">+ Agent</button>' +
      '<p class="muted"><b>CDT</b> (chef de tour) : seul un CDT peut tenir J1-1, J2-1 et J3-1 ; s\'il n\'y en a aucun de disponible ce jour-là, une alerte est affichée. <b>Renfort</b> : jamais planifié, sauf les jours saisis dans l\'onglet Demandes (type « Renfort disponible »).</p></div>';
    const per = (c.cycle.optionPeriods || []).map(function (p) { return p.from + ' ' + p.to; }).join('\n');
    h += '<div class="card"><h2 style="margin-top:0">Cycle</h2><div class="row">' +
      '<label>Premier jour d\'un cycle (J1)<input type="date" id="p-anchor" value="' + esc(c.cycle.anchor) + '"></label>' +
      '<label>Cycle normal<input id="p-normal" size="30" value="' + esc(c.cycle.normal.join(',')) + '"></label>' +
      '</div>' +
      '<div class="row" style="margin-top:10px"><label style="flex:1;min-width:260px">Périodes d\'option (une par ligne : début fin)<textarea id="p-periods" rows="3">' + esc(per) + '</textarea></label>' +
      '<label style="flex:1;min-width:260px">Jours fériés supplémentaires (un par ligne, AAAA-MM-JJ)<textarea id="p-hol" rows="3">' + esc((c.holidays || []).join('\n')) + '</textarea></label></div>' +
      '<p class="muted">Les jours fériés français sont calculés automatiquement ; un férié en semaine utilise la grille « dimanche / férié ». Le cycle (6 jours) est déroulé à partir de la date d\'ancrage et ne change jamais de longueur : en période d\'option, le dernier jour OFF juste avant chaque J1 devient J0.</p></div>';
    h += '<div class="card"><h2 style="margin-top:0">Règles et pondérations</h2><div class="row">' +
      '<label>Effectif minimum<input type="number" id="p-min" min="1" value="' + c.minStaff + '"></label>' +
      '<label>Postes de nuit effective (J3)<input type="number" id="p-nights" min="0" value="' + c.nightCount + '"></label>' +
      '<label>Horaire du J0<input id="p-j0" value="' + esc(c.j0Range) + '"></label>' +
      '<label>J2 « tôt » : début au plus tard à<input id="p-j2early" size="6" value="' + esc(c.j2EarlyMax || '10:00') + '"></label></div><div class="row" style="margin-top:10px">' +
      [['hours', 'Heures (par h)'], ['night', 'Nuit'], ['evening', 'Soirée J3'], ['late', 'J2 tardif'], ['early', 'Début tôt'], ['nightWE', 'Nuit WE/férié'], ['n1', 'N1 🌙 (par écart)'], ['meal', 'Repas 🍴 (par écart)'], ['j2tot', 'J2 tôt avant une nuit'], ['pref', 'Souhait / évitement']].map(function (x) {
        return '<label>' + x[1] + '<input type="number" step="any" min="0" data-w="' + x[0] + '" value="' + w[x[0]] + '" style="width:90px"></label>';
      }).join('') +
      '</div><p class="muted">Plus le poids est élevé, plus l\'algorithme évite de charger un agent déjà au-dessus du taux d\'équipe sur ce critère. Le poids « souhait » doit rester élevé pour que les demandes soient prioritaires sur l\'équité.</p></div>';
    h += '<div class="card"><h2 style="margin-top:0">Tableaux horaires (JSON)</h2><textarea id="p-tables" rows="14">' + esc(JSON.stringify(c.tables, null, 1)) + '</textarea>' +
      '<p class="muted">Par type de jour (weekday, saturday, sunday) et par vacation (J1, J2, J3), la liste des horaires attribués dans l\'ordre du rang (rang 1 = J1-1, etc.). Valeurs par défaut : grille « NORMALE AVEC TDS OPTION 1 ».</p></div>';
    h += '<button class="btn" data-act="params-save">Enregistrer les paramètres</button>';
    $('#tab-params').innerHTML = h;
  }
  function agentRow(a) {
    const ini = state.initial[a.id] || {};
    return '<tr><td><input data-k="id" value="' + esc(a.id) + '" size="6"></td><td><input type="checkbox" data-k="renfort"' + (a.renfort ? ' checked' : '') + '></td><td><input type="checkbox" data-k="cdt"' + (a.cdt ? ' checked' : '') + '></td>' +
      COUNTER_FIELDS.map(function (f) { return '<td><input type="number" step="any" data-c="' + f[0] + '" value="' + (ini[f[0]] || 0) + '" style="width:70px"></td>'; }).join('') +
      '<td><input type="number" data-c="days" value="' + (ini.days || 0) + '" style="width:70px"></td><td><button class="x" data-act="ag-del">✕</button></td></tr>';
  }
  function saveParams() {
    try {
      const c = state.cfg, old = ids();
      const agents = [], initial = {}, seen = new Set();
      $$('#ag-table tbody tr').forEach(function (tr) {
        const id = $('[data-k=id]', tr).value.trim().toUpperCase();
        if (!id) return;
        if (seen.has(id)) throw new Error('Agent en double : ' + id);
        seen.add(id);
        agents.push({ id: id, renfort: $('[data-k=renfort]', tr).checked, cdt: $('[data-k=cdt]', tr).checked });
        const ini = {}; $$('[data-c]', tr).forEach(function (i) { ini[i.dataset.c] = parseFloat(i.value) || 0; });
        initial[id] = ini;
      });
      if (!agents.length) throw new Error('Il faut au moins un agent.');
      const split = function (s) { return s.split(/[,;\s]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); };
      const normal = split($('#p-normal').value);
      const okRole = function (r) { return ['J0', 'J1', 'J2', 'J3', 'OFF'].indexOf(r) >= 0; };
      if (!normal.length || !normal.every(okRole)) throw new Error('Cycle : valeurs admises J1, J2, J3, OFF.');
      const anchor = P.normalizeDate($('#p-anchor').value);
      if (!anchor) throw new Error('Date d\'ancrage invalide.');
      const periods = $('#p-periods').value.split('\n').map(function (l) {
        const d = (l.match(/\d{4}-\d{2}-\d{2}/g) || []); return d.length >= 2 ? { from: d[0], to: d[1] } : null;
      }).filter(Boolean);
      const hol = ($('#p-hol').value.match(/\d{4}-\d{2}-\d{2}/g) || []);
      const tables = JSON.parse($('#p-tables').value);
      ['weekday', 'saturday', 'sunday'].forEach(function (dt) {
        ['J1', 'J2', 'J3'].forEach(function (k) {
          if (!tables[dt] || !Array.isArray(tables[dt][k]) || !tables[dt][k].length) throw new Error('Tableau horaire manquant : ' + dt + ' / ' + k);
          tables[dt][k].forEach(function (r) { P.parseRange(r); });
        });
      });
      P.parseRange($('#p-j0').value);
      const j2e = $('#p-j2early').value.trim().replace(/h/i, ':');
      if (!/^\d{1,2}:\d{2}$/.test(j2e)) throw new Error('Heure « J2 tôt » invalide (ex. 10:00).');
      const weights = {}; $$('[data-w]').forEach(function (i) { weights[i.dataset.w] = parseFloat(i.value) || 0; });
      Object.assign(c, { agents: agents, tables: tables, holidays: hol, minStaff: +$('#p-min').value || 1, nightCount: +$('#p-nights').value || 0, j0Range: $('#p-j0').value.trim(), j2EarlyMax: j2e, weights: weights });
      c.cycle = { anchor: anchor, normal: normal, optionPeriods: periods };
      state.initial = initial;
      const renamed = old.filter(function (id) { return !seen.has(id); });
      save(); renderParams();
      toast('Paramètres enregistrés.' + (renamed.length ? ' Agents retirés/renommés : ' + renamed.join(', ') + ' (régénérez les mois concernés).' : '') + ' Les plannings déjà générés ne changent pas tant qu\'ils ne sont pas régénérés.');
    } catch (e) { toast('Paramètres non enregistrés : ' + e.message); }
  }

  /* =====================================================================
   *  DONNÉES
   * ===================================================================== */
  function renderData() {
    $('#tab-data').innerHTML = '<div class="card"><h2 style="margin-top:0">Sauvegarde</h2><div class="row">' +
      '<button class="btn" data-act="json-export">Exporter tout (JSON)</button>' +
      '<label>Restaurer une sauvegarde<input type="file" id="json-file" accept=".json"></label></div>' +
      '<p class="muted">Le fichier contient paramètres, demandes et plannings générés : il est nominatif, ne le publiez pas dans un dépôt public. Mois générés : ' + (sortedMonths().join(', ') || 'aucun') + '.</p></div>' +
      '<div class="card"><h2 style="margin-top:0">Réinitialisation</h2><button class="btn danger" data-act="reset">Tout effacer</button></div>';
    $('#json-file').onchange = function (e) {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try {
          const s = JSON.parse(rd.result);
          if (!s.cfg || !s.cfg.cycle || !s.cfg.agents) throw new Error('fichier non reconnu');
          state = Object.assign(defaultState(), s); save(); ui.month = state.cfg.cycle.anchor.slice(0, 7); toast('Sauvegarde restaurée.'); render();
        } catch (err) { toast('Restauration impossible : ' + err.message); }
      };
      rd.readAsText(f);
    };
  }

  /* ---------- Actions (délégation) ---------- */
  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
    if (t.dataset.tab) { showTab(t.dataset.tab); return; }
    switch (t.dataset.act) {
      case 'generate': generate(); break;
      case 'export-csv': exportCsv(); break;
      case 'export-xlsx': exportXlsx(); break;
      case 'swap': doSwap(false); break;
      case 'unlock': doSwap(true); break;
      case 'req-add': state.requests.push({ agent: ids()[0] || '', from: ui.month + '-01', to: ui.month + '-01', type: 'C', value: '', note: '' }); save(); renderRequests(); break;
      case 'req-del': state.requests.splice(+t.dataset.i, 1); save(); renderRequests(); break;
      case 'req-clear': if (confirm('Supprimer toutes les demandes ?')) { state.requests = []; save(); renderRequests(); } break;
      case 'req-template': requestTemplate(); break;
      case 'ag-add': $('#ag-table tbody').insertAdjacentHTML('beforeend', agentRow({ id: '', renfort: false })); break;
      case 'ag-del': t.closest('tr').remove(); break;
      case 'params-save': saveParams(); break;
      case 'json-export': download('planning-tds-sauvegarde.json', JSON.stringify(state), 'application/json'); break;
      case 'reset': if (confirm('Effacer définitivement paramètres, demandes et plannings ?')) { state = defaultState(); save(); ui.month = state.cfg.cycle.anchor.slice(0, 7); render(); toast('Données réinitialisées.'); } break;
    }
  });

  render();
})();
