/* Moteur de calcul nutritionnel : fonctions pures, sans accès à la page.
   Toutes les valeurs sont des estimations à ajuster selon l'évolution réelle du poids. */
(function (root) {
  'use strict';

  /* Activités du planning. met = équivalent métabolique moyen d'une séance complète (pauses comprises),
     d'après le Compendium of Physical Activities (Ainsworth 2011), arrondi vers le bas. */
  var ACT = {
    muscu: { label: 'Muscu', met: 4 },
    mma: { label: 'MMA', met: 7 },
    grappling: { label: 'Grappling', met: 6.5 },
    boxe: { label: 'Boxe', met: 7 },
    course: { label: 'Course', met: 9 },
    cardio: { label: 'Cardio', met: 6 },
    autre: { label: 'Autre', met: 5 }
  };
  var ACT_ORDER = ['muscu', 'mma', 'grappling', 'boxe', 'course', 'cardio', 'autre'];
  var COMBAT = { mma: 1, grappling: 1, boxe: 1 };

  /* Surcoût d'une journée de travail, en part du métabolisme de base. */
  var JOB = {
    sedentaire: { label: 'Sédentaire (bureau, assis)', k: 0 },
    debout: { label: 'Debout (vente, accueil)', k: 0.15 },
    physique: { label: 'Physique (logistique, manutention)', k: 0.3 },
    tresphysique: { label: 'Très physique (BTP, port de charges)', k: 0.45 }
  };

  var GOALS = {
    recompo: { label: 'Recomposition', prot: 2.0 },
    masse: { label: 'Prise de masse maîtrisée', prot: 1.8 },
    perte: { label: 'Perte de graisse', prot: 2.2 }
  };
  var FAT_PER_KG = 0.9;
  var DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  var DAY_LABEL = { lun: 'Lundi', mar: 'Mardi', mer: 'Mercredi', jeu: 'Jeudi', ven: 'Vendredi', sam: 'Samedi', dim: 'Dimanche' };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function round(n, d) { var k = Math.pow(10, d || 0); return Math.round(n * k) / k; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* Vérifie le profil : renvoie la liste des problèmes (vide si complet et plausible). */
  function checkProfile(p) {
    var errs = [];
    if (!p) return ['Profil vide.'];
    if (p.sex !== 'h' && p.sex !== 'f') errs.push('Indique ton sexe.');
    var a = num(p.age), h = num(p.height), w = num(p.weight);
    if (isNaN(a)) errs.push('Indique ton âge.'); else if (a < 16 || a > 90) errs.push('Âge accepté : de 16 à 90 ans.');
    if (isNaN(h)) errs.push('Indique ta taille.'); else if (h < 130 || h > 230) errs.push('Taille acceptée : de 130 à 230 cm.');
    if (isNaN(w)) errs.push('Indique ton poids.'); else if (w < 35 || w > 250) errs.push('Poids accepté : de 35 à 250 kg.');
    return errs;
  }

  /* Métabolisme de base, formule de Mifflin-St Jeor (1990). */
  function bmr(sex, weight, height, age) {
    return 10 * weight + 6.25 * height - 5 * age + (sex === 'f' ? -161 : 5);
  }

  function dayActs(plan, day) { var d = plan && plan[day]; return d && Array.isArray(d.a) ? d.a.filter(function (x) { return ACT[x]; }) : []; }
  function dayWork(plan, day) { var d = plan && plan[day]; return !!(d && d.w); }

  /* Dépense d'une journée : base (MB x 1,2), activité quotidienne (travail ou pas, la plus haute des deux), séances. */
  function dayExpense(p, w, base, acts, work) {
    var steps = num(p.steps); if (isNaN(steps) || steps < 0) steps = 0;
    var stepsK = Math.max(0, steps - 3000) * w * 0.0005;
    var jobK = work ? base * (JOB[p.job] ? JOB[p.job].k : 0) : 0;
    var dur = num(p.dur); if (isNaN(dur) || dur <= 0) dur = 60;
    var sport = 0;
    acts.forEach(function (a) { sport += (ACT[a].met - 1) * w * dur / 60; });
    return { base: base * 1.2, neat: Math.max(stepsK, jobK), sport: sport, total: base * 1.2 + Math.max(stepsK, jobK) + sport };
  }

  /* Ajustement lié à l'objectif, en kcal, à partir du maintien moyen. */
  function goalAdjust(p, maint) {
    var g = p.goal in GOALS ? p.goal : 'recompo', w = num(p.weight), gw = num(p.goalW);
    if (g === 'masse') return clamp(maint * 0.08, 150, 350);
    if (g === 'perte') return -clamp(maint * 0.18, 300, 600);
    if (!isNaN(gw) && !isNaN(w) && gw >= w) return 0;
    return -Math.round(maint * 0.05);
  }

  /* Macros d'une journée à partir de ses calories. Protéines et lipides fixes, les glucides prennent le reste. */
  function macrosFor(kcal, p, w, h) {
    var g = GOALS[p.goal] || GOALS.recompo;
    var bmi = w / Math.pow(h / 100, 2);
    var refW = bmi > 30 ? 27 * Math.pow(h / 100, 2) : w;      // évite des protéines excessives si IMC élevé
    var P = Math.round(g.prot * refW);
    var F = Math.round(FAT_PER_KG * w);
    if (F * 9 < kcal * 0.2) F = Math.round(kcal * 0.2 / 9);   // au moins 20 % des calories en lipides
    var C = Math.round((kcal - P * 4 - F * 9) / 4);
    if (C < 50) {                                              // garde un minimum de glucides pour s'entraîner
      F = Math.max(Math.round(0.6 * w), Math.floor((kcal - P * 4 - 50 * 4) / 9));
      C = Math.max(0, Math.round((kcal - P * 4 - F * 9) / 4));
    }
    var k = P * 4 + C * 4 + F * 9;
    return { p: P, c: C, f: F, kcal: k, fib: fiberFor(k) };
  }
  function fiberFor(kcal) { return clamp(Math.round(kcal / 1000 * 14), 25, 45); }

  /* Calcul complet : renvoie null si le profil est incomplet. */
  function compute(p, opts) {
    opts = opts || {};
    if (checkProfile(p).length) return null;
    var w = opts.weight > 0 ? opts.weight : num(p.weight), h = num(p.height), a = num(p.age);
    var B = bmr(p.sex, w, h, a);
    var days = {}, sumM = 0, sessions = 0, combat = 0, types = {};
    DAYS.forEach(function (d) {
      var acts = dayActs(p.plan, d), work = dayWork(p.plan, d), e = dayExpense(p, w, B, acts, work);
      days[d] = { acts: acts, work: work, maint: e.total, sport: e.sport };
      sumM += e.total; sessions += acts.length;
      acts.forEach(function (x) { types[x] = 1; if (COMBAT[x]) combat++; });
    });
    var maint = sumM / 7;
    var adj = goalAdjust(p, maint) + (num(p.adj) || 0);
    var target = maint + adj;
    var floor = Math.max(target * 0.9, B);
    DAYS.forEach(function (d) {
      var t = target + 0.6 * (days[d].maint - maint);              // les écarts entre jours sont adoucis
      t = clamp(t, floor, target * 1.15);
      days[d].target = t;
      days[d].macros = macrosFor(t, p, w, h);
    });
    var factor = maint / B;
    var level = factor < 1.4 ? 'Peu actif' : factor < 1.6 ? 'Modérément actif' : factor < 1.8 ? 'Actif' : factor < 2 ? 'Très actif' : 'Extrêmement actif';
    return {
      weight: w, bmr: B, maint: maint, tdee: maint, adj: adj, target: target, avg: macrosFor(target, p, w, h),
      days: days, sessions: sessions, types: Object.keys(types), factor: factor, level: level
    };
  }

  /* Objectif d'une journée donnée (activités éventuellement modifiées pour aujourd'hui). */
  function forActs(p, res, acts, work) {
    if (!res) return null;
    var w = res.weight, h = num(p.height), B = res.bmr;
    var e = dayExpense(p, w, B, acts, work);
    var t = clamp(res.target + 0.6 * (e.total - res.maint), Math.max(res.target * 0.9, B), res.target * 1.15);
    var m = macrosFor(t, p, w, h); m.maint = e.total; return m;
  }

  /* ---------- Suivi du poids ---------- */
  function dayNum(iso) { var t = Date.parse(iso + 'T12:00:00Z'); return isNaN(t) ? NaN : Math.round(t / 86400000); }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : NaN; }

  /* Moyenne glissante sur 7 jours pour chaque mesure. */
  function rolling(list, key) {
    var pts = list.filter(function (m) { return m[key] > 0; }).map(function (m) { return { n: dayNum(m.d), v: +m[key], d: m.d }; })
      .filter(function (x) { return !isNaN(x.n); }).sort(function (a, b) { return a.n - b.n; });
    return pts.map(function (x) {
      var win = pts.filter(function (y) { return y.n <= x.n && y.n > x.n - 7; }).map(function (y) { return y.v; });
      return { d: x.d, n: x.n, v: x.v, avg: mean(win) };
    });
  }

  /* Analyse des 2 dernières semaines et proposition d'ajustement (jamais appliquée sans confirmation). */
  function analyze(list, goal, todayIso) {
    var t = dayNum(todayIso);
    function win(key, from, to) { return list.filter(function (m) { var n = dayNum(m.d); return m[key] > 0 && n > t - from && n <= t - to; }).map(function (m) { return +m[key]; }); }
    var w1 = win('w', 7, 0), w0 = win('w', 14, 7);
    if (w1.length < 3 || w0.length < 3) {
      return { status: 'wait', msg: 'Pèse-toi au moins 3 fois par semaine pendant 2 semaines : l\'analyse compare la moyenne des 7 derniers jours à celle des 7 jours d\'avant.', n1: w1.length, n0: w0.length };
    }
    var a1 = mean(w1), a0 = mean(w0), rate = (a1 - a0) / a0 * 100;
    var t1 = win('t', 7, 0), t0 = win('t', 14, 7), dt = t1.length && t0.length ? mean(t1) - mean(t0) : null;
    var perfs = list.filter(function (m) { var n = dayNum(m.d); return m.perf && n > t - 14 && n <= t; }).sort(function (a, b) { return dayNum(b.d) - dayNum(a.d); });
    var perf = perfs.length ? perfs[0].perf : null;
    var r = { a1: a1, a0: a0, rate: rate, dt: dt, perf: perf, delta: 0, status: 'ok' };
    var sAbs = round(Math.abs(rate), 2).toLocaleString('fr-FR') + ' % de ton poids par semaine';
    var rt = round(rate, 2), sRate = (rt > 0 ? '+' : '') + rt.toLocaleString('fr-FR') + ' % par semaine';
    var waistTxt = dt == null ? '' : ' Tour de taille : ' + (dt > 0 ? '+' : '') + round(dt, 1).toLocaleString('fr-FR') + ' cm.';
    if (goal === 'perte') {
      if (rate < -1) { r.delta = 150; r.status = 'up'; r.msg = 'Tu perds ' + sAbs + ' : c\'est trop rapide, tu risques de perdre du muscle. Je propose +150 kcal par jour.'; }
      else if (rate > -0.2) { r.delta = -150; r.status = 'down'; r.msg = 'Ton poids ne baisse presque pas (' + sRate + '). Je propose -150 kcal par jour.'; }
      else r.msg = 'Rythme de perte correct (' + sRate + ', objectif entre -0,2 et -1 %). Ne change rien.';
    } else if (goal === 'masse') {
      if (rate > 0.5 || (rate > 0.25 && dt != null && dt > 0.5)) { r.delta = -150; r.status = 'down'; r.msg = 'Tu prends ' + sRate + (dt != null && dt > 0.5 ? ' et ton tour de taille augmente' : '') + ' : trop de gras risque de s\'accumuler. Je propose -150 kcal par jour.'; }
      else if (rate < 0.1) { r.delta = 150; r.status = 'up'; r.msg = 'Ton poids ne monte presque pas (' + sRate + '). Je propose +150 kcal par jour.'; }
      else r.msg = 'Prise de poids maîtrisée (' + sRate + ', objectif entre +0,1 et +0,5 %). Ne change rien.';
    } else {
      if (rate < -0.5) { r.delta = 150; r.status = 'up'; r.msg = 'Tu perds ' + sAbs + ' : trop rapide pour une recomposition. Je propose +150 kcal par jour.'; }
      else if (rate > 0.3 && dt != null && dt > 0.5) { r.delta = -150; r.status = 'down'; r.msg = 'Tu prends ' + sRate + ' et ton tour de taille augmente. Je propose -150 kcal par jour.'; }
      else if (Math.abs(rate) <= 0.3 && dt != null && dt <= -0.3) { r.status = 'win'; r.msg = 'Poids stable et tour de taille en baisse' + (perf === 'up' ? ', performances en progrès' : '') + ' : la recomposition semble fonctionner. Ne change rien.'; }
      else r.msg = 'Poids stable (' + sRate + '). Continue et surveille le tour de taille et tes performances.';
    }
    r.msg += waistTxt;
    return r;
  }

  /* ---------- Qualité nutritionnelle de la journée ---------- */
  /* items : [{ g, fib, p, f, kind, pgroup, fat }] ; kind = 'fruit' | 'veg' ; fat = 'good' | 'sat'. */
  function quality(items, fibGoal, water, weight) {
    var fib = 0, fv = 0, groups = {}, good = 0, sat = 0, n = 0;
    items.forEach(function (x) {
      if (!(x.g > 0)) return; n++;
      fib += x.fib * x.g / 100;
      if (x.kind === 'fruit') fv += x.g / 100; else if (x.kind === 'veg') fv += x.g / 80;
      if (x.pgroup && x.p * x.g / 100 >= 10) groups[x.pgroup] = 1;
      if (x.fat === 'good') good += x.f * x.g / 100; else if (x.fat === 'sat') sat += x.f * x.g / 100;
    });
    var ng = Object.keys(groups).length;
    var parts = [
      { k: 'fib', label: 'Fibres', max: 25, pts: 25 * Math.min(1, fibGoal > 0 ? fib / fibGoal : 0), info: Math.round(fib) + ' / ' + fibGoal + ' g', tip: 'Ajoute des légumes, des fruits, des légumineuses ou du pain complet.' },
      { k: 'fv', label: 'Fruits et légumes', max: 20, pts: 20 * Math.min(1, fv / 5), info: round(fv, 1).toLocaleString('fr-FR') + ' / 5 portions', tip: 'Vise 5 portions : 1 fruit = 1 portion, 80 g de légumes = 1 portion.' },
      { k: 'prot', label: 'Sources de protéines', max: 15, pts: ng >= 3 ? 15 : ng === 2 ? 12 : ng === 1 ? 6 : 0, info: ng + ' type' + (ng > 1 ? 's' : ''), tip: 'Varie : viande, poisson, œufs ou laitiers, légumineuses.' },
      { k: 'fat', label: 'Qualité des graisses', max: 20, pts: good + sat < 5 ? 20 : 20 * Math.min(1, good / (good + sat) / 0.5), info: good + sat < 5 ? 'peu de graisses ajoutées' : Math.round(good / (good + sat) * 100) + ' % de bonnes graisses', tip: 'Préfère l\'huile d\'olive, les oléagineux, l\'avocat ou le poisson gras au beurre et au fromage.' },
      { k: 'div', label: 'Diversité', max: 10, pts: 10 * Math.min(1, n / 8), info: n + ' aliment' + (n > 1 ? 's' : '') + ' différent' + (n > 1 ? 's' : ''), tip: 'Varie tes aliments d\'un jour à l\'autre.' }
    ];
    var wg = weight > 0 ? round(weight * 0.033, 1) : 2.5;
    if (water > 0) parts.push({ k: 'eau', label: 'Hydratation', max: 10, pts: 10 * Math.min(1, water / wg), info: round(water, 1).toLocaleString('fr-FR') + ' / ' + wg.toLocaleString('fr-FR') + ' L', tip: 'Bois régulièrement, surtout les jours de sport.' });
    var max = 0, pts = 0;
    parts.forEach(function (x) { x.pts = Math.round(x.pts); max += x.max; pts += x.pts; });
    var score = n ? Math.round(pts / max * 100) : 0;
    var tips = parts.filter(function (x) { return x.pts < x.max * 0.7; }).sort(function (a, b) { return (b.max - b.pts) - (a.max - a.pts); }).slice(0, 2).map(function (x) { return x.tip; });
    return { score: score, parts: parts, tips: tips, fib: fib, waterGoal: wg };
  }

  var api = {
    ACT: ACT, ACT_ORDER: ACT_ORDER, JOB: JOB, GOALS: GOALS, DAYS: DAYS, DAY_LABEL: DAY_LABEL,
    checkProfile: checkProfile, bmr: bmr, compute: compute, forActs: forActs, macrosFor: macrosFor, fiberFor: fiberFor,
    rolling: rolling, analyze: analyze, quality: quality, dayNum: dayNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Nutri = api;
})(typeof window !== 'undefined' ? window : this);
