/* Primordium — emergent particle-life ecosystem
   A few simple local rules between coloured "species" produce
   cells, membranes, chasers, oscillators and self-healing structures. */
(() => {
'use strict';

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d', { alpha: false });
let W, H, DPR;
function resize(){
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.width  = Math.floor(innerWidth  * DPR);
  H = cv.height = Math.floor(innerHeight * DPR);
  cv.style.width = innerWidth + 'px';
  cv.style.height = innerHeight + 'px';
}
addEventListener('resize', resize); resize();

// pause the physics when the tab is hidden — no point burning CPU unseen
let hiddenPause = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ if (!S.paused){ hiddenPause = true; S.paused = true; } }
  else if (hiddenPause){ hiddenPause = false; S.paused = false; }
});

// ---- palette (one hue per species) ----
const PALETTE = [
  '#ff5d73', // rose
  '#6df3c0', // mint
  '#8a7bff', // violet
  '#ffd166', // gold
  '#4cc9ff', // sky
  '#ff9f43', // amber
  '#c77dff', // orchid
];

// ---- simulation state ----
const S = {
  count: 1500,
  species: 5,
  force: 1.0,
  range: 90,        // interaction radius (css px)
  friction: 0.86,
  trails: true,
  fade: 0.16,       // trail persistence: lower = longer trails
  paused: false,
  matrix: [],       // matrix[i][j] = how species i feels about species j  (-1..1)
  speed: 1,         // physics substeps per rendered frame
  psize: 1.7,       // particle radius (css px)
  glow: true,       // additive blending for a luminous look
  bg: '#05060a',    // background / fade colour (theme-driven)
  bonds: false,     // draw faint links between nearby attracting particles
  aurora: false,    // slowly rotate every species' hue over time
};

let P = null; // particle struct-of-arrays

function buildMatrix(randomize = true){
  const n = S.species;
  S.matrix = [];
  for (let i = 0; i < n; i++){
    S.matrix[i] = [];
    for (let j = 0; j < n; j++){
      S.matrix[i][j] = randomize ? +(Math.random()*2 - 1).toFixed(2) : 0;
    }
  }
}

function spawn(){
  const n = S.count;
  P = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    s:  new Uint8Array(n),
  };
  for (let i = 0; i < n; i++){
    P.x[i] = Math.random() * W;
    P.y[i] = Math.random() * H;
    P.vx[i] = 0; P.vy[i] = 0;
    P.s[i] = (Math.random() * S.species) | 0;
  }
}

// ---- spatial hash grid for O(n) neighbour queries ----
let grid, gridCols, gridRows, cellSize, gridW, gridH;
function buildGrid(r){
  cellSize = r; gridW = W; gridH = H;
  gridCols = Math.max(1, Math.ceil(W / cellSize));
  gridRows = Math.max(1, Math.ceil(H / cellSize));
  grid = new Array(gridCols * gridRows);
  for (let i = 0; i < grid.length; i++) grid[i] = [];
}
function cellIndex(x, y){
  let cx = (x / cellSize) | 0, cy = (y / cellSize) | 0;
  if (cx < 0) cx = 0; else if (cx >= gridCols) cx = gridCols - 1;
  if (cy < 0) cy = 0; else if (cy >= gridRows) cy = gridRows - 1;
  return cy * gridCols + cx;
}

// ---- mouse stirring (left drag = attract, right drag = repel) ----
const mouse = { x: 0, y: 0, down: false, repel: false };
cv.addEventListener('pointerdown', e => { mouse.down = true; mouse.repel = (e.button === 2); mouse.x = e.clientX*DPR; mouse.y = e.clientY*DPR; });
cv.addEventListener('pointermove', e => { mouse.x = e.clientX*DPR; mouse.y = e.clientY*DPR; });
addEventListener('pointerup', () => mouse.down = false);
cv.addEventListener('contextmenu', e => e.preventDefault()); // free the right button for repel

// double-click drops a fresh "seed colony" of one species at the cursor
cv.addEventListener('dblclick', e => {
  if (!P) return;
  const cxp = e.clientX*DPR, cyp = e.clientY*DPR;
  const sp = (Math.random()*S.species)|0;
  const seed = Math.min(120, (S.count*0.06)|0);
  for (let k = 0; k < seed; k++){
    const i = (Math.random()*S.count)|0;
    const ang = Math.random()*6.2832, rr = Math.random()*40*DPR;
    P.x[i] = cxp + Math.cos(ang)*rr;
    P.y[i] = cyp + Math.sin(ang)*rr;
    P.vx[i] = P.vy[i] = 0;
    P.s[i] = sp;
  }
});

// ---- physics step ----
function step(){
  const n = S.count;
  const r = S.range * DPR;
  const r2 = r * r;
  const F = S.force;
  const fr = S.friction;
  const M = S.matrix;

  if (!grid || cellSize !== r || gridW !== W || gridH !== H) buildGrid(r);
  for (let c = 0; c < grid.length; c++) grid[c].length = 0;
  for (let i = 0; i < n; i++) grid[cellIndex(P.x[i], P.y[i])].push(i);

  const beta = 0.3 * r; // inner repulsion zone (keeps particles from collapsing)
  // toroidal world: wrap neighbour cells + use minimal-image deltas, but only
  // when there are enough cells that wrapping won't fold a cell onto itself.
  const wrapX = gridCols >= 3, wrapY = gridRows >= 3;
  const hW = W * 0.5, hH = H * 0.5;

  for (let i = 0; i < n; i++){
    const xi = P.x[i], yi = P.y[i], si = P.s[i];
    let fx = 0, fy = 0;
    const cx = Math.min(gridCols-1, Math.max(0,(xi/cellSize)|0));
    const cy = Math.min(gridRows-1, Math.max(0,(yi/cellSize)|0));
    for (let oy = -1; oy <= 1; oy++){
      let ny = cy + oy;
      if (ny < 0 || ny >= gridRows){ if (wrapY) ny = (ny + gridRows) % gridRows; else continue; }
      for (let ox = -1; ox <= 1; ox++){
        let nx = cx + ox;
        if (nx < 0 || nx >= gridCols){ if (wrapX) nx = (nx + gridCols) % gridCols; else continue; }
        const bucket = grid[ny * gridCols + nx];
        for (let b = 0; b < bucket.length; b++){
          const j = bucket[b]; if (j === i) continue;
          let dx = P.x[j] - xi, dy = P.y[j] - yi;
          // minimal-image wrapping: feel the nearest copy across the seam
          if (dx >  hW) dx -= W; else if (dx < -hW) dx += W;
          if (dy >  hH) dy -= H; else if (dy < -hH) dy += H;
          const d2 = dx*dx + dy*dy;
          if (d2 >= r2 || d2 === 0) continue;
          const d = Math.sqrt(d2);
          let f;
          if (d < beta){
            // universal short-range repulsion
            f = (d / beta) - 1;
          } else {
            // species-specific attraction in the outer shell
            const a = M[si][P.s[j]];
            f = a * (1 - Math.abs(2*d - beta - r) / (r - beta));
          }
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
      }
    }
    // mouse stir
    if (mouse.down){
      let dx = mouse.x - xi, dy = mouse.y - yi;
      const d2 = dx*dx + dy*dy, R = 140*DPR;
      if (d2 < R*R && d2 > 1){
        const d = Math.sqrt(d2);
        const pull = (1 - d/R) * 1.6 * (mouse.repel ? -1 : 1);
        fx += (dx/d) * pull; fy += (dy/d) * pull;
      }
    }
    P.vx[i] = (P.vx[i] + fx * F) * fr;
    P.vy[i] = (P.vy[i] + fy * F) * fr;
  }

  // integrate + wrap
  for (let i = 0; i < n; i++){
    P.x[i] += P.vx[i];
    P.y[i] += P.vy[i];
    if (P.x[i] < 0) P.x[i] += W; else if (P.x[i] >= W) P.x[i] -= W;
    if (P.y[i] < 0) P.y[i] += H; else if (P.y[i] >= H) P.y[i] -= H;
  }
}

// ---- rendering ----
function hexToRgb(h){
  const n = parseInt(h.slice(1),16);
  return [ (n>>16)&255, (n>>8)&255, n&255 ];
}
const rgb = PALETTE.map(hexToRgb);
// pre-built fill strings so the hot draw loop never rebuilds them
const fillStyles = rgb.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
// base HSL per species, for the Aurora hue-cycling mode
function rgbToHsl([r,g,b]){
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2;
  let h=0, s=0;
  if (mx!==mn){
    const d=mx-mn;
    s = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
    if (mx===r) h=(g-b)/d + (g<b?6:0);
    else if (mx===g) h=(b-r)/d + 2;
    else h=(r-g)/d + 4;
    h*=60;
  }
  return [h, Math.round(s*100), Math.round(l*100)];
}
const baseHSL = rgb.map(rgbToHsl);
let hueOffset = 0;
function draw(){
  const [br,bg,bb] = hexToRgb(S.bg);
  if (S.trails){
    ctx.fillStyle = `rgba(${br},${bg},${bb},${S.fade})`;
  } else {
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  }
  ctx.fillRect(0,0,W,H);
  const n = S.count;
  const rad = S.psize * DPR;
  if (S.glow) ctx.globalCompositeOperation = 'lighter';
  if (S.bonds && grid) drawBonds();
  if (S.aurora) hueOffset = (hueOffset + 0.35) % 360;
  for (let sp = 0; sp < S.species; sp++){
    if (S.aurora){
      const h = baseHSL[sp];
      ctx.fillStyle = `hsl(${(h[0]+hueOffset)%360},${h[1]}%,${h[2]}%)`;
    } else {
      ctx.fillStyle = fillStyles[sp];
    }
    ctx.beginPath();
    const m = rad + 1; // edge margin for ghost copies
    for (let i = 0; i < n; i++){
      if (P.s[i] !== sp) continue;
      const x = P.x[i], y = P.y[i];
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, 6.2832);
      // ghost copies so the toroidal seam is invisible
      const wx = x < m ? x + W : (x > W - m ? x - W : null);
      const wy = y < m ? y + H : (y > H - m ? y - H : null);
      if (wx !== null){ ctx.moveTo(wx + rad, y); ctx.arc(wx, y, rad, 0, 6.2832); }
      if (wy !== null){ ctx.moveTo(x + rad, wy); ctx.arc(x, wy, rad, 0, 6.2832); }
      if (wx !== null && wy !== null){ ctx.moveTo(wx + rad, wy); ctx.arc(wx, wy, rad, 0, 6.2832); }
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // show the stir radius while dragging (cyan = attract, red = repel)
  if (mouse.down){
    ctx.strokeStyle = mouse.repel ? 'rgba(255,93,115,0.4)' : 'rgba(109,243,192,0.4)';
    ctx.lineWidth = 1.2 * DPR;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 140 * DPR, 0, 6.2832);
    ctx.stroke();
  }
}

// faint links between nearby, mutually-relevant particles — reveals membranes.
// Reuses the spatial grid built during the last physics step. Capped for perf.
function drawBonds(){
  const M = S.matrix;
  const bd = S.range * DPR * 0.62, bd2 = bd*bd;
  let lines = 0; const MAXL = 6000;
  ctx.lineWidth = 0.6 * DPR;
  ctx.beginPath();
  for (let i = 0; i < S.count; i++){
    const xi = P.x[i], yi = P.y[i], si = P.s[i];
    const cx = Math.min(gridCols-1, Math.max(0,(xi/cellSize)|0));
    const cy = Math.min(gridRows-1, Math.max(0,(yi/cellSize)|0));
    for (let oy = 0; oy <= 1; oy++){
      const ny = cy + oy; if (ny >= gridRows) continue;
      for (let ox = -1; ox <= 1; ox++){
        if (oy === 0 && ox < 0) continue; // visit each pair once
        const nx = cx + ox; if (nx < 0 || nx >= gridCols) continue;
        const bucket = grid[ny * gridCols + nx];
        for (let b = 0; b < bucket.length; b++){
          const j = bucket[b]; if (j <= i) continue;
          const dx = P.x[j]-xi, dy = P.y[j]-yi;
          const d2 = dx*dx + dy*dy;
          if (d2 >= bd2) continue;
          // only link if at least one side is attracted to the other
          if (M[si][P.s[j]] <= 0.15 && M[P.s[j]][si] <= 0.15) continue;
          ctx.moveTo(xi, yi); ctx.lineTo(P.x[j], P.y[j]);
          if (++lines >= MAXL){ ox = 9; oy = 9; i = S.count; break; }
        }
      }
    }
  }
  const [r,g,bl] = hexToRgb(PALETTE[1]);
  ctx.strokeStyle = `rgba(${r},${g},${bl},0.12)`;
  ctx.stroke();
}

// ---- main loop + fps ----
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 0;
function frame(t){
  const dt = t - last; last = t;
  fpsT += dt; fpsN++;
  if (fpsT > 500){
    fps = Math.round(1000 * fpsN / fpsT); fpsT = 0; fpsN = 0;
    const el = document.getElementById('vFps');
    el.textContent = fps;
    el.style.color = fps >= 50 ? '#6df3c0' : fps >= 30 ? '#ffd166' : '#ff5d73';
  }
  if (!S.paused){ const sub = S.speed|0; for (let k = 0; k < sub; k++) step(); }
  draw();
  requestAnimationFrame(frame);
}

// expose for UI module
window.PRIMORDIUM = { S, spawn, buildMatrix, PALETTE, get P(){return P;}, get fps(){return fps;} };

// dramatic opening: collapse everything to centre, fling it outward
function bigBang(){
  if (!P) return;
  const cx = W/2, cy = H/2;
  for (let i = 0; i < S.count; i++){
    const ang = Math.random()*6.2832, rr = Math.random()*30*DPR;
    P.x[i] = cx + Math.cos(ang)*rr;
    P.y[i] = cy + Math.sin(ang)*rr;
    const sp = 6 + Math.random()*9;
    P.vx[i] = Math.cos(ang)*sp;
    P.vy[i] = Math.sin(ang)*sp;
  }
}
window.PRIMORDIUM.bigBang = bigBang;

// ---- boot ----
buildMatrix(true);
spawn();
// honour reduced-motion: skip the explosive opening, just let it settle
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion) bigBang();
requestAnimationFrame(frame);

})();
