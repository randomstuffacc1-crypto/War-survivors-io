const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });

const W = 720;
const H = 1280;
const DPR_CAP = 2;
const PLAYER_Y = 1065;
const WALL_Y = 1165;
const ROAD_LEFT = 118;
const ROAD_RIGHT = 602;
const STORAGE_KEY = 'siege-surge-save-v1';

const $ = (selector) => document.querySelector(selector);
const ui = {
  home: $('#homeScreen'), hud: $('#hud'), pause: $('#pauseScreen'), choices: $('#upgradeChoiceScreen'),
  gameOver: $('#gameOverScreen'), modal: $('#modalScreen'), modalContent: $('#modalContent'),
  wave: $('#waveValue'), wall: $('#wallValue'), wallMeter: $('#wallMeter'), squad: $('#squadValue'),
  power: $('#powerValue'), runCoins: $('#runCoinsValue'), homeCoins: $('#homeCoins'), toast: $('#toast'),
  finalWave: $('#finalWave'), finalKills: $('#finalKills'), finalCoins: $('#finalCoins'),
  upgradeChoices: $('#upgradeChoices')
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function roundedRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function loadSave() {
  const base = { coins: 0, bestWave: 0, muted: false, upgrades: { damage: 0, fireRate: 0, squad: 0, wall: 0 } };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...base,
      ...parsed,
      upgrades: { ...base.upgrades, ...(parsed?.upgrades || {}) }
    };
  } catch { return base; }
}
function saveProgress() { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); }
let save = loadSave();

class TinyAudio {
  constructor() { this.ctx = null; this.muted = false; }
  unlock() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq, duration = .05, type = 'sine', gain = .025, slide = 0) {
    if (this.muted) return;
    this.unlock();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(now); osc.stop(now + duration);
  }
  shot() { this.tone(160, .025, 'square', .012, 50); }
  hit() { this.tone(95, .04, 'triangle', .02, -30); }
  gate(good = true) { this.tone(good ? 540 : 120, .12, 'sine', .04, good ? 320 : -55); }
  coin() { this.tone(780, .07, 'sine', .03, 240); }
  boom() { this.tone(58, .25, 'sawtooth', .055, -25); }
}
const audio = new TinyAudio();
audio.muted = Boolean(save.muted);

const COLORS = {
  sky1: '#14233a', sky2: '#07111f', road1: '#24354a', road2: '#162536', edge: '#0a1726',
  blue: '#2b91ff', cyan: '#38e7ff', gold: '#ffd447', red: '#ff4e65', green: '#52f0a3', purple: '#a46cff'
};

const state = {
  mode: 'home', t: 0, scroll: 0, last: performance.now(), wave: 1, waveKills: 0, waveGoal: 18,
  waveSpawned: 0, spawnTimer: 0, intermission: 0, kills: 0, runCoins: 0,
  wallHp: 100, wallMax: 100, shake: 0, flash: 0,
  pointerX: W / 2, inputX: 0, keys: new Set(),
  player: { x: W / 2, targetX: W / 2, squad: 8, damage: 1, fireRate: 5.5, fireTimer: 0, bulletSpeed: 880, spread: 0.14, shield: 0, pierce: 0, multishot: 1 },
  bullets: [], enemies: [], particles: [], texts: [], gates: [], pickups: [], ruins: [], stars: []
};

function resetRun() {
  const u = save.upgrades;
  Object.assign(state, {
    mode: 'playing', t: 0, scroll: 0, wave: 1, waveKills: 0, waveGoal: 18, waveSpawned: 0,
    spawnTimer: .35, intermission: 0, kills: 0, runCoins: 0,
    wallMax: 100 + u.wall * 15, wallHp: 100 + u.wall * 15, shake: 0, flash: 0,
    pointerX: W / 2, inputX: 0
  });
  Object.assign(state.player, {
    x: W / 2, targetX: W / 2, squad: 8 + u.squad * 2, damage: 1 + u.damage * .25,
    fireRate: 5.5 * (1 + u.fireRate * .08), fireTimer: 0, bulletSpeed: 880,
    spread: 0.14, shield: 0, pierce: 0, multishot: 1
  });
  state.bullets.length = 0; state.enemies.length = 0; state.particles.length = 0;
  state.texts.length = 0; state.gates.length = 0; state.pickups.length = 0;
  hideAllScreens();
  ui.hud.classList.remove('hidden');
  updateHud();
  spawnGateRow(-240);
  toast('WAVE 1');
}

function hideAllScreens() {
  [ui.home, ui.pause, ui.choices, ui.gameOver, ui.modal].forEach(el => el.classList.add('hidden'));
}
function showHome() {
  state.mode = 'home';
  ui.hud.classList.add('hidden'); hideAllScreens(); ui.home.classList.remove('hidden');
  updateHomeCoins();
}
function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused'; ui.pause.classList.remove('hidden');
}
function resumeGame() { state.mode = 'playing'; ui.pause.classList.add('hidden'); state.last = performance.now(); }

let toastTimer;
function toast(text, good = true) {
  ui.toast.textContent = text;
  ui.toast.style.color = good ? '#f7fbff' : '#ff9aa9';
  ui.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 1150);
}

function updateHud() {
  ui.wave.textContent = state.wave;
  ui.wall.textContent = Math.max(0, Math.ceil(state.wallHp));
  ui.wallMeter.style.width = `${clamp(state.wallHp / state.wallMax * 100, 0, 100)}%`;
  ui.squad.textContent = Math.max(1, Math.round(state.player.squad));
  ui.power.textContent = `${state.player.damage.toFixed(1)}×`;
  ui.runCoins.textContent = state.runCoins;
}
function updateHomeCoins() { ui.homeCoins.textContent = `${save.coins} ◆`; }

function addText(x, y, text, color = '#fff', size = 30) {
  state.texts.push({ x, y, text, color, size, life: 1, max: 1, vy: -48 });
}
function burst(x, y, color, n = 8, speed = 160) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * .35, speed);
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.25, .6), max: .6, size: rand(2, 7), color });
  }
}

function getFormation(index, total) {
  const cols = Math.ceil(Math.sqrt(total * 1.45));
  const row = Math.floor(index / cols);
  const col = index % cols;
  const rows = Math.ceil(total / cols);
  const spacing = clamp(23 - total * .07, 11, 23);
  const width = (Math.min(cols, total) - 1) * spacing;
  return { x: col * spacing - width / 2 + ((row % 2) ? spacing * .5 : 0), y: row * 20 - (rows - 1) * 10 };
}

function spawnEnemy(type = null) {
  const bossWave = state.wave % 5 === 0;
  let chosen = type;
  if (!chosen) {
    const r = Math.random();
    chosen = bossWave && state.waveSpawned === state.waveGoal - 1 ? 'boss' :
      r < .58 ? 'grunt' : r < .78 ? 'runner' : r < .93 ? 'tank' : 'splitter';
  }
  const scale = 1 + (state.wave - 1) * .12;
  const specs = {
    grunt: { hp: 2.5, speed: 64, r: 18, reward: 1, color: '#ff6176', damage: 8 },
    runner: { hp: 1.7, speed: 105, r: 15, reward: 1, color: '#ff9b50', damage: 6 },
    tank: { hp: 9, speed: 39, r: 26, reward: 3, color: '#a96c7c', damage: 16 },
    splitter: { hp: 5.3, speed: 54, r: 21, reward: 2, color: '#d873ff', damage: 10 },
    boss: { hp: 75 + state.wave * 7, speed: 26, r: 54, reward: 25, color: '#ffcd4b', damage: 40 }
  };
  const s = specs[chosen];
  state.enemies.push({
    type: chosen, x: rand(ROAD_LEFT + 28, ROAD_RIGHT - 28), y: rand(-160, -50),
    hp: s.hp * scale, maxHp: s.hp * scale, speed: s.speed * (1 + state.wave * .009),
    r: s.r, reward: s.reward, color: s.color, damage: s.damage, hit: 0, phase: rand(0, 10)
  });
}

function spawnGateRow(y = -200) {
  const options = makeGateOptions();
  state.gates.push({ y, passed: false, left: options[0], right: options[1] });
}
function makeGateOptions() {
  const positive = [
    () => ({ kind:'squad', label:`+${Math.floor(rand(4, 10))}`, sub:'RECRUITS', color:COLORS.blue }),
    () => ({ kind:'damage', label:`+${rand(.25, .55).toFixed(1)}×`, sub:'POWER', color:COLORS.gold }),
    () => ({ kind:'firerate', label:`+${Math.floor(rand(12, 24))}%`, sub:'FIRE RATE', color:COLORS.cyan }),
    () => ({ kind:'multishot', label:'TWIN', sub:'VOLLEY', color:COLORS.purple }),
    () => ({ kind:'shield', label:`+${Math.floor(rand(12, 26))}`, sub:'SHIELD', color:COLORS.green }),
    () => ({ kind:'multiply', label:'×2', sub:'SQUAD', color:COLORS.gold })
  ];
  const bad = () => ({ kind:'loss', label:`-${Math.floor(rand(3, 8))}`, sub:'AMBUSH', color:COLORS.red });
  let a = pick(positive)(), b = Math.random() < .22 ? bad() : pick(positive)();
  if (a.kind === b.kind) b = pick(positive.filter(fn => fn().kind !== a.kind))();
  return Math.random() < .5 ? [a,b] : [b,a];
}

function applyGate(gate, sideX) {
  const p = state.player;
  const good = gate.kind !== 'loss';
  switch (gate.kind) {
    case 'squad': { const n = +gate.label.slice(1); p.squad += n; addText(sideX, PLAYER_Y - 80, `+${n}`, gate.color, 42); break; }
    case 'damage': { const n = parseFloat(gate.label); p.damage += n; addText(sideX, PLAYER_Y - 80, gate.label, gate.color, 42); break; }
    case 'firerate': { const n = parseInt(gate.label); p.fireRate *= 1 + n / 100; addText(sideX, PLAYER_Y - 80, gate.label, gate.color, 42); break; }
    case 'multishot': { p.multishot = Math.min(5, p.multishot + 1); addText(sideX, PLAYER_Y - 80, 'VOLLEY +1', gate.color, 36); break; }
    case 'shield': { const n = parseInt(gate.label); p.shield += n; addText(sideX, PLAYER_Y - 80, `SHIELD +${n}`, gate.color, 32); break; }
    case 'multiply': { p.squad = Math.min(80, Math.ceil(p.squad * 2)); addText(sideX, PLAYER_Y - 80, 'SQUAD ×2', gate.color, 38); break; }
    case 'loss': { const n = parseInt(gate.label); p.squad = Math.max(1, p.squad - n); addText(sideX, PLAYER_Y - 80, `-${n}`, gate.color, 42); state.shake = 8; break; }
  }
  burst(sideX, PLAYER_Y - 20, gate.color, 20, 220);
  audio.gate(good);
  navigator.vibrate?.(good ? 25 : [40, 30, 40]);
  updateHud();
}

function fireVolley() {
  const p = state.player;
  const shooters = clamp(Math.ceil(p.squad / 8), 1, 7);
  const volleys = Math.min(5, p.multishot);
  for (let v = 0; v < volleys; v++) {
    for (let i = 0; i < shooters; i++) {
      const offset = (i - (shooters - 1) / 2) * 10;
      const angle = (i - (shooters - 1) / 2) * p.spread / Math.max(1, shooters - 1) + (v - (volleys - 1) / 2) * .035;
      state.bullets.push({ x: p.x + offset, y: PLAYER_Y - 25, vx: Math.sin(angle) * p.bulletSpeed, vy: -Math.cos(angle) * p.bulletSpeed, r: 3.2, damage: p.damage * (.82 + p.squad * .012), pierce: p.pierce });
    }
  }
  audio.shot();
}

function enemyDeath(enemy, index) {
  state.enemies.splice(index, 1);
  state.kills++; state.waveKills++;
  const coinChance = enemy.type === 'boss' ? 1 : .18;
  if (Math.random() < coinChance) state.pickups.push({ x: enemy.x, y: enemy.y, vy: 60, life: 8, value: enemy.type === 'boss' ? 12 : 1 });
  if (enemy.type === 'splitter') {
    for (let i = 0; i < 2; i++) {
      state.enemies.push({ type:'runner', x:enemy.x + (i ? 16 : -16), y:enemy.y, hp:1.1, maxHp:1.1, speed:115, r:12, reward:0, color:'#ff9b50', damage:4, hit:0, phase:rand(0,10) });
    }
  }
  burst(enemy.x, enemy.y, enemy.color, enemy.type === 'boss' ? 42 : 12, enemy.type === 'boss' ? 330 : 190);
  audio.hit();
}

function damageWall(amount, x) {
  let remaining = amount;
  if (state.player.shield > 0) {
    const blocked = Math.min(state.player.shield, remaining);
    state.player.shield -= blocked; remaining -= blocked;
    addText(x, WALL_Y - 45, `-${Math.ceil(blocked)} shield`, COLORS.cyan, 22);
  }
  if (remaining > 0) {
    state.wallHp -= remaining;
    state.shake = Math.min(22, state.shake + remaining * .35);
    state.flash = .22;
    addText(x, WALL_Y - 40, `-${Math.ceil(remaining)}`, COLORS.red, 30);
    audio.boom();
  }
  updateHud();
  if (state.wallHp <= 0) endRun();
}

function finishWave() {
  if (state.mode !== 'playing') return;
  state.mode = 'choice';
  state.wave++;
  state.waveGoal = Math.round(16 + state.wave * 4.6);
  state.waveKills = 0; state.waveSpawned = 0; state.spawnTimer = .6;
  showUpgradeChoice();
}

const fieldUpgrades = [
  { id:'damage', icon:'✦', title:'Overcharged rounds', desc:'+35% damage for this run', apply:() => state.player.damage *= 1.35 },
  { id:'fire', icon:'↯', title:'Rapid cycling', desc:'+22% fire rate', apply:() => state.player.fireRate *= 1.22 },
  { id:'squad', icon:'▲', title:'Fresh platoon', desc:'+8 squad members', apply:() => state.player.squad += 8 },
  { id:'wall', icon:'▰', title:'Field repairs', desc:'Restore 30 wall health', apply:() => state.wallHp = Math.min(state.wallMax, state.wallHp + 30) },
  { id:'shield', icon:'⬡', title:'Aegis grid', desc:'+35 shield', apply:() => state.player.shield += 35 },
  { id:'multi', icon:'≋', title:'Split barrels', desc:'+1 projectile volley', apply:() => state.player.multishot = Math.min(5, state.player.multishot + 1) },
  { id:'pierce', icon:'➤', title:'Tungsten cores', desc:'Shots pierce one more target', apply:() => state.player.pierce++ },
  { id:'wallmax', icon:'◆', title:'Reinforced line', desc:'+20 maximum wall health', apply:() => { state.wallMax += 20; state.wallHp += 20; } }
];

function showUpgradeChoice() {
  const pool = [...fieldUpgrades].sort(() => Math.random() - .5).slice(0, 3);
  ui.upgradeChoices.innerHTML = '';
  pool.forEach(up => {
    const btn = document.createElement('button');
    btn.className = 'choice-card';
    btn.innerHTML = `<span class="icon">${up.icon}</span><span><h3>${up.title}</h3><p>${up.desc}</p></span>`;
    btn.addEventListener('click', () => {
      audio.gate(true); up.apply(); ui.choices.classList.add('hidden'); state.mode = 'playing';
      state.last = performance.now(); updateHud(); spawnGateRow(-260); toast(`WAVE ${state.wave}`);
    }, { once:true });
    ui.upgradeChoices.appendChild(btn);
  });
  ui.choices.classList.remove('hidden');
}

function endRun() {
  state.mode = 'gameover';
  const bonus = Math.floor(state.kills / 8) + Math.max(0, state.wave - 1) * 2;
  const recovered = state.runCoins + bonus;
  save.coins += recovered;
  save.bestWave = Math.max(save.bestWave, state.wave);
  saveProgress(); updateHomeCoins();
  ui.finalWave.textContent = state.wave;
  ui.finalKills.textContent = state.kills;
  ui.finalCoins.textContent = `${recovered} ◆`;
  ui.gameOver.classList.remove('hidden');
  ui.hud.classList.add('hidden');
  navigator.vibrate?.([80, 50, 120]);
}

function update(dt) {
  state.t += dt;
  state.scroll = (state.scroll + dt * (135 + state.wave * 2)) % 120;
  state.shake = Math.max(0, state.shake - dt * 34);
  state.flash = Math.max(0, state.flash - dt);

  let axis = 0;
  if (state.keys.has('ArrowLeft') || state.keys.has('KeyA')) axis -= 1;
  if (state.keys.has('ArrowRight') || state.keys.has('KeyD')) axis += 1;
  if (axis) state.player.targetX += axis * 390 * dt;
  state.player.targetX = clamp(state.player.targetX, ROAD_LEFT + 45, ROAD_RIGHT - 45);
  state.player.x = lerp(state.player.x, state.player.targetX, 1 - Math.exp(-14 * dt));

  state.player.fireTimer -= dt;
  if (state.player.fireTimer <= 0) {
    fireVolley();
    state.player.fireTimer += 1 / state.player.fireRate;
  }

  state.spawnTimer -= dt;
  if (state.waveSpawned < state.waveGoal && state.spawnTimer <= 0) {
    spawnEnemy(); state.waveSpawned++;
    state.spawnTimer = Math.max(.14, .72 - state.wave * .018) * rand(.72, 1.18);
  }

  if (!state.gates.length || state.gates[state.gates.length - 1].y > 510) spawnGateRow(-210);
  for (let i = state.gates.length - 1; i >= 0; i--) {
    const row = state.gates[i]; row.y += dt * (135 + state.wave * 2);
    if (!row.passed && row.y >= PLAYER_Y - 35) {
      row.passed = true;
      const left = state.player.x < W / 2;
      applyGate(left ? row.left : row.right, left ? 245 : 475);
    }
    if (row.y > H + 180) state.gates.splice(i, 1);
  }

  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -20 || b.x < ROAD_LEFT - 20 || b.x > ROAD_RIGHT + 20) { state.bullets.splice(i,1); continue; }
    let removed = false;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j];
      if (dist2(b,e) < (b.r + e.r) ** 2) {
        e.hp -= b.damage; e.hit = .09; burst(b.x,b.y,'#ffefad',3,80);
        if (e.hp <= 0) enemyDeath(e,j);
        if (b.pierce > 0) b.pierce--; else { state.bullets.splice(i,1); removed = true; }
        break;
      }
    }
    if (removed) continue;
  }

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    e.y += e.speed * dt; e.phase += dt; e.hit = Math.max(0, e.hit - dt);
    e.x += Math.sin(e.phase * (e.type === 'runner' ? 3.4 : 1.4)) * dt * (e.type === 'runner' ? 28 : 9);
    e.x = clamp(e.x, ROAD_LEFT + e.r, ROAD_RIGHT - e.r);
    if (e.y + e.r >= WALL_Y) {
      damageWall(e.damage, e.x); state.enemies.splice(i,1); burst(e.x,WALL_Y,COLORS.red,18,220);
    }
  }

  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i]; p.y += p.vy * dt; p.life -= dt;
    const target = { x: state.player.x, y: PLAYER_Y };
    if (p.y > 730 || dist2(p,target) < 220 ** 2) {
      p.x = lerp(p.x, target.x, 1 - Math.exp(-8 * dt)); p.y = lerp(p.y, target.y, 1 - Math.exp(-8 * dt));
    }
    if (dist2(p,target) < 26 ** 2) {
      state.runCoins += p.value; audio.coin(); addText(p.x,p.y,`+${p.value} ◆`,COLORS.gold,24); state.pickups.splice(i,1); updateHud(); continue;
    }
    if (p.life <= 0) state.pickups.splice(i,1);
  }

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy = p.vy * .985 + 90 * dt;
    if (p.life <= 0) state.particles.splice(i,1);
  }
  for (let i = state.texts.length - 1; i >= 0; i--) {
    const t = state.texts[i]; t.life -= dt; t.y += t.vy * dt;
    if (t.life <= 0) state.texts.splice(i,1);
  }

  if (state.waveSpawned >= state.waveGoal && state.enemies.length === 0 && state.mode === 'playing') finishWave();
}

function drawBackground(home = false) {
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,COLORS.sky1); g.addColorStop(.58,COLORS.sky2); g.addColorStop(1,'#040a13');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // distant glow and moon
  const rg = ctx.createRadialGradient(W*.5,170,10,W*.5,170,460);
  rg.addColorStop(0,'rgba(56,231,255,.16)'); rg.addColorStop(1,'rgba(56,231,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(0,0,W,700);
  ctx.fillStyle = 'rgba(220,245,255,.75)'; ctx.beginPath(); ctx.arc(585,120,30,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = COLORS.sky1; ctx.beginPath(); ctx.arc(596,110,29,0,Math.PI*2); ctx.fill();

  // ruined skyline
  ctx.save();
  for (let side = 0; side < 2; side++) {
    const dir = side ? 1 : -1;
    const baseX = side ? ROAD_RIGHT + 8 : ROAD_LEFT - 8;
    for (let i = 0; i < 7; i++) {
      const bw = 36 + ((i * 13) % 35), bh = 110 + ((i * 71) % 175);
      const x = baseX + dir * (i * 58 + 18) - (side ? 0 : bw);
      const y = 370 - bh + (i % 2) * 24;
      ctx.fillStyle = i % 2 ? '#111d2b' : '#182638'; ctx.fillRect(x,y,bw,bh);
      ctx.fillStyle = 'rgba(100,164,188,.16)';
      for (let wy = y+18; wy < y+bh-16; wy += 24) for (let wx = x+10; wx < x+bw-8; wx += 18) ctx.fillRect(wx,wy,7,10);
      ctx.fillStyle = '#07111f';
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+bw*.25,y+rand(8,25)); ctx.lineTo(x+bw*.45,y+3); ctx.lineTo(x+bw*.75,y+rand(13,31)); ctx.lineTo(x+bw,y); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();

  // road and shoulders with perspective
  ctx.fillStyle = COLORS.edge; ctx.fillRect(0,350,W,H-350);
  const roadGrad = ctx.createLinearGradient(0,350,0,H);
  roadGrad.addColorStop(0,COLORS.road1); roadGrad.addColorStop(1,COLORS.road2);
  ctx.fillStyle = roadGrad;
  ctx.beginPath(); ctx.moveTo(260,350); ctx.lineTo(460,350); ctx.lineTo(ROAD_RIGHT,H); ctx.lineTo(ROAD_LEFT,H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(126,202,224,.14)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(260,350); ctx.lineTo(ROAD_LEFT,H); ctx.moveTo(460,350); ctx.lineTo(ROAD_RIGHT,H); ctx.stroke();

  // scrolling center markings
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=4; ctx.setLineDash([26,72]); ctx.lineDashOffset = state.scroll;
  ctx.beginPath(); ctx.moveTo(W/2,360); ctx.lineTo(W/2,H); ctx.stroke(); ctx.restore();

  // side rubble / lights
  for (let y = 410 - state.scroll; y < H; y += 120) {
    const t = (y - 350) / (H - 350); const inset = lerp(258, ROAD_LEFT, t);
    ctx.fillStyle = 'rgba(62,114,134,.20)';
    ctx.fillRect(inset-18,y,12+18*t,8+8*t); ctx.fillRect(W-inset+4,y+45,18+16*t,9+9*t);
    ctx.fillStyle='rgba(56,231,255,.25)'; ctx.fillRect(inset-9,y+2,4+3*t,4+3*t); ctx.fillRect(W-inset+9,y+48,4+3*t,4+3*t);
  }

  if (home) drawHomeScene();
}

function drawHomeScene() {
  // Hero squad and incoming swarm used as animated menu backdrop.
  const drift = Math.sin(state.t * .65) * 8;
  for (let i = 0; i < 18; i++) {
    const f = getFormation(i,18); drawSoldier(W/2 + f.x, 1010 + f.y + drift, 1, COLORS.blue, .85);
  }
  for (let i = 0; i < 20; i++) {
    const col = i % 5, row = Math.floor(i/5);
    drawEnemyShape(290 + col*36 + Math.sin(i)*8, 510 + row*38 + Math.sin(state.t*1.2+i)*4, 12, '#ff6176', 'grunt', 0);
  }
  // shots
  ctx.globalCompositeOperation='lighter';
  for (let i=0;i<6;i++) {
    const y = 840 - ((state.t*420 + i*90) % 380);
    ctx.strokeStyle='rgba(89,230,255,.72)'; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(W/2+(i-3)*9,y+28); ctx.lineTo(W/2+(i-3)*9,y); ctx.stroke();
  }
  ctx.globalCompositeOperation='source-over';
}

function drawWall() {
  const y = WALL_Y;
  ctx.fillStyle='#101d2c'; ctx.fillRect(ROAD_LEFT-16,y,ROAD_RIGHT-ROAD_LEFT+32,88);
  ctx.fillStyle='#24374b';
  for(let x=ROAD_LEFT-10;x<ROAD_RIGHT+12;x+=44){ roundedRect(ctx,x,y+8,36,58,6);ctx.fill(); }
  ctx.fillStyle='rgba(56,231,255,.2)'; ctx.fillRect(ROAD_LEFT,y+8,ROAD_RIGHT-ROAD_LEFT,4);
  ctx.fillStyle='#07111f'; ctx.font='900 24px system-ui'; ctx.textAlign='center'; ctx.fillText('LAST LINE',W/2,y+48);
  if (state.player.shield>0) {
    ctx.strokeStyle=`rgba(56,231,255,${.35 + Math.sin(state.t*5)*.08})`; ctx.lineWidth=5;
    ctx.beginPath(); ctx.arc(W/2,y+5,270,Math.PI,Math.PI*2); ctx.stroke();
  }
}

function drawGate(g, x, width, y) {
  const h=96;
  ctx.save();
  ctx.shadowColor=g.color; ctx.shadowBlur=18;
  ctx.globalAlpha=.94;
  const grad=ctx.createLinearGradient(x,y,x,y+h); grad.addColorStop(0,g.color); grad.addColorStop(1,'#102238');
  ctx.fillStyle=grad; roundedRect(ctx,x,y,width,h,14);ctx.fill();
  ctx.shadowBlur=0; ctx.fillStyle='rgba(3,9,18,.72)'; roundedRect(ctx,x+7,y+7,width-14,h-14,10);ctx.fill();
  ctx.fillStyle=g.color; ctx.globalAlpha=.18; roundedRect(ctx,x+10,y+10,width-20,h-20,9);ctx.fill();
  ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font='1000 35px system-ui'; ctx.fillText(g.label,x+width/2,y+44);
  ctx.fillStyle=g.color; ctx.font='900 12px system-ui'; ctx.letterSpacing='2px'; ctx.fillText(g.sub,x+width/2,y+70);
  ctx.restore();
}

function drawGates() {
  for (const row of state.gates) {
    const perspective = clamp((row.y - 350)/(H-350),0,1);
    const centerGap=12, halfW=lerp(80,205,perspective), xL=W/2-centerGap/2-halfW, xR=W/2+centerGap/2;
    drawGate(row.left,xL,halfW,row.y); drawGate(row.right,xR,halfW,row.y);
  }
}

function drawSoldier(x,y,s=1,color=COLORS.blue,alpha=1) {
  ctx.save(); ctx.translate(x,y); ctx.scale(s,s); ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath();ctx.ellipse(0,11,12,6,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#22344b'; roundedRect(ctx,-9,-4,18,21,6);ctx.fill();
  ctx.fillStyle=color; ctx.beginPath();ctx.arc(0,-9,8,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#9bd9ff'; ctx.fillRect(-5,-11,10,4);
  ctx.fillStyle='#d7e7f3'; ctx.fillRect(-2,-1,4,10);
  ctx.restore();
}

function drawPlayer() {
  const n=Math.min(80,Math.max(1,Math.round(state.player.squad)));
  for(let i=n-1;i>=0;i--){ const f=getFormation(i,n); drawSoldier(state.player.x+f.x,PLAYER_Y+f.y,clamp(1.04-n*.002, .78,1.02),COLORS.blue); }
  // leader
  ctx.save(); ctx.translate(state.player.x,PLAYER_Y-22); ctx.globalCompositeOperation='lighter';
  const rg=ctx.createRadialGradient(0,0,0,0,0,35);rg.addColorStop(0,'rgba(56,231,255,.32)');rg.addColorStop(1,'rgba(56,231,255,0)');ctx.fillStyle=rg;ctx.fillRect(-40,-40,80,80);ctx.restore();
}

function drawEnemyShape(x,y,r,color,type,hit) {
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(0,r*.65,r*.85,r*.38,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=hit>0?'#fff':color;
  if(type==='runner'){
    ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(r*.85,r*.7);ctx.lineTo(-r*.85,r*.7);ctx.closePath();ctx.fill();
  }else if(type==='tank'){
    roundedRect(ctx,-r,-r*.85,r*2,r*1.7,7);ctx.fill();ctx.fillStyle='#3f2731';ctx.fillRect(-r*.8,-3,r*1.6,8);
  }else if(type==='splitter'){
    ctx.rotate(Math.PI/4);roundedRect(ctx,-r*.72,-r*.72,r*1.44,r*1.44,7);ctx.fill();
  }else if(type==='boss'){
    ctx.beginPath();for(let i=0;i<16;i++){const a=i/16*Math.PI*2,rr=i%2?r*.82:r*1.08;ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}ctx.closePath();ctx.fill();
    ctx.fillStyle='#431d22';ctx.beginPath();ctx.arc(0,0,r*.48,0,Math.PI*2);ctx.fill();
  }else{ ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill(); }
  ctx.fillStyle='#0a1019';ctx.beginPath();ctx.arc(-r*.3,-r*.1,Math.max(2,r*.12),0,Math.PI*2);ctx.arc(r*.3,-r*.1,Math.max(2,r*.12),0,Math.PI*2);ctx.fill();
  ctx.restore();
}

function drawEnemies() {
  for(const e of state.enemies){
    drawEnemyShape(e.x,e.y,e.r,e.color,e.type,e.hit);
    if(e.maxHp>6){
      const w=e.r*2;ctx.fillStyle='rgba(0,0,0,.45)';roundedRect(ctx,e.x-w/2,e.y-e.r-14,w,6,3);ctx.fill();
      ctx.fillStyle=e.type==='boss'?COLORS.gold:COLORS.red;roundedRect(ctx,e.x-w/2,e.y-e.r-14,w*(e.hp/e.maxHp),6,3);ctx.fill();
    }
  }
}

function drawBullets() {
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const b of state.bullets){
    const g=ctx.createLinearGradient(b.x,b.y+26,b.x,b.y-8);g.addColorStop(0,'rgba(50,137,255,0)');g.addColorStop(1,'#9af6ff');ctx.strokeStyle=g;ctx.lineWidth=5;
    ctx.beginPath();ctx.moveTo(b.x-b.vx*.018,b.y-b.vy*.018);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  ctx.restore();
}

function drawPickups() {
  for(const p of state.pickups){
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.t*2.5);ctx.shadowColor=COLORS.gold;ctx.shadowBlur=18;ctx.fillStyle=COLORS.gold;
    ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(9,0);ctx.lineTo(0,10);ctx.lineTo(-9,0);ctx.closePath();ctx.fill();ctx.restore();
  }
}
function drawParticles() {
  for(const p of state.particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;
  for(const t of state.texts){ctx.globalAlpha=clamp(t.life/t.max,0,1);ctx.fillStyle=t.color;ctx.font=`900 ${t.size}px system-ui`;ctx.textAlign='center';ctx.fillText(t.text,t.x,t.y);}
  ctx.globalAlpha=1;
}

function safeRenderFallback() {
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#14233a'); bg.addColorStop(1,'#07111f');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#0b1828';
  ctx.beginPath(); ctx.moveTo(250,320); ctx.lineTo(470,320); ctx.lineTo(620,H); ctx.lineTo(100,H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(90,220,255,.18)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(250,320); ctx.lineTo(100,H); ctx.moveTo(470,320); ctx.lineTo(620,H); ctx.stroke();
  for (const row of state.gates) {
    const y=row.y, t=clamp((y-320)/(H-320),0,1), w=lerp(85,210,t);
    const drawSimpleGate=(g,x)=>{ctx.fillStyle=g.color;ctx.fillRect(x,y,w,84);ctx.fillStyle='rgba(4,12,24,.8)';ctx.fillRect(x+6,y+6,w-12,72);ctx.fillStyle='#fff';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.fillText(g.label,x+w/2,y+40);ctx.fillStyle=g.color;ctx.font='bold 12px sans-serif';ctx.fillText(g.sub,x+w/2,y+62);};
    drawSimpleGate(row.left,W/2-6-w); drawSimpleGate(row.right,W/2+6);
  }
  ctx.fillStyle='#263a50';ctx.fillRect(95,WALL_Y,530,80);
  ctx.fillStyle='#dbeafe';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText('LAST LINE',W/2,WALL_Y+48);
  for(const e of state.enemies){ctx.fillStyle=e.hit>0?'#fff':e.color;ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#8ff4ff';ctx.lineWidth=5;for(const b of state.bullets){ctx.beginPath();ctx.moveTo(b.x,b.y+20);ctx.lineTo(b.x,b.y);ctx.stroke();}
  const n=Math.min(60,Math.max(1,Math.round(state.player.squad)));
  for(let i=0;i<n;i++){const f=getFormation(i,n);ctx.fillStyle='#2b91ff';ctx.beginPath();ctx.arc(state.player.x+f.x,PLAYER_Y+f.y,7,0,Math.PI*2);ctx.fill();}
}

function render() {
  try {
    ctx.save();
    const sx=state.shake?rand(-state.shake,state.shake):0, sy=state.shake?rand(-state.shake*.55,state.shake*.55):0;
    ctx.translate(sx,sy);
    drawBackground(state.mode==='home');
    if(state.mode!=='home'){
      drawGates(); drawWall(); drawEnemies(); drawBullets(); drawPickups(); drawPlayer(); drawParticles();
    }
    ctx.restore();
    if(state.flash>0){ctx.fillStyle=`rgba(255,72,96,${state.flash*.42})`;ctx.fillRect(0,0,W,H);}
  } catch (err) {
    console.error('Primary renderer failed; using fallback renderer.', err);
    try { safeRenderFallback(); } catch (fallbackErr) { console.error(fallbackErr); }
  }
}

function loop(now) {
  const dt=Math.min(.033,(now-state.last)/1000 || 0);state.last=now;
  if(state.mode==='playing') update(dt); else { state.t+=dt; state.scroll=(state.scroll+dt*35)%120; }
  render(); requestAnimationFrame(loop);
}

function canvasPoint(evt) {
  const rect=canvas.getBoundingClientRect();
  const p=evt.touches?.[0] || evt;
  return {x:(p.clientX-rect.left)/rect.width*W,y:(p.clientY-rect.top)/rect.height*H};
}
let dragging=false;
function pointerStart(e){ if(state.mode!=='playing')return; dragging=true;audio.unlock();const p=canvasPoint(e);state.player.targetX=clamp(p.x,ROAD_LEFT+45,ROAD_RIGHT-45);e.preventDefault(); }
function pointerMove(e){ if(!dragging||state.mode!=='playing')return;const p=canvasPoint(e);state.player.targetX=clamp(p.x,ROAD_LEFT+45,ROAD_RIGHT-45);e.preventDefault(); }
function pointerEnd(){dragging=false;}
canvas.addEventListener('pointerdown',pointerStart,{passive:false});canvas.addEventListener('pointermove',pointerMove,{passive:false});window.addEventListener('pointerup',pointerEnd);
window.addEventListener('keydown',e=>{state.keys.add(e.code);if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Escape'){state.mode==='playing'?pauseGame():state.mode==='paused'&&resumeGame();}});
window.addEventListener('keyup',e=>state.keys.delete(e.code));
window.addEventListener('blur',()=>{if(state.mode==='playing')pauseGame();});

function showHow() {
  ui.modalContent.innerHTML=`
    <p class="eyebrow">FIELD MANUAL</p><h2>How to play</h2>
    <p>Your squad fires automatically. Your job is to steer the formation, choose the strongest gate, and stop every enemy before it reaches the wall.</p>
    <div class="how-list">
      <div class="how-item"><div class="how-icon">↔</div><div><strong>Move the squad</strong><span>Drag anywhere on the battlefield. Desktop players can use A/D or the arrow keys.</span></div></div>
      <div class="how-item"><div class="how-icon">+9</div><div><strong>Choose gates</strong><span>Blue and gold gates grow your army or weapon power. Red gates reduce your squad.</span></div></div>
      <div class="how-item"><div class="how-icon">◎</div><div><strong>Hold the line</strong><span>Enemies that reach the bottom damage the wall. Bosses arrive every fifth wave.</span></div></div>
      <div class="how-item"><div class="how-icon">◆</div><div><strong>Build permanently</strong><span>Recover shards during runs, then spend them in the Armory for permanent upgrades.</span></div></div>
    </div>`;
  ui.modal.classList.remove('hidden');
}

const permanentDefs=[
  {id:'damage',icon:'✦',name:'Ballistics',desc:'Start with +25% damage per level.',base:35},
  {id:'fireRate',icon:'↯',name:'Auto-loader',desc:'Start with +8% fire rate per level.',base:30},
  {id:'squad',icon:'▲',name:'Reserve squad',desc:'Start with +2 soldiers per level.',base:40},
  {id:'wall',icon:'▰',name:'Fortification',desc:'Start with +15 wall health per level.',base:45}
];
function upgradeCost(def){const lvl=save.upgrades[def.id];return Math.round(def.base*Math.pow(1.62,lvl));}
function showArmory(){
  ui.modalContent.innerHTML=`<p class="eyebrow">PERMANENT UPGRADES</p><h2>Armory</h2><div class="armory-balance">◆ <span id="armoryBalance">${save.coins}</span></div><div class="armory-grid" id="armoryGrid"></div>`;
  const grid=ui.modalContent.querySelector('#armoryGrid');
  permanentDefs.forEach(def=>{
    const lvl=save.upgrades[def.id], cost=upgradeCost(def), card=document.createElement('div');card.className='armory-card';
    card.innerHTML=`<div class="armory-icon">${def.icon}</div><div><h3>${def.name} · Lv ${lvl}</h3><p>${def.desc}</p></div><button class="buy-btn" ${save.coins<cost?'disabled':''}>${cost} ◆</button>`;
    card.querySelector('button').addEventListener('click',()=>{if(save.coins<cost)return;save.coins-=cost;save.upgrades[def.id]++;saveProgress();updateHomeCoins();audio.coin();showArmory();});
    grid.appendChild(card);
  });
  ui.modal.classList.remove('hidden');
}

$('#playBtn').addEventListener('click',()=>{audio.unlock();resetRun();});
$('#soundBtn').textContent = audio.muted ? '×' : '♪';
$('#soundBtn').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
$('#soundBtn').addEventListener('click',()=>{
  audio.muted = !audio.muted; save.muted = audio.muted; saveProgress();
  $('#soundBtn').textContent = audio.muted ? '×' : '♪';
  $('#soundBtn').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  if (!audio.muted) audio.gate(true);
});
$('#pauseBtn').addEventListener('click',pauseGame);
$('#resumeBtn').addEventListener('click',resumeGame);
$('#restartBtn').addEventListener('click',()=>{ui.pause.classList.add('hidden');resetRun();});
$('#quitBtn').addEventListener('click',()=>{ui.pause.classList.add('hidden');showHome();});
$('#retryBtn').addEventListener('click',resetRun);
$('#baseBtn').addEventListener('click',showHome);
$('#howBtn').addEventListener('click',showHow); $('#howBtn').addEventListener('pointerup',showHow);
$('#upgradesBtn').addEventListener('click',showArmory); $('#upgradesBtn').addEventListener('pointerup',showArmory);
$('#modalClose').addEventListener('click',()=>ui.modal.classList.add('hidden'));
ui.modal.addEventListener('click',e=>{if(e.target===ui.modal)ui.modal.classList.add('hidden');});

document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')pauseGame();});

if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}
if('caches' in window){caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});}

updateHomeCoins();
requestAnimationFrame(loop);
