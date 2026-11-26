/* GENERATED from ecg-simulator/index.html by tools/sync-ecg-engine.sh. Do not edit by hand. */
/* ECG engine: cardiac dipole model + discrete-event conduction simulator.
   Coordinates: x = patient's left, y = inferior, z = anterior. Units: seconds, mV. */
'use strict';

const LEADS = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6','V4R','V7','V8','V9'];
const LI = Object.fromEntries(LEADS.map((n, i) => [n, i]));

function norm(v){ const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/m, v[1]/m, v[2]/m]; }
function scl(v, s){ return [v[0]*s, v[1]*s, v[2]*s]; }
function neg(v){ return [-v[0], -v[1], -v[2]]; }
function rotZ(v, deg){ const r = deg*Math.PI/180, c = Math.cos(r), s = Math.sin(r); return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]]; }
function clamp(x, a, b){ return x < a ? a : x > b ? b : x; }
function dir(x, y, z){ return norm([x, y, z]); }

// Lead vectors. Limb leads follow Einthoven/Goldberger exactly; precordial leads carry gain.
const LEADVEC = (() => {
  const I = [1,0,0], II = [0.5,0.866,0], III = [-0.5,0.866,0];
  const pre = (v, g) => scl(norm(v), g);
  return {
    I, II, III,
    aVR: scl([I[0]+II[0], I[1]+II[1], 0], -0.5),
    aVL: [(I[0]-III[0])/2, (I[1]-III[1])/2, 0],
    aVF: [(II[0]+III[0])/2, (II[1]+III[1])/2, 0],
    V1: pre([-0.45,0.05,0.90], 1.0),
    V2: pre([-0.10,0.10,0.99], 1.55),
    V3: pre([0.25,0.15,0.96], 1.55),
    V4: pre([0.55,0.25,0.80], 1.45),
    V5: pre([0.82,0.25,0.52], 1.25),
    V6: pre([0.96,0.25,0.15], 1.05),
    V4R: pre([-0.55,0.25,0.80], 0.9),
    V7: pre([0.85,0.20,-0.48], 0.8),
    V8: pre([0.55,0.15,-0.82], 0.7),
    V9: pre([0.22,0.10,-0.97], 0.6),
  };
})();

function projectVec(v, tech){
  const out = new Float32Array(LEADS.length);
  const vv = tech === 'dextro' ? [-v[0], v[1], v[2]] : v;
  for (let i = 0; i < LEADS.length; i++){ const L = LEADVEC[LEADS[i]]; out[i] = vv[0]*L[0] + vv[1]*L[1] + vv[2]*L[2]; }
  if (tech === 'lara'){ // LA/RA cable swap
    const I = out[0], II = out[1], III = out[2], R = out[3], L = out[4];
    out[0] = -I; out[1] = III; out[2] = II; out[3] = L; out[4] = R;
  }
  return out;
}
function projectW(w){
  const out = new Float32Array(LEADS.length);
  if (w === 'all'){ out.fill(1); return out; }
  for (const k in w) if (k in LI) out[LI[k]] = w[k];
  return out;
}

// ---------- seeded RNG ----------
function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- component shapes ----------
// g: asymmetric gaussian; plat: logistic plateau; saw: flutter wave over one cycle
function G(c, sl, sr, a, v, tag){ return { k: 'g', c, sl, sr: sr ?? sl, a, v, tag }; }
function PLAT(t0, t1, e0, e1, a, v, tag){ return { k: 'p', t0, t1, e0, e1, a, v, tag }; }

function shape(cp, dt){
  if (cp.k === 'g'){ const d = dt - cp.c; const s = d < 0 ? cp.sl : cp.sr; const u = d / s; return u*u > 40 ? 0 : Math.exp(-0.5*u*u); }
  if (cp.k === 'p'){ return 1/(1+Math.exp(-(dt-cp.t0)/cp.e0)) * 1/(1+Math.exp((dt-cp.t1)/cp.e1)); }
  if (cp.k === 's'){ // flutter: slow descent, sharp negative deflection, quick recovery
    if (dt < 0 || dt > cp.cl) return 0; const u = dt / cp.cl;
    if (u < 0.55) return 0.25 - 0.55*(u/0.55);
    if (u < 0.72) return -0.30 - 0.70*((u-0.55)/0.17);
    if (u < 0.88) return -1.0 + 1.35*((u-0.72)/0.16);
    return 0.35 - 0.10*((u-0.88)/0.12);
  }
  return 0;
}
function extent(cp){
  if (cp.k === 'g') return [cp.c - 5*cp.sl, cp.c + 5*cp.sr];
  if (cp.k === 'p') return [cp.t0 - 7*cp.e0, cp.t1 + 7*cp.e1];
  if (cp.k === 's') return [0, cp.cl];
  return [0, 0];
}
function finalize(comps, tech){
  let s0 = Infinity, s1 = -Infinity;
  for (const cp of comps){
    const p = cp.w ? projectW(cp.w) : Array.isArray(cp.v) ? projectVec(cp.v, tech) : projectW(cp.v);
    for (let i = 0; i < p.length; i++) p[i] *= cp.a;
    cp.p = p; const e = extent(cp); if (e[0] < s0) s0 = e[0]; if (e[1] > s1) s1 = e[1];
  }
  return { comps, s0, s1 };
}

// ---------- pathology library ----------
// Each pathology: group, name, sev (optional slider), stages (optional), preset, eff(p) -> interval offsets,
// pmod(ctx) for P wave, apply(ctx) for QRS-ST-T, features [] teaching points.
const STEMI_STAGES = [['hyper','Hyperacute (first minutes)'], ['acute','Acute (ST elevation)'], ['evolved','Evolved (Q waves, T inversion)']];
function stemi(name, d, features, extra){
  return Object.assign({ group: 'Acute coronary syndromes', name, sev: { label: 'Peak ST deviation (12-lead)', min: 1, max: 6, step: 0.5, def: 3, unit: 'mm' },
    stages: STEMI_STAGES, stDir: dir(...d), features: features.concat([STEMI_CRIT]),
    apply(c){ stemiApply(c, this.stDir, c.sev, c.stage, this.antT || 0); } }, extra || {});
}
const STEMI_CRIT = 'STEMI criteria (ESC 2023 / 4th UDMI): new ST elevation at the J point in ≥ 2 contiguous leads, ≥ 1 mm in most leads; in V2–V3 ≥ 2 mm in men ≥ 40, ≥ 2.5 mm in men < 40, ≥ 1.5 mm in women.';
function stemiApply(c, d, mm, stage, antT){
  const a = (mm * 0.1) / c.maxAbs(d, ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6']);
  if (stage === 'hyper'){
    c.add(PLAT(c.D - 0.004, c.tPeak - 0.02, 0.006, 0.05, a*0.35, d, 'st'));
    c.add(G(c.tPeak - 0.015, 0.075, 0.055, a*1.6, d, 't'));
    if (antT) c.add(G(c.tPeak + 0.01, 0.06, 0.05, a*antT*1.4, dir(0.05,0.05,1), 't'));
  } else if (stage === 'acute'){
    c.add(PLAT(c.D - 0.004, c.tPeak + 0.01, 0.005, 0.045, a, d, 'st'));
    c.add(G(c.tPeak - 0.01, 0.07, 0.05, a*0.7, d, 't'));
    c.add(G(0.45*c.D, 0.12*c.D, 0.12*c.D, 0.25, neg(d), 'q')); // loss of R wave in the territory
    if (antT) c.add(G(c.tPeak + 0.01, 0.06, 0.05, a*antT, dir(0.05,0.05,1), 't')); // upright terminal T in V1–V3 (mirror of posterior T)
  } else {
    c.add(G(0.02, 0.011, 0.012, 0.75, neg(d), 'q')); // pathological Q (>= 40 ms)
    c.add(G(0.45*c.D, 0.12*c.D, 0.12*c.D, 0.35, neg(d), 'q'));
    c.add(PLAT(c.D - 0.004, c.tPeak, 0.006, 0.05, a*0.35, d, 'st'));
    c.add(G(c.tPeak, 0.05, 0.045, 0.45 + a*0.4, neg(d), 't'));
  }
}

const PATHOLOGIES = {
  normal: { group: 'Normal', name: 'Normal ECG', features: [
    'Sinus rhythm: upright P in I and II, every P followed by a QRS.',
    'PR 120–200 ms, QRS < 120 ms, QTc < 450 ms (men) or < 460 ms (women).',
    'R-wave progression with transition around V3–V4; small septal q waves in I, aVL, V5–V6.',
    'T waves upright in I, II and V3–V6; inverted in aVR; may be inverted in V1.'] },

  stemi_ant: stemi('Anterior STEMI (LAD)', [0.12,-0.12,1], [
    'ST elevation V1–V4, maximal V2–V3 (LAD territory).',
    'Proximal LAD occlusion adds I and aVL; reciprocal depression in III and aVF.',
    'Evolved: QS or Q waves V1–V3 with loss of R-wave progression and T inversion.',
    'Hyperacute stage: broad, tall, symmetric T waves before the ST segment lifts.']),
  stemi_antlat: stemi('Anterolateral STEMI (proximal LAD)', [0.6,-0.35,0.72], [
    'ST elevation V2–V6 plus I and aVL.',
    'Reciprocal ST depression in III and aVF (often the earliest clue).',
    'Suggests proximal LAD or LAD with a large diagonal; large myocardium at risk.']),
  stemi_lat: stemi('High lateral STEMI (D1 / circumflex)', [0.82,-0.55,0.1], [
    'ST elevation in I and aVL, ± V5–V6; can be subtle (small voltages in aVL).',
    'Reciprocal ST depression in III and aVF is often more obvious than the elevation.',
    'Shown here with lateral precordial (V5–V6) involvement. Isolated first-diagonal occlusion can instead give the "South African flag": STE in I, aVL and V2 with depression in III (not drawn here).']),
  stemi_inf: stemi('Inferior STEMI (RCA)', [-0.25,0.95,-0.35], [
    'ST elevation II, III, aVF with STE III > II (vector points rightward, typical of RCA).',
    'Reciprocal ST depression in aVL (and I): aVL depression is a sensitive early sign.',
    'Look for bradycardia and AV block (AV nodal artery usually from RCA).',
    'Check V1 and V4R for RV involvement; check V1–V3 depression for posterior extension.']),
  stemi_infrv: stemi('Inferior + RV STEMI (proximal RCA)', [-0.72,0.65,0.12], [
    'Inferior ST elevation with STE III > II and ST elevation in V1 that is greater than in V2 and fades by V3 (V2 > V1 would point to the LAD instead).',
    'ST elevation ≥ 0.5 mm in V3R/V4R (≥ 1 mm in men < 30) indicates RV involvement (switch on the right-sided leads). It is sensitive early but can resolve within hours.',
    'Clinical: preload-dependent; avoid nitrates; hypotension with clear lungs.'], { extraLeads: true }),
  stemi_post: stemi('Posterior STEMI (circumflex)', [0.12,0.1,-1], [
    'Horizontal ST depression V1–V3 with an upright terminal T wave: the mirror image of posterior STE. The upright T helps separate it from subendocardial ischaemia.',
    'Tall, broad R waves in V1–V2 (R/S > 1) when evolved: the mirror image of posterior Q waves.',
    'ST elevation ≥ 0.5 mm in V7–V9 (≥ 1 mm in men < 40) confirms it (switch on the posterior leads).'], { extraLeads: true, antT: 1.1 }),
  stemi_infpost: stemi('Inferoposterior STEMI', [0.0,0.78,-0.62], [
    'ST elevation II, III, aVF with ST depression V1–V3.',
    'Usually dominant circumflex or RCA with posterolateral branch.',
    'Posterior leads V7–V9 show ST elevation.'], { extraLeads: true, antT: 1.1 }),
  lmca: { group: 'Acute coronary syndromes', name: 'Left main / multivessel ischaemia', sev: { label: 'Max ST depression', min: 1, max: 5, step: 0.5, def: 2.5, unit: 'mm' },
    features: [
      'Widespread horizontal or downsloping ST depression, maximal V4–V6, I and II.',
      'ST elevation in aVR (± V1), typically with aVR STE > V1 STE.',
      'Pattern of diffuse subendocardial ischaemia: left main, proximal LAD or triple-vessel disease.',
      'Not diagnostic of occlusion by itself; interpret with the clinical picture.'],
    apply(c){ const d = dir(-0.62,-0.62,-0.2); const a = (c.sev*0.1) / c.maxProj(neg(d), ['II','V4','V5','V6']);
      c.add(PLAT(c.D - 0.004, c.tPeak + 0.01, 0.006, 0.04, a, d, 'st')); c.scale('t', 0.6); } },
  wellens: { group: 'Acute coronary syndromes', name: "Wellens syndrome", stages: [['B','Type B: deep symmetric T inversion'], ['A','Type A: biphasic T (V2–V3)']],
    features: [
      'Pain-free ECG pattern of critical proximal LAD stenosis (reperfused occlusion).',
      'Type A (~25%): biphasic T in V2–V3, up then down. Type B (~75%): deep, symmetric T inversion V2–V3 (± V1, V4–V6).',
      'Isoelectric or minimally elevated ST (< 1 mm), preserved R-wave progression, no Q waves.',
      'Stress testing is dangerous; needs angiography.'],
    apply(c){
      if (c.stage === 'A'){ c.add(G(c.tPeak + 0.06, 0.045, 0.05, 1, { V1: -0.15, V2: -0.55, V3: -0.5, V4: -0.25 }, 't')); }
      else { c.add(G(c.tPeak, 0.055, 0.055, 1, { V1: -0.35, V2: -1.05, V3: -1.0, V4: -0.75, V5: -0.4, V6: -0.2 }, 't')); }
    } },
  dewinter: { group: 'Acute coronary syndromes', name: 'De Winter T waves', features: [
      'STEMI equivalent of proximal LAD occlusion without ST elevation.',
      '1–3 mm upsloping ST depression at the J point in V1–V6 continuing into tall, symmetric T waves.',
      'Often 0.5–1 mm ST elevation in aVR.',
      'Pattern may be static; treat as an occlusion MI.'],
    apply(c){
      c.add(PLAT(c.D - 0.006, c.D + 0.03, 0.004, 0.05, 1, { V1: -0.08, V2: -0.28, V3: -0.32, V4: -0.3, V5: -0.2, V6: -0.12, I: -0.05, II: -0.05, aVR: 0.08 }, 'st'));
      c.add(G(c.tPeak - 0.02, 0.05, 0.045, 1, { V2: 0.6, V3: 0.75, V4: 0.65, V5: 0.4, V6: 0.2 }, 't'));
    } },

  hyperk: { group: 'Electrolytes', name: 'Hyperkalaemia', sev: { label: 'Serum K⁺', min: 5.5, max: 9.5, step: 0.1, def: 7.0, unit: 'mmol/L' },
    features: [
      'K⁺ 5.5–6.5: tall, narrow-based, peaked ("tented") T waves, best seen V2–V4; shortened QT.',
      'K⁺ 6.5–7.5: P-wave flattening and widening, PR prolongation.',
      'K⁺ 7–8: QRS widening, bizarre morphology; bradycardia, junctional or sinoventricular rhythm (P absent).',
      'K⁺ > 8.5–9: QRS merges with T to form a sine wave, then VF or asystole.',
      'Correlation with serum K⁺ is loose; any of these changes warrants calcium.'],
    eff(p, k){ return {
      prAdd: k > 6.5 ? Math.min(0.12, (k-6.5)*0.05) : 0,
      qrsAdd: k > 7.0 ? (k-7.0)*0.065 : 0,
      qtcAdd: -0.025*clamp((k-5)/2, 0, 1),
      rateMul: k > 8.0 ? Math.max(0.55, 1 - (k-8)*0.25) : 1,
      pAmp: k > 6.8 ? Math.max(0, 1 - (k-6.8)/1.3) : 1,
      pDur: 1 + clamp((k-6.5)*0.15, 0, 0.35) } },
    apply(c){ const k = c.sev, f = clamp((k-5.0)/2.0, 0, 1.4);
      c.scale('t', 0); // replace with a tented T
      const w = 0.032 + (k > 8.5 ? (k-8.5)*0.03 : 0);
      c.add(G(c.tPeak + 0.01, w, w*0.95, 0.32 + 0.55*f, c.Tdir, 't'));
      if (k > 8.3){ const s = 1 + (k-8.3)*0.9; c.broaden('q', s); c.scale('q', 1/Math.sqrt(s)); }
    } },
  hypok: { group: 'Electrolytes', name: 'Hypokalaemia', sev: { label: 'Serum K⁺', min: 1.5, max: 3.4, step: 0.1, def: 2.4, unit: 'mmol/L' },
    features: [
      'T-wave flattening or inversion with ST depression.',
      'Prominent U waves (> 1 mm, may exceed T), best seen V2–V3.',
      'Apparent QT prolongation is really a long QU interval (T–U fusion).',
      'Increased P amplitude and slight PR prolongation; risk of torsades and other arrhythmias.'],
    eff(p, k){ const f = clamp((3.5-k)/2, 0, 1); return { prAdd: 0.02*f, pAmp: 1 + 0.4*f }; },
    apply(c){ const f = clamp((3.5-c.sev)/2, 0, 1);
      c.scale('t', 1 - 0.8*f); c.scale('u', 0);
      c.add(G(c.QT + 0.075, 0.045, 0.05, 0.03 + 0.2*f, dir(0.3,0.5,0.8), 'u'));
      c.add(PLAT(c.D + 0.01, c.tPeak, 0.02, 0.04, 0.08*f, neg(c.Tdir), 'st')); } },
  hyperca: { group: 'Electrolytes', name: 'Hypercalcaemia', sev: { label: 'Corrected Ca²⁺', min: 2.7, max: 4.0, step: 0.05, def: 3.4, unit: 'mmol/L' },
    features: [
      'Short QT interval, mainly from a shortened ST segment (T wave starts at the end of the QRS).',
      'Severe (here above 3.4 mmol/L): small J waves (Osborn-like) and PR prolongation; bradyarrhythmias and AV block can follow.',
      'QTc below ~ 360 ms should prompt a calcium level.'],
    eff(p, ca){ return { qtcAdd: -(ca-2.5)*0.065, prAdd: ca > 3.4 ? (ca-3.4)*0.06 : 0 }; },
    apply(c){ if (c.sev > 3.4) c.add(G(c.D + 0.018, 0.012, 0.025, (c.sev-3.4)*0.18, dir(0.5,0.75,0.45), 'j')); } },
  hypoca: { group: 'Electrolytes', name: 'Hypocalcaemia', sev: { label: 'Corrected Ca²⁺', min: 1.3, max: 2.1, step: 0.05, def: 1.7, unit: 'mmol/L' },
    features: [
      'QT prolongation from lengthening of the ST segment; the T wave itself is of normal width.',
      'T wave may be narrow or flat; risk of torsades is lower than with other long-QT causes.',
      'Causes: hypoparathyroidism, post-thyroidectomy, pancreatitis, massive transfusion.'],
    tFixed: true,
    eff(p, ca){ return { qtcAdd: (2.25-ca)*0.17 }; } },

  tca: { group: 'Toxicology', name: 'TCA poisoning (Na⁺-channel blockade)', sev: { label: 'Severity', min: 1, max: 3, step: 1, def: 2, unit: '', labels: ['', 'Mild', 'Moderate', 'Severe'] },
    preset: { rhythm: 'sinus', rate: 125 },
    features: [
      'Sinus tachycardia (anticholinergic effect).',
      'QRS widening: > 100 ms predicts seizures, > 160 ms predicts ventricular arrhythmias.',
      'Terminal rightward axis: tall terminal R wave in aVR (> 3 mm) with R/S in aVR > 0.7; deep, slurred S in I and aVL.',
      'QTc prolongation; Brugada-like pattern may appear in V1–V2.',
      'Treat with sodium bicarbonate and watch the QRS narrow.'],
    eff(p, s){ return { qrsAdd: [0, 0.02, 0.05, 0.085][s], qtcAdd: [0, 0.03, 0.05, 0.07][s] }; },
    apply(c){ const s = c.sev; c.add(G(c.D*0.84, c.D*0.12, c.D*0.12, 0.3 + 0.24*s, dir(-0.75,-0.55,0.15), 'q')); } },
  dig: { group: 'Toxicology', name: 'Digoxin effect', features: [
      'Sagging, "scooped" ST depression with a reverse-tick shape, most obvious in the lateral leads.',
      'Flattened, inverted or biphasic T waves; shortened QT.',
      'Effect, not toxicity. Toxicity: frequent PVCs, bigeminy, atrial tachycardia with block, bidirectional VT, any AV block.'],
    eff(){ return { qtcAdd: -0.05, prAdd: 0.02 }; },
    apply(c){ c.scale('t', 0.35); c.add(G(c.D + 0.085, 0.07, 0.03, 0.2, neg(dir(0.65,0.7,0.25)), 'st')); } },

  hypothermia: { group: 'Environmental', name: 'Hypothermia', sev: { label: 'Core temperature', min: 24, max: 35, step: 0.5, def: 29, unit: '°C' },
    features: [
      'Osborn (J) waves: positive hump at the J point, most visible in inferior and lateral precordial leads; size grows as temperature falls.',
      'Sinus bradycardia with prolongation of PR, QRS and QT.',
      'Shivering artefact at 30–35 °C; usually lost below 30 °C.',
      'Below ~ 30 °C: AF with slow ventricular response, then VF and asystole. Try the AF rhythm with a low temperature.'],
    eff(p, T){ const d = clamp(36.5 - T, 0, 13); return { rateMul: Math.max(0.42, 1 - d*0.055), prAdd: d*0.009, qrsAdd: d > 5 ? (d-5)*0.006 : 0, qtcAdd: d*0.013, shiver: (T >= 30 && T < 35.5) ? 0.035 : 0 }; },
    apply(c){ const a = clamp((34.5 - c.sev)*0.055, 0, 0.6); if (a > 0) c.add(G(c.D + 0.022, 0.014, 0.03, a, dir(0.5,0.75,0.45), 'j')); } },

  pericarditis: { group: 'Inflammatory', name: 'Acute pericarditis', sev: { label: 'ST elevation', min: 0.5, max: 4, step: 0.5, def: 2.5, unit: 'mm' },
    stages: [['1','Stage 1: diffuse STE + PR depression'], ['2','Stage 2: ST normalises, T flattens'], ['3','Stage 3: diffuse T inversion'], ['4','Stage 4: resolution']],
    preset: { rhythm: 'sinus', rate: 102 },
    stDir: dir(0.55,0.78,0.28),
    features: [
      'Widespread concave ("saddle") ST elevation not confined to one coronary territory.',
      'PR depression in most leads with reciprocal PR elevation and ST depression in aVR (± V1).',
      'No reciprocal ST depression other than aVR and V1; no Q waves.',
      'Spodick sign (downsloping TP segment) and ST/T ratio > 0.25 in V6 favour pericarditis over early repolarisation.',
      'Sinus tachycardia is common. Stages evolve over days to weeks.'],
    pmod(c){ if (c.stage === '1') c.add(PLAT(c.Pd + 0.005, c.PR + 0.01, 0.01, 0.004, 0.04 + 0.03*c.sev, neg(this.stDir), 'pr')); },
    apply(c){ const d = this.stDir;
      if (c.stage === '1'){ const a = (c.sev*0.1) / c.maxProj(d, ['II','V5','V6','V4']); c.add(PLAT(c.D + 0.012, c.tPeak + 0.015, 0.02, 0.045, a, d, 'st')); }
      else if (c.stage === '2') c.scale('t', 0.3);
      else if (c.stage === '3') c.scale('t', -0.8);
    } },

  rbbb: { group: 'Conduction', name: 'Right bundle branch block', conduction: 'rbbb', preset: { qrs: 140 }, features: [
      'QRS ≥ 120 ms with rsR′ ("M") in V1–V2.',
      'Wide, slurred S wave in I, aVL, V5–V6.',
      'Secondary T-wave inversion and ST depression in V1–V3 (appropriate discordance).',
      'Axis usually normal; with left axis deviation think bifascicular block.'] },
  lbbb: { group: 'Conduction', name: 'Left bundle branch block', conduction: 'lbbb', preset: { qrs: 150, axis: 10 }, features: [
      'QRS ≥ 120 ms; dominant S (QS or rS) in V1.',
      'Broad, notched or monophasic R in I, aVL, V5–V6, with no q waves in I, V5 and V6 (a small q in aVL is allowed).',
      'Strict (Strauss) criteria, used for CRT selection: QRS ≥ 140 ms (men) or ≥ 130 ms (women) with mid-QRS notching in ≥ 2 of I, aVL, V1, V2, V5, V6.',
      'Appropriate discordance: ST and T deviate opposite to the main QRS deflection.',
      'Obscures ischaemia; use Sgarbossa (Smith-modified) criteria for suspected MI.'] },
  lafb: { group: 'Conduction', name: 'Left anterior fascicular block', conduction: 'lafb', preset: { axis: -55, qrs: 100 }, features: [
      'Left axis deviation (−45° to −90°).',
      'qR in I and aVL; rS in II, III and aVF.',
      'QRS < 120 ms, R-peak time in aVL ≥ 45 ms.'] },
  lpfb: { group: 'Conduction', name: 'Left posterior fascicular block', conduction: 'lpfb', preset: { axis: 115, qrs: 100 }, features: [
      'Right axis deviation (> +90°), a diagnosis of exclusion (rule out RVH, lateral MI, PE).',
      'rS in I and aVL; qR in II, III and aVF.',
      'Rare in isolation; usually accompanies RBBB.'] },
  bifasc: { group: 'Conduction', name: 'Bifascicular block (RBBB + LAFB)', conduction: 'rbbb', initial: 'lafb', preset: { axis: -60, qrs: 140 }, features: [
      'RBBB morphology in V1 plus left axis deviation from LAFB.',
      'With a long PR this is often called "trifascicular", a misnomer: the PR delay is usually in the AV node.',
      'Risk of progression to complete heart block. With unexplained syncope, an EP study or prolonged monitoring is recommended (ESC 2021).'] },
  wpw: { group: 'Conduction', name: 'WPW pre-excitation', ap: true, stages: [['ll','Left lateral pathway (type A)'], ['ps','Posteroseptal pathway'], ['rf','Right free-wall pathway (type B)']],
    features: [
      'Short PR (< 120 ms) with a slurred QRS upstroke (delta wave) and QRS > 110 ms.',
      'Secondary ST-T changes opposite the delta wave; delta polarity can mimic Q waves (pseudo-infarction).',
      'Left lateral pathway: positive delta in V1 (type A). Right-sided: negative V1 (type B).',
      'AF with a short accessory-pathway refractory period gives fast, irregular, broad, changing QRS complexes. Try the AF rhythm and shorten the AP refractory period. Avoid AV-nodal blockers.'],
    deltaDir(stage){ return stage === 'ps' ? dir(0.55,-0.75,0.15) : stage === 'rf' ? dir(0.8,0.15,-0.55) : dir(-0.5,0.45,0.72); } },

  lvh: { group: 'Hypertrophy', name: 'LVH with strain', preset: { qrs: 105 }, features: [
      'Increased voltage: S in V1 + R in V5 or V6 ≥ 35 mm (Sokolow–Lyon); alternatives include R in aVL ≥ 11 mm and Cornell (R aVL + S V3 > 28 mm men, > 20 mm women).',
      'Strain pattern: asymmetric T inversion and downsloping ST depression in I, aVL, V5–V6.',
      'Often left atrial enlargement (broad, notched P; deep terminal negative P in V1).',
      'Slight QRS widening and left axis shift.'],
    pmod(c){ c.lae = true; },
    apply(c){ const v = dir(0.6,0.35,-0.72); c.add(G(0.52*c.D, 0.12*c.D, 0.12*c.D, 1.6, v, 'q'));
      c.add(PLAT(c.D + 0.01, c.tPeak, 0.015, 0.04, 0.09, neg(v), 'st')); c.scale('t', 0.3); c.add(G(c.tPeak, 0.07, 0.035, 0.35, neg(v), 't')); } },
  rvh: { group: 'Hypertrophy', name: 'Right ventricular hypertrophy', preset: { axis: 115 }, features: [
      'Right axis deviation (≥ +110°).',
      'Dominant R wave in V1 (R/S > 1, R > 7 mm); deep S waves in V5–V6.',
      'RV strain: ST depression and T inversion in V1–V3 (and inferior leads).',
      'Right atrial enlargement: peaked P > 2.5 mm in II (P pulmonale).'],
    pmod(c){ c.rae = true; },
    apply(c){ const v = dir(-0.55,0.35,0.78); c.scale('lv', 0.5); c.add(G(0.55*c.D, 0.12*c.D, 0.12*c.D, 1.0, v, 'q'));
      c.add(G(c.tPeak, 0.065, 0.04, 0.3, neg(v), 't')); } },
  rae: { group: 'Hypertrophy', name: 'Right atrial enlargement (P pulmonale)', features: [
      'Tall, peaked P waves > 2.5 mm in II, III and aVF.',
      'Prominent initial positive P in V1–V2 (> 1.5 mm).',
      'Seen with pulmonary hypertension, COPD, tricuspid disease.'], pmod(c){ c.rae = true; } },
  lae: { group: 'Hypertrophy', name: 'Left atrial enlargement (P mitrale)', features: [
      'Broad P wave ≥ 120 ms, notched ("bifid") in II with peaks > 40 ms apart.',
      'Deep, broad terminal negative P in V1 (≥ 1 mm × 40 ms, the Morris index).',
      'Seen with mitral stenosis/regurgitation, hypertension, LVH.'], pmod(c){ c.lae = true; } },

  pe: { group: 'Other', name: 'Acute pulmonary embolism', preset: { rhythm: 'sinus', rate: 115, axis: 85 }, features: [
      'Sinus tachycardia is the most common finding.',
      'RV strain: T inversion V1–V4 and in III; may be the only sign.',
      'S1Q3T3: S in I, Q and inverted T in III. Insensitive and not specific.',
      'Right axis shift, incomplete or complete RBBB, clockwise rotation, and occasionally AF.'],
    pmod(c){ c.rae = true; },
    apply(c){ c.add(G(0.78*c.D, 0.09*c.D, 0.09*c.D, 0.38, dir(-0.75,-0.35,0.35), 'q'));
      c.add(G(0.14*c.D, 0.06*c.D, 0.06*c.D, 0.28, dir(0.35,-0.95,0), 'q'));
      c.add(G(0.86*c.D, 0.08*c.D, 0.06*c.D, 0.2, dir(-0.5,0.05,0.85), 'q'));
      c.add(G(c.tPeak, 0.065, 0.05, 0.42, dir(-0.15,-0.25,-0.95), 't'));
      c.add(G(c.tPeak, 0.065, 0.05, 0.2, dir(0.1,-1,0), 't')); } },
  brugada: { group: 'Other', name: 'Brugada pattern', stages: [['1','Type 1: coved'], ['2','Type 2: saddleback']], features: [
      'Type 1 (diagnostic): coved ST elevation ≥ 2 mm in V1–V2 descending into an inverted T wave.',
      'Type 2: saddleback ST elevation ≥ 0.5 mm with upright or biphasic T (suggestive only).',
      'Pseudo-RBBB appearance in V1–V2 without wide S in the lateral leads.',
      'Unmasked by fever, sodium-channel blockers and high V1–V2 lead placement. Risk of VF and sudden death.'],
    apply(c){
      if (c.stage === '2'){ c.add(PLAT(c.D - 0.006, c.D + 0.012, 0.004, 0.02, 1, { V1: 0.12, V2: 0.22 }, 'st')); c.add(PLAT(c.D + 0.01, c.tPeak, 0.02, 0.05, 1, { V1: 0.08, V2: 0.1 }, 'st')); }
      else { c.add(PLAT(c.D - 0.008, c.D + 0.025, 0.004, 0.05, 1, { V1: 0.62, V2: 0.58, V3: 0.08 }, 'st')); c.add(G(c.tPeak + 0.01, 0.05, 0.05, 1, { V1: -0.22, V2: -0.62 }, 't')); }
    } },
  ber: { group: 'Other', name: 'Early repolarisation / normal-variant ST elevation', preset: { rate: 60 }, features: [
      'Mild concave ST elevation, mostly V2–V5, with a notched or slurred J point (fish-hook) in V4. "Benign early repolarisation" is an outdated term.',
      'Consensus (2015): the early repolarisation pattern is J-point notching or slurring ≥ 1 mm in ≥ 2 contiguous inferior or lateral leads; concave precordial STE alone is a normal variant ("male pattern").',
      'Prominent, slightly asymmetric T waves concordant with the QRS.',
      'No reciprocal depression (except aVR), no PR depression, stable over time.',
      'Common in young, fit, male patients with slower heart rates.'],
    apply(c){ const d = dir(0.45,0.4,0.8); c.add(PLAT(c.D + 0.004, c.tPeak + 0.02, 0.012, 0.045, 0.1, d, 'st'));
      c.add(G(c.D + 0.006, 0.006, 0.012, 0.11, d, 'j')); c.scale('t', 1.3); } },
  lqts: { group: 'Other', name: 'Long QT syndrome', preset: { qtc: 540 }, features: [
      'Diagnosis (ESC 2022): QTc ≥ 480 ms on repeated ECGs, or an LQTS risk score > 3; QTc ≥ 460 ms suffices with unexplained syncope. QTc > 500 ms carries high torsades risk.',
      'T-wave clues to genotype: broad-based T (LQT1), low-amplitude notched T (LQT2, the pattern shown), long isoelectric ST with late narrow T (LQT3). T-wave alternans in high-risk states.',
      'Causes: congenital channelopathy or acquired (drugs, hypoK, hypoMg, bradycardia).',
      'Torsades de pointes is the associated arrhythmia; try that rhythm.'],
    apply(c){ c.scale('t', 0.55); c.add(G(c.tPeak + 0.045, 0.05, 0.05, 0.16, c.Tdir, 't')); } },
  icp: { group: 'Other', name: 'Raised intracranial pressure', preset: { rate: 52, qtc: 560 }, features: [
      'Giant, wide, inverted "cerebral" T waves, widespread (often precordial).',
      'Marked QT prolongation; prominent U waves.',
      'Bradycardia (Cushing reflex). Seen with subarachnoid haemorrhage and other acute brain injury.'],
    apply(c){ c.scale('t', 0); c.add(G(c.tPeak, 0.1, 0.07, 0.75, neg(dir(0.4,0.55,0.75)), 't')); c.scale('u', 3); } },
  dextro: { group: 'Technical', name: 'Dextrocardia', tech: 'dextro', features: [
      'Inverted P, QRS and T in lead I; aVR and aVL appear swapped.',
      'Absent R-wave progression: QRS gets smaller from V1 to V6.',
      'Right-sided chest leads restore normal progression. Compare with LA/RA lead reversal, where the chest leads stay normal.'] },
  lara: { group: 'Technical', name: 'LA/RA limb lead reversal', tech: 'lara', features: [
      'Lead I fully inverted (P, QRS, T negative), with II and III swapped and aVR and aVL swapped.',
      'aVR may look upright and normal-looking.',
      'Chest leads are normal, unlike dextrocardia.'] },
};

// ---------- rhythm library ----------
const RHYTHMS = {
  sinus: { group: 'Sinus', name: 'Sinus rhythm', atrial: 'sinus', preset: { rate: 75 }, features: [
    'Regular P waves at 60–100 /min with normal axis (upright in I, II, aVF).',
    'Every P followed by a QRS with a constant PR interval.',
    'Drag the rate below 60 or above 100 for sinus bradycardia or tachycardia.'] },
  sinus_arr: { group: 'Sinus', name: 'Sinus arrhythmia', atrial: 'sinus', preset: { rate: 68, rsa: 18 }, features: [
    'Phasic variation of the P–P interval with respiration (> 120 ms between longest and shortest).',
    'Normal P morphology and constant PR throughout.',
    'Normal, especially in the young; the respiratory variation slider controls it.'] },
  sinus_pac: { group: 'Sinus', name: 'Sinus with PACs', atrial: 'sinus', preset: { rate: 72, pac: 18 }, features: [
    'Early P waves with a different morphology, usually followed by a narrow QRS.',
    'Non-compensatory pause: the sinus node is reset.',
    'Very early PACs block in the AV node (non-conducted PAC) or conduct with aberrancy (often RBBB-like).'] },
  sinus_pvc: { group: 'Sinus', name: 'Sinus with PVCs (bigeminy)', atrial: 'sinus', preset: { rate: 72, pvc: 'bigeminy' }, features: [
    'Early, wide, bizarre QRS with no preceding P and discordant T wave.',
    'Fully compensatory pause: the sinus P falls during ventricular refractoriness or is blocked in the AV node by concealed retrograde conduction.',
    'Bigeminy: every other beat is a PVC. Change the PVC pattern to see trigeminy, couplets or single ectopics.'] },
  sinus_brady: { group: 'Sinus', name: 'Sinus bradycardia', atrial: 'sinus', preset: { rate: 42 }, features: [
    'Sinus rhythm below 60 /min with normal P waves and PR.',
    'Causes: fitness, sleep, drugs (beta-blockers, calcium-channel blockers), hypothyroidism, sinus node dysfunction, inferior MI.',
    'A common underlying rhythm for AAI or DDD pacing: below the lower rate the device paces the atrium.'] },
  af: { group: 'Atrial', name: 'Atrial fibrillation', atrial: 'af', preset: { avnERP: 320 }, features: [
    'Irregularly irregular ventricular rhythm with no discernible P waves.',
    'Fibrillatory (f) waves of variable amplitude, best seen in V1 and inferior leads.',
    'Ventricular rate is set by AV-node refractoriness and concealed conduction: lengthen the AV-node ERP (as with beta-blockers, verapamil or digoxin) to slow it.',
    'Long–short cycles may produce Ashman (RBBB-aberrant) beats.'] },
  af_slow: { group: 'Atrial', name: 'AF with slow ventricular response', atrial: 'af', preset: { avnERP: 780 }, features: [
    'Irregularly irregular rhythm with fibrillatory waves and long pauses.',
    'Ventricular rate < 60 /min from AV-nodal disease or rate-control drugs (here a very long AV-node refractory period).',
    'Typical indication for VVI pacing: the device fills the pauses at the lower rate. Dual-chamber devices mode-switch and stop tracking.'] },
  flutter: { group: 'Atrial', name: 'Atrial flutter (2:1)', atrial: 'flutter', preset: { rate: 300, avnERP: 200 }, features: [
    'Typical counter-clockwise flutter: sawtooth F waves at ~300 /min, negative in II, III, aVF and positive in V1.',
    '2:1 conduction gives a regular ventricular rate of ~150 /min; always suspect flutter at 150.',
    'AV-node ERP sets the conduction ratio: lengthen it to see 3:1 and 4:1.'] },
  flutter4: { group: 'Atrial', name: 'Atrial flutter (4:1)', atrial: 'flutter', preset: { rate: 300, avnERP: 600 }, features: [
    'Same atrial circuit at ~300 /min with more AV-nodal block (here 4:1).',
    'Sawtooth waves are easiest to see when the conduction ratio is high.',
    'Varying the ERP gives variable block and an irregular rhythm that mimics AF.'] },
  avnrt: { group: 'Atrial', name: 'AVNRT (SVT)', atrial: 'none', auto: 'avnrt', preset: { vrate: 180 }, features: [
    'Regular narrow-complex tachycardia, typically 140–250 /min.',
    'Typical (slow–fast) AVNRT: retrograde P buried in or just after the QRS, giving a pseudo-r′ in V1 and pseudo-S waves in II, III, aVF.',
    'Ladder: anterograde down the slow pathway, retrograde up the fast pathway, re-entering within the AV node.',
    'Terminated by vagal manoeuvres or adenosine.'] },
  junctional: { group: 'Atrial', name: 'Junctional rhythm', atrial: 'none', auto: 'junc', preset: { vrate: 50 }, features: [
    'Regular narrow QRS at 40–60 /min (accelerated junctional 60–100, junctional tachycardia > 100).',
    'P waves absent, or retrograde (inverted in II, III, aVF) just before, within or after the QRS.',
    'Seen with sinus node dysfunction, digoxin, beta-blockers, inferior MI.'] },
  avb1: { group: 'AV block', name: '1st-degree AV block', atrial: 'sinus', preset: { rate: 72, pr: 290 }, features: [
    'PR interval > 200 ms, constant, with every P conducted.',
    'Delay is usually in the AV node; often benign.',
    'Ladder: a longer, more oblique (flatter) line across the AV tier.'] },
  mobitz1: { group: 'AV block', name: '2nd-degree type I (Wenckebach)', atrial: 'sinus', preset: { rate: 75, pr: 160, avnERP: 530, avnDec: 90, rsa: 0 }, features: [
    'Progressive PR prolongation until a P wave is not conducted, then the cycle repeats.',
    'The largest PR increment is usually on the second beat, so R–R intervals shorten before the pause ("group beating").',
    'The pause is less than two P–P intervals; the PR after the pause is the shortest.',
    'Here it emerges from AV-node physiology: a long nodal refractory period with decremental conduction. Shorten the AV-node ERP and it resolves.'] },
  mobitz2: { group: 'AV block', name: '2nd-degree type II (Mobitz II)', atrial: 'sinus', his: 'mobitz', preset: { rate: 90, ratio: 4 }, features: [
    'Constant PR in conducted beats, then a sudden non-conducted P wave.',
    'Block is infranodal (His–Purkinje), so the QRS is often wide (bundle branch block).',
    'Risk of progression to complete heart block; needs pacing.',
    'Ladder: the block sits low in the AV tier, below the node.'] },
  avb21: { group: 'AV block', name: '2:1 AV block', atrial: 'sinus', his: 'fixed', preset: { rate: 90, ratio: 2 }, features: [
    'Every other P wave is conducted; constant PR in conducted beats.',
    'Cannot be classified as type I or II from the strip alone: a wide QRS favours infranodal block, a long PR with narrow QRS favours nodal.',
    'Non-conducted P waves may hide in the preceding T wave.'] },
  avbhg: { group: 'AV block', name: 'High-grade AV block (3:1)', atrial: 'sinus', his: 'fixed', preset: { rate: 80, ratio: 3 }, features: [
    'Two or more consecutive non-conducted P waves with some conducted beats (constant PR).',
    'Distinguished from complete heart block by consistent PR in conducted beats.',
    'Often infranodal, but can be nodal (inferior MI, drugs, high vagal tone). Exclude reversible causes; persistent advanced AV block needs pacing.',
    'Here a junctional escape (~40 /min) fills the longest pauses, as often happens in practice.'] },
  chb: { group: 'AV block', name: '3rd-degree (complete) heart block', atrial: 'sinus', his: 'complete', auto: 'escape', preset: { rate: 85, vrate: 40, escape: 'junctional' }, features: [
    'Complete AV dissociation: P waves and QRS complexes march out independently.',
    'Atrial rate faster than ventricular rate; PR varies randomly.',
    'Junctional escape (40–60 /min, narrow) or ventricular escape (20–40 /min, wide); change the escape focus below.',
    'Ladder: no impulse crosses the AV tier.'] },
  vt: { group: 'Ventricular', name: 'Monomorphic VT', atrial: 'sinus', auto: 'vt', preset: { rate: 80, vrate: 170 }, features: [
    'Regular broad-complex tachycardia, QRS > 120 ms (often > 160 ms).',
    'AV dissociation: P waves march through at a slower rate (shown in the ladder). Capture and fusion beats are diagnostic.',
    'Watch for them here: a capture beat (C on the ladder) is an early, narrow, normal-looking QRS conducted from a sinus P; a fusion beat (F) has an intermediate shape because the sinus wavefront and the VT focus activate the ventricles together.',
    'Extreme (northwest) axis, concordance across the chest leads, and RBBB- or LBBB-like morphologies.',
    'Assume VT for any regular broad-complex tachycardia until proven otherwise.'] },
  aivr: { group: 'Ventricular', name: 'Accelerated idioventricular rhythm', atrial: 'sinus', auto: 'aivr', preset: { rate: 68, vrate: 82 }, features: [
    'Regular wide-complex rhythm at 50–110 /min, slightly faster than the sinus rate.',
    'AV dissociation with capture (C) and fusion (F) beats at transitions, labelled on the ladder.',
    'Classic reperfusion rhythm after thrombolysis or PCI; usually benign and self-limited.'] },
  tdp: { group: 'Ventricular', name: 'Torsades de pointes', atrial: 'none', auto: 'tdp', preset: { vrate: 230, qtc: 560 }, features: [
    'Polymorphic VT with QRS amplitude and axis twisting around the baseline.',
    'Occurs on a background of a long QT interval, often triggered by a short–long–short sequence.',
    'Treat with IV magnesium, correct K⁺ and Mg²⁺ and stop QT-prolonging drugs. Defibrillate if sustained.',
    'For recurrent pause-dependent (acquired) torsades: temporary overdrive pacing or isoprenaline. Isoprenaline is contraindicated in congenital long QT (especially LQT1), where beta-blockade is the treatment.'] },
  vf: { group: 'Ventricular', name: 'Ventricular fibrillation', atrial: 'none', auto: 'vf', preset: {}, features: [
    'Chaotic, irregular deflections of varying amplitude with no identifiable QRS, ST or T.',
    'Coarse VF becomes fine VF with time.',
    'Cardiac arrest: immediate defibrillation.'] },
};

// device presets: change pacemaker settings only; the underlying rhythm stays under the user's control
const PACE_PRESETS = {
  vvi: { name: 'VVI, RV apical lead', set: { pmMode: 'VVI', pmSite: 'rva', pmLR: 60 }, suggest: { rhythm: 'af_slow', label: 'AF with slow ventricular response' }, features: [
    'Ventricular demand pacing: inhibited by sensed QRS complexes, paces when the R–R interval exceeds the lower rate interval.',
    'No AV synchrony: over sinus rhythm with AV block, P waves march through independently.',
    'Over intact conduction at a faster native rate the device stays inhibited and you see only native beats.'] },
  aai: { name: 'AAI, atrial lead', set: { pmMode: 'AAI', pmLR: 70 }, suggest: { rhythm: 'sinus_brady', label: 'Sinus bradycardia' }, features: [
    'Atrial spike followed by a paced P wave, then native AV conduction and a narrow QRS.',
    'Stimulus-to-QRS is slightly longer than the native PR (latency from the RA appendage).',
    'Needs intact AV conduction: try it over Wenckebach or complete heart block to see why AAI alone is risky.'] },
  ddd: { name: 'DDD, dual chamber', set: { pmMode: 'DDD', pmLR: 60, pmSAV: 150, pmPAV: 200 }, suggest: { rhythm: 'chb', label: 'Complete heart block' }, features: [
    'Tracks sensed P waves (AS–VP) up to the upper rate; below the lower rate paces both chambers in sequence (AP–VP).',
    'With intact conduction and a PR longer than the sensed AV delay the ventricle is paced; fusion or pseudofusion appears when native conduction arrives close to the paced beat. Lengthen the SAV to let native conduction through.',
    'Over AF or flutter the device mode-switches to non-tracking pacing.'] },
  ddd_ur: { name: 'DDD upper-rate behaviour', set: { pmMode: 'DDD', pmLR: 60, pmUR: 120, pmSAV: 150, pmPVARP: 250 }, suggest: { rhythm: 'chb', rate: 135, label: 'Complete heart block, sinus 135' }, features: [
    'Sinus rate above the upper tracking rate: V pacing is held until the upper-rate interval has elapsed, so AS–VP lengthens.',
    'Eventually a P falls in PVARP, is not tracked (AR) and a beat drops: pacemaker Wenckebach.',
    'Once the sinus rate exceeds 60 000 / (SAV + PVARP), every other P falls in PVARP: fixed 2:1 block.'] },
  crt: { name: 'CRT (biventricular)', set: { pmMode: 'DDD', pmSite: 'biv', pmLR: 60, pmSAV: 100, pmPAV: 130 }, suggest: { rhythm: 'sinus', pathology: 'lbbb', label: 'Sinus rhythm with LBBB' }, features: [
    'Short AV delays keep every beat biventricularly paced; any native beat shows the underlying conduction.',
    'Typical BiV pattern: dominant R in V1, Q or QS in lead I, right or northwest axis, QRS narrower than RV pacing.',
    'Positive lead I or loss of the R in V1 suggests LV lead loss of capture. Use the V–V offset for LV-first pacing (two spikes).'] },
  his: { name: 'His bundle pacing', set: { pmMode: 'DDD', pmSite: 'his_s', pmLR: 60, pmSAV: 120 }, suggest: { rhythm: 'avb21', label: '2:1 AV block' }, features: [
    'Selective capture: spike, isoelectric gap (≈ native HV interval), then a QRS identical to native conduction.',
    'Non-selective capture: no gap; pseudo-delta from local septal capture merging into a near-normal QRS.',
    'Change the site between selective and non-selective His to compare.'] },
  lbbap: { name: 'Left bundle branch area pacing', set: { pmMode: 'DDD', pmSite: 'lbbap', pmLR: 60, pmSAV: 120 }, suggest: { rhythm: 'chb', label: 'Complete heart block' }, features: [
    'Lead deep in the LV septum captures the left bundle.',
    'Paced QRS has an RBBB-type pattern (qR or rSR′ in V1) because the right bundle activates late.',
    'Short, constant stimulus to LV activation time in V5–V6; QRS ≈ 110–130 ms.'] },
  magnet: { name: 'Magnet applied (DOO)', set: { pmMode: 'DOO', pmLR: 85, pmPAV: 120 }, suggest: { rhythm: 'sinus', rate: 94, label: 'Sinus rhythm at 94' }, features: [
    'Magnet forces asynchronous pacing (DOO/VOO) at the magnet rate, ignoring intrinsic activity.',
    'Competition with a faster native rhythm: spikes land at fixed intervals, some on T waves or in native QRS (functional non-capture).',
    'Magnet rate varies by manufacturer and falls as the battery depletes.',
    'On an ICD a magnet suspends tachycardia therapies but does not switch to asynchronous pacing.'] },
};

// default parameter set (UI units: ms, bpm, degrees, %)
const DEFAULTS = {
  rhythm: 'sinus', pathology: 'normal', stage: null, sev: null,
  rate: 75, vrate: 60, pr: 160, qrs: 90, qtc: 410, axis: 55,
  avnERP: 260, avnDec: 25, vERP: 260, apERP: 280, ratio: 4, escape: 'junctional',
  pvc: 'none', pvcOrigin: 'rvot', pvcCoupling: 440, pac: 0, rsa: 4, noise: 15, wander: 10,
  pmPreset: 'custom', pmMode: 'off', pmSite: 'rva', pmLR: 60, pmUR: 120, pmPAV: 180, pmSAV: 150, pmPVARP: 250, pmVV: 0, pmPolarity: 'bipolar', pmACap: 'ok', pmVCap: 'ok', pmVSense: 'ok',
};

// ---------- effective parameters ----------
function effective(p){
  const path = PATHOLOGIES[p.pathology] || PATHOLOGIES.normal;
  const e = { rateMul: 1, prAdd: 0, qrsAdd: 0, qtcAdd: 0, pAmp: 1, pDur: 1, shiver: 0 };
  if (path.eff) Object.assign(e, path.eff(p, p.sev ?? (path.sev && path.sev.def)));
  return {
    rate: p.rate * (e.rateMul ?? 1), vrate: p.vrate * (e.rateMul ?? 1),
    pr: p.pr/1000 + (e.prAdd || 0), qrs: Math.max(0.06, p.qrs/1000 + (e.qrsAdd || 0)),
    qtc: Math.max(0.28, p.qtc/1000 + (e.qtcAdd || 0)), axis: p.axis,
    pAmp: e.pAmp ?? 1, pDur: e.pDur ?? 1, shiver: e.shiver || 0,
    avnERP: p.avnERP/1000, avnA: 0.08 + 0.19*(p.avnDec/100), avnTau: 0.02 + 0.2*(p.avnDec/100),
    vERP: p.vERP/1000, apERP: p.apERP/1000,
    path, sev: p.sev ?? (path.sev && path.sev.def), stage: p.stage ?? (path.stages && path.stages[0][0]),
    tech: path.tech || null,
  };
}

// ---------- morphology builders ----------
function makeCtx(e, extras){
  const comps = [];
  const c = Object.assign({ comps, sev: e.sev, stage: e.stage,
    add(cp){ comps.push(cp); return cp; },
    scale(tag, f){ for (const cp of comps) if (cp.tag === tag || (cp.sub && cp.sub === tag)) cp.a *= f; },
    broaden(tag, f){ for (const cp of comps) if (cp.tag === tag && cp.k === 'g'){ cp.sl *= f; cp.sr *= f; cp.c *= Math.sqrt(f); } },
    maxAbs(v, leads){ const p = projectVec(v, null); let m = 0.05; for (const n of leads){ const x = Math.abs(p[LI[n]]); if (x > m) m = x; } return m; },
    maxProj(v, leads){ const p = projectVec(v, null); let m = 0.05; for (const n of leads){ const x = p[LI[n]]; if (x > m) m = x; } return m; },
  }, extras);
  return c;
}

function buildP(kind, e, cl){
  const comps = [];
  const path = e.path;
  const c = { add(cp){ comps.push(cp); }, stage: e.stage, sev: e.sev, Pd: 0.1*e.pDur, PR: e.pr, rae: false, lae: false };
  if (path.pmod) path.pmod.call(path, c);
  const amp = e.pAmp;
  if (kind === 'flutter'){ comps.push({ k: 's', cl, a: 0.17, v: dir(0.1,0.9,-0.42), tag: 'p' }); return finalize(comps, e.tech); }
  if (kind === 'retro'){ const Pd = 0.08; comps.push(G(Pd*0.5, Pd*0.24, Pd*0.24, 0.13*amp, dir(-0.15,-0.95,0.35), 'p')); return finalize(comps, e.tech); }
  if (kind === 'pac'){ const Pd = 0.09; comps.push(G(Pd*0.5, Pd*0.22, Pd*0.24, 0.13*amp, dir(0.85,0.35,0.5), 'p')); return finalize(comps, e.tech); }
  let Pd = c.Pd;
  if (c.lae){ Pd = Math.max(Pd, 0.13);
    comps.push(G(Pd*0.28, Pd*0.13, Pd*0.15, 0.11*amp, dir(0.25,0.9,0.45), 'p'));
    comps.push(G(Pd*0.68, Pd*0.15, Pd*0.15, 0.16*amp, dir(0.6,0.5,-0.75), 'p'));
  } else {
    comps.push(G(Pd*0.36, Pd*0.17, Pd*0.17, (c.rae ? 0.31 : 0.11)*amp, dir(0.25,0.9,0.45), 'p'));
    comps.push(G(Pd*0.62, Pd*0.18, Pd*0.18, 0.09*amp, dir(0.75,0.5,-0.5), 'p'));
  }
  return finalize(comps, e.tech);
}

// QRS reference components at axis +60 (normalised time in fractions of D)
function qrsNormal(D, initial){
  const sep = initial === 'lafb' ? G(0.13*D, 0.08*D, 0.08*D, 0.2, dir(-0.25,0.85,0.35), 'q')
            : initial === 'lpfb' ? G(0.13*D, 0.08*D, 0.08*D, 0.22, dir(0.6,-0.65,0.3), 'q')
            : G(0.12*D, 0.07*D, 0.07*D, 0.16, dir(-0.6,-0.05,0.8), 'q');
  sep.fixed = true;
  return [ sep,
    Object.assign(G(0.36*D, 0.10*D, 0.10*D, 0.85, dir(0.5,0.866,0.42), 'q'), { sub: 'lv' }),
    Object.assign(G(0.53*D, 0.11*D, 0.11*D, 1.15, dir(0.6,0.75,-0.5), 'q'), { sub: 'lv' }),
    G(0.79*D, 0.08*D, 0.08*D, 0.28, dir(-0.35,-0.55,-0.6), 'q'),
  ];
}

function buildConducted(e, info){
  const path = e.path;
  const D0 = e.qrs;
  let conduction = info.forceConduction || path.conduction || 'normal';
  if (info.aberrant && conduction === 'normal') conduction = 'rbbb';
  const initial = path.initial || (conduction === 'lafb' || conduction === 'lpfb' ? conduction : null);
  const rr = clamp(info.rr || 60/e.rate, 0.3, 2.2);
  let D = info.qrsOverride || D0;
  if (conduction === 'rbbb' && D < 0.125) D = info.aberrant ? 0.13 : Math.max(D, 0.12);
  if (conduction === 'lbbb' && D < 0.125) D = 0.13;
  const axisRot = e.axis - 53;
  const comps = [];
  if (conduction === 'lbbb'){
    comps.push(G(0.28*D, 0.15*D, 0.14*D, 0.95, dir(0.8,0.25,-0.5), 'q'));
    comps.push(G(0.62*D, 0.16*D, 0.15*D, 1.25, dir(0.75,0.15,-0.62), 'q'));
  } else if (conduction === 'rbbb'){
    const Dn = Math.min(0.09, D*0.68);
    for (const cp of qrsNormal(Dn, initial)) comps.push(cp);
    comps.push(Object.assign(G(D - 0.034, 0.02 + (D-0.12)*0.12, 0.016 + (D-0.12)*0.1, 0.55, dir(-0.62,0.05,0.8), 'q'), { fixed: true, rterm: true }));
  } else {
    for (const cp of qrsNormal(D, initial)) comps.push(cp);
  }
  const rotBy = conduction === 'lbbb' ? e.axis - 14 : axisRot;
  for (const cp of comps) if (!cp.fixed) cp.v = rotZ(cp.v, rotBy);
  // pre-excitation
  let lead = 0, deltaDir = null;
  if (info.preexc){
    const k = info.preexc.k; lead = info.preexc.lead; deltaDir = info.deltaDir || (path.deltaDir ? path.deltaDir(e.stage) : dir(-0.5,0.45,0.72));
    for (const cp of comps){ cp.c += lead; cp.a *= (1 - 0.4*Math.min(1, k)); }
    comps.push(G(lead*0.95, Math.max(0.012, lead*0.55), 0.022, 0.25 + 0.4*Math.min(1.3, k), deltaDir, 'q'));
  }
  const Dtot = D + lead;
  let QT = e.qtc * Math.sqrt(rr) + Math.max(0, D - 0.1)*0.8 + lead;
  QT = Math.max(QT, Dtot + 0.14);
  const wf = path.tFixed ? 1 : clamp(QT/0.38, 0.75, 1.5);
  const tsl = 0.072*wf, tsr = 0.045*wf;
  let tPeak = QT - 2.3*tsr;
  if (tPeak - 1.2*tsl < Dtot) tPeak = Dtot + 1.2*tsl;
  let Tdir = rotZ(dir(0.6,0.75,0.42), axisRot/2);
  const ctx = makeCtx(e, { D: Dtot, QT, tPeak, tsl, tsr, Tdir, axisRot });
  for (const cp of comps) ctx.add(cp);
  if (conduction === 'lbbb'){
    const m = rotZ(dir(0.75,0.15,-0.62), rotBy);
    ctx.add(G(tPeak, tsl, tsr, 0.42, neg(m), 't'));
    ctx.add(PLAT(Dtot, tPeak, 0.01, 0.04, 0.14, neg(m), 'st'));
  } else {
    ctx.add(G(tPeak, tsl, tsr, 0.33, Tdir, 't'));
    if (conduction === 'rbbb') ctx.add(G(tPeak - 0.02, 0.06, 0.045, 0.24, dir(0.62,0,-0.8), 't'));
  }
  if (deltaDir) ctx.add(G(tPeak, tsl, tsr, 0.16*Math.min(1, info.preexc.k), neg(deltaDir), 't'));
  ctx.add(G(QT + 0.07, 0.035, 0.04, 0.03, dir(0.35,0.5,0.8), 'u'));
  if (path.apply) path.apply.call(path, ctx);
  const m = finalize(ctx.comps, e.tech);
  m.D = Dtot; m.QT = QT; m.lead = lead;
  return m;
}

// Wide ectopic / ventricular beats
function buildVentricular(kind, e, info){
  const comps = [];
  let D = 0.16, v1, v2, tAmp = 0.45, spike = false;
  if (kind === 'paced'){ D = 0.16; v1 = dir(0.35,-0.75,-0.55); v2 = dir(0.55,-0.55,-0.55); spike = true; }
  else if (kind === 'vt' || kind === 'escV' || kind === 'aivr' || (kind === 'pvc' && e.pvcOrigin === 'lv')){ D = kind === 'vt' ? 0.17 : 0.16; v1 = dir(-0.35,-0.75,0.6); v2 = dir(0.15,-0.6,0.75); }
  else if (kind === 'tdp'){ D = 0.14; const ph = 2*Math.PI*info.t/2.6; v1 = norm([Math.cos(ph), 0.4*Math.sin(ph), 0.6*Math.sin(ph+1)]); v2 = v1; tAmp = 0.2; }
  else { D = 0.15; v1 = dir(0.35,0.85,-0.45); v2 = dir(0.6,0.5,-0.6); }
  if (e.qrs > 0.12) D = Math.max(D, e.qrs + 0.04);
  let amp = 1;
  if (kind === 'tdp') amp = 0.35 + 0.95*Math.abs(Math.sin(Math.PI*info.t/2.6));
  if (spike) comps.push(Object.assign(G(0, 0.0012, 0.0012, 1.4, null, 'spike'), { w: 'all' }));
  comps.push(G(0.32*D, 0.15*D, 0.15*D, 1.35*amp, v1, 'q'));
  comps.push(G(0.66*D, 0.14*D, 0.13*D, 0.6*amp, v2, 'q'));
  const rr = clamp(info.rr || 0.8, 0.25, 2.2);
  const QT = kind === 'tdp' ? D + 0.1 : Math.max(D + 0.16, 0.42*Math.sqrt(rr) + 0.06);
  const tPeak = QT - 0.1;
  comps.push(G(tPeak, 0.075, 0.05, tAmp*amp, neg(v1), 't'));
  comps.push(PLAT(D, tPeak, 0.01, 0.04, 0.12*amp, neg(v1), 'st'));
  const m = finalize(comps, e.tech); m.D = D; m.QT = QT; m.spike = spike; m.lead = 0;
  return m;
}

// ---------- pacing morphology ----------
function finalComp(m, cp, tech){
  const p = cp.w ? projectW(cp.w) : projectVec(cp.v, tech);
  for (let i = 0; i < p.length; i++) p[i] *= cp.a;
  cp.p = p; m.comps.push(cp); const ex = extent(cp); m.s0 = Math.min(m.s0, ex[0]); m.s1 = Math.max(m.s1, ex[1]);
}
function shiftMorph(m, d){
  for (const cp of m.comps){ if (cp.k === 'g') cp.c += d; else if (cp.k === 'p'){ cp.t0 += d; cp.t1 += d; } }
  m.s0 += d; m.s1 += d; return m;
}
function scaleMorph(m, f){ for (const cp of m.comps) for (let i = 0; i < cp.p.length; i++) cp.p[i] *= f; return m; }
function addSpike(m, off, chamber, polarity, tech){
  if (polarity === 'unipolar'){
    const v = chamber === 'A' ? dir(0.25,0.85,0.35) : dir(-0.35,-0.75,0.45);
    finalComp(m, G(off, 0.0014, 0.0014, chamber === 'A' ? 1.6 : 2.6, v, 'spike'), tech);
    finalComp(m, Object.assign(G(off, 0.0014, 0.0014, 0.7, null, 'spike'), { w: 'all' }), tech);
    finalComp(m, G(off + 0.004, 0.002, 0.014, chamber === 'A' ? -0.12 : -0.2, v, 'spike'), tech);
  } else {
    finalComp(m, Object.assign(G(off, 0.0012, 0.0012, chamber === 'A' ? 0.45 : 0.8, null, 'spike'), { w: 'all' }), tech);
  }
  (m.spikes = m.spikes || []).push(off);
  return m;
}
function spikeOnly(chamber, p, e){ const m = { comps: [], s0: 0, s1: 0.02 }; return addSpike(m, 0, chamber, p.pmPolarity, e.tech); }
function wideBeat(e, D, v1, a1, v2, a2, rr){
  const comps = [G(0.32*D, 0.15*D, 0.15*D, a1, v1, 'q'), G(0.66*D, 0.14*D, 0.13*D, a2, v2, 'q')];
  const QT = Math.max(D + 0.16, 0.42*Math.sqrt(clamp(rr || 0.8, 0.3, 2.2)) + 0.06), tPeak = QT - 0.1;
  comps.push(G(tPeak, 0.075, 0.05, 0.42, neg(v1), 't'));
  comps.push(PLAT(D, tPeak, 0.01, 0.04, 0.11, neg(v1), 'st'));
  const m = finalize(comps, e.tech); m.D = D; m.QT = QT; m.lead = 0; return m;
}
const PACE_SITES = {
  rva: 'RV apex', rvs: 'RV septum / outflow', biv: 'Biventricular (CRT)', his_s: 'His bundle, selective', his_ns: 'His bundle, non-selective', lbbap: 'Left bundle branch area',
};
function buildPaced(site, e, p, info){
  const rr = info.rr, pol = p.pmPolarity;
  let m;
  if (site === 'rvs'){ m = wideBeat(e, 0.15, dir(0.3,0.85,-0.45), 1.3, dir(0.55,0.5,-0.6), 0.55, rr); addSpike(m, 0, 'V', pol, e.tech); }
  else if (site === 'biv'){
    const vv = (p.pmVV || 0)/1000;
    m = wideBeat(e, 0.125 + vv*0.4, dir(-0.7,-0.5,0.5), 1.05, dir(-0.2,-0.7,0.25), 0.55, rr);
    addSpike(m, 0, 'V', pol, e.tech); if (vv > 0.004) addSpike(m, vv, 'V', pol, e.tech);
  }
  else if (site === 'his_s'){ m = shiftMorph(buildConducted(e, { rr }), 0.045); m.latency = 0.045; addSpike(m, 0, 'V', pol, e.tech); }
  else if (site === 'his_ns'){ m = shiftMorph(buildConducted(e, { rr, preexc: { k: 0.75, lead: 0.035 }, deltaDir: dir(0.25,0.75,-0.35) }), 0.004); addSpike(m, 0, 'V', pol, e.tech); }
  else if (site === 'lbbap'){ m = shiftMorph(buildConducted(e, { rr, forceConduction: 'rbbb', qrsOverride: 0.115 }), 0.022); m.latency = 0.022; addSpike(m, 0, 'V', pol, e.tech); }
  else { m = wideBeat(e, 0.165, dir(0.35,-0.75,-0.55), 1.35, dir(0.55,-0.55,-0.55), 0.6, rr); addSpike(m, 0, 'V', pol, e.tech); }
  return m;
}
function fuseMorph(mp, mc, dt){
  scaleMorph(mp, 0.6); scaleMorph(shiftMorph(mc, dt), 0.6);
  const m = { comps: mp.comps.concat(mc.comps), s0: Math.min(mp.s0, mc.s0), s1: Math.max(mp.s1, mc.s1), spikes: mp.spikes, D: Math.max(mp.D, mc.D + dt), QT: Math.max(mp.QT, mc.QT + dt), lead: 0 };
  return m;
}

// ---------- simulator ----------
class Sim {
  constructor(p, seed, t0){
    this.rand = rng(seed || 1);
    this.atr = []; this.ven = []; this.segs = []; this.pending = []; this.spk = []; this.marks = [];
    this.nextAP = Infinity; this.nextVP = Infinity; this.pmLastV = -10;
    this.lastNodeExit = -10; this.lastAPin = -10; this.lastV = -10; this.prevRR = 0.8; this.lastVkind = 'cond';
    this.concealK = 0.3; this.hisIdx = 0; this.pvcCount = 0; this.beatsSincePVC = 0; this.nextPVC = Infinity; this.pvcPlannedFor = null;
    this.tGen = t0; this.nextA = t0 + 0.05; this.pacNext = false; this.sinusRef = t0;
    this.setParams(p, t0, true);
  }
  setParams(p, tNow, initial){
    const prevR = this.p ? this.p.rhythm : null;
    this.p = Object.assign({}, p);
    this.e = effective(this.p); this.e.pvcOrigin = this.p.pvcOrigin;
    this.r = RHYTHMS[this.p.rhythm] || RHYTHMS.sinus;
    if (!initial){
      // drop not-yet-shown events so new parameters take effect now
      const cut = tNow;
      this.atr = this.atr.filter(a => a.t <= cut);
      this.ven = this.ven.filter(v => v.t <= cut || (v.src && v.src.t <= cut));
      this.pending = this.pending.filter(pv => pv.src && pv.src.t <= cut);
      this.spk = this.spk.filter(x => x.t <= cut); this.marks = this.marks.filter(x => x.t <= cut);
      this.lastV = this.ven.length ? this.ven[this.ven.length-1].t : -10;
      this.nextPVC = Infinity;
      const lastA = this.atr.length ? this.atr[this.atr.length-1] : null;
      this.tGen = Math.max(cut, this.lastV);
      this.nextA = this.nextAtrialAfter(lastA, cut);
      if (this.lastNodeExit > cut) this.lastNodeExit = cut;
    }
    // continuous segments (AF baseline, VF)
    const cont = this.r.atrial === 'af' ? 'af' : this.r.auto === 'vf' ? 'vf' : null;
    const last = this.segs[this.segs.length-1];
    if (last && last.t1 === Infinity && last.kind !== cont) last.t1 = tNow;
    if (cont && !(last && last.t1 === Infinity && last.kind === cont)) this.segs.push({ kind: cont, t0: tNow, t1: Infinity });
    this.nextAuto = this.autoCycle() ? Math.max(tNow + 0.05, this.lastV + this.autoCycle()) : Infinity;
    if (this.r.auto === 'vf') this.nextAuto = Infinity;
    if (prevR !== this.p.rhythm && !initial) this.hisIdx = 0;
    this.pmSchedule(tNow);
  }
  // ----- pacemaker -----
  pmMode(){
    const m = this.p.pmMode || 'off';
    if ((m === 'DDD' || m === 'VDD') && (this.r.atrial === 'af' || this.r.atrial === 'flutter')) return 'VVI'; // automatic mode switch
    return m;
  }
  pmSchedule(tNow){
    this.nextAP = Infinity; this.nextVP = Infinity;
    const m = this.pmMode(); if (m === 'off') return;
    const p = this.p, LRI = 60/p.pmLR, PAV = p.pmPAV/1000;
    const base = Math.max(this.pmLastV, this.lastV);
    if (m === 'AAI'){ const la = this.atr.length ? this.atr[this.atr.length-1].t : -10; this.nextAP = Math.max(tNow + 0.05, la + LRI); }
    else if (m === 'DDD' || m === 'DOO') this.nextAP = Math.max(tNow + 0.05, base + LRI - PAV);
    else this.nextVP = Math.max(tNow + 0.05, base + LRI);
  }
  mark(t, txt, bad){ this.marks.push({ t, txt, bad: !!bad }); }
  pmAfterV(t){
    const m = this.pmMode(), p = this.p, LRI = 60/p.pmLR;
    this.nextVP = Infinity;
    if (m === 'VVI' || m === 'VOO' || m === 'VDD') this.nextVP = t + LRI;
    if (m === 'DDD' || m === 'DOO') this.nextAP = t + LRI - p.pmPAV/1000;
  }
  pmSenseA(a){
    const m = this.pmMode(), p = this.p;
    if (!['AAI','DDD','VDD'].includes(m)) return;
    const LRI = 60/p.pmLR;
    if (m === 'AAI'){ this.mark(a.t, 'AS'); this.nextAP = a.t + LRI; return; }
    if (a.t < this.pmLastV + p.pmPVARP/1000){ this.mark(a.t, 'AR'); a.pvarp = true; return; }
    this.mark(a.t, 'AS'); this.nextAP = Infinity;
    this.nextVP = Math.max(a.t + p.pmSAV/1000, this.pmLastV + 60/p.pmUR);
  }
  pmSenseV(v){
    const m = this.pmMode(), p = this.p;
    if (['off','AAI','VOO','DOO'].includes(m)) return;
    if (p.pmVSense === 'under' && this.rand() < 0.6){ v.undersensed = true; return; }
    this.mark(v.t, 'VS'); this.pmLastV = v.t; this.nextAP = Infinity; this.pmAfterV(v.t);
  }
  insertSpk(x){ this.spk.push(x); this.spk.sort((a, b) => a.t - b.t); }
  doAP(t){
    this.nextAP = Infinity;
    const m = this.pmMode(), p = this.p;
    const devCap = !(p.pmACap === 'loss' || (p.pmACap === 'intermittent' && this.rand() < 0.35));
    let cap = devCap;
    if (this.r.atrial === 'af' || this.r.atrial === 'flutter') cap = false;
    const lastA = this.atr.length ? this.atr[this.atr.length-1].t : -10;
    if (t - lastA < 0.25) cap = false; // atrial refractory: functional non-capture
    if (cap) this.doAtrial(t, 'apace'); else this.insertSpk({ t, m: spikeOnly('A', p, this.e) });
    this.mark(t, 'AP', !devCap);
    if (m === 'AAI') this.nextAP = t + 60/p.pmLR;
    if (m === 'DDD' || m === 'DOO') this.nextVP = t + p.pmPAV/1000;
  }
  doVP(t){
    this.nextVP = Infinity;
    const p = this.p, m = this.pmMode(), e = this.e;
    const asyncMode = m === 'VOO' || m === 'DOO';
    if (!asyncMode && p.pmVSense === 'over' && this.rand() < 0.35){ this.mark(t, 'VS', true); this.pmLastV = t; this.pmAfterV(t); return; }
    const cap = !(p.pmVCap === 'loss' || (p.pmVCap === 'intermittent' && this.rand() < 0.35));
    const functional = t - this.lastV < e.vERP;
    if (cap && !functional){
      const rr = this.lastV > -5 ? t - this.lastV : 0.8;
      let mm = buildPaced(p.pmSite, e, p, { rr, t });
      let fusion = false;
      const lat = mm.latency || 0;
      const i = this.pending.findIndex(pv => pv.t >= t + lat - 0.005 && pv.t < t + lat + 0.045);
      if (i >= 0 && p.pmSite !== 'his_s'){
        const pv = this.pending.splice(i, 1)[0];
        mm = fuseMorph(mm, buildConducted(e, { rr }), pv.t - t); fusion = true; pv.src.status = 'cond';
      } else if (i >= 0){ this.pending.splice(i, 1)[0].src.status = 'vref'; }
      this.addV({ t, kind: 'vpace', paced: true, site: p.pmSite, fusion, m: mm });
      if (p.pmSite !== 'his_s' && p.pmSite !== 'his_ns' && this.r.atrial !== 'af') this.lastNodeExit = Math.max(this.lastNodeExit, t + 0.09);
    } else this.insertSpk({ t, m: spikeOnly('V', p, e), nc: true });
    this.mark(t, 'VP', !cap && !functional);
    this.pmLastV = t; this.pmAfterV(t);
  }
  sinusCycle(t){
    const base = 60 / this.e.rate;
    const rsa = (this.p.rsa || 0)/100;
    return base * (1 + rsa*Math.sin(2*Math.PI*t/4.2)) * (1 + (this.rand()-0.5)*0.012);
  }
  nextAtrialAfter(lastA, tNow){
    const mode = this.r.atrial;
    if (mode === 'none') return Infinity;
    if (!lastA) return tNow + 0.05;
    if (mode === 'af') return Math.max(tNow, lastA.t + 0.11 + this.rand()*0.08);
    if (mode === 'flutter') return Math.max(tNow, lastA.t + 60/this.p.rate);
    return Math.max(tNow, lastA.t + this.sinusCycle(lastA.t));
  }
  autoCycle(){
    const a = this.r.auto;
    if (!a) return 60/40; // backup junctional escape at 40/min
    if (a === 'vf') return 0;
    return 60 / this.e.vrate;
  }
  autoKind(){
    const a = this.r.auto;
    if (!a) return 'escJ';
    if (a === 'escape') return this.p.escape === 'ventricular' ? 'escV' : 'escJ';
    return a;
  }
  advance(tEnd){
    let guard = 0;
    while (guard++ < 5000){
      const tp = this.pending.length ? this.pending[0].t : Infinity;
      const t = Math.min(this.nextA, tp, this.nextPVC, this.nextAuto, this.nextAP, this.nextVP);
      if (t > tEnd || t === Infinity) break;
      if (t === this.nextAP) this.doAP(t);
      else if (t === this.nextVP) this.doVP(t);
      else if (t === this.nextA) this.doAtrial(t);
      else if (t === tp) this.doPending(this.pending.shift());
      else if (t === this.nextPVC) this.doPVC(t);
      else this.doAuto(t);
    }
    this.tGen = tEnd;
    // prune old history
    const keep = tEnd - 40;
    if (this.atr.length > 400) this.atr = this.atr.filter(a => a.t > keep);
    if (this.ven.length > 300) this.ven = this.ven.filter(v => v.t > keep);
    if (this.spk.length > 200) this.spk = this.spk.filter(v => v.t > keep);
    if (this.marks.length > 600) this.marks = this.marks.filter(v => v.t > keep);
  }
  doAtrial(tA, forced){
    const mode = this.r.atrial, e = this.e;
    let kind = mode === 'af' ? 'af' : mode === 'flutter' ? 'flutter' : 'sinus';
    let cl = mode === 'flutter' ? 60/this.p.rate : 0;
    if (forced) kind = forced;
    else if (this.pacNext){ kind = 'pac'; this.pacNext = false; }
    const a = { t: tA, kind, status: 'cond', pr: 0 };
    if (kind === 'apace'){ a.m = shiftMorph(buildP('sinus', e, 0), 0.03); a.m.s0 = Math.min(a.m.s0, -0.01); addSpike(a.m, 0, 'A', this.p.pmPolarity, e.tech); a.paced = true; }
    else a.m = kind === 'af' ? null : buildP(kind, e, cl);
    this.atr.push(a); if (forced) this.atr.sort((x, y) => x.t - y.t);
    // schedule next atrial impulse
    if (forced){ if (mode === 'sinus') this.nextA = tA + this.sinusCycle(tA); }
    else if (mode === 'sinus'){
      const cyc = this.sinusCycle(tA);
      if (kind !== 'pac' && this.p.pac > 0 && this.rand()*100 < this.p.pac){ this.pacNext = true; this.nextA = tA + cyc*0.62; }
      else this.nextA = tA + cyc;
    } else this.nextA = this.nextAtrialAfter(a, tA);
    if (!forced) this.pmSenseA(a);
    // conduction
    if (this.r.his === 'complete'){ a.status = 'chb'; return; }
    const tin = tA + (kind === 'af' || kind === 'flutter' ? 0.0 : kind === 'apace' ? 0.06 : 0.03);
    let erp = e.avnERP, A = e.avnA, tau = e.avnTau;
    if (mode === 'sinus'){ const f = clamp((60/e.rate)/0.8, 0.45, 1.15); erp *= f; A *= f; tau *= f; } // autonomic coupling with sinus rate
    if (kind === 'af') erp *= 0.62 + 0.76*this.rand(); // AF: wavelets of varying strength and timing meet a node in varying recovery, so R–R is irregularly irregular
    const R = tin - this.lastNodeExit;
    let nodeOK = R >= erp, tV = Infinity;
    if (!nodeOK){
      a.status = 'node';
      if ((kind === 'af') && R > erp*0.45 && this.rand() < 0.7) this.lastNodeExit += (tin - erp*0.45 - this.lastNodeExit)*(0.25 + 0.6*this.rand()); // variable concealed conduction
    } else {
      const AH = Math.max(0.02, e.pr - 0.075) + A*Math.exp(-(R - erp)/tau);
      const exit = tin + AH; this.lastNodeExit = exit;
      // infranodal (His-Purkinje) block patterns
      let hisOK = true;
      if (this.r.his === 'mobitz'){ const n = Math.max(2, this.p.ratio|0); hisOK = (this.hisIdx % n) !== n-1; this.hisIdx++; }
      else if (this.r.his === 'fixed'){ const n = Math.max(2, this.p.ratio|0); hisOK = (this.hisIdx % n) === 0; this.hisIdx++; }
      a.tNode = exit + 0.045;
      if (!hisOK) a.status = 'his';
      else tV = exit + 0.045 - (kind === 'af' || kind === 'flutter' ? -0.0 : 0);
    }
    // accessory pathway
    let tDelta = Infinity;
    if (e.path.ap){
      if (tA - this.lastAPin >= e.apERP){ tDelta = tA + (kind === 'af' ? 0.07 : 0.1); this.lastAPin = tA; }
    }
    if (tDelta < tV){
      const lead = Math.min(0.09, tV === Infinity ? 0.09 : (tV - tDelta));
      const k = clamp(lead/0.05, 0.4, 1.6);
      a.status = 'cond'; a.ap = tDelta; a.tV = tDelta; a.pr = tDelta - tA;
      this.queue({ t: tDelta, src: a, kind: 'ap', preexc: { k, lead }, tNode: tV });
    } else if (tV < Infinity){
      a.tV = tV; a.pr = tV - tA;
      this.queue({ t: tV, src: a, kind: 'cond' });
    }
  }
  queue(pv){ this.pending.push(pv); this.pending.sort((x, y) => x.t - y.t); }
  doPending(pv){
    const t = pv.t;
    if (t - this.lastV < this.e.vERP){ pv.src.status = 'vref'; return; }
    const coupling = t - this.lastV;
    const bbERP = 0.27 + 0.13*this.prevRR;
    const aberrant = pv.kind === 'cond' && ['cond','aber','ap'].includes(this.lastVkind) && coupling < bbERP && coupling < 0.5;
    const m = buildConducted(this.e, { rr: coupling, aberrant, preexc: pv.preexc });
    const au = this.r.auto;
    if ((au === 'vt' || au === 'aivr') && pv.kind === 'cond'){
      const lead = this.nextAuto - t;
      if (lead >= 0 && lead < 0.05){ // focus fires while the conducted wavefront is spreading: fusion beat
        const tA = this.nextAuto;
        const mv = buildVentricular(au, this.e, { rr: coupling, t: tA });
        this.addV({ t, kind: 'fus', src: pv.src, m: fuseMorph(m, mv, lead), tNode: pv.tNode });
        this.nextAuto = tA + this.autoCycle();
        return;
      }
      this.addV({ t, kind: 'cap', src: pv.src, m, tNode: pv.tNode }); // capture beat: narrow, early
      return;
    }
    this.addV({ t, kind: aberrant ? 'aber' : pv.kind, src: pv.src, m, tNode: pv.tNode });
  }
  addV(v){
    const t = v.t;
    if (this.lastV > -5) this.prevRR = clamp(t - this.lastV, 0.2, 3);
    this.lastV = t; this.lastVkind = v.kind; this.ven.push(v);
    if (!v.paced) this.pmSenseV(v);
    if (this.autoCycle()) this.nextAuto = t + this.autoCycle() * (this.r.auto === 'tdp' ? 0.85 + this.rand()*0.3 : 1);
    this.planPVC(v);
  }
  planPVC(v){
    const pat = this.p.pvc, coup = this.p.pvcCoupling/1000;
    this.nextPVC = Infinity;
    if (!pat || pat === 'none') return;
    if (['vt','tdp','vf','avnrt'].includes(this.r.auto)) return;
    if (v.kind === 'pvc'){
      this.pvcRun = (this.pvcRun || 0) + 1;
      if (pat === 'couplets' && this.pvcRun < 2) this.nextPVC = v.t + coup;
      return;
    }
    this.pvcRun = 0; this.beatsSincePVC++;
    let fire = false;
    if (pat === 'bigeminy') fire = this.beatsSincePVC >= 1;
    else if (pat === 'trigeminy') fire = this.beatsSincePVC >= 2;
    else if (pat === 'occasional') fire = this.rand() < 0.12;
    else if (pat === 'frequent') fire = this.rand() < 0.3;
    else if (pat === 'couplets') fire = this.rand() < 0.15;
    if (fire) this.nextPVC = v.t + coup;
  }
  doPVC(t){
    this.nextPVC = Infinity;
    if (t - this.lastV < this.e.vERP) return;
    this.beatsSincePVC = 0;
    const m = buildVentricular('pvc', this.e, { rr: t - this.lastV, t });
    this.lastNodeExit = Math.max(this.lastNodeExit, t + 0.11); // concealed retrograde penetration of the node
    // cancel conducted impulses that would now hit refractory tissue (they are handled in doPending)
    this.addV({ t, kind: 'pvc', m });
  }
  doAuto(t){
    const kind = this.autoKind();
    if (t - this.lastV < this.e.vERP){ this.nextAuto = this.lastV + this.autoCycle(); return; }
    const rr = t - this.lastV;
    let m;
    if (kind === 'escJ' || kind === 'junc' || kind === 'avnrt') m = buildConducted(this.e, { rr: Math.min(rr, 2) });
    else m = buildVentricular(kind, this.e, { rr, t });
    const v = { t, kind, m };
    if (kind === 'junc' || kind === 'escJ' || kind === 'avnrt'){
      this.lastNodeExit = Math.max(this.lastNodeExit, t);
      if (this.r.atrial === 'none' && kind !== 'escJ'){
        const off = kind === 'avnrt' ? 0.035 : 0.05;
        const a = { t: t + off, kind: 'retro', status: 'retro', m: buildP('retro', this.e, 0), from: v };
        this.atr.push(a); this.atr.sort((x, y) => x.t - y.t); v.retro = a;
      }
    }
    if (kind === 'escV' || kind === 'tdp' || (kind === 'vt' && this.rand() < 0.3) || (kind === 'aivr' && this.rand() < 0.6)) this.lastNodeExit = Math.max(this.lastNodeExit, t + 0.1); // retrograde concealment (intermittent in VT/AIVR, so sinus beats occasionally capture)
    this.addV(v);
  }
}

// ---------- signal evaluation ----------
function findStart(arr, t){ let lo = 0, hi = arr.length; while (lo < hi){ const mid = (lo+hi) >> 1; if (arr[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }
function beatSum(arr, t, li, getM){
  let s = 0;
  for (let i = Math.max(0, findStart(arr, t - 1.4)); i < arr.length; i++){
    const b = arr[i]; if (b.t > t + 0.05) break;
    const m = b.m; if (!m) continue;
    const dt = t - b.t; if (dt < m.s0 || dt > m.s1) continue;
    for (const cp of m.comps){ const v = cp.p[li]; if (v === 0) continue; s += shape(cp, dt) * v; }
  }
  return s;
}
// deterministic pseudo-random continuous functions
const AFV = [dir(0.2,0.8,-0.6), dir(-0.5,0.6,0.6), dir(0.6,0.3,0.3)];
const AFF = [[5.3, 0.3], [6.7, 1.9], [7.9, 4.1]];
const VFV = [dir(0.6,0.7,-0.4), dir(-0.5,0.5,0.7), dir(0.3,-0.6,0.7)];
const projCache = new Map();
function projOf(v, tech){ const key = v.join(',') + tech; let p = projCache.get(key); if (!p){ p = projectVec(v, tech); projCache.set(key, p); } return p; }
function contSignal(sim, t, li){
  let s = 0; const tech = sim.e.tech;
  for (const sg of sim.segs){
    if (t < sg.t0 || t >= sg.t1) continue;
    const fade = Math.min(1, (t - sg.t0)/0.3);
    if (sg.kind === 'af'){
      for (let k = 0; k < 3; k++){
        const [f, ph] = AFF[k];
        const env = 0.6 + 0.4*Math.sin(2*Math.PI*0.37*t + k*2.1);
        const w = Math.sin(2*Math.PI*f*t + ph + 1.3*Math.sin(2*Math.PI*0.53*t + k)) * env;
        s += 0.05 * w * projOf(AFV[k], tech)[li] * fade;
      }
    } else if (sg.kind === 'vf'){
      const env = 0.55 + 0.45*Math.sin(2*Math.PI*0.21*t) * Math.sin(2*Math.PI*0.13*t + 1);
      for (let k = 0; k < 3; k++){
        const f = [4.1, 5.3, 6.2][k];
        const w = Math.sin(2*Math.PI*f*t + 1.7*Math.sin(2*Math.PI*0.7*t + k*1.9) + k);
        s += 0.42 * env * w * projOf(VFV[k], tech)[li] * fade;
      }
    }
  }
  return s;
}
function noiseSignal(sim, t, li){
  const p = sim.p, e = sim.e;
  let s = 0;
  const wd = (p.wander || 0)/100, nz = (p.noise || 0)/100;
  if (wd) s += wd * 0.18 * (Math.sin(2*Math.PI*0.23*t + li*0.7) * 0.7 + Math.sin(2*Math.PI*0.11*t + li*1.3)*0.5);
  if (nz) s += nz * 0.012 * (Math.sin(2*Math.PI*31*t + li*2.1) + Math.sin(2*Math.PI*47.3*t + li) + Math.sin(2*Math.PI*71.7*t + li*0.3));
  if (e.shiver){ const env = 0.6 + 0.4*Math.sin(2*Math.PI*0.6*t + li); s += e.shiver * env * (Math.sin(2*Math.PI*8.7*t + li) + 0.8*Math.sin(2*Math.PI*11.9*t + 2*li) + 0.6*Math.sin(2*Math.PI*17.3*t + li*3)); }
  return s;
}
function signal(sim, t, li, opts){
  let s = beatSum(sim.atr, t, li) + beatSum(sim.ven, t, li) + beatSum(sim.spk, t, li) + contSignal(sim, t, li);
  if (!opts || !opts.clean) s += noiseSignal(sim, t, li);
  return s;
}

// QRS axis from net area of QRS components in I and aVF
function measureAxis(m){
  let I = 0, F = 0;
  for (const cp of m.comps){ if (cp.tag !== 'q' || cp.k !== 'g' || cp.rterm) continue; const area = cp.sl + cp.sr; I += cp.p[0]*area; F += cp.p[5]*area; }
  return Math.round(Math.atan2(F, I) * 180/Math.PI);
}


// ---------- ladder diagram ----------
function drawLadder(g, sim, t0, t1, xs, pxs, y0, h, col){
  const X = (t) => xs + (t - t0)*pxs;
  const th = h/3, A0 = y0, A1 = y0 + th, V0 = y0 + 2*th, V1 = y0 + h;
  g.save();
  g.fillStyle = col.bg; g.fillRect(xs, y0, (t1 - t0)*pxs, h);
  g.beginPath(); g.rect(xs, y0 - 8, (t1 - t0)*pxs, h + 10 + (col.mk || 0)); g.clip();
  g.strokeStyle = col.label; g.globalAlpha = 0.35; g.lineWidth = 1;
  g.beginPath(); for (const y of [A0, A1, V0, V1]){ g.moveTo(xs, y); g.lineTo(X(t1), y); } g.stroke(); g.globalAlpha = 1;
  g.lineWidth = Math.max(1.3, pxs/55); g.lineCap = 'round';
  const line = (xa, ya, xb, yb, color, dash) => { g.strokeStyle = color; g.setLineDash(dash || []); g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke(); g.setLineDash([]); };
  const bar = (x, y, color) => { const s = Math.max(4, th*0.18); line(x - s, y, x + s, y, color); };
  const stim = (x, y, color) => { g.fillStyle = color; g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x - 4, y - 6); g.lineTo(x + 4, y - 6); g.closePath(); g.fill(); };
  const dot = (x, y, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, Math.max(2.4, th*0.09), 0, 7); g.fill(); };
  const ink = col.ink, blk = col.block, ap = col.ap;
  const cand = (arr) => arr.filter(e => e.t > t0 - 0.6 && e.t < t1 + 0.1);
  const showPR = pxs > 70;
  g.font = `500 ${col.fs}px ${col.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const a of cand(sim.atr)){
    const xa = X(a.t), da = 0.035;
    if (a.kind === 'af'){ const r = ((a.t*997) % 1); line(xa, A0 + th*(0.1 + 0.3*r), X(a.t + 0.02), A0 + th*(0.55 + 0.35*r), ink); }
    else if (a.kind === 'retro'){ line(X(a.t - 0.005), A1, X(a.t + da), A0, ink); continue; }
    else if (a.kind === 'apace'){ stim(xa, A0, ap); line(xa, A0, X(a.t + da), A1, ap); }
    else if (a.kind === 'pac'){ dot(X(a.t + 0.012), A0 + th*0.45, ink); line(X(a.t + 0.012), A0 + th*0.45, X(a.t + 0.03), A0, ink); line(X(a.t + 0.012), A0 + th*0.45, X(a.t + da), A1, ink); }
    else line(xa, A0, X(a.t + da), A1, ink);
    const xs2 = X(a.t + da);
    const st = a.status;
    if (st === 'cond' || st === 'vref'){
      if (a.ap){ line(xs2, A1, X(a.ap), V0, ap, [5, 3]); if (a.tNode && a.tNode < Infinity){ line(xs2, A1, X(a.tNode), V0, ink); } }
      else line(xs2, A1, X(a.tV), V0, ink);
      if (st === 'vref'){ line(X(a.tV), V0, X(a.tV + 0.01), V0 + th*0.25, blk); bar(X(a.tV + 0.01), V0 + th*0.25, blk); }
      if (showPR && a.kind !== 'af' && a.kind !== 'flutter' && a.pr){ g.fillStyle = col.label; const xm = (xs2 + X(a.tV))/2; g.textAlign = 'left'; g.fillText(Math.round(a.pr*1000), X(a.tV) + 3, A1 + th*0.62); g.textAlign = 'center'; }
    } else if (st === 'node'){
      const fr = a.kind === 'af' || a.kind === 'flutter' ? 0.22 : 0.35;
      const xe = X(a.t + da + 0.05*fr/0.35), ye = A1 + th*fr; line(xs2, A1, xe, ye, a.kind === 'af' ? ink : blk); if (a.kind !== 'af') bar(xe, ye, blk);
    } else if (st === 'his'){ const xe = X(a.t + da + 0.11), ye = A1 + th*0.78; line(xs2, A1, xe, ye, blk); bar(xe, ye, blk); }
    else if (st === 'chb'){ const xe = X(a.t + da + 0.07), ye = A1 + th*0.5; line(xs2, A1, xe, ye, blk); bar(xe, ye, blk); }
  }
  const vs = cand(sim.ven);
  vs.forEach((v, i) => {
    const xv = X(v.t);
    if (v.kind === 'cond' || v.kind === 'aber' || v.kind === 'ap' || v.kind === 'cap'){ line(xv, V0, X(v.t + 0.05), V1, v.kind === 'ap' ? ap : ink); if (v.kind === 'aber' || v.kind === 'cap'){ g.fillStyle = col.label; g.fillText(v.kind === 'cap' ? 'C' : 'ab', X(v.t + 0.05) + 9, V0 + th*0.5); } }
    else if (v.kind === 'fus'){ line(xv, V0, X(v.t + 0.03), V0 + th*0.5, ink); const ox = X(v.t + 0.02), oy = V0 + th*0.72; dot(ox, oy, ink); line(ox, oy, X(v.t + 0.03), V0 + th*0.5, ink); line(ox, oy, X(v.t + 0.06), V1, ink); g.fillStyle = col.label; g.fillText('F', X(v.t + 0.06) + 9, V0 + th*0.5); }
    else if (v.kind === 'junc' || v.kind === 'escJ' || v.kind === 'avnrt'){
      if (v.kind === 'avnrt'){
        line(xv, V0, X(v.t + 0.035), A1, ink); // fast pathway up
        const prev = vs[i-1];
        if (prev && prev.kind === 'avnrt') line(X(prev.t + 0.035), A1, xv, V0, ink, [4, 3]); // slow pathway down
      } else {
        const ox = X(v.t - 0.03), oy = V0 - th*0.3; dot(ox, oy, ink); line(ox, oy, xv, V0, ink);
        if (v.retro) line(ox, oy, X(v.retro.t - 0.005), A1, ink); else { line(ox, oy, X(v.t), oy - th*0.3, blk); bar(X(v.t), oy - th*0.3, blk); }
      }
      line(xv, V0, X(v.t + 0.05), V1, ink);
    } else if (v.paced && (v.site === 'his_s' || v.site === 'his_ns' || v.site === 'lbbap')){
      const lat = (v.m && v.m.latency) || 0.004, oy = V0 - th*0.3;
      stim(xv, oy - 2, ap); dot(xv, oy, ap); line(xv, oy, X(v.t + lat), V0, ap); line(X(v.t + lat), V0, X(v.t + lat + 0.05), V1, ap);
    } else {
      const ox = xv, oy = V0 + th*0.72;
      const c = v.paced ? ap : ink; if (v.kind === 'tdp' && pxs < 140 && i % 1) return;
      dot(ox, oy, c); line(ox, oy, X(v.t + 0.06), V0, c); line(ox, oy, X(v.t + 0.04), V1, c);
      if (v.paced){ stim(ox, oy - 3, c); if (v.fusion){ g.fillStyle = col.label; g.fillText('F', X(v.t + 0.06) + 9, V0 + th*0.5); } }
      if (v.kind === 'pvc'){ const xe = X(v.t + 0.11), ye = V0 - th*0.35; line(X(v.t + 0.06), V0, xe, ye, blk, [3, 3]); bar(xe, ye, blk); }
    }
  });
  for (const sg of sim.segs){
    if (sg.kind !== 'vf' || sg.t1 < t0 || sg.t0 > t1) continue;
    g.strokeStyle = ink; g.beginPath();
    const a = Math.max(t0, sg.t0), b = Math.min(t1, sg.t1);
    for (let t = a, i = 0; t < b; t += 0.035, i++){ const y = V0 + th*(0.15 + 0.7*((Math.sin(t*91.7) + 1)/2)); if (i) g.lineTo(X(t), y); else g.moveTo(X(t), y); }
    g.stroke();
  }
  if (col.mk && sim.marks){
    const my = V1 + col.mk*0.55;
    g.fillStyle = col.bg; g.fillRect(xs, V1 + 1, (t1 - t0)*pxs, col.mk);
    g.font = `600 ${Math.max(8, col.fs - 1)}px ${col.font}`;
    for (const mk of sim.marks){ if (mk.t < t0 - 0.05 || mk.t > t1) continue;
      const up = mk.txt[0] === 'A';
      g.fillStyle = mk.bad ? blk : (mk.txt[1] === 'P' ? ap : col.label);
      g.fillText(mk.txt, X(mk.t), my + (up ? -col.mk*0.18 : col.mk*0.18)); }
    g.font = `500 ${col.fs}px ${col.font}`;
  }
  g.restore();
  g.fillStyle = col.label; g.font = `600 ${col.fs}px ${col.font}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText('A', xs - 4, A0 + th/2); g.fillText('AV', xs - 4, A1 + th/2); g.fillText('V', xs - 4, V0 + th/2);
  if (col.mk) g.fillText('Mkr', xs - 4, V1 + col.mk*0.55);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

