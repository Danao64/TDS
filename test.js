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

// ---- synthèse
const c = P.computeCounters(all, cfg, {});
console.table(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { h: +v.hours.toFixed(1), nuits: v.nights, N1: v.n1, repas: v.meal, soir: v.evenings, nWE: v.nightWE, tard: v.late, tot: v.early, j0: v.j0, jours: v.days }])));
console.log('nuits:', nights, '| jours sans CDT:', noCdt, '| J0 hors N1:', j0n);
console.log('agents de nuit avec J2 tôt la veille:', withEarly + '/' + nightAg, '(' + Math.round(100 * withEarly / nightAg) + ' %) | équipe de nuit conforme au plan:', planOk + '/' + planned);
console.log('OK');
