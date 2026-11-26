const P = require('../planner.js');
const assert = require('assert');

const cfg = {
  agents: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map(id => ({ id, renfort: false, cdt: id === 'A1' || id === 'A4' }))
    .concat([{ id: 'R1', renfort: true, cdt: false }]),
  tables: P.DEFAULT_TABLES,
  cycle: { anchor: '2027-01-01', normal: ['J1', 'J2', 'J3', 'OFF', 'OFF', 'OFF'], optionPeriods: [{ from: '2027-06-01', to: '2027-09-30' }] },
  holidays: [], minStaff: 4, nightCount: 3, j0Range: '10:00-18:30', j2EarlyMax: '10:00', weights: {}
};

// ---- cycle : longueur inchangée, J0 sur le dernier OFF avant le J1 en période d'option
const R = P.buildRoles(cfg.cycle, '2027-01-01', '2027-12-31');
Object.keys(R).sort().forEach((k, i) => {
  if (k > '2027-12-31') return;
  const base = ['J1', 'J2', 'J3', 'OFF', 'OFF', 'OFF'][i % 6];
  const exp = (base === 'OFF' && i % 6 === 5 && k >= '2027-06-01' && k <= '2027-09-30') ? 'J0' : base;
  assert.strictEqual(R[k], exp, k);
});

// ---- demandes pseudo-aléatoires
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const requests = [];
for (let i = 0; i < 40; i++) {
  const a = 'A' + (1 + Math.floor(rnd() * 7));
  const d = P.addDays('2027-01-01', Math.floor(rnd() * 360));
  requests.push({ agent: a, from: d, to: P.addDays(d, Math.floor(rnd() * 6)), type: 'C' });
}
requests.push({ agent: 'R1', from: '2027-01-02', to: '2027-01-02', type: 'RENFORT' }, { agent: 'R1', from: '2027-03-10', to: '2027-03-12', type: 'RENFORT' },
  { agent: 'A2', from: '2027-02-01', to: '2027-02-28', type: 'CDT' },
  { agent: 'A5', from: '2027-06-05', to: '2027-06-05', type: 'VEUT', value: 'j0' }, { agent: 'A1', from: '2027-06-11', to: '2027-06-11', type: 'EVITE', value: 'j0' },
  { agent: 'A3', from: '2027-01-05', to: '2027-01-05', type: 'EVITE', value: 'nuit' });

// ---- génération de l'année
const hist = (all, m) => all.filter(d => d.date >= P.addDays(P.monthRange(m)[0], -8));
let all = []; const bases = {};
for (let m = 1; m <= 12; m++) {
  const month = '2027-' + String(m).padStart(2, '0');
  const base = P.computeCounters(all, cfg, {}); bases[month] = base;
  const res = P.generateMonth(cfg, requests, base, month, null, hist(all, month));
  res.days.forEach(d => {
    if (d.role === 'OFF') return;
    if (d.role === 'J0') { assert.strictEqual(Object.keys(d.assign).length, 1); return; }
    const reg = Object.keys(d.absent).filter(i => i !== 'R1').length;
    assert.strictEqual(Object.keys(d.assign).length, 7 - reg + (d.assign.R1 ? 1 : 0), d.date);
    Object.values(d.assign).map(a => a.rank).sort((a, b) => a - b).forEach((r, i) => assert.strictEqual(r, i + 1));
    if (d.assign.R1) assert(['2027-01-02', '2027-03-10', '2027-03-11', '2027-03-12'].includes(d.date), 'renfort hors demande ' + d.date);
  });
  all = all.concat(res.days);
}
const byDate = Object.fromEntries(all.map(d => [d.date, d]));

// ---- chef de tour : rang 1 toujours CDT quand un CDT est présent
let noCdt = 0;
all.forEach(d => {
  if (d.role === 'OFF' || d.role === 'J0' || !Object.keys(d.assign).length) return;
  const ids = Object.keys(d.assign), r1 = ids.find(i => d.assign[i].rank === 1);
  if (ids.some(i => d.cdt[i])) assert(d.cdt[r1], 'rang 1 non CDT ' + d.date);
  else { noCdt++; assert(d.warnings.some(w => w.startsWith('CDT : ')), 'alerte CDT ' + d.date); }
});

// ---- N1 / repas : un seul de chaque, deux agents différents, parmi les agents de nuit
let nights = 0;
all.filter(d => d.role === 'J3' && Object.keys(d.assign).length).forEach(d => {
  const ids = Object.keys(d.assign), night = ids.filter(i => d.assign[i].rank <= cfg.nightCount);
  const n1 = ids.filter(i => d.assign[i].n1), meal = ids.filter(i => d.assign[i].meal);
  assert.strictEqual(n1.length, 1, 'N1 ' + d.date); assert.strictEqual(meal.length, night.length >= 2 ? 1 : 0, 'repas ' + d.date);
  assert(night.includes(n1[0])); if (meal.length) { assert(night.includes(meal[0])); assert.notStrictEqual(n1[0], meal[0]); }
  nights++;
});

// ---- horaire du J0 : 10h00-18h30 du lundi au samedi, 10h00-18h00 le dimanche / férié
{
  const j0s = all.filter(d => d.role === 'J0' && Object.keys(d.assign).length);
  j0s.forEach(d => { const a = Object.values(d.assign)[0]; assert.strictEqual(a.range, d.dayType === 'sunday' ? '10:00-18:00' : '10:00-18:30', 'horaire J0 ' + d.date); });
  assert(j0s.some(d => d.dayType === 'sunday') && j0s.some(d => d.dayType !== 'sunday'), 'J0 en semaine et le dimanche dans l\'année simulée');
  console.log('J0 : ' + j0s.filter(d => d.dayType === 'sunday').length + ' dimanche(s) / férié(s) en 10h00-18h00, ' + j0s.filter(d => d.dayType !== 'sunday').length + ' autres en 10h00-18h30');
}

// ---- J0 jamais attribué à l'agent N1 du J3 du même cycle (sauf alerte)
let j0n = 0;
all.filter(d => d.role === 'J0').forEach(d => {
  const j3 = byDate[P.addDays(d.date, -3)], who = Object.keys(d.assign)[0];
  if (j3 && j3.assign[who] && j3.assign[who].n1) assert(d.warnings.some(w => /N1/.test(w)), 'J0 après N1 sans alerte ' + d.date);
  else j0n++;
});

// ---- pas de J0 la veille d'un congé ou d'une récup (règle souple : sinon alerte)
let j0Leave = 0, j0LeaveOk = 0;
all.filter(d => d.role === 'J0' && Object.keys(d.assign).length).forEach(d => {
  const who = Object.keys(d.assign)[0], nd = byDate[P.addDays(d.date, 1)];
  if (nd && nd.absentType && ['CF', 'CYC', 'RS', 'RMT', 'RPT', 'REC'].includes(nd.absentType[who])) { j0Leave++; assert(d.warnings.some(w => /la veille/.test(w)), 'J0 la veille d\'un congé sans alerte ' + d.date); }
  else j0LeaveOk++;
});
{
  // cycle 2027-06-06 → 2027-06-11 : J0 le 11/06, J1 le 12/06 ; FAV (le moins de J0, hors N1 du 08/06) est en tête pour le J0
  const AG = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
  const at = (days, k) => days.find(d => d.date === k);
  const n1Of = days => { const d = at(days, '2027-06-08'); return Object.keys(d.assign).find(i => d.assign[i].n1); };
  const j0Of = days => Object.keys(at(days, '2027-06-11').assign)[0];
  const base0 = {}; AG.forEach(a => { base0[a] = { j0: 5 }; });
  const n1Agent = n1Of(P.generateMonth(cfg, [], base0, '2027-06', null, []).days);
  const FAV = AG.find(a => a !== n1Agent);
  const base = {}; AG.forEach(a => { base[a] = { j0: a === FAV ? 0 : 5 }; });
  const gen = (rq, prev) => P.generateMonth(cfg, rq, base, '2027-06', prev || null, []).days;
  const free = gen([]);
  assert.strictEqual(n1Of(free), n1Agent, 'N1 indépendante du compteur de J0'); assert.strictEqual(j0Of(free), FAV, FAV + ' attendu au J0 sans contrainte');
  // récup RS le lendemain : FAV ne fait pas le J0, sans alerte
  let days = gen([{ agent: FAV, from: '2027-06-12', to: '2027-06-12', type: 'RS' }]), j0 = at(days, '2027-06-11');
  assert.notStrictEqual(j0Of(days), FAV, 'pas de J0 la veille d\'une récup'); assert.notStrictEqual(j0Of(days), n1Of(days)); assert(!j0.warnings.some(w => /la veille/.test(w)));
  // souhait J0 de l'agent : il le garde malgré sa récup du lendemain
  days = gen([{ agent: FAV, from: '2027-06-12', to: '2027-06-12', type: 'RS' }, { agent: FAV, from: '2027-06-11', to: '2027-06-11', type: 'VEUT', value: 'j0' }]);
  assert.strictEqual(j0Of(days), FAV, 'souhait J0 respecté malgré la récup du lendemain'); assert(!at(days, '2027-06-11').warnings.some(w => /la veille/.test(w)));
  // tous en congé le lendemain sauf l'agent de la N1 : la règle N1 passe d'abord, alerte « la veille »
  days = gen(AG.filter(a => a !== n1Agent).map(a => ({ agent: a, from: '2027-06-12', to: '2027-06-12', type: 'CF' })));
  j0 = at(days, '2027-06-11');
  assert.strictEqual(n1Of(days), n1Agent); assert.notStrictEqual(j0Of(days), n1Agent, 'la règle N1 prime'); assert(j0.warnings.some(w => /la veille/.test(w)), 'alerte J0 la veille d\'un congé');
  // J0 figé puis congé posé après coup pour le lendemain : J0 conservé, alerte
  const frozen = {}; free.forEach(d => { frozen[d.date] = Object.assign({}, d, { frozen: true }); });
  const j0Who = Object.keys(at(free, '2027-06-11').assign)[0];
  days = gen([{ agent: j0Who, from: '2027-06-12', to: '2027-06-12', type: 'CF' }], frozen);
  j0 = at(days, '2027-06-11');
  assert(j0.assign[j0Who], 'J0 figé conservé'); assert(j0.warnings.some(w => /J0 figé .* la veille/.test(w)), 'alerte J0 figé la veille d\'un congé');
  console.log('J0 et congés : OK (pas de J0 la veille d\'un congé ou d\'une récup, sauf souhait ; règle N1 prioritaire ; ' + j0Leave + ' exception(s) avec alerte sur ' + (j0Leave + j0LeaveOk) + ' J0 dans l\'année)');
}

// ---- J2 tôt la veille d'une nuit
let nightAg = 0, withEarly = 0, planned = 0, planOk = 0;
all.filter(d => d.role === 'J3').forEach(d => {
  const pd = byDate[P.addDays(d.date, -1)]; if (!pd || pd.role !== 'J2') return;
  const night = Object.keys(d.assign).filter(i => d.assign[i].rank <= cfg.nightCount);
  night.forEach(i => { nightAg++; if (pd.assign[i] && P.slotMetrics && (() => { const a = pd.assign[i]; return a.kind === 'J2' && P.parseRange(a.range).start <= 600; })()) withEarly++; });
  if (pd.nextNight) { planned++; if (night.slice().sort().join() === pd.nextNight.slice().sort().join()) planOk++; }
});

// ---- échange : seuls les 2 agents sont verrouillés, conservés à la régénération
{
  const month = '2027-02', base = bases[month], monthDays = all.filter(d => d.date.startsWith(month));
  const d = monthDays.find(x => x.role === 'J1' && Object.keys(x.assign).length >= 4);
  const copy = JSON.parse(JSON.stringify(d));
  const [x, y] = Object.keys(copy.assign).slice(0, 2);
  P.swapAgents(copy, x, y);
  assert.deepStrictEqual(Object.keys(copy.lockedAgents).sort(), [x, y].sort());
  const prev = Object.fromEntries(monthDays.map(z => [z.date, z.date === d.date ? copy : z]));
  const res = P.generateMonth(cfg, requests, base, month, prev, hist(all.filter(z => z.date < month + '-01'), month));
  const nd = res.days.find(z => z.date === d.date);
  assert.strictEqual(nd.assign[x].slot, copy.assign[x].slot); assert.strictEqual(nd.assign[y].slot, copy.assign[y].slot);
  assert.deepStrictEqual(Object.keys(nd.lockedAgents).sort(), [x, y].sort());
  Object.values(nd.assign).map(a => a.rank).sort((a, b) => a - b).forEach((r, i) => assert.strictEqual(r, i + 1));
  // N1/repas : l'échange déplace la vacation complète
  const j3 = JSON.parse(JSON.stringify(monthDays.find(z => z.role === 'J3' && Object.keys(z.assign).length >= 4)));
  const n1 = Object.keys(j3.assign).find(i => j3.assign[i].n1), plain = Object.keys(j3.assign).find(i => j3.assign[i].rank > cfg.nightCount);
  P.swapAgents(j3, n1, plain); assert(j3.assign[plain].n1 && !j3.assign[n1].n1);
  console.log('échange : OK (verrou limité à', x, 'et', y + ')');
}

// ---- journées figées : conservées à l'identique à la régénération, le reste est recalculé
{
  const month = '2027-02', base = bases[month], monthDays = all.filter(d => d.date.startsWith(month));
  const copy = JSON.parse(JSON.stringify(monthDays));
  const frozenDates = copy.filter(d => d.date <= '2027-02-14' && d.role !== 'OFF').map(d => { d.frozen = true; return d.date; });
  const prev = Object.fromEntries(copy.map(z => [z.date, z]));
  // des demandes changent après coup : un congé sur une journée figée et un sur une journée libre
  const rq2 = requests.concat([{ agent: 'A6', from: '2027-02-09', to: '2027-02-09', type: 'C' }, { agent: 'A5', from: '2027-02-20', to: '2027-02-27', type: 'C' }]);
  const res = P.generateMonth(cfg, rq2, base, month, prev, hist(all.filter(z => z.date < month + '-01'), month));
  const sig = d => JSON.stringify(Object.keys(d.assign).sort().map(i => [i, d.assign[i].slot, !!d.assign[i].n1, !!d.assign[i].meal]));
  frozenDates.forEach(k => {
    const a = prev[k], b = res.days.find(z => z.date === k);
    assert.strictEqual(sig(b), sig(a), 'journée figée modifiée ' + k); assert(b.frozen);
  });
  const dead = res.days.find(z => z.date === '2027-02-09');
  if (dead.role !== 'OFF') assert(dead.warnings.some(w => /figée/.test(w) && /A6/.test(w)), 'alerte agent indisponible sur journée figée');
  const free = res.days.filter(z => z.date > '2027-02-14' && z.role !== 'OFF');
  free.forEach(z => { assert(!z.frozen); if (z.assign.A5 && z.date >= '2027-02-20' && z.date <= '2027-02-27') assert.fail('congé ignoré ' + z.date); });
  console.log('figées :', frozenDates.length, 'journées conservées à l\'identique ; reste recalculé (', free.length, 'journées )');
}

// ---- demande posée après coup : seules les journées concernées sont recalculées (mois figé ou non)
{
  const month = '2027-03', base = bases[month], h = hist(all.filter(z => z.date < month + '-01'), month);
  const sig = d => JSON.stringify(Object.keys(d.assign).sort().map(i => [i, d.assign[i].slot, d.assign[i].range, !!d.assign[i].n1, !!d.assign[i].meal]));
  [true, false].forEach(frozen => {
    const days = JSON.parse(JSON.stringify(all.filter(d => d.date.startsWith(month))));
    days.forEach(d => { if (d.role !== 'OFF') d.frozen = frozen; else delete d.frozen; });
    // rien n'a changé : aucune journée à recalculer
    assert.strictEqual(P.updateDays(cfg, requests, base, month, days, h).result, null);
    // congé posé après coup sur un J1 où l'agent travaille
    const d = days.find(x => x.role === 'J1' && x.assign.A3 && Object.keys(x.assign).length >= 5);
    const r = P.updateDays(cfg, requests.concat([{ agent: 'A3', from: d.date, to: d.date, type: 'CF' }]), base, month, days, h);
    assert.deepStrictEqual(r.dates, [d.date]);
    r.result.days.forEach(nd => {
      const od = days.find(x => x.date === nd.date);
      assert.strictEqual(!!nd.frozen, !!od.frozen, 'état figé ' + nd.date);
      if (nd.date !== d.date) assert.strictEqual(sig(nd), sig(od), 'journée non concernée modifiée ' + nd.date);
    });
    const nd = r.result.days.find(x => x.date === d.date);
    assert(!nd.assign.A3 && nd.absent.A3 === 'CF');
    assert.strictEqual(Object.keys(nd.assign).length, Object.keys(d.assign).length - 1);
    const ch = r.changes[0];
    assert(ch.items.some(it => it.id === 'A3' && it.before.slot && it.after.absent === 'CF'));
    ch.items.forEach(it => { if (it.id !== 'A3') assert(it.before && it.after && it.after.slot, 'changement listé ' + it.id); });
    // congé retiré après coup : l'agent retrouve une vacation ce jour-là seulement
    const back = P.updateDays(cfg, requests, base, month, r.result.days.map(x => Object.assign({}, x, { frozen: frozen && x.role !== 'OFF' })), h);
    assert.deepStrictEqual(back.dates, [d.date]);
    assert(back.result.days.find(x => x.date === d.date).assign.A3);
  });
  console.log('demande après coup : OK (seule la journée posée est recalculée, changements de vacation listés)');
}

// ---- rattrapage après absence : une agente absente tout janvier revient à parité sur les nuits
{
  const ids = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'];
  const c2 = { ...cfg, agents: ids.map(id => ({ id, renfort: false, cdt: id === 'B3' || id === 'B1' })) };
  const rq = [{ agent: 'B4', from: '2027-01-01', to: '2027-01-31', type: 'C' }];
  const run = credit => {
    const conf = { ...c2, absenceCredit: credit }; let d = [];
    for (let m = 1; m <= 4; m++) { const mo = '2027-0' + m; d = d.concat(P.generateMonth(conf, rq, P.computeCounters(d, conf, {}), mo, null, d.filter(z => z.date >= P.addDays(P.monthRange(mo)[0], -8))).days); }
    return P.computeCounters(d, conf, {});
  };
  const withCredit = run(1), without = run(0);
  const others = ids.filter(i => i !== 'B4' && i !== 'B3' && i !== 'B1');
  const avg = r => others.reduce((s, i) => s + r[i].nights, 0) / others.length;
  console.log('rattrapage (4 mois, B4 absente en janvier) — B4:', withCredit.B4.nights, 'avec crédit |', without.B4.nights, 'sans | autres non-CDT en moyenne:', avg(withCredit).toFixed(1));
  assert(withCredit.B4.nights >= avg(withCredit) - 1, 'B4 doit rattraper ses nuits');
  assert(withCredit.B4.nights > without.B4.nights, 'le crédit d\'absence doit aider le rattrapage');
}

// ---- rythme de rattrapage : au plus 3 nuits et 2 N1 par agent et par mois, la 2e N1 reste exceptionnelle
{
  const ids = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'];
  const c3 = { ...cfg, agents: ids.map((id, i) => ({ id, renfort: false, cdt: i < 3 })) };
  const rq = [{ agent: 'B4', from: '2027-01-04', to: '2027-02-21', type: 'C' }, { agent: 'B5', from: '2027-10-04', to: '2027-11-14', type: 'C' }];
  let d = [], over = 0, twoN1 = 0, natMonths = [];
  for (let m = 1; m <= 12; m++) {
    const mo = '2027-' + String(m).padStart(2, '0');
    const res = P.generateMonth(c3, rq, P.computeCounters(d, c3, {}), mo, null, d.filter(z => z.date >= P.addDays(P.monthRange(mo)[0], -8)));
    const mc = P.computeCounters(res.days, c3, {});
    ids.forEach(i => { if (mc[i].nights > 3 || mc[i].n1 > 2) over++; if (mc[i].n1 === 2) twoN1++; });
    natMonths.push(mc.B4.nights);
    d = d.concat(res.days);
  }
  const fc = P.computeCounters(d, c3, {});
  const rate = ids.reduce((s, i) => s + fc[i].nights, 0) / ids.reduce((s, i) => s + P.effDays(fc[i], c3, 'nights'), 0);
  const natDev = fc.B4.nights - rate * P.effDays(fc.B4, c3, 'nights');
  console.log('rythme : B4 (congés janv.-févr.) nuits par mois', natMonths.join(' '), '| écart fin d\'année', natDev.toFixed(1), '| mois à 2 N1 :', twoN1);
  assert.strictEqual(over, 0, 'plafond mensuel de nuits / N1 dépassé');
  assert(twoN1 <= 2, '2e N1 du mois trop fréquente');
  assert(Math.max(...natMonths) <= 3);
  assert(natDev > -2, 'B4 doit avoir rattrapé l\'essentiel de ses nuits sur l\'année');
}

// ---- grilles horaires : période creuse hors période d'option (juin-septembre ici), grille d'option pendant
{
  let creuse = 0, option = 0;
  all.forEach(d => {
    if (d.role !== 'J1' && d.role !== 'J2' && d.role !== 'J3') return;
    const inOpt = d.date >= '2027-06-01' && d.date <= '2027-09-30';
    const grid = inOpt ? P.DEFAULT_TABLES : P.DEFAULT_TABLES_CREUSE;
    assert.strictEqual(d.period, inOpt ? 'option' : 'creuse', 'période ' + d.date);
    Object.values(d.assign).forEach(a => assert.strictEqual(a.range, grid[d.dayType][a.kind][a.rank - 1], 'horaire ' + d.date + ' ' + a.slot));
    if (inOpt) option++; else creuse++;
  });
  assert(creuse > 0 && option > 0);
  assert.strictEqual(P.periodOf(cfg, '2027-05-31'), 'creuse'); assert.strictEqual(P.periodOf(cfg, '2027-06-01'), 'option');
  console.log('grilles : ' + creuse + ' jours en période creuse, ' + option + ' en période d\'option, horaires conformes');
}

// ---- saisonnalité 2027 (note de service) : périodes d'option par défaut
{
  const c27 = { ...cfg, cycle: { ...cfg.cycle, optionPeriods: P.DEFAULT_OPTION_PERIODS } };
  [['2027-01-12', 'creuse'], ['2027-01-13', 'option'], ['2027-07-23', 'option'], ['2027-07-24', 'creuse'], ['2027-08-31', 'creuse'],
   ['2027-09-01', 'option'], ['2027-12-17', 'option'], ['2027-12-18', 'creuse']].forEach(([k, p]) => assert.strictEqual(P.periodOf(c27, k), p, k));
  // les périodes d'option font 16 et 9 cycles de 12 jours
  assert.strictEqual(P.daysBetween('2027-01-13', '2027-07-23') + 1, 16 * 12);
  assert.strictEqual(P.daysBetween('2027-09-01', '2027-12-17') + 1, 9 * 12);
  console.log('saisonnalité 2027 : OK');
}

// ---- contrôle d'effectif des demandes (avant génération)
{
  const rq = [
    { agent: 'A1', from: '2027-01-01', to: '2027-01-01', type: 'C' }, { agent: 'A4', from: '2027-01-01', to: '2027-01-01', type: 'C' }, // les 2 CDT absents le 1er
    { agent: 'A2', from: '2027-01-02', to: '2027-01-02', type: 'C' }, { agent: 'A3', from: '2027-01-02', to: '2027-01-02', type: 'REC' },
    { agent: 'A5', from: '2027-01-02', to: '2027-01-02', type: 'FORM' }, { agent: 'A6', from: '2027-01-02', to: '2027-01-02', type: 'C' }
  ];
  const chk = P.staffingCheck(cfg, rq, '2027-01-01', '2027-01-06');
  assert.deepStrictEqual(Object.keys(chk), ['2027-01-01', '2027-01-02', '2027-01-03'], 'seuls les jours de cycle sont contrôlés');
  assert(chk['2027-01-01'].problems.includes('aucun chef de tour'));
  assert.strictEqual(chk['2027-01-02'].avail.length, 3, '7 agents - 4 absents, renfort non compté sans demande RENFORT');
  assert(chk['2027-01-02'].problems.some(x => x.startsWith('3 agent(s) pour 4 minimum')));
  assert(chk['2027-01-02'].problems.some(x => /quota d'absences dépassé : 4/.test(x)), 'la formation compte désormais sur le quota');
  assert.deepStrictEqual(chk['2027-01-03'].problems, []);
  console.log('contrôle des demandes : OK');
}

// ---- quotas d'absences (alpha / bêta) et besoin de couverture (BC), note de service page 9
{
  // cardinal 7 (A1..A7, le renfort ne compte pas) ; 2027-01-08 = vendredi, J2, période creuse → alpha 3
  assert.strictEqual(P.cardinalOf(cfg), 7);
  const q = P.quotaFor(cfg, '2027-01-08', 'J2', 'weekday');
  assert.deepStrictEqual([q.alpha, q.beta, q.cardinal], [3, 0, 7]);
  const abs = (ids, type) => ids.map(a => ({ agent: a, from: '2027-01-08', to: '2027-01-08', type }));
  const c3 = P.staffingCheck(cfg, abs(['A2', 'A3', 'A5'], 'CF'), '2027-01-08', '2027-01-08')['2027-01-08'];
  assert(!c3.problems.some(p => /quota/.test(p)), '3 congés pour alpha 3 : accepté');
  const c4 = P.staffingCheck(cfg, abs(['A2', 'A3', 'A5'], 'CF').concat(abs(['A6'], 'RPT')), '2027-01-08', '2027-01-08')['2027-01-08'];
  assert(c4.problems.some(p => /quota d'absences dépassé : 4 pour un alpha de 3/.test(p)), c4.problems.join());
  const cf = P.staffingCheck(cfg, abs(['A2', 'A3', 'A5'], 'CF').concat(abs(['A6'], 'FORM')), '2027-01-08', '2027-01-08')['2027-01-08'];
  assert(cf.problems.some(p => /quota d'absences dépassé : 4 pour un alpha de 3/.test(p)), 'formation sans bêta disponible : décomptée sur alpha');
  const cfA = P.staffingCheck(cfg, abs(['A2', 'A3', 'A5'], 'CF').concat(abs(['A6'], 'ABS')), '2027-01-08', '2027-01-08')['2027-01-08'];
  assert(!cfA.problems.some(p => /quota/.test(p)), 'autre absence (ABS) : non décomptée');
  // période normale (= période d'option), cardinal 8 : alpha 2 + bêta 1 en semaine → une RS peut passer sur bêta
  const c8 = { ...cfg, agents: cfg.agents.concat([{ id: 'A8', renfort: false, cdt: false }]) };
  const k = '2027-06-08'; // mardi, J3, période d'option
  assert.deepStrictEqual(P.quotaFor(c8, k, 'J3', 'weekday'), { alpha: 2, beta: 1, cardinal: 8 });
  const ab = (ids, type) => ids.map(a => ({ agent: a, from: k, to: k, type }));
  assert.strictEqual(P.staffingCheck(c8, ab(['A2', 'A3'], 'CF').concat(ab(['A5'], 'RS')), k, k)[k].quota.over, 0, '2 CF + 1 RS sur bêta : accepté');
  assert.strictEqual(P.staffingCheck(c8, ab(['A2', 'A3', 'A5'], 'CF'), k, k)[k].quota.over, 1, '3 CF pour alpha 2 : dépassé');
  // bêta d'abord pour les formations, puis pour les RS ; la formation passe avant la RS
  const qf = P.staffingCheck(c8, ab(['A2', 'A3'], 'CF').concat(ab(['A5'], 'FORM')), k, k)[k].quota;
  assert.deepStrictEqual([qf.formBeta, qf.rsBeta, qf.used, qf.over], [1, 0, 2, 0], '2 CF + 1 formation sur bêta : accepté');
  const qfr = P.staffingCheck(c8, ab(['A2'], 'CF').concat(ab(['A5'], 'FORM'), ab(['A6'], 'RS')), k, k)[k].quota;
  assert.deepStrictEqual([qfr.formBeta, qfr.rsBeta, qfr.used, qfr.over], [1, 0, 2, 0], 'formation sur bêta, RS sur alpha');
  const qfr2 = P.staffingCheck(c8, ab(['A2', 'A3'], 'CF').concat(ab(['A5'], 'FORM'), ab(['A6'], 'RS')), k, k)[k].quota;
  assert.strictEqual(qfr2.over, 1, '2 CF + formation (bêta) + RS (alpha) : dépassé de 1');
  const qff = P.staffingCheck(c8, ab(['A5', 'A6'], 'FORM').concat(ab(['A7'], 'RS')), k, k)[k].quota;
  assert.deepStrictEqual([qff.formBeta, qff.rsBeta, qff.used], [1, 0, 2], '2 formations : 1 sur bêta, 1 sur alpha ; la RS reste sur alpha');
  // cardinal 7, période normale : bêta 0,66 en semaine, mis en commun sur le cycle (2 jours × 0,66 → 2 places)
  const ab2 = (ids, type, day) => ids.map(a => ({ agent: a, from: day, to: day, type }));
  const [d7, d8] = ['2027-06-07', '2027-06-08']; // J2 lundi, J3 mardi (J1 = dimanche 06/06, bêta 0)
  assert.strictEqual(P.quotaFor(cfg, d7, 'J2', 'weekday').beta, 0.66);
  const rqP = ab2(['A2', 'A3'], 'CF', d7).concat(ab2(['A5'], 'FORM', d7), ab2(['A2', 'A3'], 'CF', d8), ab2(['A6'], 'RS', d8));
  const qp = P.staffingCheck(cfg, rqP, d7, d8);
  assert.deepStrictEqual([qp[d7].quota.cycleBeta, qp[d7].quota.formBeta, qp[d7].quota.over, qp[d8].quota.rsBeta, qp[d8].quota.over], [2, 1, 0, 1, 0], 'formation et RS sur les 2 places bêta du cycle');
  const qp2 = P.staffingCheck(cfg, rqP.concat(ab2(['A7'], 'RS', d7)), d7, d8);
  assert.deepStrictEqual([qp2[d7].quota.onBeta, qp2[d7].quota.over, qp2[d8].quota.rsBeta, qp2[d8].quota.over], [2, 0, 0, 1], '3e absence bêta : plus de place, la RS du mardi passe sur alpha');
  // génération : mêmes quotas par cycle (pas d'alerte quand tout tient sur bêta)
  const gq = P.generateMonth(cfg, rqP, {}, '2027-06', null, []);
  [d7, d8].forEach(k => assert(!gq.days.find(d => d.date === k).warnings.some(w => /Quota/.test(w)), 'alerte de quota à tort ' + k));
  // cardinal d'équipe réglé dans les paramètres : prioritaire sur le nombre d'agents
  const cc = { ...cfg, agents: cfg.agents.filter(a => !['A6', 'A7'].includes(a.id)), cardinal: 7 };
  assert.strictEqual(P.cardinalOf(cc), 7); assert.strictEqual(P.quotaFor(cc, d7, 'J2', 'weekday').cardinal, 7);
  // cardinal 6 : pas de place sur bêta
  const c6 = { ...cfg, agents: cfg.agents.filter(a => a.id !== 'A7') };
  assert.strictEqual(P.staffingCheck(c6, ab(['A5'], 'FORM'), k, k)[k].quota.onBeta, 0, 'cardinal 6 : rien sur bêta');
  // période creuse, cardinal 8, samedi : alpha propre à chaque vacation (J1 4, J2 3, J3 4)
  assert.strictEqual(P.quotaFor(c8, '2027-01-02', 'J2', 'saturday').alpha, 3);
  assert.strictEqual(P.quotaFor(c8, '2027-01-02', 'J1', 'saturday').alpha, 4);
  // BC
  assert.strictEqual(P.bcFor(cfg, '2027-01-08', 'J2', 'weekday'), 6, 'BC période creuse semaine');
  assert.strictEqual(P.bcFor(cfg, '2027-06-08', 'J3', 'weekday'), 7, 'BC période normale semaine');
  assert.strictEqual(P.bcFor(cfg, '2027-06-06', 'J1', 'sunday'), 5, 'BC dimanche');
  // génération : alerte de quota dépassé et BC mémorisé sur chaque jour de cycle
  const res = P.generateMonth(cfg, abs(['A2', 'A3', 'A5', 'A6'], 'CF'), {}, '2027-01', null, []);
  const d5 = res.days.find(d => d.date === '2027-01-08');
  assert(d5.warnings.some(w => /Quota d'absences dépassé : 4/.test(w)), d5.warnings.join());
  assert.strictEqual(d5.bc, 6);
  console.log('quotas et BC : OK (alpha / bêta selon cardinal et période, formations puis RS sur bêta, 0,66 mis en commun par cycle, BC par vacation)');
}

// ---- impact d'un échange : rééquilibrer = négatif, aggraver = positif
{
  const month = '2027-03', md = all.filter(z => z.date.startsWith(month));
  const counters = P.computeCounters(all.filter(z => z.date < '2027-04-01'), cfg, {});
  const day = md.find(z => z.role === 'J3' && Object.keys(z.assign).length >= 5);
  const ids = Object.keys(day.assign), night = ids.filter(i => day.assign[i].rank <= cfg.nightCount && !day.assign[i].n1 && !day.assign[i].meal), eve = ids.filter(i => day.assign[i].rank > cfg.nightCount);
  const a = night[0], b = eve[0];
  const d1 = P.swapImpact(cfg, counters, day, a, b), d2 = P.swapImpact(cfg, counters, day, b, a);
  assert(Math.abs(d1 - d2) < 1e-9, 'impact symétrique');
  // on charge artificiellement a en nuits : lui retirer sa nuit doit rééquilibrer
  const heavy = JSON.parse(JSON.stringify(counters)); heavy[a].nights += 6; heavy[b].nights -= 6;
  assert(P.swapImpact(cfg, heavy, day, a, b) < 0, 'retirer une nuit à un agent surchargé doit rééquilibrer');
  const light = JSON.parse(JSON.stringify(counters)); light[a].nights -= 6; light[b].nights += 6;
  assert(P.swapImpact(cfg, light, day, a, b) > 0, 'donner une nuit à un agent déjà chargé doit déséquilibrer');
  console.log('impact d\'un échange : OK');
}

// ---- types d'absence : congé fractionné (CF), congé cycle (Cyc), récups RS / RMT / RPT, formation avec son code
{
  // cycle 2027-06-06 → 2027-06-11 (J1 J2 J3 OFF OFF J0, période d'option) ; congé cycle posé sur une seule date du cycle
  const span = P.requestSpan(cfg, { type: 'Cyc', from: '2027-06-08', to: '2027-06-08' });
  assert.deepStrictEqual([span.from, span.to], ['2027-06-06', '2027-06-11'], 'un congé cycle couvre les 6 jours du cycle');
  const rq = [
    { agent: 'A5', from: '2027-06-07', to: '2027-06-07', type: 'CYC' },
    { agent: 'A2', from: '2027-06-07', to: '2027-06-07', type: 'FORM', value: 'GB' },
    { agent: 'A3', from: '2027-06-06', to: '2027-06-06', type: 'RS' }, { agent: 'A6', from: '2027-06-07', to: '2027-06-07', type: 'RMT' },
    { agent: 'A7', from: '2027-06-08', to: '2027-06-08', type: 'RPT' }, { agent: 'A1', from: '2027-06-01', to: '2027-06-01', type: 'C' }
  ];
  // A5 serait le seul candidat au J0 du 12/06 s'il était disponible : on rend les autres indisponibles ce jour-là
  const others = ['A1', 'A2', 'A3', 'A4', 'A6', 'A7'].map(a => ({ agent: a, from: '2027-06-11', to: '2027-06-11', type: 'C' }));
  const res = P.generateMonth(cfg, rq.concat(others), {}, '2027-06', null, []);
  const day = k => res.days.find(d => d.date === k);
  ['2027-06-06', '2027-06-07', '2027-06-08'].forEach(k => { assert.strictEqual(day(k).absent.A5, 'Cyc', 'Cyc affiché ' + k); assert(!day(k).assign.A5); });
  ['2027-06-09', '2027-06-10'].forEach(k => assert(!day(k).absent.A5, 'Cyc non affiché sur un jour OFF ' + k));
  const j0 = day('2027-06-11');
  assert.strictEqual(j0.role, 'J0'); assert(!j0.assign.A5, 'pas de J0 le 6e jour d\'un congé cycle'); assert(!j0.absent.A5, 'Cyc non affiché le jour du J0');
  assert(j0.warnings.some(w => /Aucun agent disponible pour le J0/.test(w)));
  assert.strictEqual(day('2027-06-07').absent.A2, 'GB', 'la formation affiche son code');
  assert.strictEqual(day('2027-06-07').absentType.A2, 'FORM');
  assert.strictEqual(day('2027-06-06').absent.A3, 'RS'); assert.strictEqual(day('2027-06-07').absent.A6, 'RMT'); assert.strictEqual(day('2027-06-08').absent.A7, 'RPT');
  assert.strictEqual(day('2027-06-01').absent.A1, 'CF', 'ancien type C = congé fractionné');
  // compteurs : le 6e jour d'un congé cycle n'est pas compté comme jour d'absence
  const cc = P.computeCounters(res.days, cfg, {});
  assert.strictEqual(cc.A5.absDays, 3, 'congé cycle : 3 jours d\'absence (J1, J2, J3)');
  // mail : sous-type indiqué, congé cycle étendu au cycle complet
  const m = P.buildLeaveMail(cfg, rq, {});
  assert(m.body.includes('- A5 (congé cycle) : du 06/06/2027 au 11/06/2027 (6 jours, dont 3 vacations de cycle)'), m.body);
  assert(m.body.includes('- A2 (GB) : le 07/06/2027 (J2)'), m.body);
  assert(m.body.includes('- A3 (RS) : le 06/06/2027 (J1)') && m.body.includes('- A6 (RMT)') && m.body.includes('- A7 (RPT)'), m.body);
  assert(/RÉCUPÉRATIONS \(3\)/.test(m.body) && /CONGÉS \(2\)/.test(m.body), m.body);
  console.log('types d\'absence : OK (Cyc sur J1-J3 seulement et pas de J0 le 6e jour, formation « GB », RS / RMT / RPT)');
}

// ---- priorités d'équilibre : N1, nuits et repas passent avant le reste (équipe de 6 dont 3 CDT, une année)
{
  const ids6 = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
  const c6 = { ...cfg, agents: ids6.map((id, i) => ({ id, renfort: false, cdt: i < 3 })), cycle: { ...cfg.cycle, optionPeriods: P.DEFAULT_OPTION_PERIODS }, maxNightsMonth: 3, maxN1Month: 2 };
  let sd = 31; const rn = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const rq6 = [];
  for (let i = 0; i < 30; i++) { const d = P.addDays('2027-01-01', Math.floor(rn() * 360)); rq6.push({ agent: ids6[Math.floor(rn() * 6)], from: d, to: P.addDays(d, Math.floor(rn() * 6)), type: 'CF' }); }
  let d6 = []; const worst = { nights: 0, n1: 0, meal: 0 };
  for (let m = 1; m <= 12; m++) {
    const month = '2027-' + String(m).padStart(2, '0');
    d6 = d6.concat(P.generateMonth(c6, rq6, P.computeCounters(d6, c6, {}), month, null, hist(d6, month)).days);
    const cc = P.computeCounters(d6, c6, {});
    Object.keys(worst).forEach(k => {
      const rate = ids6.reduce((s, i) => s + cc[i][k], 0) / ids6.reduce((s, i) => s + P.effDays(cc[i], c6, k), 0);
      const dv = ids6.map(i => cc[i][k] - rate * P.effDays(cc[i], c6, k));
      worst[k] = Math.max(worst[k], Math.max(...dv) - Math.min(...dv));
    });
  }
  console.log('priorités : pire écart mensuel sur l\'année (rapporté aux jours travaillés) — nuits', worst.nights.toFixed(2), '| N1', worst.n1.toFixed(2), '| repas', worst.meal.toFixed(2));
  Object.keys(worst).forEach(k => assert(worst[k] < 2, 'écart de ' + k + ' trop grand : ' + worst[k].toFixed(2)));
}

// ---- aperçu d'un mois non généré : structure du cycle et demandes
{
  const rq = [{ agent: 'A2', from: '2027-06-08', to: '2027-06-08', type: 'FORM', value: 'GB' }, { agent: 'A5', from: '2027-06-06', to: '2027-06-06', type: 'CYC' },
    { agent: 'A3', from: '2027-06-07', to: '2027-06-07', type: 'VEUT', value: 'nuit' }, { agent: 'A6', from: '2027-06-07', to: '2027-06-07', type: 'FIXE', value: 'J1-3' },
    { agent: 'R1', from: '2027-06-08', to: '2027-06-08', type: 'RENFORT' }, { agent: 'A7', from: '2027-06-11', to: '2027-06-11', type: 'VEUT', value: 'j0' }];
  const pv = P.previewMonth(cfg, rq, '2027-06');
  const R6 = P.buildRoles(cfg.cycle, '2027-06-01', '2027-06-30');
  assert.strictEqual(pv.days.length, 30); pv.days.forEach(d => assert.strictEqual(d.role, R6[d.date] || 'OFF', d.date));
  const g = k => pv.days.find(d => d.date === k);
  assert.strictEqual(g('2027-06-08').absent.A2, 'GB');
  ['2027-06-06', '2027-06-07', '2027-06-08'].forEach(k => assert.strictEqual(g(k).absent.A5, 'Cyc'));
  assert.strictEqual(g('2027-06-11').role, 'J0'); assert(g('2027-06-11').unavailable.A5 && !g('2027-06-11').absent.A5, 'congé cycle : pas de J0 le 6e jour, rien affiché');
  assert.deepStrictEqual(g('2027-06-07').prefs.A3, [{ agent: 'A3', type: 'VEUT', value: 'nuit' }]); assert.strictEqual(g('2027-06-07').fixed.A6, 'J1-3');
  assert(g('2027-06-08').renfort.R1 && g('2027-06-08').avail.includes('R1') && !g('2027-06-07').avail.includes('R1'));
  assert(g('2027-06-11').prefs.A7 && !g('2027-06-10').prefs.A7);
  assert.strictEqual(g('2027-06-08').avail.length, 6); // 7 réguliers - A2 - A5 + R1
  assert.strictEqual(g('2027-06-08').bc, P.bcFor(cfg, '2027-06-08', 'J3', g('2027-06-08').dayType));
  console.log('aperçu d\'un mois non généré : OK');
}

// ---- mail de dépôt des demandes
{
  const rq = [
    { agent: 'A1', from: '2027-01-12', to: '2027-01-16', type: 'C', note: 'vacances' },
    { agent: 'A2', from: '2027-01-14', to: '2027-01-14', type: 'REC' },
    { agent: 'A3', from: '2027-01-20', to: '2027-01-20', type: 'récup', sent: '2027-01-02' },
    { agent: 'A4', from: '2027-02-03', to: '2027-02-04', type: 'FORM' },
    { agent: 'A5', from: '2027-01-05', to: '2027-01-05', type: 'EVITE', value: 'nuit' }
  ];
  const m = P.buildLeaveMail(cfg, rq, { onlyUnsent: true });
  assert.strictEqual(m.count, 3); assert.deepStrictEqual(m.included, [0, 1, 3]);
  assert(/CONGÉS \(1\)/.test(m.body) && /RÉCUPÉRATIONS \(1\)/.test(m.body) && /FORMATIONS \(1\)/.test(m.body));
  assert(m.body.includes('- A1 (CF) : du 12/01/2027 au 16/01/2027 (5 jours, dont 3 vacations de cycle) — vacances'), m.body);
  assert(m.body.includes('- A2 : le 14/01/2027 (J2)'), m.body);
  assert(!m.body.includes('A5') && !m.body.includes('A3'), 'souhait et demande déjà déposée exclus');
  assert(m.subject.startsWith('Demandes de congés / récupérations / formations — du 12/01/2027 au 04/02/2027'), m.subject);
  assert.strictEqual(P.buildLeaveMail(cfg, rq, { types: ['C'] }).count, 1);
  assert.strictEqual(P.buildLeaveMail(cfg, rq, { from: '2027-02-01' }).count, 1);
  assert.strictEqual(P.buildLeaveMail(cfg, rq, { onlyUnsent: false }).count, 4);
  console.log('mail : OK\n' + m.body.split('\n').slice(0, 9).join('\n'));
}

// ---- synthèse
const c = P.computeCounters(all, cfg, {});

// ---- lissage mensuel : écart d'heures resserré, et aucune vacation imposée déplacée
{
  const reg = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
  const rate = reg.reduce((s, i) => s + c[i].hours, 0) / reg.reduce((s, i) => s + P.effDays(c[i], cfg, 'hours'), 0);
  const devs = reg.map(i => c[i].hours - rate * P.effDays(c[i], cfg, 'hours'));
  const spreadH = Math.max(...devs) - Math.min(...devs);
  console.log('lissage : écart max-min des heures (rapporté aux jours travaillés) =', spreadH.toFixed(1), 'h');
  assert(spreadH < 5, 'écart d\'heures trop grand : ' + spreadH.toFixed(1));
  // N1 : autant pour les chefs de tour (A1, A4) que pour les autres, même s'ils font plus de nuits
  const n1s = reg.map(i => c[i].n1), avgN1 = g => g.reduce((s, i) => s + c[i].n1, 0) / g.length;
  const gap = Math.abs(avgN1(['A1', 'A4']) - avgN1(['A2', 'A3', 'A5', 'A6', 'A7']));
  console.log('N1 : CDT', avgN1(['A1', 'A4']).toFixed(1), '| non-CDT', avgN1(['A2', 'A3', 'A5', 'A6', 'A7']).toFixed(1), '| min-max', Math.min(...n1s) + '-' + Math.max(...n1s));
  assert(gap <= 1, 'N1 inégales entre CDT et non-CDT'); assert(Math.max(...n1s) - Math.min(...n1s) <= 2, 'N1 mal réparties');
  // repas : même règle que la N1
  const meals = reg.map(i => c[i].meal), avgM = g => g.reduce((s, i) => s + c[i].meal, 0) / g.length;
  console.log('repas : CDT', avgM(['A1', 'A4']).toFixed(1), '| non-CDT', avgM(['A2', 'A3', 'A5', 'A6', 'A7']).toFixed(1), '| min-max', Math.min(...meals) + '-' + Math.max(...meals));
  assert(Math.abs(avgM(['A1', 'A4']) - avgM(['A2', 'A3', 'A5', 'A6', 'A7'])) <= 1, 'repas inégaux entre CDT et non-CDT'); assert(Math.max(...meals) - Math.min(...meals) <= 2, 'repas mal répartis');
  const rqF = requests.concat([{ agent: 'A3', from: '2027-03-03', to: '2027-03-03', type: 'FIXE', value: 'J2-4' }]);
  const res = P.generateMonth(cfg, rqF, bases['2027-03'], '2027-03', null, hist(all.filter(z => z.date < '2027-03-01'), '2027-03'));
  const d = res.days.find(z => z.date === '2027-03-03');
  assert.strictEqual(d.role, 'J2'); assert.strictEqual(d.assign.A3.slot, 'J2-4', 'créneau imposé déplacé par le lissage');
  // déterministe : deux générations identiques donnent le même mois
  const res2 = P.generateMonth(cfg, rqF, bases['2027-03'], '2027-03', null, hist(all.filter(z => z.date < '2027-03-01'), '2027-03'));
  assert.strictEqual(JSON.stringify(res.days), JSON.stringify(res2.days));
}
// ---- J2 tardifs et débuts tôt : comptés pour information, plus des critères d'équilibre
{
  assert(!('late' in P.DEFAULT_WEIGHTS) && !('early' in P.DEFAULT_WEIGHTS), 'plus de poids J2 tardif / début tôt');
  const b1 = P.computeCounters(all.filter(z => z.date < '2027-04-01'), cfg, {});
  const b2 = JSON.parse(JSON.stringify(b1)); b2.A1.late += 40; b2.A2.early += 40; b2.A3.late -= 20;
  const h = hist(all.filter(z => z.date < '2027-04-01'), '2027-04');
  const r1 = P.generateMonth(cfg, requests, b1, '2027-04', null, h), r2 = P.generateMonth(cfg, requests, b2, '2027-04', null, h);
  assert.strictEqual(JSON.stringify(r1.days.map(d => d.assign)), JSON.stringify(r2.days.map(d => d.assign)), 'les compteurs J2 tardifs / débuts tôt ne changent plus la génération');
  console.log('J2 tardifs / débuts tôt : OK (hors équilibre)');
}
console.table(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { h: +v.hours.toFixed(1), nuits: v.nights, N1: v.n1, repas: v.meal, soir: v.evenings, nWE: v.nightWE, tard: v.late, tot: v.early, j0: v.j0, jours: v.days }])));
console.log('nuits:', nights, '| jours sans CDT:', noCdt, '| J0 hors N1:', j0n);
console.log('agents de nuit avec J2 tôt la veille:', withEarly + '/' + nightAg, '(' + Math.round(100 * withEarly / nightAg) + ' %) | équipe de nuit conforme au plan:', planOk + '/' + planned);
console.log('OK');
