/* Primordium — sound toggle, PNG export, save / load / shareable URL */
(() => {
'use strict';
const API = window.PRIMORDIUM;
const { S } = API;
const $ = id => document.getElementById(id);
function flash(msg){ const s = $('status'); s.textContent = msg; clearTimeout(flash._t); flash._t = setTimeout(()=>s.textContent='', 2600); }

// ---- PNG export ----
$('bSnap').onclick = () => {
  const cv = document.getElementById('stage');
  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `primordium-${Date.now()}.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    flash('saved PNG');
  });
};

// ---- video capture (WebM via MediaRecorder) ----
let recorder = null, chunks = [];
const bRec = $('bRec');
bRec.onclick = () => {
  if (recorder){ recorder.stop(); return; }
  const cv = document.getElementById('stage');
  if (!cv.captureStream || typeof MediaRecorder === 'undefined'){ flash('recording not supported here'); return; }
  let mime = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
  try {
    recorder = new MediaRecorder(cv.captureStream(60), { mimeType: mime, videoBitsPerSecond: 8e6 });
  } catch(e){ flash('recording failed to start'); recorder = null; return; }
  chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `primordium-${Date.now()}.webm`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    recorder = null; bRec.classList.remove('active'); bRec.textContent = '🎬 Record';
    flash('saved WebM clip');
  };
  recorder.start();
  bRec.classList.add('active'); bRec.textContent = '⏹ Stop';
  flash('recording… click again to save');
};

// ---- serialise the rules (not particle positions) ----
function serialise(){
  return {
    v: 3,
    count: S.count, species: S.species, force: +S.force.toFixed(3),
    range: S.range, friction: +S.friction.toFixed(3),
    speed: S.speed, psize: +S.psize.toFixed(2), glow: S.glow, bg: S.bg,
    trails: S.trails, fade: S.fade, bonds: S.bonds, aurora: S.aurora,
    matrix: S.matrix.map(r => r.map(x => +x.toFixed(2))),
  };
}
function setToggle(id, val){ const b = $(id); if (b) b.classList.toggle('active', !!val); }
function apply(st){
  S.count = st.count; S.species = st.species; S.force = st.force;
  S.range = st.range; S.friction = st.friction;
  if (st.speed != null) S.speed = st.speed;
  if (st.psize != null) S.psize = st.psize;
  if (st.glow  != null){ S.glow  = st.glow;  setToggle('bGlow', st.glow); }
  if (st.bonds != null){ S.bonds = st.bonds; setToggle('bBonds', st.bonds); }
  if (st.aurora!= null){ S.aurora= st.aurora;setToggle('bAurora', st.aurora); }
  if (st.trails!= null){ S.trails= st.trails;setToggle('bTrails', st.trails); }
  if (st.fade  != null){
    S.fade = st.fade;
    const el = $('sTrail');
    if (el){ const len = Math.round((0.5 - st.fade)/0.47*100); el.value = len; const o=$('vTrail'); if(o)o.textContent = len+'%'; }
  }
  if (st.bg) { S.bg = st.bg; document.documentElement.style.setProperty('--bg', st.bg); }
  S.matrix = st.matrix.map(r => r.slice());
  API.spawn();
  const UI = window.PRIMORDIUM_UI;
  if (UI){ UI.syncSliders(); UI.rebuildMatrix(); UI.rebuildLegend(); }
}

// ---- save / load (localStorage) ----
$('bSave').onclick = () => { localStorage.setItem('primordium', JSON.stringify(serialise())); flash('saved to this browser'); };
$('bLoad').onclick = () => {
  const raw = localStorage.getItem('primordium');
  if (!raw){ flash('nothing saved yet'); return; }
  try { apply(JSON.parse(raw)); flash('loaded'); } catch(e){ flash('load failed'); }
};

// ---- shareable URL (state packed into hash) ----
$('bShare').onclick = async () => {
  const packed = btoa(JSON.stringify(serialise()));
  const url = location.origin + location.pathname + '#' + packed;
  try { await navigator.clipboard.writeText(url); flash('share link copied to clipboard'); }
  catch(e){ location.hash = packed; flash('link in address bar'); }
};

// ---- fullscreen ----
$('bFull').onclick = () => {
  if (!document.fullscreenElement){
    (document.documentElement.requestFullscreen || (()=>{})).call(document.documentElement);
  } else {
    (document.exitFullscreen || (()=>{})).call(document);
  }
};

// ---- big bang restart ----
$('bBang').onclick = () => { API.spawn(); API.bigBang(); flash('let there be light'); };

// ---- help overlay ----
const help = $('help');
$('helpBtn').onclick = () => help.classList.add('show');
$('helpClose').onclick = () => help.classList.remove('show');
help.addEventListener('click', e => { if (e.target === help) help.classList.remove('show'); });

// ---- intro overlay (skip entirely with ?nointro, e.g. for kiosk/embeds) ----
const intro = $('intro');
function dismiss(){ intro.classList.add('gone'); }
if (intro){
  if (/[?&]nointro\b/.test(location.search)){
    intro.style.display = 'none';
  } else {
    intro.addEventListener('click', dismiss);
    setTimeout(dismiss, 5200);
  }
}

// ---- load from URL hash on boot ----
if (location.hash.length > 4){
  try { apply(JSON.parse(atob(location.hash.slice(1)))); flash('loaded from link'); }
  catch(e){ /* ignore malformed */ }
}
})();
