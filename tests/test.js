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
  assert(chk['2027-01-02'].problems[0].startsWith('3 agent(s) pour 4 minimum'));
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
  assert(!cf.problems.some(p => /quota/.test(p)), 'une formation ne compte pas dans le quota');
  // période normale (= période d'option), cardinal 8 : alpha 2 + bêta 1 en semaine → une RS peut passer sur bêta
  const c8 = { ...cfg, agents: cfg.agents.concat([{ id: 'A8', renfort: false, cdt: false }]) };
  const k = '2027-06-08'; // mardi, J3, période d'option
  assert.deepStrictEqual(P.quotaFor(c8, k, 'J3', 'weekday'), { alpha: 2, beta: 1, cardinal: 8 });
  const ab = (ids, type) => ids.map(a => ({ agent: a, from: k, to: k, type }));
  assert.strictEqual(P.staffingCheck(c8, ab(['A2', 'A3'], 'CF').concat(ab(['A5'], 'RS')), k, k)[k].quota.over, 0, '2 CF + 1 RS sur bêta : accepté');
  assert.strictEqual(P.staffingCheck(c8, ab(['A2', 'A3', 'A5'], 'CF'), k, k)[k].quota.over, 1, '3 CF pour alpha 2 : dépassé');
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
  console.log('quotas et BC : OK (alpha / bêta selon cardinal et période, formation non décomptée, BC par vacation)');
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
console.table(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { h: +v.hours.toFixed(1), nuits: v.nights, N1: v.n1, repas: v.meal, soir: v.evenings, nWE: v.nightWE, tard: v.late, tot: v.early, j0: v.j0, jours: v.days }])));
console.log('nuits:', nights, '| jours sans CDT:', noCdt, '| J0 hors N1:', j0n);
console.log('agents de nuit avec J2 tôt la veille:', withEarly + '/' + nightAg, '(' + Math.round(100 * withEarly / nightAg) + ' %) | équipe de nuit conforme au plan:', planOk + '/' + planned);
console.log('OK');
