/* Primordium — UI controller: sliders, matrix editor, presets, keyboard */
(() => {
'use strict';
const API = window.PRIMORDIUM;
const { S, PALETTE } = API;
const $ = id => document.getElementById(id);

// ---- slider wiring ----
function bind(slider, label, key, fmt, after){
  const el = $(slider), out = $(label);
  const render = () => { out.textContent = fmt ? fmt(S[key]) : S[key]; };
  el.value = S[key];
  el.addEventListener('input', () => {
    S[key] = parseFloat(el.value);
    render();
    if (after) after();
  });
  render();
}
bind('sCount','vCount','count', v=>v|0, () => API.spawn());
bind('sSpecies','vSpecies','species', v=>v|0, () => { API.buildMatrix(true); API.spawn(); rebuildMatrix(); rebuildLegend(); });
bind('sForce','vForce','force', v=>v.toFixed(2));
bind('sRange','vRange','range', v=>(v|0));
bind('sFriction','vFriction','friction', v=>v.toFixed(2));
bind('sSpeed','vSpeed','speed', v=>(v|0)+'×');
bind('sPsize','vPsize','psize', v=>v.toFixed(1));

// trail length: higher slider = longer trails = smaller per-frame fade
(() => {
  const el = $('sTrail'), out = $('vTrail');
  const upd = () => {
    const len = parseFloat(el.value);
    S.fade = +(0.5 - (len/100)*0.47).toFixed(3);
    out.textContent = len + '%';
  };
  el.addEventListener('input', upd); upd();
})();

// ---- glow toggle ----
const bGlow = $('bGlow');
bGlow.onclick = () => { S.glow = !S.glow; bGlow.classList.toggle('active', S.glow); };
const bBonds = $('bBonds');
bBonds.onclick = () => { S.bonds = !S.bonds; bBonds.classList.toggle('active', S.bonds); };
const bAurora = $('bAurora');
bAurora.onclick = () => { S.aurora = !S.aurora; bAurora.classList.toggle('active', S.aurora); };

// ---- themes: background + accent recolouring ----
const THEMES = {
  'Void':  { bg:'#05060a', a:'#6df3c0', a2:'#8a7bff' },
  'Ember': { bg:'#0c0604', a:'#ff9f43', a2:'#ff5d73' },
  'Ice':   { bg:'#04080d', a:'#4cc9ff', a2:'#a0f0ff' },
  'Mono':  { bg:'#0a0a0c', a:'#d6d6e6', a2:'#9aa0c0' },
};
function applyTheme(t){
  S.bg = t.bg;
  document.documentElement.style.setProperty('--bg', t.bg);
  document.documentElement.style.setProperty('--accent', t.a);
  document.documentElement.style.setProperty('--accent2', t.a2);
}
function buildThemeButtons(){
  const wrap = $('themes'); wrap.innerHTML = '';
  Object.keys(THEMES).forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { applyTheme(THEMES[name]); [...wrap.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); };
    wrap.appendChild(b);
  });
  wrap.firstChild.classList.add('active');
}

// ---- attraction matrix editor ----
function valColor(v){
  // -1 red -> 0 grey -> +1 green
  if (v >= 0){ const t = v; return `rgb(${Math.round(60-40*t)},${Math.round(60+160*t)},${Math.round(80+60*t)})`; }
  const t = -v; return `rgb(${Math.round(60+180*t)},${Math.round(60-40*t)},${Math.round(70-30*t)})`;
}
function rebuildMatrix(){
  const wrap = $('matrixWrap');
  const n = S.species;
  const tbl = document.createElement('table');
  tbl.className = 'matrix';
  for (let i = 0; i < n; i++){
    const tr = document.createElement('tr');
    for (let j = 0; j < n; j++){
      const td = document.createElement('td');
      const set = () => { td.style.background = valColor(S.matrix[i][j]); td.title = `${i}→${j}: ${S.matrix[i][j].toFixed(2)}`; };
      set();
      td.addEventListener('click', () => {
        // cycle through -1, -0.5, 0, 0.5, 1
        const steps = [-1,-0.5,0,0.5,1];
        let idx = steps.findIndex(s => Math.abs(s - S.matrix[i][j]) < 0.26);
        idx = (idx + 1) % steps.length;
        S.matrix[i][j] = steps[idx];
        set();
      });
      td.addEventListener('contextmenu', e => { e.preventDefault(); S.matrix[i][j] = +(Math.random()*2-1).toFixed(2); set(); });
      // colour-coded border by row species
      td.style.boxShadow = `inset 0 0 0 1px ${PALETTE[j]}22`;
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  wrap.innerHTML = '';
  wrap.appendChild(tbl);
}

// ---- legend ----
function rebuildLegend(){
  const names = ['Rose','Mint','Violet','Gold','Sky','Amber','Orchid'];
  let html = '';
  for (let i = 0; i < S.species; i++)
    html += `<span class="swatch" title="${names[i]}" style="background:${PALETTE[i]}"></span>`;
  $('legend').innerHTML = html;
}

// ---- buttons ----
$('bRandom').onclick = () => { API.buildMatrix(true); rebuildMatrix(); };
$('bZero').onclick   = () => { API.buildMatrix(false); rebuildMatrix(); };
$('bSymmetry').onclick = () => {
  const n = S.species;
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) S.matrix[j][i] = S.matrix[i][j];
  rebuildMatrix();
};
const bPause = $('bPause');
bPause.onclick = () => { S.paused = !S.paused; bPause.classList.toggle('active', S.paused); bPause.textContent = S.paused ? 'Resume' : 'Pause'; };
const bTrails = $('bTrails');
bTrails.onclick = () => { S.trails = !S.trails; bTrails.classList.toggle('active', S.trails); };

// ---- Evolve: let the rules drift, so the ecosystem never settles ----
let evolving = false;
const bEvolve = $('bEvolve');
bEvolve.onclick = () => { evolving = !evolving; bEvolve.classList.toggle('active', evolving); };
setInterval(() => {
  if (!evolving) return;
  const n = S.species;
  // nudge a couple of random matrix entries by a small amount, clamped to [-1,1]
  for (let k = 0; k < 2; k++){
    const i = (Math.random()*n)|0, j = (Math.random()*n)|0;
    let v = S.matrix[i][j] + (Math.random()*0.4 - 0.2);
    S.matrix[i][j] = Math.max(-1, Math.min(1, +v.toFixed(2)));
  }
  rebuildMatrix();
}, 1500);

// ---- "Surprise me": randomise the entire world, then big-bang it ----
const rnd = (a,b) => a + Math.random()*(b-a);
$('bSurprise').onclick = () => {
  S.species  = 3 + ((Math.random()*4)|0);     // 3..6
  S.force    = +rnd(0.6, 1.8).toFixed(2);
  S.range    = Math.round(rnd(60, 130));
  S.friction = +rnd(0.80, 0.92).toFixed(2);
  API.buildMatrix(true);
  const names = Object.keys(THEMES);
  applyTheme(THEMES[names[(Math.random()*names.length)|0]]);
  const set=(id,lbl,val,fmt)=>{const e=$(id);if(e){e.value=val;$(lbl).textContent=fmt?fmt(val):val;}};
  set('sSpecies','vSpecies',S.species,v=>v|0);
  set('sForce','vForce',S.force,v=>(+v).toFixed(2));
  set('sRange','vRange',S.range,v=>v|0);
  set('sFriction','vFriction',S.friction,v=>(+v).toFixed(2));
  API.spawn(); API.bigBang();
  rebuildMatrix(); rebuildLegend();
};

// ---- Auto showreel: hands-free art mode, reinvents the world periodically ----
// For variety it alternates between fully-random worlds and the curated presets
// (each with a random theme), so the gallery never feels samey.
let autoOn = false, autoTimer = null;
function autoStep(){
  if (Math.random() < 0.5){
    $('bSurprise').click();
  } else {
    const btns = $('presets').children;
    if (btns.length) btns[(Math.random()*btns.length)|0].click();
    const names = Object.keys(THEMES);
    applyTheme(THEMES[names[(Math.random()*names.length)|0]]);
    API.bigBang();
  }
}
const bAuto = $('bAuto');
bAuto.onclick = () => {
  autoOn = !autoOn;
  bAuto.classList.toggle('active', autoOn);
  clearInterval(autoTimer);
  if (autoOn){ autoStep(); autoTimer = setInterval(autoStep, 20000); }
};

// ---- presets: hand-picked matrices that produce recognisable behaviour ----
const PRESETS = {
  'Cells': { species:4, m:[
    [ 1,-1, 0, 0],
    [-1, 1,-1, 0],
    [ 0,-1, 1,-1],
    [ 0, 0,-1, 1]] },
  'Chase': { species:3, m:[
    [ 0, 1, 0],
    [ 0, 0, 1],
    [ 1, 0, 0]] },
  'Web':   { species:5, m:[
    [ 0.6,-1, 0.4,-1, 0.2],
    [-1, 0.6,-1, 0.4,-1],
    [ 0.4,-1, 0.6,-1, 0.4],
    [-1, 0.4,-1, 0.6,-1],
    [ 0.2,-1, 0.4,-1, 0.6]] },
  'Drift': { species:3, m:[
    [ 0.3, 0.6,-0.8],
    [-0.8, 0.3, 0.6],
    [ 0.6,-0.8, 0.3]] },
  'Worms': { species:4, m:[
    [ 0.8, 0.7,-1, 0],
    [-1, 0.8, 0.7, 0],
    [ 0.7,-1, 0.8, 0],
    [ 0.2, 0.2, 0.2, 0.9]] },
  'Crystal': { species:4, m:[
    [ 1,-0.6,-0.6,-0.6],
    [-0.6, 1,-0.6,-0.6],
    [-0.6,-0.6, 1,-0.6],
    [-0.6,-0.6,-0.6, 1]] },
};
function buildPresetButtons(){
  const wrap = $('presets');
  wrap.innerHTML = '';
  Object.keys(PRESETS).forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => {
      const p = PRESETS[name];
      S.species = p.species;
      $('sSpecies').value = p.species; $('vSpecies').textContent = p.species;
      S.matrix = p.m.map(r => r.slice());
      API.spawn(); rebuildMatrix(); rebuildLegend();
    };
    wrap.appendChild(b);
  });
}

// ---- panel toggle ----
const ui = $('ui'), toggle = $('toggleUI');
function hidePanel(h){ ui.classList.toggle('hidden', h); toggle.classList.toggle('show', h); }
let panelHidden = false;
toggle.onclick = () => { panelHidden = false; hidePanel(false); };
$('bClose').onclick = () => { panelHidden = true; hidePanel(true); };

// ---- keyboard ----
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch(e.key.toLowerCase()){
    case ' ': e.preventDefault(); bPause.click(); break;
    case 'r': $('bRandom').click(); break;
    case 't': bTrails.click(); break;
    case 'h': panelHidden = !panelHidden; hidePanel(panelHidden); break;
    case 'g': bGlow.click(); break;
    case 'b': bBonds.click(); break;
    case 'a': bAurora.click(); break;
    case 'e': bEvolve.click(); break;
    case 's': document.getElementById('bSurprise').click(); break;
    case 'f': document.getElementById('bFull').click(); break;
    case '?': document.getElementById('helpBtn').click(); break;
    case 'escape': document.getElementById('help').classList.remove('show'); break;
    case '1': case '2': case '3': case '4': {
      const btns = $('presets').children;
      const idx = +e.key - 1;
      if (btns[idx]) btns[idx].click();
      break;
    }
  }
});

// ---- cluster estimate (cheap) : count coarse grid cells with high density ----
setInterval(() => {
  const P = API.P; if (!P) return;
  const n = S.count, gs = 60 * (window.devicePixelRatio||1);
  const cols = Math.ceil(innerWidth*(window.devicePixelRatio||1)/gs);
  const rows = Math.ceil(innerHeight*(window.devicePixelRatio||1)/gs);
  const bins = new Uint16Array(cols*rows);
  for (let i=0;i<n;i++){
    const cx = Math.min(cols-1, (P.x[i]/gs)|0);
    const cy = Math.min(rows-1, (P.y[i]/gs)|0);
    bins[cy*cols+cx]++;
  }
  const thresh = (n/(cols*rows)) * 2.2;
  let c = 0; for (let i=0;i<bins.length;i++) if (bins[i] > thresh) c++;
  $('vClusters').textContent = c;
}, 700);

// ---- expose rebuild hooks for other modules (tools.js) ----
window.PRIMORDIUM_UI = {
  rebuildMatrix, rebuildLegend,
  syncSliders(){
    const set=(id,lbl,val,fmt)=>{const e=$(id);if(e){e.value=val;$(lbl).textContent=fmt?fmt(val):val;}};
    set('sCount','vCount',S.count,v=>v|0); set('sSpecies','vSpecies',S.species,v=>v|0);
    set('sForce','vForce',S.force,v=>(+v).toFixed(2)); set('sRange','vRange',S.range,v=>v|0);
    set('sFriction','vFriction',S.friction,v=>(+v).toFixed(2));
    set('sSpeed','vSpeed',S.speed,v=>(v|0)+'×'); set('sPsize','vPsize',S.psize,v=>(+v).toFixed(1));
    $('bGlow').classList.toggle('active', S.glow);
  }
};

// ---- init ----
rebuildMatrix();
rebuildLegend();
buildPresetButtons();
buildThemeButtons();
$('vCount').textContent = S.count;

})();
