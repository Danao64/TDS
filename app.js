/* Interface — Planning TDS. Toutes les données sont stockées dans le navigateur (localStorage). */
(function () {
  'use strict';
  const P = window.Planner;
  const LS = 'tds-planning-v1';
  // Le planning commence en janvier 2027 : aucun mois, aucune date de planning antérieurs.
  const FIRST_MONTH = '2027-01', FIRST_DAY = '2027-01-01';
  const MONTHS_FR = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];
  const DOW = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const TYPES = { C: 'Congé', REC: 'Récup', FORM: 'Formation', ABS: 'Autre absence', RENFORT: 'Renfort disponible', VEUT: 'Souhaite', EVITE: 'Évite', FIXE: 'Créneau imposé', CDT: 'Chef de tour (sur la période)' };
  const COUNTER_FIELDS = [['hours', 'Heures'], ['nights', 'Nuits'], ['n1', 'N1 🌙'], ['meal', 'Repas 🍽️'], ['evenings', 'Soirées J3'], ['nightWE', 'Nuits WE/férié'], ['late', 'J2 tardifs'], ['early', 'Débuts tôt'], ['j0', 'J0']];

  /* ---------- État ---------- */
  function defaultState() {
    return {
      version: 1,
      cfg: {
        agents: ['AG1', 'AG2', 'AG3', 'AG4', 'AG5', 'AG6'].map(function (id, i) { return { id: id, renfort: false, cdt: i < 2, reg: i }; }),
        tables: JSON.parse(JSON.stringify(P.DEFAULT_TABLES)),
        cycle: {
          anchor: '2027-01-01',
          normal: ['J1', 'J2', 'J3', 'OFF', 'OFF', 'OFF'],
          optionPeriods: []
        },
        holidays: [], minStaff: 4, nightCount: 3, j0Range: '10:00-18:30', j2EarlyMax: '10:00', absenceCredit: 1,
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
  // Mise à jour des pondérations par défaut (v2 : nuit 4 → 8 pour un rattrapage plus franc sur l'année)
  let migrated = false;
  if (!state.weightsVersion) {
    if (state.cfg.weights && state.cfg.weights.night === 4) { state.cfg.weights.night = P.DEFAULT_WEIGHTS.night; migrated = true; }
    state.weightsVersion = 2;
  }
  delete state.cfg.equityPeriod; // ancien réglage « remise à zéro annuelle », retiré : les compteurs sont toujours cumulés
  function save() {
    state.changedAt = Date.now();
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { toast('Sauvegarde locale impossible : ' + e.message); }
    renderNotice();
  }
  const ui = { tab: 'planning', month: startMonth(), statMonth: null,
    mail: { open: false, types: { C: true, REC: true, FORM: true, ABS: true }, from: '', to: '', onlyUnsent: true, subject: '', body: '', idx: [] } };
  if (!state.mail) state.mail = { greeting: 'Bonjour,', signature: 'Cordialement,' };

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
  // Ordre d'affichage : chefs de tour d'abord, puis les autres ; dans chaque groupe, ordre d'inscription.
  function agentReg(a) { return a.reg !== undefined ? a.reg : state.cfg.agents.indexOf(a); }
  function sortedAgents() {
    return state.cfg.agents.slice().sort(function (x, y) { return (!!y.cdt - !!x.cdt) || (agentReg(x) - agentReg(y)); });
  }
  function nextReg() {
    let m = -1;
    state.cfg.agents.forEach(function (a) { m = Math.max(m, agentReg(a)); });
    $$('#ag-table tbody tr').forEach(function (tr) { m = Math.max(m, +tr.dataset.reg || 0); });
    return m + 1;
  }

  function initialCounters() {
    const o = {};
    state.cfg.agents.forEach(function (a) { o[a.id] = Object.assign(P.ZERO(), state.initial[a.id] || {}); });
    return o;
  }
  function sortedMonths() { return Object.keys(state.months).sort(); }
  function daysBefore(month) {
    return sortedMonths().filter(function (m) { return m < month; }).reduce(function (acc, m) { return acc.concat(state.months[m].days); }, []);
  }
  // Compteurs cumulés en continu depuis le début (compteurs initiaux + tous les mois précédents) :
  // jamais de remise à zéro au 1er janvier, un retard de fin d'année se rattrape l'année suivante.
  function countersBefore(month) { return P.computeCounters(daysBefore(month), state.cfg, initialCounters()); }
  function statsFor(month) {
    const before = countersBefore(month);
    const after = P.computeCounters(state.months[month].days, state.cfg, before);
    return { before: before, after: after };
  }

  /* ---------- Annuler : instantanés de l'état avant chaque action (en mémoire, perdus au rechargement) ---------- */
  const undoStack = [], UNDO_MAX = 15;
  function pushUndo(label) {
    undoStack.push({ label: label, data: JSON.stringify(state) });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    paintUndo();
  }
  function undo() {
    const u = undoStack.pop(); if (!u) return;
    state = JSON.parse(u.data);
    save(); render(); paintUndo();
    toast('Annulé : ' + u.label + '.');
  }
  function paintUndo() {
    const b = $('#undo-btn'); if (!b) return;
    const u = undoStack[undoStack.length - 1];
    b.hidden = !u;
    if (u) { b.textContent = '↶ Annuler'; b.title = 'Annuler : ' + u.label + (undoStack.length > 1 ? ' (' + undoStack.length + ' actions annulables)' : ''); }
  }

  /* ---------- Bandeau : sauvegarde conseillée, mois à régénérer ---------- */
  const BACKUP_DAYS = 7;
  function backupDue() {
    if (!state.lastBackup) return sortedMonths().length || state.requests.length ? 'Aucune sauvegarde exportée pour l\'instant.' : null;
    if (!state.changedAt || state.lastBackup >= state.changedAt) return null; // rien de nouveau depuis l'export
    if (state.genSinceBackup) return 'Un planning a été généré ou modifié depuis la dernière sauvegarde.';
    const d = Math.floor((Date.now() - state.lastBackup) / 864e5);
    return d >= BACKUP_DAYS ? 'Dernière sauvegarde il y a ' + d + ' jours.' : null;
  }
  function staleMonths() { return sortedMonths().filter(function (m) { return state.months[m].stale; }); }
  function staleReason(m) { const r = state.months[m].stale; return typeof r === 'string' ? r : 'un mois précédent a été régénéré'; }
  // Marque à régénérer les mois générés à partir de « from » (inclus) ; les mois suivants héritent de la raison.
  function markStale(from, reason) {
    sortedMonths().forEach(function (m) { if (m >= from) state.months[m].stale = reason; });
  }
  function renderNotice() {
    const el = $('#notice'); if (!el) return;
    let h = '';
    const due = backupDue();
    if (due) h += '<div class="notice"><span>💾 <b>Sauvegarde conseillée.</b> ' + esc(due) + ' Les données ne vivent que dans ce navigateur : un nettoyage du cache les efface.</span><button class="btn" data-act="json-export">Exporter la sauvegarde</button></div>';
    const st = staleMonths();
    if (st.length) {
      h += '<div class="notice warnbox"><span>⚠ <b>À régénérer : ' + st.map(monthLabel).map(esc).join(', ') + '.</b> ' +
        esc(staleReason(st[0]).charAt(0).toUpperCase() + staleReason(st[0]).slice(1)) + ' : l\'équité de ' + (st.length > 1 ? 'ces mois' : 'ce mois') + ' est faussée. Les journées figées et les échanges sont conservés.</span>' +
        '<button class="btn" data-act="regen-stale">Régénérer dans l\'ordre</button></div>';
    }
    el.innerHTML = h; el.hidden = !h;
  }
  function exportBackup() {
    state.lastBackup = Date.now(); state.genSinceBackup = false;
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { /* ignore */ }
    download('planning-tds-sauvegarde-' + P.toKey(new Date()) + '.json', JSON.stringify(state), 'application/json');
    renderNotice(); if (ui.tab === 'data') renderData();
  }

  /* ---------- Onglets ---------- */
  function showTab(t) {
    ui.tab = t;
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    ['planning', 'stats', 'requests', 'params', 'data'].forEach(function (n) { $('#tab-' + n).hidden = n !== t; });
    render();
  }
  function render() {
    renderNotice();
    ({ planning: renderPlanning, stats: renderStats, requests: renderRequests, params: renderParams, data: renderData })[ui.tab]();
  }

  /* =====================================================================
   *  PLANNING
   * ===================================================================== */
  // Menu des mois : mois générés (✓, ⚠ si à régénérer), le mois suivant à générer, et le mois affiché.
  function startMonth() { const a = state.cfg.cycle.anchor.slice(0, 7); return a < FIRST_MONTH ? FIRST_MONTH : a; }
  function shiftMonth(m, n) { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return P.toKey(d).slice(0, 7); }
  function monthOptions() {
    const gen = sortedMonths(), set = new Set(gen);
    set.add(ui.month);
    set.add(gen.length ? shiftMonth(gen[gen.length - 1], 1) : startMonth());
    return Array.from(set).filter(function (m) { return m >= FIRST_MONTH; }).sort().map(function (m) {
      const mm = state.months[m];
      const tag = mm ? (mm.stale ? ' ⚠ à régénérer' : ' ✓') : ' — à générer';
      return '<option value="' + m + '"' + (m === ui.month ? ' selected' : '') + '>' + monthLabel(m) + tag + '</option>';
    }).join('');
  }
  function renderPlanning() {
    const el = $('#tab-planning');
    const mm = state.months[ui.month];
    let html = '<div class="card"><div class="row">' +
      '<div class="month-nav"><button class="btn sec" data-act="month-prev" title="Mois précédent"' + (ui.month <= FIRST_MONTH ? ' disabled' : '') + '>◀</button>' +
      '<label>Mois<select id="pl-month">' + monthOptions() + '</select></label>' +
      '<button class="btn sec" data-act="month-next" title="Mois suivant">▶</button></div>' +
      '<button class="btn" data-act="generate">' + (mm ? 'Régénérer le mois' : 'Générer le mois') + '</button>';
    if (mm) {
      html += '<button class="btn sec" data-act="export-csv">Export CSV</button><button class="btn sec" data-act="export-xlsx">Export Excel</button><button class="btn sec" data-act="print-pdf">📄 Exporter en PDF</button><button class="btn sec danger" data-act="clear-month">🗑 Effacer ce mois</button>';
    }
    const rg = P.monthRange(ui.month), opt = optionCovers(rg);
    html += '<label style="flex-direction:row;align-items:center;gap:6px;color:var(--ink)"><input type="checkbox" id="pl-option"' + (opt ? ' checked' : '') + '> Mois en période d\'option (J0 sur le dernier OFF avant chaque J1)</label></div>';
    if (!(state.cfg.cycle.optionPeriods || []).length) html += '<p class="warn">Aucune période d\'option définie : le planning ne contient donc aucun J0. Cochez la case ci-dessus pour ce mois, ou définissez les périodes dans Paramètres.</p>';
    if (mm && mm.stale) html += '<p class="warn">⚠ Ce mois est à régénérer : ' + esc(staleReason(ui.month)) + '.</p>';
    html += '<p class="muted">Cycle ancré au ' + esc(state.cfg.cycle.anchor) + ' · effectif minimum ' + state.cfg.minStaff + ' · ' + state.cfg.agents.length + ' agents. <span class="ico-chip">' + ICON_N1 + '</span> = N1, <span class="ico-chip">' + ICON_MEAL + '</span> = repas, ❄ = journée figée. Les vacations 🔒 (échange manuel) sont conservées à la régénération.</p></div>';
    if (!mm) {
      el.innerHTML = html + '<p class="muted">Aucun planning pour ce mois. Vérifiez les paramètres et les demandes, puis cliquez sur « Générer le mois ».</p>';
      bindPlanning(); return;
    }
    const warns = [];
    (mm.warnings || []).forEach(function (w) { warns.push(w); });
    mm.days.forEach(function (d) { (d.warnings || []).forEach(function (w) { warns.push(d.date + ' : ' + w); }); });
    if (warns.length) html += '<div class="card"><b class="warn">' + warns.length + ' alerte(s)</b><ul class="alerts">' + warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    html += freezeHtml(mm) + gridHtml(mm);
    html += agentSheetHtml(mm);
    html += swapHtml(mm);
    el.innerHTML = html;
    bindPlanning();
  }
  function freezeHtml(mm) {
    const n = mm.days.filter(function (d) { return d.frozen; }).length;
    const rg = P.monthRange(ui.month);
    return '<div class="card"><div class="row"><b>❄ Figer des journées</b> <span class="muted">' + n + ' journée(s) figée(s)</span>' +
      '<label>Figer jusqu\'au (inclus)<input type="date" id="fr-until" min="' + rg[0] + '" max="' + rg[1] + '" value="' + (function () { const t = P.toKey(new Date()); return t < rg[0] ? rg[0] : (t > rg[1] ? rg[1] : t); })() + '"></label>' +
      '<button class="btn sec" data-act="freeze-until">Figer jusqu\'à cette date</button>' +
      '<button class="btn sec" data-act="freeze-all">Tout figer</button><button class="btn sec" data-act="unfreeze-all">Tout dégeler</button></div>' +
      '<p class="muted">Une journée figée est conservée telle quelle (vacations, N1, repas, échanges) quand vous cliquez sur « Régénérer le mois » ; seules les autres journées sont recalculées autour d\'elle. Cochez la case sous un jour dans la grille, ou utilisez les boutons.</p></div>';
  }
  function keepScroll(fn) {
    const g = $('.grid-wrap'), l = g ? g.scrollLeft : 0, t = g ? g.scrollTop : 0, y = window.scrollY;
    fn();
    const g2 = $('.grid-wrap'); if (g2) { g2.scrollLeft = l; g2.scrollTop = t; }
    window.scrollTo(0, y);
  }
  function setFrozen(pred, on) {
    pushUndo(on ? 'gel de journées' : 'dégel de journées');
    const mm = state.months[ui.month]; let n = 0;
    mm.days.forEach(function (d) { if (d.role !== 'OFF' && pred(d) && !!d.frozen !== on) { d.frozen = on; n++; } });
    save(); keepScroll(renderPlanning); return n;
  }
  // Icônes N1 (croissant de lune épais) et repas (assiette entre fourchette et couteau), pensées pour le fond J3 foncé
  const ICON_N1 = '<svg class="ico" viewBox="0 0 16 16" aria-label="N1" role="img"><path d="M8.45 1.52A6.5 6.5 0 1 0 14.3 9.61A5 5 0 0 1 8.45 1.52Z" fill="#ffc928" stroke="#a87400" stroke-width=".6"/></svg>';
  const ICON_MEAL = '<svg class="ico ico-meal" viewBox="0 0 26 16" aria-label="repas" role="img"><g fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"><path d="M3 2v4M1.6 2v3.2a1.4 1.4 0 0 0 2.8 0V2M3 6.6V14"/><path d="M23.2 14V2c1.6 1.6 1.8 5 0 6.6"/></g><circle cx="13" cy="8" r="6.6" fill="#fff" stroke="#9aa6c8" stroke-width=".8"/><circle cx="13" cy="8" r="4.2" fill="none" stroke="#c3cbe3" stroke-width=".8"/></svg>';
  // Symboles N1/repas sur une ligne à part, horaires en dessous ; à l'export PDF, « J1-1 » devient « J1 CDT »
  function printSlotHtml(as) {
    const sym = (as.n1 ? ICON_N1 : '') + (as.meal ? ICON_MEAL : '');
    return '<b class="prt">' + esc(as.slot.replace(/-1$/, ' CDT')) + '</b>' + (sym ? '<span class="sym">' + sym + '</span>' : '');
  }
  function slotLabel(as) { return as.slot + (as.n1 ? ' 🌙' : '') + (as.meal ? ' 🍽️' : ''); }
  function visibleAgents(mm) {
    return sortedAgents().filter(function (a) {
      if (!a.renfort) return true;
      return mm.days.some(function (d) { return d.assign[a.id] || d.absent[a.id]; });
    });
  }
  function monthLabel(m) { return MONTHS_FR[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
  function gridHtml(mm) {
    let h = '<div class="month-banner" id="month-banner">' + monthLabel(ui.month) + '</div><div class="grid-wrap"><table class="grid"><thead><tr><th class="sticky">Agent</th>';
    mm.days.forEach(function (d) {
      h += '<th class="' + (d.dayType !== 'weekday' ? 'we' : '') + (d.frozen ? ' frozen' : '') + '">' + (d.frozen ? '<span class="fz">❄<br></span>' : '') + DOW[P.dow(d.date)] + '<br>' + d.date.slice(8) + '</th>';
    });
    h += '</tr><tr><th class="sticky">Rôle</th>';
    mm.days.forEach(function (d) {
      const n = Object.keys(d.assign).length;
      h += '<th class="role-' + d.role + '">' + d.role + (d.role !== 'OFF' ? '<br><small>' + n + (Object.keys(d.lockedAgents || {}).length || d.locked ? ' 🔒' : '') + '</small>' : '') + '</th>';
    });
    h += '</tr><tr><th class="sticky" title="Figer la journée avant de régénérer">Figer ❄</th>';
    mm.days.forEach(function (d) {
      h += '<th class="' + (d.frozen ? 'frozen' : '') + '">' + (d.role !== 'OFF' ? '<input type="checkbox" data-freeze="' + d.date + '"' + (d.frozen ? ' checked' : '') + ' title="Figer ' + d.date + '">' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    visibleAgents(mm).forEach(function (a) {
      h += '<tr><td class="sticky">' + esc(a.id) + (a.cdt ? ' <small class="muted">CDT</small>' : '') + (a.renfort ? ' <small class="muted">renf.</small>' : '') + '</td>';
      mm.days.forEach(function (d) {
        const as = d.assign[a.id];
        if (as) {
          h += '<td class="k-' + as.kind + (d.frozen ? ' frozen' : '') + ((d.lockedAgents && d.lockedAgents[a.id]) || d.locked ? ' lock' : '') + '" title="' + esc(P.DAY_TYPE_LABEL[d.dayType]) + '"><b class="scr">' + esc(as.slot) + '</b>' + printSlotHtml(as) + '<small>' + P.fmtRange(as.range) + '</small></td>';
        } else if (d.absent[a.id]) {
          h += '<td class="abs' + (d.frozen ? ' frozen' : '') + '">' + esc(d.absent[a.id]) + '</td>';
        } else h += '<td class="off' + (d.frozen ? ' frozen' : '') + '"></td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div><p class="print-legend"><span class="ico-chip">' + ICON_N1 + '</span> N1 · <span class="ico-chip">' + ICON_MEAL + '</span> repas · CDT = chef de tour · J1 / J2 / J3 = vacations du cycle · J0 = jour d\'option</p>';
  }
  /* ---------- Planning individuel : vue, impression, export calendrier (.ics) ---------- */
  const ABS_LABEL = { C: 'Congé', REC: 'Récup', FORM: 'Formation', ABS: 'Absence' };
  const DOW_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function cdtSlot(slot) { return slot.replace(/-1$/, ' CDT'); }
  function agentLines(id, days) { // une ligne par jour où l'agent travaille ou est absent
    const out = [];
    days.forEach(function (d) {
      const as = d.assign[id];
      if (as) out.push({ date: d.date, as: as, dayType: d.dayType });
      else if (d.absent[id]) out.push({ date: d.date, abs: d.absent[id] });
    });
    return out;
  }
  function agentSheetHtml(mm) {
    const list = visibleAgents(mm);
    if (!list.length) return '';
    if (!ui.agent || !list.some(function (a) { return a.id === ui.agent; })) ui.agent = list[0].id;
    const lines = agentLines(ui.agent, mm.days);
    let work = 0, hours = 0;
    lines.forEach(function (l) { if (l.as) { work++; hours += P.parseRange(l.as.range).dur / 60; } });
    let h = '<div class="card agent-card"><div class="row no-print"><b>👤 Planning individuel</b>' +
      '<label>Agent<select id="ag-sheet">' + list.map(function (a) { return '<option' + (a.id === ui.agent ? ' selected' : '') + '>' + esc(a.id) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn sec" data-act="agent-print">📄 Imprimer / PDF</button>' +
      '<button class="btn sec" data-act="agent-ics">📅 Calendrier du mois (.ics)</button>' +
      '<button class="btn sec" data-act="agent-ics-all">📅 Tous les mois générés (.ics)</button></div>' +
      '<h2 class="agent-title">' + esc(ui.agent) + ' — ' + monthLabel(ui.month) + '</h2>' +
      '<p class="muted">' + work + ' vacation(s), ' + num(hours) + ' h' + (lines.length > work ? ', ' + (lines.length - work) + ' jour(s) d\'absence' : '') + '. Le fichier .ics s\'importe dans le calendrier du téléphone (iPhone : ouvrir le fichier ; Google Agenda : Paramètres › Importer).</p>';
    if (!lines.length) return h + '<p class="muted">Aucune vacation ce mois-ci.</p></div>';
    h += '<table class="list agent-list"><thead><tr><th>Date</th><th>Vacation</th><th>Horaires</th><th>Nuit</th></tr></thead><tbody>';
    lines.forEach(function (l) {
      const day = DOW_LONG[P.dow(l.date)] + ' ' + (+l.date.slice(8)) + ' ' + MONTHS_FR[+l.date.slice(5, 7) - 1].toLowerCase();
      if (l.abs) { h += '<tr class="abs"><td>' + day + '</td><td colspan="3">' + esc(ABS_LABEL[l.abs] || l.abs) + '</td></tr>'; return; }
      const sym = (l.as.n1 ? ICON_N1 + ' N1' : '') + (l.as.meal ? ICON_MEAL + ' repas' : '');
      h += '<tr class="k-' + l.as.kind + '"><td>' + day + '</td><td><b>' + esc(cdtSlot(l.as.slot)) + '</b></td><td>' + P.fmtRange(l.as.range) + '</td><td class="agent-sym">' + sym + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function printAgent() {
    const old = document.title;
    document.title = 'Planning ' + ui.agent + ' ' + monthLabel(ui.month);
    document.body.classList.add('print-agent');
    const restore = function () { document.title = old; document.body.classList.remove('print-agent'); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  }
  function icsDate(k, min) { // heure locale « flottante » : le calendrier l'affiche à l'heure de l'appareil
    const day = P.addDays(k, Math.floor(min / 1440)), m = min % 1440;
    return day.replace(/-/g, '') + 'T' + String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0') + '00';
  }
  function icsText(t) { return String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
  function exportIcs(all) {
    const months = all ? sortedMonths() : [ui.month];
    const id = ui.agent, stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const ev = [];
    months.forEach(function (m) {
      agentLines(id, state.months[m].days).forEach(function (l) {
        const uid = 'tds-' + id + '-' + l.date + '@planning-tds';
        if (l.abs) {
          ev.push(['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + l.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + P.addDays(l.date, 1).replace(/-/g, ''),
            'SUMMARY:' + icsText(ABS_LABEL[l.abs] || l.abs), 'TRANSP:TRANSPARENT', 'END:VEVENT']);
          return;
        }
        const r = P.parseRange(l.as.range);
        const extra = (l.as.n1 ? ' · N1' : '') + (l.as.meal ? ' · repas' : '');
        ev.push(['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp, 'DTSTART:' + icsDate(l.date, r.start), 'DTEND:' + icsDate(l.date, r.end),
          'SUMMARY:' + icsText(cdtSlot(l.as.slot) + extra), 'DESCRIPTION:' + icsText('Vacation ' + l.as.slot + ' (' + P.fmtRange(l.as.range) + ')' + extra), 'END:VEVENT']);
      });
    });
    if (!ev.length) { toast('Aucune vacation à exporter pour ' + id + '.'); return; }
    const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planning TDS//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + icsText('Planning TDS ' + id)];
    const body = head.concat([].concat.apply([], ev), ['END:VCALENDAR']).join('\r\n') + '\r\n';
    download('planning-' + id + '-' + (all ? 'tous-les-mois' : ui.month) + '.ics', body, 'text/calendar;charset=utf-8');
    toast(ev.length + ' événement(s) exporté(s) pour ' + id + '. Réimporter le fichier met à jour les vacations déjà présentes.');
  }
  function swapHtml(mm) {
    const active = mm.days.filter(function (d) { return d.role !== 'OFF' && Object.keys(d.assign).length > 1; });
    if (!active.length) return '';
    return '<div class="card"><h2 style="margin-top:0">Échanger deux agents</h2><div class="row">' +
      '<label>Jour<select id="sw-day">' + active.map(function (d) { return '<option value="' + d.date + '">' + DOW[P.dow(d.date)] + ' ' + d.date.slice(8) + ' · ' + d.role + '</option>'; }).join('') + '</select></label>' +
      '<label>Agent A<select id="sw-a"></select></label><label>Agent B<select id="sw-b"></select></label>' +
      '<button class="btn" data-act="swap">Échanger</button><button class="btn sec" data-act="unlock">Déverrouiller A et B</button></div>' +
      '<div id="sw-suggest"></div>' +
      '<p class="muted">L\'échange verrouille uniquement les vacations des deux agents ce jour-là (🔒) : elles sont conservées si vous régénérez le mois, le reste du jour est recalculé autour. La vacation complète change d\'agent (N1 🌙 et repas 🍽️ compris).</p></div>';
  }
  function fillSwap() {
    const mm = state.months[ui.month]; const sel = $('#sw-day'); if (!mm || !sel) return;
    const d = mm.days.find(function (x) { return x.date === sel.value; });
    const opts = Object.keys(d.assign).map(function (id) { return '<option>' + esc(id) + '</option>'; }).join('');
    $('#sw-a').innerHTML = opts; $('#sw-b').innerHTML = opts;
    if ($('#sw-b').options.length > 1) $('#sw-b').selectedIndex = 1;
    suggestSwaps();
  }
  // Suggestions : avec qui l'agent A peut échanger ce jour-là en déséquilibrant le moins les compteurs (compteurs cumulés).
  function suggestSwaps() {
    const box = $('#sw-suggest'), mm = state.months[ui.month]; if (!box || !mm) return;
    const d = mm.days.find(function (x) { return x.date === $('#sw-day').value; }), a = $('#sw-a').value;
    if (!d || !d.assign[a]) { box.innerHTML = ''; return; }
    const counters = statsFor(ui.month).after;
    const cdt = function (id) { return !!(d.cdt && d.cdt[id]); };
    const nc = state.cfg.nightCount;
    const list = Object.keys(d.assign).filter(function (b) { return b !== a; }).map(function (b) {
      const x = d.assign[a], y = d.assign[b];
      const same = x.range === y.range && !!x.n1 === !!y.n1 && !!x.meal === !!y.meal && x.kind === y.kind && (x.rank <= nc) === (y.rank <= nc);
      const cdtKo = (x.rank === 1 && cdt(a) && !cdt(b)) || (y.rank === 1 && cdt(b) && !cdt(a));
      return { b: b, delta: P.swapImpact(state.cfg, counters, d, a, b), same: same, cdtKo: cdtKo, slot: y };
    }).filter(function (o) { return !o.same; });
    if (!list.length) { box.innerHTML = '<p class="muted">Aucun échange utile pour ' + esc(a) + ' ce jour-là (vacations identiques).</p>'; return; }
    list.sort(function (p, q) { return (p.cdtKo - q.cdtKo) || (p.delta - q.delta); });
    const verdict = function (o) {
      if (o.cdtKo) return '<span class="bad">⚠ rang 1 sans chef de tour</span>';
      if (o.delta < -0.5) return '<span class="good">rééquilibre</span>';
      if (o.delta <= 0.5) return '<span class="muted">neutre</span>';
      return '<span class="' + (o.delta > 8 ? 'bad' : 'warn') + '">déséquilibre ' + (o.delta > 8 ? 'fort' : 'léger') + '</span>';
    };
    box.innerHTML = '<p class="muted" style="margin-bottom:4px">Échanges possibles pour <b>' + esc(a) + '</b> (' + esc(slotLabel(d.assign[a])) + '), du plus équitable au moins équitable — cliquez pour choisir l\'agent B :</p><div class="sw-list">' +
      list.map(function (o) {
        return '<button class="btn sec sw-pick" data-act="sw-pick" data-b="' + esc(o.b) + '"><b>' + esc(o.b) + '</b> · ' + esc(slotLabel(o.slot)) + ' · ' + verdict(o) + '</button>';
      }).join('') + '</div>';
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
    const ag = $('#ag-sheet'); if (ag) ag.onchange = function () { ui.agent = ag.value; keepScroll(renderPlanning); };
    const sw = $('#sw-day'); if (sw) { sw.onchange = fillSwap; fillSwap(); $('#sw-a').onchange = suggestSwaps; }
  }
  // Génère (ou régénère) un mois ; renvoie le nombre de journées figées conservées.
  function generateFor(month) {
    const prev = {};
    if (state.months[month]) state.months[month].days.forEach(function (d) { prev[d.date] = d; });
    const before = sortedMonths().filter(function (m) { return m < month; });
    const res = P.generateMonth(state.cfg, state.requests, countersBefore(month), month, prev, daysBefore(month).filter(function (x) { return x.date >= P.addDays(P.monthRange(month)[0], -8); }));
    if (before.length) {
      const last = before[before.length - 1];
      const exp = P.toKey(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 2, 1))).slice(0, 7);
      if (last !== exp) res.warnings.push('Le mois ' + exp + ' n\'est pas généré : l\'équité ne le prend pas en compte.');
    }
    state.months[month] = { days: res.days, warnings: res.warnings, generatedAt: res.generatedAt };
    sortedMonths().forEach(function (m) { if (m > month) state.months[m].stale = 'le planning de ' + monthLabel(month).toLowerCase() + ' a changé'; });
    state.genSinceBackup = true;
    return res.days.filter(function (d) { return d.frozen; }).length;
  }
  function generate() {
    if (ui.month < FIRST_MONTH) { toast('Le planning commence en janvier 2027.'); return; }
    pushUndo((state.months[ui.month] ? 'régénération de ' : 'génération de ') + monthLabel(ui.month).toLowerCase());
    try {
      const nFrozen = generateFor(ui.month);
      save(); renderPlanning(); toast('Planning de ' + ui.month + ' généré' + (nFrozen ? ' · ' + nFrozen + ' journée(s) figée(s) conservée(s).' : '.'));
    } catch (e) { toast('Erreur : ' + e.message); }
  }
  // Efface le planning du mois affiché (vacations, journées figées, échanges) ; les demandes sont conservées.
  function clearMonth() {
    const mm = state.months[ui.month]; if (!mm) return;
    const label = monthLabel(ui.month).toLowerCase();
    const nFrozen = mm.days.filter(function (d) { return d.frozen; }).length;
    const nLocked = mm.days.filter(function (d) { return Object.keys(d.lockedAgents || {}).length || d.locked; }).length;
    const later = sortedMonths().filter(function (m) { return m > ui.month; });
    const msg = 'Effacer le planning de ' + label + ' ?\n\n' +
      'Seront supprimés : toutes les vacations du mois' + (nFrozen ? ', ' + nFrozen + ' journée(s) figée(s)' : '') + (nLocked ? ', les échanges de ' + nLocked + ' journée(s)' : '') + '. ' +
      'Les demandes et les paramètres sont conservés.' +
      (later.length ? '\n\nLes mois suivants (' + later.map(monthLabel).join(', ').toLowerCase() + ') seront à régénérer.' : '') +
      '\n\nAstuce : exportez une sauvegarde avant si vous voulez pouvoir revenir en arrière.';
    if (!confirm(msg)) return;
    pushUndo('effacement de ' + label);
    delete state.months[ui.month];
    later.forEach(function (m) { state.months[m].stale = 'le planning de ' + label + ' a été effacé'; });
    state.genSinceBackup = true;
    save(); renderPlanning(); toast('Planning de ' + label + ' effacé.');
  }
  // Régénère, dans l'ordre, tous les mois à partir du premier mois à régénérer.
  function regenStale() {
    const st = staleMonths(); if (!st.length) return;
    const todo = sortedMonths().filter(function (m) { return m >= st[0]; });
    pushUndo('régénération de ' + todo.length + ' mois');
    try {
      todo.forEach(function (m) { generateFor(m); });
      save(); render(); toast(todo.length + ' mois régénéré(s) dans l\'ordre : ' + todo.map(monthLabel).join(', ') + '.');
    } catch (e) { save(); render(); toast('Erreur : ' + e.message); }
  }
  function doSwap(unlock) {
    const mm = state.months[ui.month]; const d = mm.days.find(function (x) { return x.date === $('#sw-day').value; });
    try {
      const a = $('#sw-a').value, b = $('#sw-b').value;
      if (!unlock && a === b) { toast('Choisissez deux agents différents.'); return; }
      pushUndo((unlock ? 'déverrouillage ' : 'échange ') + a + (unlock ? ' et ' : ' ↔ ') + b + ' le ' + fmtDay(d.date));
      if (unlock) {
        if (d.locked) { d.lockedAgents = Object.keys(d.assign).reduce(function (o, id) { o[id] = true; return o; }, {}); d.locked = false; }
        if (d.lockedAgents) { delete d.lockedAgents[a]; delete d.lockedAgents[b]; }
        toast('Vacations de ' + a + ' et ' + b + ' déverrouillées.');
      } else {
        if (a === b) { toast('Choisissez deux agents différents.'); return; }
        P.swapAgents(d, a, b); toast('Échange effectué : ' + a + ' ↔ ' + b + '.');
      }
      sortedMonths().forEach(function (m) { if (m > ui.month) state.months[m].stale = 'un échange a été fait en ' + monthLabel(ui.month).toLowerCase(); });
      state.genSinceBackup = true;
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
  // PDF : impression du seul planning du mois affiché (bandeau + tableau) ; choisir « Enregistrer au format PDF »
  function printPlanning() {
    const old = document.title;
    document.title = 'Planning ' + monthLabel(ui.month);
    const restore = function () { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
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
    const rate = function (k) { let s = 0, d = 0; reg.forEach(function (id) { s += st.after[id][k]; d += P.effDays(st.after[id], state.cfg, k); }); return d ? s / d : 0; };
    const labels = COUNTER_FIELDS.concat([['days', 'Jours travaillés'], ['weDays', 'Jours WE/férié']]);
    let h = '<div class="card"><div class="row"><label>Cumul jusqu\'à la fin de<select id="st-month">' +
      months.map(function (m) { return '<option' + (m === ui.statMonth ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="muted">Cumul = compteurs initiaux + tous les mois générés jusqu\'au mois choisi (pas de remise à zéro au 1er janvier). Sous chaque valeur : « ce mois » et l\'écart au taux d\'équipe rapporté aux jours travaillés (rouge = trop chargé, bleu = moins chargé).</p></div>';
    h += '<div class="card" style="overflow:auto"><table class="stats" style="width:100%"><thead><tr><th>Agent</th>' + labels.map(function (l) { return '<th>' + l[1] + '</th>'; }).join('') + '<th>Souhaits OK / KO</th><th>Jours d\'absence</th></tr></thead><tbody>';
    sortedAgents().forEach(function (a) {
      const c = st.after[a.id], b = st.before[a.id];
      if (a.renfort && !c.days) return;
      h += '<tr><td>' + esc(a.id) + (a.renfort ? ' <small>renfort</small>' : '') + '</td>';
      keys.forEach(function (k) {
        let cls = '', dv = '';
        const monthV = c[k] - b[k];
        if (!a.renfort && k !== 'days' && k !== 'weDays') {
          const d = c[k] - rate(k) * P.effDays(c, state.cfg, k), thr = k === 'hours' ? 8 : 1;
          dv = (d > 0 ? '+' : '') + num(d);
          if (d >= thr) cls = 'hi'; else if (d <= -thr) cls = 'lo';
        }
        h += '<td class="' + cls + '">' + num(c[k]) + '<small>ce mois ' + num(monthV) + (dv ? ' · écart ' + dv : '') + '</small></td>';
      });
      h += '<td>' + c.prefOk + ' / ' + c.prefKo + '</td><td>' + c.absDays + '</td></tr>';
    });
    h += '<tr><td><i>Taux équipe par jour</i></td>' + keys.map(function (k) { return '<td>' + (k === 'days' || k === 'weDays' ? '' : (Math.round(rate(k) * 1000) / 1000)) + '</td>'; }).join('') + '<td></td><td></td></tr>';
    el.innerHTML = h + '</tbody></table></div>';
    $('#st-month').onchange = function (e) { ui.statMonth = e.target.value; renderStats(); };
  }

  /* =====================================================================
   *  DEMANDES
   * ===================================================================== */
  function renderRequests() {
    const el = $('#tab-requests');
    const agentOpts = function (sel) { return (sel && ids().indexOf(sel) < 0 ? '<option selected>' + esc(sel) + '</option>' : '') + sortedAgents().map(function (a) { return '<option' + (a.id === sel ? ' selected' : '') + '>' + esc(a.id) + '</option>'; }).join(''); };
    const typeOpts = function (sel) { return Object.keys(TYPES).map(function (t) { return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + TYPES[t] + '</option>'; }).join(''); };
    let h = '<div class="card"><div class="row"><button class="btn" data-act="req-add">+ Ajouter une demande</button>' +
      '<label>Importer (CSV, XLSX)<input type="file" id="req-file" accept=".csv,.xlsx,.xls"></label>' +
      '<button class="btn sec" data-act="req-template">Télécharger le modèle CSV</button>' +
      '<button class="btn" data-act="mail-toggle">✉ Générer le mail de dépôt</button>' +
      '<button class="btn sec danger" data-act="req-clear">Tout supprimer</button></div>' +
      '<p class="muted">Types : congé (C), récup (REC), formation (FORM), autre absence (ABS) → l\'agent ne travaille pas ; <b>Souhaite / Évite</b> avec une valeur parmi <code>nuit</code>, <code>soiree</code>, <code>tot</code>, <code>tard</code>, <code>j0</code> (le souhait ou l\'évitement J0 ne compte que les jours où un J0 existe) ; <b>Créneau imposé</b> avec une valeur du type <code>J2-3</code> ou <code>J0</code> ; <b>Renfort disponible</b> pour les agents marqués « renfort » dans les paramètres : un renfort n\'est <b>jamais</b> planifié en dehors des jours saisis ici. <b>Chef de tour</b> : l\'agent est considéré CDT sur la période, en plus de la case des paramètres.</p></div>';
    h += mailPanelHtml();
    h += '<div class="card" style="overflow:auto"><table class="list"><thead><tr><th>Agent</th><th>Du</th><th>Au</th><th>Type</th><th>Valeur</th><th>Note</th><th title="Demande déjà déposée auprès de l\'administration">Déposée</th><th title="Effectif les jours de cycle couverts par la demande">Contrôle</th><th></th></tr></thead><tbody>';
    const chk = requestChecks();
    reqOrder().forEach(function (i) {
      const r = state.requests[i];
      h += '<tr data-i="' + i + '"><td><select data-f="agent">' + agentOpts(r.agent) + '</select></td>' +
        '<td><input type="date" data-f="from" min="' + FIRST_DAY + '" value="' + esc(r.from) + '"></td><td><input type="date" data-f="to" min="' + FIRST_DAY + '" value="' + esc(r.to) + '"></td>' +
        '<td><select data-f="type">' + typeOpts(r.type) + '</select></td><td><input data-f="value" list="val-list" value="' + esc(r.value) + '"></td>' +
        '<td><input data-f="note" value="' + esc(r.note) + '"></td><td style="text-align:center"><input type="checkbox" data-f="sent" title="' + (r.sent ? 'Déposée le ' + esc(r.sent) : 'Pas encore déposée') + '"' + (r.sent ? ' checked' : '') + '></td>' + checkCell(chk[i]) + '<td><button class="x" data-act="req-del" data-i="' + i + '">✕</button></td></tr>';
    });
    if (!state.requests.length) h += '<tr><td colspan="9" class="muted">Aucune demande.</td></tr>';
    el.innerHTML = h + '</tbody></table></div><datalist id="val-list">' + ['nuit', 'soiree', 'tot', 'tard', 'j0', 'J1-1', 'J2-1', 'J3-1'].map(function (v) { return '<option value="' + v + '">'; }).join('') + '</datalist>';
    $('#req-file').onchange = importRequests;
    $$('#tab-requests tbody tr[data-i]').forEach(function (tr) {
      $$('[data-f]', tr).forEach(function (inp) {
        inp.onchange = function () {
          const r = state.requests[+tr.dataset.i], m0 = reqMonth(r);
          pushUndo('modification d\'une demande de ' + r.agent);
          r[inp.dataset.f] = inp.type === 'checkbox' ? (inp.checked ? P.toKey(new Date()) : '') : inp.value;
          if ((inp.dataset.f === 'from' || inp.dataset.f === 'to') && r[inp.dataset.f] && r[inp.dataset.f] < FIRST_DAY) { r[inp.dataset.f] = FIRST_DAY; toast('Le planning commence le 1er janvier 2027 : date ramenée au 01/01/2027.'); }
          if (inp.dataset.f === 'from' && !r.to) { r.to = r.from; }
          if (REQ_NEUTRAL.indexOf(inp.dataset.f) < 0) {
            requestChanged([m0, reqMonth(r)]);
            const bad = requestChecks()[+tr.dataset.i];
            if (bad && bad.length) toast('⚠ ' + r.agent + ' absent : ' + fmtDay(bad[0].date) + ' (' + bad[0].role + ') ' + bad[0].problems.join(', ') + (bad.length > 1 ? ' — et ' + (bad.length - 1) + ' autre(s) jour(s).' : '.'));
          }
          save(); if (['agent', 'from', 'to', 'type'].indexOf(inp.dataset.f) >= 0) renderRequests();
        };
      });
    });
  }
  /* ---------- Ordre d'affichage : les dernières demandes en haut ---------- */
  /* ---------- Contrôle des demandes d'absence : effectif des jours couverts ---------- */
  const ABS_TYPES = ['C', 'REC', 'FORM', 'ABS'];
  function requestChecks() { // index de la demande -> jours à problème (ou [] si tout va bien, null si sans objet)
    const out = {}, abs = [];
    state.requests.forEach(function (r, i) {
      const t = P.normalizeType(r.type), f = P.normalizeDate(r.from), to = P.normalizeDate(r.to) || f;
      if (ABS_TYPES.indexOf(t) < 0 || !f) { out[i] = null; return; }
      abs.push({ i: i, from: f, to: to < f ? f : to });
    });
    if (!abs.length) return out;
    const from = abs.reduce(function (m, x) { return x.from < m ? x.from : m; }, abs[0].from);
    const to = abs.reduce(function (m, x) { return x.to > m ? x.to : m; }, abs[0].to);
    const days = P.staffingCheck(state.cfg, state.requests, from < state.cfg.cycle.anchor ? state.cfg.cycle.anchor : from, to);
    abs.forEach(function (x) {
      const bad = [];
      for (let k = x.from, g = 0; k <= x.to && g < 400; k = P.addDays(k, 1), g++) {
        const d = days[k];
        if (d && d.problems.length) bad.push({ date: k, role: d.role, problems: d.problems });
      }
      out[x.i] = bad;
    });
    return out;
  }
  function fmtDay(k) { return DOW[P.dow(k)] + ' ' + k.slice(8) + '/' + k.slice(5, 7); }
  function checkCell(bad) {
    if (bad === null || bad === undefined) return '<td></td>';
    if (!bad.length) return '<td class="chk-ok" title="Effectif suffisant et chef de tour présent tous les jours de cycle couverts">✓</td>';
    const txt = bad.map(function (b) { return fmtDay(b.date) + ' (' + b.role + ') : ' + b.problems.join(', '); });
    return '<td class="chk-bad" title="' + esc(txt.join('\n')) + '">⚠ ' + esc(txt[0]) + (txt.length > 1 ? ' <small>+' + (txt.length - 1) + ' jour(s)</small>' : '') + '</td>';
  }
  const REQ_NEUTRAL = ['note', 'sent']; // champs sans effet sur le planning
  function reqMonth(r) { const d = P.normalizeDate(r.from); return d ? d.slice(0, 7) : null; }
  function requestChanged(months) { // months : mois de début des demandes avant / après modification
    const ms = months.filter(Boolean).sort(); if (!ms.length) return;
    // on part du mois de début de la demande : elle peut déborder sur les mois suivants
    markStale(ms[0], 'une demande a été modifiée en ' + monthLabel(ms[0]).toLowerCase());
  }
  function nextTs() { return Math.max(Date.now(), state.requests.reduce(function (m, r) { return Math.max(m, r.ts || 0); }, 0) + 1); }
  function reqOrder() {
    return state.requests.map(function (r, i) { return i; }).sort(function (a, b) {
      const ta = state.requests[a].ts || 0, tb = state.requests[b].ts || 0;
      if (ta !== tb) return tb - ta;
      return ta ? a - b : b - a; // même lot d'import : ordre du fichier ; anciennes demandes sans date : la plus récemment saisie d'abord
    });
  }

  /* ---------- Mail de dépôt des demandes ---------- */
  function mailPanelHtml() {
    const m = ui.mail;
    if (!m.open) return '';
    const chk = function (attr, on, label) { return '<label style="flex-direction:row;align-items:center;gap:5px;color:var(--ink)"><input type="checkbox" ' + attr + (on ? ' checked' : '') + '> ' + label + '</label>'; };
    return '<div class="card" id="mail-panel"><h2 style="margin-top:0">✉ Mail de dépôt des demandes</h2>' +
      '<div class="row"><label>Du<input type="date" id="ml-from" min="' + FIRST_DAY + '" value="' + esc(m.from) + '"></label><label>Au<input type="date" id="ml-to" min="' + FIRST_DAY + '" value="' + esc(m.to) + '"></label>' +
      chk('data-ml-type="C"', m.types.C, 'Congés') + chk('data-ml-type="REC"', m.types.REC, 'Récupérations') + chk('data-ml-type="FORM"', m.types.FORM, 'Formations') + chk('data-ml-type="ABS"', m.types.ABS, 'Autres absences') +
      chk('id="ml-unsent"', m.onlyUnsent, 'Uniquement les demandes non déposées') + '</div>' +
      '<div class="row" style="margin-top:10px"><label style="flex:1;min-width:200px">Formule d\'appel<input id="ml-greet" value="' + esc(state.mail.greeting) + '"></label>' +
      '<label style="flex:2;min-width:260px">Signature<textarea id="ml-sig" rows="2">' + esc(state.mail.signature) + '</textarea></label>' +
      '<button class="btn" data-act="mail-gen">Générer le texte</button></div>' +
      '<label style="margin-top:10px">Objet<input id="ml-subject" value="' + esc(m.subject) + '"></label>' +
      '<label style="margin-top:10px">Corps du mail (modifiable)<textarea id="ml-body" rows="14">' + esc(m.body) + '</textarea></label>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-act="mail-copy">Copier le corps</button><button class="btn sec" data-act="mail-copy-subject">Copier l\'objet</button>' +
      '<button class="btn sec" data-act="mail-open">Ouvrir dans ma messagerie</button><button class="btn sec" data-act="mail-mark">Marquer ces demandes comme déposées</button></div>' +
      '<p class="muted">Seules les absences (congés, récupérations, formations, autres) sont reprises, avec le nombre de vacations de cycle concernées. Le destinataire se saisit dans votre messagerie. Formule d\'appel et signature sont mémorisées dans ce navigateur.</p></div>';
  }
  function mailRead() {
    const m = ui.mail;
    m.from = $('#ml-from').value; m.to = $('#ml-to').value; m.onlyUnsent = $('#ml-unsent').checked;
    $$('[data-ml-type]').forEach(function (c) { m.types[c.dataset.mlType] = c.checked; });
    state.mail.greeting = $('#ml-greet').value; state.mail.signature = $('#ml-sig').value; save();
  }
  function mailGen() {
    mailRead();
    const m = ui.mail;
    const res = P.buildLeaveMail(state.cfg, state.requests, {
      types: Object.keys(m.types).filter(function (t) { return m.types[t]; }), from: m.from || null, to: m.to || null,
      onlyUnsent: m.onlyUnsent, greeting: state.mail.greeting, signature: state.mail.signature
    });
    m.subject = res.subject; m.body = res.body; m.idx = res.included; renderRequests();
    toast(res.count ? res.count + ' demande(s) incluse(s).' : 'Aucune demande à inclure (vérifiez les types, la période et « non déposées »).');
  }
  function copyText(text, label) {
    const done = function () { toast(label + ' copié.'); };
    const fallback = function () {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copie impossible : sélectionnez le texte à la main.'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function mailAction(act) {
    const body = $('#ml-body').value, subject = $('#ml-subject').value;
    if (act === 'mail-copy-subject') { copyText(subject, 'Objet'); return; }
    if (!body.trim()) { toast('Générez d\'abord le texte.'); return; }
    if (act === 'mail-copy') copyText(body, 'Corps du mail');
    else if (act === 'mail-open') {
      const url = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      if (url.length > 1900) { copyText(body, 'Corps du mail'); toast('Texte trop long pour ouvrir la messagerie automatiquement : il a été copié, collez-le dans votre mail.'); }
      else window.location.href = url;
    } else if (act === 'mail-mark') {
      if (!ui.mail.idx.length) { toast('Aucune demande à marquer.'); return; }
      const today = P.toKey(new Date());
      ui.mail.idx.forEach(function (i) { if (state.requests[i]) state.requests[i].sent = today; });
      const n = ui.mail.idx.length; ui.mail.idx = []; save(); renderRequests(); toast(n + ' demande(s) marquée(s) comme déposées.');
    }
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
      if ((to || from) < FIRST_DAY) { rejected.push('ligne ' + (hi + n + 2) + ' (avant janvier 2027)'); return; }
      out.push({ agent: agent, from: from < FIRST_DAY ? FIRST_DAY : from, to: to, type: type, value: String(g(ci.value) || '').trim(), note: String(g(ci.note) || '').trim() });
    });
    return { out: out, rejected: rejected };
  }
  function importRequests(e) {
    const f = e.target.files[0]; if (!f) return;
    const done = function (rows) {
      try {
        const res = rowsToRequests(rows);
        const known = {}; ids().forEach(function (id) { known[id.toUpperCase()] = id; });
        let added = 0; const unknown = new Set(); const bts = nextTs();
        pushUndo('import de ' + res.out.length + ' demande(s)');
        res.out.forEach(function (r) {
          const k = known[r.agent.toUpperCase()];
          if (k) r.agent = k; else if (r.type !== 'RENFORT') unknown.add(r.agent);
          else if (r.type === 'RENFORT') { state.cfg.agents.push({ id: r.agent.toUpperCase(), renfort: true, reg: nextReg() }); known[r.agent.toUpperCase()] = r.agent.toUpperCase(); r.agent = r.agent.toUpperCase(); }
          r.ts = bts; state.requests.push(r); added++;
        });
        requestChanged(res.out.map(reqMonth));
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
    sortedAgents().forEach(function (a) { h += agentRow(a); });
    h += '</tbody></table></div><button class="btn sec" data-act="ag-add">+ Agent</button>' +
      '<p class="muted"><b>CDT</b> (chef de tour) : seul un CDT peut tenir J1-1, J2-1 et J3-1 ; s\'il n\'y en a aucun de disponible ce jour-là, une alerte est affichée. <b>Renfort</b> : jamais planifié, sauf les jours saisis dans l\'onglet Demandes (type « Renfort disponible »).</p></div>';
    const per = (c.cycle.optionPeriods || []).map(function (p) { return p.from + ' ' + p.to; }).join('\n');
    h += '<div class="card"><h2 style="margin-top:0">Cycle</h2><div class="row">' +
      '<label>Premier jour d\'un cycle (J1)<input type="date" id="p-anchor" min="' + FIRST_DAY + '" value="' + esc(c.cycle.anchor) + '"></label>' +
      '<label>Cycle normal<input id="p-normal" size="30" value="' + esc(c.cycle.normal.join(',')) + '"></label>' +
      '</div>' +
      '<div class="row" style="margin-top:10px"><label style="flex:1;min-width:260px">Périodes d\'option (une par ligne : début fin)<textarea id="p-periods" rows="3">' + esc(per) + '</textarea></label>' +
      '<label style="flex:1;min-width:260px">Jours fériés supplémentaires (un par ligne, AAAA-MM-JJ)<textarea id="p-hol" rows="3">' + esc((c.holidays || []).join('\n')) + '</textarea></label></div>' +
      '<p class="muted">Les jours fériés français sont calculés automatiquement ; un férié en semaine utilise la grille « dimanche / férié ». Le cycle (6 jours) est déroulé à partir de la date d\'ancrage et ne change jamais de longueur : en période d\'option, le dernier jour OFF juste avant chaque J1 devient J0.</p></div>';
    h += '<div class="card"><h2 style="margin-top:0">Règles et pondérations</h2><div class="row">' +
      '<label>Effectif minimum<input type="number" id="p-min" min="1" value="' + c.minStaff + '"></label>' +
      '<label>Postes de nuit effective (J3)<input type="number" id="p-nights" min="0" value="' + c.nightCount + '"></label>' +
      '<label>Horaire du J0<input id="p-j0" value="' + esc(c.j0Range) + '"></label>' +
      '<label>J2 « tôt » : début au plus tard à<input id="p-j2early" size="6" value="' + esc(c.j2EarlyMax || '10:00') + '"></label>' +
      '<label>Crédit d\'absence pour l\'équité (0 à 1)<input type="number" id="p-abscredit" step="0.1" min="0" max="1" style="width:90px" value="' + (c.absenceCredit === undefined ? 1 : c.absenceCredit) + '"></label>' +
      '<label>Nuits max. par agent et par mois<input type="number" id="p-maxnights" min="1" style="width:90px" value="' + P.caps(c).nights + '"></label>' +
      '<label>N1 max. par agent et par mois<input type="number" id="p-maxn1" min="1" style="width:90px" value="' + P.caps(c).n1 + '"></label></div><div class="row" style="margin-top:10px">' +
      [['hours', 'Heures (par h)'], ['night', 'Nuit'], ['evening', 'Soirée J3'], ['late', 'J2 tardif'], ['early', 'Début tôt'], ['nightWE', 'Nuit WE/férié'], ['n1', 'N1 🌙 (par écart)'], ['meal', 'Repas 🍽️ (par écart)'], ['n1Extra', '2e N1 du mois (exceptionnelle)'], ['j2tot', 'J2 tôt avant une nuit'], ['pref', 'Souhait / évitement']].map(function (x) {
        return '<label>' + x[1] + '<input type="number" step="any" min="0" data-w="' + x[0] + '" value="' + w[x[0]] + '" style="width:90px"></label>';
      }).join('') +
      '</div><p class="muted">Crédit d\'absence : à 1, un jour d\'absence (congé, récup…) compte comme un jour de présence pour l\'équité des nuits, N1, repas, soirées, etc. : un agent absent rattrape ensuite son retard ; à 0, seule la présence compte. Les heures ne sont pas concernées. Plus le poids est élevé, plus l\'algorithme évite de charger un agent déjà au-dessus du taux d\'équipe sur ce critère. Le poids « souhait » doit rester élevé pour que les demandes soient prioritaires sur l\'équité.</p>' +
      '<p class="muted">Rythme de rattrapage : l\'équité se fait sur l\'année entière, pas en un mois. Un agent en retard (congés, absence) rattrape au plus jusqu\'au plafond de nuits du mois, et une seule N1 par mois ; une 2e N1 n\'est donnée qu\'exceptionnellement (son poids la rend coûteuse), jamais au-delà du plafond. Un dépassement inévitable (effectif insuffisant) est signalé en alerte.</p>' +
      '<p class="muted">Les compteurs ne sont jamais remis à zéro au 1er janvier : un retard de fin d\'année (congés en novembre-décembre) se rattrape au début de l\'année suivante, au même rythme plafonné.</p></div>';
    h += '<div class="card"><h2 style="margin-top:0">Tableaux horaires (JSON)</h2><textarea id="p-tables" rows="14">' + esc(JSON.stringify(c.tables, null, 1)) + '</textarea>' +
      '<p class="muted">Par type de jour (weekday, saturday, sunday) et par vacation (J1, J2, J3), la liste des horaires attribués dans l\'ordre du rang (rang 1 = J1-1, etc.). Valeurs par défaut : grille « NORMALE AVEC TDS OPTION 1 ».</p></div>';
    h += '<button class="btn" data-act="params-save">Enregistrer les paramètres</button>';
    $('#tab-params').innerHTML = h;
  }
  function agentRow(a) {
    const ini = state.initial[a.id] || {};
    return '<tr data-reg="' + (a.reg !== undefined ? a.reg : agentReg(a)) + '"><td><input data-k="id" value="' + esc(a.id) + '" size="6"></td><td><input type="checkbox" data-k="renfort"' + (a.renfort ? ' checked' : '') + '></td><td><input type="checkbox" data-k="cdt"' + (a.cdt ? ' checked' : '') + '></td>' +
      COUNTER_FIELDS.map(function (f) { return '<td><input type="number" step="any" data-c="' + f[0] + '" value="' + (ini[f[0]] || 0) + '" style="width:70px"></td>'; }).join('') +
      '<td><input type="number" data-c="days" value="' + (ini.days || 0) + '" style="width:70px"></td><td><button class="x" data-act="ag-del">✕</button></td></tr>';
  }
  function saveParams() {
    try {
      const c = state.cfg, old = ids(), sig0 = JSON.stringify([state.cfg, state.initial]), snap = JSON.stringify(state);
      const agents = [], initial = {}, seen = new Set();
      $$('#ag-table tbody tr').forEach(function (tr) {
        const id = $('[data-k=id]', tr).value.trim().toUpperCase();
        if (!id) return;
        if (seen.has(id)) throw new Error('Agent en double : ' + id);
        seen.add(id);
        agents.push({ id: id, renfort: $('[data-k=renfort]', tr).checked, cdt: $('[data-k=cdt]', tr).checked, reg: +tr.dataset.reg || 0 });
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
      if (anchor < FIRST_DAY) throw new Error('le planning commence le 1er janvier 2027 : la date d\'ancrage ne peut pas être antérieure.');
      const periods = $('#p-periods').value.split('\n').map(function (l) {
        const d = (l.match(/\d{4}-\d{2}-\d{2}/g) || []); return d.length >= 2 ? { from: d[0], to: d[1] } : null;
      }).filter(Boolean);
      if (periods.some(function (p) { return p.to < FIRST_DAY; })) throw new Error('période d\'option antérieure à janvier 2027.');
      periods.forEach(function (p) { if (p.from < FIRST_DAY) p.from = FIRST_DAY; });
      const hol = ($('#p-hol').value.match(/\d{4}-\d{2}-\d{2}/g) || []).filter(function (k) { return k >= FIRST_DAY; });
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
      Object.assign(c, { agents: agents, tables: tables, holidays: hol, minStaff: +$('#p-min').value || 1, nightCount: +$('#p-nights').value || 0, j0Range: $('#p-j0').value.trim(), j2EarlyMax: j2e, absenceCredit: Math.min(1, Math.max(0, parseFloat($('#p-abscredit').value) || 0)), maxNightsMonth: Math.max(1, +$('#p-maxnights').value || 3), maxN1Month: Math.max(1, +$('#p-maxn1').value || 2), weights: weights });
      c.cycle = { anchor: anchor, normal: normal, optionPeriods: periods };
      state.initial = initial;
      const renamed = old.filter(function (id) { return !seen.has(id); });
      if (JSON.stringify([state.cfg, state.initial]) !== sig0) {
        undoStack.push({ label: 'modification des paramètres', data: snap }); if (undoStack.length > UNDO_MAX) undoStack.shift(); paintUndo();
        if (sortedMonths().length) markStale(sortedMonths()[0], 'les paramètres ont été modifiés');
      }
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
      '<p class="muted">Le fichier contient paramètres, demandes et plannings générés : il est nominatif, ne le publiez pas dans un dépôt public. Mois générés : ' + (sortedMonths().join(', ') || 'aucun') + '.</p>' +
      '<p>Dernière sauvegarde exportée : <b>' + (state.lastBackup ? new Date(state.lastBackup).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : 'jamais') + '</b>. Un bandeau la rappelle après chaque génération ou échange, et au bout de ' + BACKUP_DAYS + ' jours sans export.</p></div>' +
      '<div class="card"><h2 style="margin-top:0">Réinitialisation</h2><button class="btn danger" data-act="reset">Tout effacer</button></div>';
    $('#json-file').onchange = function (e) {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try {
          const s = JSON.parse(rd.result);
          if (!s.cfg || !s.cfg.cycle || !s.cfg.agents) throw new Error('fichier non reconnu');
          pushUndo('restauration d\'une sauvegarde');
          state = Object.assign(defaultState(), s); dropBefore2027(); save(); ui.month = startMonth(); toast('Sauvegarde restaurée.'); render();
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
      case 'month-prev': if (ui.month > FIRST_MONTH) { ui.month = shiftMonth(ui.month, -1); renderPlanning(); } break;
      case 'month-next': ui.month = shiftMonth(ui.month, 1); renderPlanning(); break;
      case 'freeze-until': { const u = $('#fr-until').value; if (!u) { toast('Choisissez une date.'); break; } toast(setFrozen(function (d) { return d.date <= u; }, true) + ' journée(s) figée(s) jusqu\'au ' + u + '.'); break; }
      case 'freeze-all': toast(setFrozen(function () { return true; }, true) + ' journée(s) figée(s).'); break;
      case 'unfreeze-all': toast(setFrozen(function () { return true; }, false) + ' journée(s) dégelée(s).'); break;
      case 'export-csv': exportCsv(); break;
      case 'export-xlsx': exportXlsx(); break;
      case 'print-pdf': printPlanning(); break;
      case 'swap': doSwap(false); break;
      case 'unlock': doSwap(true); break;
      case 'req-add': pushUndo('ajout d\'une demande'); state.requests.push({ agent: ids()[0] || '', from: ui.month + '-01', to: ui.month + '-01', type: 'C', value: '', note: '', ts: nextTs(), sent: '' }); requestChanged([ui.month]); save(); renderRequests(); break;
      case 'req-del': pushUndo('suppression d\'une demande de ' + (state.requests[+t.dataset.i] || {}).agent); requestChanged([reqMonth(state.requests[+t.dataset.i])]); state.requests.splice(+t.dataset.i, 1); save(); renderRequests(); break;
      case 'req-clear': if (confirm('Supprimer toutes les demandes ?')) { pushUndo('suppression de toutes les demandes'); requestChanged(state.requests.map(reqMonth)); state.requests = []; save(); renderRequests(); } break;
      case 'regen-stale': regenStale(); break;
      case 'undo': undo(); break;
      case 'sw-pick': $('#sw-b').value = t.dataset.b; $$('.sw-pick').forEach(function (x) { x.classList.toggle('on', x === t); }); break;
      case 'clear-month': clearMonth(); break;
      case 'agent-print': printAgent(); break;
      case 'agent-ics': exportIcs(false); break;
      case 'agent-ics-all': exportIcs(true); break;
      case 'req-template': requestTemplate(); break;
      case 'mail-toggle': ui.mail.open = !ui.mail.open; renderRequests(); break;
      case 'mail-gen': mailGen(); break;
      case 'mail-copy': case 'mail-copy-subject': case 'mail-open': case 'mail-mark': mailAction(t.dataset.act); break;
      case 'ag-add': $('#ag-table tbody').insertAdjacentHTML('beforeend', agentRow({ id: '', renfort: false, reg: nextReg() })); break;
      case 'ag-del': t.closest('tr').remove(); break;
      case 'params-save': saveParams(); break;
      case 'json-export': exportBackup(); break;
      case 'reset': if (confirm('Effacer paramètres, demandes et plannings ?')) { pushUndo('réinitialisation complète'); state = defaultState(); save(); ui.month = startMonth(); render(); toast('Données réinitialisées.'); } break;
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'ml-body') ui.mail.body = e.target.value;
    else if (e.target.id === 'ml-subject') ui.mail.subject = e.target.value;
  });
  document.addEventListener('change', function (e) {
    const t = e.target.closest && e.target.closest('input[data-freeze]'); if (!t) return;
    const d = state.months[ui.month].days.find(function (x) { return x.date === t.dataset.freeze; });
    pushUndo((t.checked ? 'gel du ' : 'dégel du ') + fmtDay(d.date));
    d.frozen = t.checked; save(); keepScroll(renderPlanning);
  });

  /* ---------- Thème clair / sombre ---------- */
  function currentTheme() {
    const a = document.documentElement.getAttribute('data-theme');
    if (a) return a;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintThemeBtn() { $('#theme-btn').textContent = currentTheme() === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre'; }
  $('#theme-btn').addEventListener('click', function () {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tds-theme', next); } catch (e) { /* ignore */ }
    paintThemeBtn();
  });
  paintThemeBtn();

  // Mois antérieurs à janvier 2027 (anciennes données) : retirés, récupérables avec ↶ Annuler tant que la page est ouverte.
  function dropBefore2027() {
    const old = Object.keys(state.months).filter(function (m) { return m < FIRST_MONTH; });
    if (!old.length) return 0;
    pushUndo('retrait des mois antérieurs à janvier 2027');
    old.forEach(function (m) { delete state.months[m]; });
    if (state.cfg.cycle.anchor < FIRST_DAY) state.cfg.cycle.anchor = FIRST_DAY;
    return old.length;
  }
  const dropped = dropBefore2027();
  if (dropped) { save(); ui.month = startMonth(); }
  render();
  if (dropped) toast(dropped + ' mois antérieur(s) à janvier 2027 retiré(s) : le planning commence en janvier 2027 (↶ Annuler pour les récupérer).');
  if (migrated) { save(); toast('Pondération « Nuit » passée de 4 à 8 (nouveau réglage par défaut, rattrapage des nuits sur l\'année). Modifiable dans Paramètres.'); }
})();
