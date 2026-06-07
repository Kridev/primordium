/* Primordium — procedural ambient soundscape (experimental).
   Everything is synthesised live from noise + oscillators — no audio files.
   Layers (fire / wind / rain / birds / noise / melody) stack, and each one
   slowly drifts, swells and breathes, partly driven by the swarm's motion. */
(() => {
'use strict';
const API = window.PRIMORDIUM;
const $ = id => document.getElementById(id);

let actx = null, out = null, whiteBuf = null, started = false;
let convL = null, wetTone = null, wetG = null, send = null;     // reverb bus + FX send
let echoDelay = null, echoG = null, echoOn = false;             // echo bus
const layers = {};

// ---- procedural reverb: a generated impulse response = the "room" ----
function impulse(seconds, decay, dark){
  const rate = actx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
  const buf = actx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++){
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++){
      const t = i / len;
      let v = (Math.random()*2 - 1) * Math.pow(1 - t, decay);
      if (dark){ v = last + 0.35*(v - last); last = v; }   // crude lowpass → darker tail
      d[i] = v;
    }
  }
  return buf;
}
const SPACES = {
  Room:      { secs:0.70, decay:3.4, wet:0.22, dry:0.95, tone:9000 },
  Hall:      { secs:1.90, decay:2.6, wet:0.34, dry:0.90, tone:7000 },
  Cathedral: { secs:3.60, decay:2.0, wet:0.46, dry:0.82, tone:5500 },
  Cave:      { secs:2.60, decay:1.7, wet:0.42, dry:0.85, tone:2600, dark:true },
};
let curSpace = 'Cave';
function setSpace(name){
  if (!actx || !SPACES[name]) return;
  const s = SPACES[name]; curSpace = name;
  convL.buffer = impulse(s.secs, s.decay, s.dark);
  const now = actx.currentTime;
  wetTone.frequency.setTargetAtTime(s.tone, now, 0.3);
  wetG.gain.setTargetAtTime(s.wet, now, 0.4);
}
function setEcho(on){
  echoOn = on;
  if (echoG) echoG.gain.setTargetAtTime(on ? 0.32 : 0, actx.currentTime, 0.05);
}

function noiseBuffer(sec){
  const len = Math.floor(actx.sampleRate * sec);
  const b = actx.createBuffer(1, len, actx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function loopNoise(){
  const s = actx.createBufferSource();
  s.buffer = whiteBuf; s.loop = true; s.start();
  return s;
}

// ---- continuous layers (always running at gain 0 until toggled on) ----
function buildLayers(){
  let s, g, a, b;
  // WIND: band-passed noise rolled off by a lowpass → soft, airy, no hiss
  s = loopNoise();
  a = actx.createBiquadFilter(); a.type='bandpass'; a.frequency.value=220; a.Q.value=0.5;
  b = actx.createBiquadFilter(); b.type='lowpass';  b.frequency.value=800;
  g = actx.createGain(); g.gain.value=0;
  s.connect(a); a.connect(b); b.connect(g); g.connect(out);
  layers.wind = { on:false, gain:g, bp:a, lp:b };
  // FIRE: low brown-ish roar (crackles spawned separately)
  s = loopNoise();
  a = actx.createBiquadFilter(); a.type='lowpass'; a.frequency.value=320; a.Q.value=0.4;
  g = actx.createGain(); g.gain.value=0;
  s.connect(a); a.connect(g); g.connect(out);
  layers.fire = { on:false, gain:g, lp:a };
  // RAIN: high hiss capped by a lowpass so it isn't piercing (droplets separate)
  s = loopNoise();
  a = actx.createBiquadFilter(); a.type='highpass'; a.frequency.value=1100;
  b = actx.createBiquadFilter(); b.type='lowpass';  b.frequency.value=6000;
  g = actx.createGain(); g.gain.value=0;
  s.connect(a); a.connect(b); b.connect(g); g.connect(out);
  layers.rain = { on:false, gain:g, hp:a, lp:b };
  // NOISE: gently-filtered wash whose brightness drifts
  s = loopNoise();
  a = actx.createBiquadFilter(); a.type='lowpass'; a.frequency.value=5000;
  g = actx.createGain(); g.gain.value=0;
  s.connect(a); a.connect(g); g.connect(out);
  layers.noise = { on:false, gain:g, lp:a };
  // BIRDS + MELODY: no continuous node, just scheduled events
  layers.birds  = { on:false };
  layers.melody = { on:false };
}

// route a source to the dry master AND the FX send (reverb/echo). Only melodic
// and transient sounds use this; the continuous noise beds stay dry (so reverb
// has note-offsets to actually decay into, instead of a constant wash).
function toMix(node){ node.connect(out); if (send) node.connect(send); }

// ---- transient one-shots ----
function burst(freq, Q, peak, dur, type){
  const s = actx.createBufferSource(); s.buffer = whiteBuf; s.loop = true;
  const f = actx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = Q;
  const g = actx.createGain(); const now = actx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  s.connect(f); f.connect(g); toMix(g);
  s.start(now); s.stop(now + dur + 0.05);
}
function droplet(){ burst(1300 + Math.random()*2400, 3 + Math.random()*4, 0.008 + Math.random()*0.03, 0.02 + Math.random()*0.05); }

// fire crackle runs on its OWN irregular clock (not the 200ms grid), so it
// never sounds metronomic — short Poisson-ish gaps cluster into natural flurries
let fireSched = false;
function crackleLoop(){
  if (!started || !layers.fire || !layers.fire.on){ fireSched = false; return; }
  if (Math.random() < 0.12)   // occasional fatter pop
    burst(280 + Math.random()*1100, 2 + Math.random()*3, 0.045 + Math.random()*0.07, 0.05 + Math.random()*0.12);
  else                        // lots of tiny ticks
    burst(700 + Math.random()*2600, 4 + Math.random()*5, 0.006 + Math.random()*0.022, 0.010 + Math.random()*0.04);
  // gaps biased short (random*random) → flurries; a little denser with swarm energy
  const gap = 8 + (Math.random()*Math.random()*150) / (0.7 + curEnergy);
  setTimeout(crackleLoop, gap);
}
function chirp(){
  const notes = 1 + (Math.random()*3|0);
  const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
  if (pan){ pan.pan.value = Math.random()*1.6 - 0.8; toMix(pan); }
  let t0 = actx.currentTime;
  const base = 1700 + Math.random()*2000;
  for (let k = 0; k < notes; k++){
    const o = actx.createOscillator(); o.type = 'sine';
    const g = actx.createGain();
    const f0 = base * (0.9 + Math.random()*0.4);
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.linearRampToValueAtTime(f0 * (1.2 + Math.random()*0.3), t0 + 0.05);
    o.frequency.linearRampToValueAtTime(f0 * 1.05, t0 + 0.11);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g); if (pan) g.connect(pan); else toMix(g);
    o.start(t0); o.stop(t0 + 0.22);
    t0 += 0.10 + Math.random()*0.10;
  }
}

// ---- original generative melody over a brooding chord progression ----
// progression.js provides only the harmony (chord voicings + timing). The lead
// line here is composed live from the current chord's tones — fully original.
const CHORDS = window.CHORD_PROG || [];   // [blockDurMs, [midiPitches]]
const SONG_SPEED = 1.0;
let BEAT = 0.5, EIGHTH = 0.25;
if (CHORDS.length){ BEAT = Math.min.apply(null, CHORDS.map(c => c[0])) / 1000; EIGHTH = BEAT / 2; }
const PHRASE = 8;                          // beats per melodic phrase
let chordIdx = 0, songTime = 0, songPos = 0, chordBeatsLeft = 0, curChord = null, lastLead = 81;
let motif = [], motifAge = 0, phraseLow = 76, phraseHigh = 86, lastPhrase = -1;
const mfreq = m => 440 * Math.pow(2, (m - 69) / 12);
function sawNote(freq, t, len, pan, peak){
  const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  const g = actx.createGain();
  lp.frequency.setValueAtTime(freq*2 + 300, t);
  lp.frequency.linearRampToValueAtTime(freq*5 + 900, t + len*0.45);
  lp.frequency.linearRampToValueAtTime(freq*2 + 300, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak || 0.03, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(lp); lp.connect(g);
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  if (p){ p.pan.value = pan; g.connect(p); toMix(p); } else toMix(g);
  o.start(t); o.stop(t + len + 0.05);
}
// a fresh rhythm motif for a phrase: which eighth-note slots carry a note.
// the SAME motif is reused for a few phrases so the tune feels composed.
function newMotif(){
  const slots = PHRASE * 2;
  motif = [];
  for (let i = 0; i < slots; i++){
    const onBeat = (i % 2 === 0);
    motif.push(Math.random() < (onBeat ? 0.62 : 0.32) ? 1 : 0);
  }
}
// lead candidates = current chord's pitch-classes across the lead register
function chordCands(){
  const pcs = new Set((curChord ? curChord[1] : []).map(p => p % 12));
  const c = [];
  for (let m = 72; m <= 91; m++) if (pcs.has(m % 12)) c.push(m);
  return c;
}
// steady eighth-note grid + a phrase-long arc (rise to the middle, fall back) +
// a repeating motif → song-like; the exact pitch is lightly jittered within the chord
function scheduleSong(now){
  if (!CHORDS.length) return;
  if (songTime < now) songTime = now + 0.08;
  let guard = 0;
  while (songTime < now + 0.6 && guard++ < 32){
    // move to the next chord block when the current one runs out, and lay its pad
    if (chordBeatsLeft <= 0.0001){
      curChord = CHORDS[chordIdx];
      const durSec = (curChord[0] / 1000) * SONG_SPEED;
      for (const p of curChord[1]) sawNote(mfreq(p), songTime, durSec + 0.25, ((p % 7) - 3) / 7, 0.013);
      chordBeatsLeft = Math.max(1, Math.round(curChord[0] / (BEAT * 1000)));
      chordIdx = (chordIdx + 1) % CHORDS.length;
    }
    // at each new phrase, pick a fresh register window for the arc (varied shape)
    const phrase = Math.floor(songPos / PHRASE);
    if (phrase !== lastPhrase){
      lastPhrase = phrase;
      phraseLow  = 75 + (Math.random()*4|0);    // 75..78
      phraseHigh = 83 + (Math.random()*7|0);    // 83..89
      if (motifAge <= 0){ newMotif(); motifAge = PHRASE * (2 + (Math.random()*2|0)); }
    }
    // melody on the eighth-grid, gated by the motif
    const slot = ((Math.round(songPos * 2) % (PHRASE*2)) + PHRASE*2) % (PHRASE*2);
    if (motif.length && motif[slot]){
      const phase  = (songPos % PHRASE) / PHRASE;       // 0..1 across the phrase
      const arc    = Math.sin(Math.PI * phase);         // up to the middle, then down
      const target = phraseLow + arc * (phraseHigh - phraseLow);
      const cands  = chordCands();
      if (cands.length){
        let pool = cands.filter(c => c !== lastLead); if (!pool.length) pool = cands;
        const aim = target + (Math.random()*3 - 1.5);   // slight randomisation around the contour
        let best = pool[0], bd = 1e9;
        for (const c of pool){ const d = Math.abs(c - aim); if (d < bd){ bd = d; best = c; } }
        lastLead = best;
        const len = EIGHTH * (Math.random() < 0.28 ? 1.9 : 1.1);
        sawNote(mfreq(best), songTime, len + 0.1, (best - 82) / 16, 0.032);
      }
    }
    songTime       += EIGHTH;
    songPos        += 0.5;
    chordBeatsLeft -= 0.5;
    motifAge       -= 0.5;
  }
}

// ---- evolution loop: slow drift + swarm coupling + sparse events ----
let phase = 0, curEnergy = 0;
// smoothed random walk → organic "coming and going" for wind & rain.
// every few seconds we pick a new random target level and ease toward it.
const windState = { lvl:0, tgt:0, next:0, min:5, span:11, rate:0.07, bias:1.5 };
const rainState = { lvl:0, tgt:0, next:0, min:6, span:13, rate:0.05, bias:1.2 };
function walk(st, now){
  if (now >= st.next){ st.tgt = Math.pow(Math.random(), st.bias); st.next = now + st.min + Math.random()*st.span; }
  st.lvl += (st.tgt - st.lvl) * st.rate;
  return st.lvl;
}
setInterval(() => {
  if (!started || !actx) return;
  const now = actx.currentTime;
  let energy = 0;
  const P = API.P, S = API.S;
  if (P){
    const n = S.count, step = Math.max(1, (n/400)|0); let c = 0;
    for (let i = 0; i < n; i += step){ energy += P.vx[i]*P.vx[i] + P.vy[i]*P.vy[i]; c++; }
    energy = Math.sqrt(energy / Math.max(1, c));
  }
  phase += 0.2;
  const drift = 0.5 + 0.5*Math.sin(phase*0.043);
  const e = Math.min(1.5, energy);
  curEnergy = e;   // shared with the off-grid crackle scheduler

  // WIND — natural coming & going via a smoothed random walk + a fine tremor.
  // level can ease all the way down to near-silence and back up to a full gust.
  const W = layers.wind;
  if (W){
    const lvl = W.on ? walk(windState, now) : (windState.lvl *= 0.92, windState.lvl);
    const tremor = 0.85 + 0.15*Math.sin(phase*0.9 + 0.5);
    W.gain.gain.setTargetAtTime(W.on ? (0.004 + 0.085*lvl*lvl) * tremor : 0, now, 0.6);
    W.bp.frequency.setTargetAtTime(120 + 260*lvl, now, 0.9);     // gust = airier/higher
    W.lp.frequency.setTargetAtTime(430 + 1500*lvl, now, 0.9);    // and brighter
  }
  // FIRE — just the steady roar here; crackles run off-grid in crackleLoop()
  const F = layers.fire;
  if (F) F.gain.gain.setTargetAtTime(F.on ? 0.05 + 0.015*drift : 0, now, 0.5);
  // RAIN — heavier/lighter via its own random walk; brightness tracks intensity
  const R = layers.rain;
  if (R){
    const lvl = R.on ? walk(rainState, now) : (rainState.lvl *= 0.92, rainState.lvl);
    R.gain.gain.setTargetAtTime(R.on ? (0.005 + 0.032*lvl) : 0, now, 0.6);
    R.hp.frequency.setTargetAtTime(1300 - 550*lvl, now, 1.2);    // heavier = fuller body
    R.lp.frequency.setTargetAtTime(3000 + 4200*lvl, now, 1.2);   // heavier = brighter
    if (R.on){ const drops = (lvl*6)|0; for (let d=0; d<drops; d++) if (Math.random()<0.6) droplet(); }
  }
  // NOISE
  const N = layers.noise;
  if (N){
    N.gain.gain.setTargetAtTime(N.on ? 0.04 : 0, now, 0.5);
    N.lp.frequency.setTargetAtTime(1500 + drift*5500, now, 1.0);
  }
  // BIRDS
  const B = layers.birds;
  if (B && B.on && Math.random() < 0.05 + e*0.03) chirp();
  // MELODY — original lead improvised over the chord progression
  const M = layers.melody;
  if (M && M.on) scheduleSong(now);
}, 200);

// ---- master setup + toggles ----
function ensure(){
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  out = actx.createGain(); out.gain.value = 0;
  out.connect(actx.destination);                      // dry master (everything)

  // FX send: ONLY melodic + transient material feeds reverb/echo (see toMix),
  // so the continuous noise beds never wash the reverb into a constant drone.
  send = actx.createGain(); send.gain.value = 1;

  // reverb: send → convolver → tone lowpass → wet → speakers
  convL = actx.createConvolver();
  wetTone = actx.createBiquadFilter(); wetTone.type = 'lowpass'; wetTone.frequency.value = 9000;
  wetG = actx.createGain(); wetG.gain.value = 0;
  send.connect(convL); convL.connect(wetTone); wetTone.connect(wetG); wetG.connect(actx.destination);

  // echo: send → [input gate] → delay → damped feedback → wet → speakers.
  // Gating the INPUT (not output) means turning echo off lets the tail ring out
  // and fall silent; the lowpass inside the feedback stops any noise buildup.
  echoDelay = actx.createDelay(); echoDelay.delayTime.value = 0.33;
  echoG = actx.createGain(); echoG.gain.value = 0;                 // input gate (toggled)
  const echoDamp = actx.createBiquadFilter(); echoDamp.type = 'lowpass'; echoDamp.frequency.value = 2400;
  const echoFb = actx.createGain(); echoFb.gain.value = 0.34;
  const echoWet = actx.createGain(); echoWet.gain.value = 0.5;
  send.connect(echoG); echoG.connect(echoDelay);
  echoDelay.connect(echoDamp); echoDamp.connect(echoFb); echoFb.connect(echoDelay);
  echoDelay.connect(echoWet); echoWet.connect(actx.destination);

  whiteBuf = noiseBuffer(3);
  buildLayers();
  setSpace(curSpace);
  out.gain.linearRampToValueAtTime(0.7, actx.currentTime + 0.8); // gentler master
}
function toggle(name, btn){
  ensure(); actx.resume(); started = true;
  layers[name].on = !layers[name].on;
  if (name === 'fire' && layers.fire.on && !fireSched){ fireSched = true; crackleLoop(); }
  btn.classList.toggle('active', layers[name].on);
}
[['fire','bFire'],['wind','bWind'],['rain','bRain'],['birds','bBirds'],['noise','bNoise'],['melody','bMelody']]
  .forEach(([name,id]) => { const btn = $(id); if (btn) btn.onclick = () => toggle(name, btn); });

// ---- Space (reverb) buttons + Echo toggle ----
const spacesWrap = $('spaces');
if (spacesWrap){
  Object.keys(SPACES).forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    if (name === curSpace) b.classList.add('active');
    b.onclick = () => {
      ensure(); actx.resume(); started = true;
      setSpace(name);
      [...spacesWrap.children].forEach(c => c.classList.remove('active'));
      b.classList.add('active');
    };
    spacesWrap.appendChild(b);
  });
}
const bEcho = $('bEcho');
if (bEcho) bEcho.onclick = () => {
  ensure(); actx.resume(); started = true;
  setEcho(!echoOn);
  bEcho.classList.toggle('active', echoOn);
};

window.PRIMORDIUM_AMBIENCE = { get started(){ return started; }, layers, setSpace, setEcho, get space(){ return curSpace; }, get echo(){ return echoOn; } };
})();
