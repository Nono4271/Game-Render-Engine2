import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapRenderer } from "./MapRenderer";

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,400;1,400&display=swap'); *{box-sizing:border-box;margin:0;padding:0} html,body,#root{width:100%;height:100%;overflow:hidden;background:#0e1014} ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0a0c10}::-webkit-scrollbar-thumb{background:#3a2a1a;border-radius:2px} @keyframes shimmer{0%{background-position:200% center}100%{background-position:-200% center}} @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}} @keyframes popIn{0%{opacity:0;transform:scale(.2)}100%{opacity:1;transform:scale(1)}} @keyframes floatUp{0%{opacity:1;transform:translateY(0) translateX(-50%)}100%{opacity:0;transform:translateY(-40px) translateX(-50%)}} @keyframes slideInLeft{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}} .btn{font-family:'Cinzel',serif;cursor:pointer;border-radius:3px;letter-spacing:.06em;transition:all .15s;outline:none;border:none} .btn:active{transform:scale(.96)} .btn:disabled{opacity:.25;cursor:not-allowed;pointer-events:none} .panel{background:rgba(5,7,11,.97);border:1px solid #221e12} .scr{overflow-y:auto;scrollbar-width:thin}`;

/* ── CONSTANTS ─────────────────────────────────────── */
const COLS = 53, ROWS = 53;

/* ── ISOMETRIC TILE GEOMETRY ──────────────────────── */
const TW = 72;
const TH = 36;
const SW = 40;   // wall height — doubled for strong 3D block feel
const TOP_PAD = 60;
const ISO_W = (COLS + 1) * TW + TW / 2;
const ISO_H = ROWS * (TH / 2) + TH + SW + TOP_PAD + 40;

function isoXY(c, r) {
return {
cx: c * TW + (r % 2 === 0 ? TW / 2 : TW),
cy: r * (TH / 2) + TOP_PAD,
};
}

function topFacePts(cx, cy, elev) {
const ey = cy - elev;
return [
[cx,         ey],
[cx + TW/2,  ey + TH/2],
[cx,         ey + TH],
[cx - TW/2,  ey + TH/2],
];
}

function leftWallPts(cx, cy, elev) {
const ey = cy - elev;
return [
[cx - TW/2, ey + TH/2],
[cx,        ey + TH],
[cx,        ey + TH + SW],
[cx - TW/2, ey + TH/2 + SW],
];
}

function rightWallPts(cx, cy, elev) {
const ey = cy - elev;
return [
[cx,        ey + TH],
[cx + TW/2, ey + TH/2],
[cx + TW/2, ey + TH/2 + SW],
[cx,        ey + TH + SW],
];
}

function ptsStr(pts) { return pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "); }

/* ── TERRAIN VISUALS ──────────────────────────────── */
const TERR_VIS = {
grass:   { top:"#3a4e2e", topL:"#4a6038", lWall:"#242e1c", rWall:"#1c2416", elev:4 },
forest:  { top:"#1e4a22", topL:"#2a6030", lWall:"#0e2810", rWall:"#0a200c", elev:4 },
mountain:{ top:"#6a5c48", topL:"#8a7860", lWall:"#3a3028", rWall:"#2c2420", elev:4 },
desert:  { top:"#8a7840", topL:"#a09050", lWall:"#5a4c28", rWall:"#443a20", elev:4 },
ruin:    { top:"#3a3430", topL:"#504846", lWall:"#1e1c1a", rWall:"#181614", elev:4 },
shore:   { top:"#b09060", topL:"#c8a870", lWall:"#7a6040", rWall:"#5a4830", elev:4 },
};

/* ── TERRAIN GAME DATA ────────────────────────────── */
const TERR = {
grass:   {lbl:"Grassland", icon:"",   def:0,  w:40},
forest:  {lbl:"Forest",    icon:"🌲", def:15, w:25},
mountain:{lbl:"Mountain",  icon:"⛰",  def:25, w:20},
desert:  {lbl:"Desert",    icon:"🏜",  def:0,  w:15},
ruin:    {lbl:"Ruin",      icon:"🏚",  def:20, w:0 },
shore:   {lbl:"Shoreline", icon:"🏖",  def:0,  w:0 },
};
/* ── BIOME CLUSTERING ─────────────────────────────── */
// Place seed points for each biome type, then assign each tile to
// the nearest seed (Voronoi). Seeds are placed with some randomness
// but kept away from the HQ corner so player starts in grassland.
const BIOME_SEEDS = (() => {
let s = 0xdeadbeef|0;
const rng = () => { s=(Math.imul(s,1664525)+1013904223)|0; return((s>>>0)/0xffffffff); };
const seeds = [];
const biomes = [
{t:"grass",   n:10},
{t:"forest",  n:8},
{t:"mountain",n:7},
{t:"desert",  n:7},
];
biomes.forEach(({t,n}) => {
for(let i=0;i<n;i++){
let c,r;
do { c=Math.floor(rng()*COLS); r=Math.floor(rng()*ROWS); }
while(Math.max(c,r)<8 && t!=="grass");
seeds.push({c,r,t});
}
});
return seeds;
})();

function clusteredTerrain(c, r) {
let best = null, bestDist = Infinity;
for (const s of BIOME_SEEDS) {
const d = (c-s.c)**2 + (r-s.r)**2;
if (d < bestDist) { bestDist = d; best = s.t; }
}
return best || "grass";
}

/* ── RSS CLUSTERING removed — resources are random per tile ── */

/* Deterministic per-tile RNG so terrain props don't shuffle on re-render */
function tileRng(c, r) {
let s = (((c+1) * 73856093) ^ ((r+1) * 19349663)) | 0;
return () => {
s = (Math.imul(s, 1103515245) + 12345) | 0;
return ((s >>> 16) & 0x7fff) / 0x7fff;
};
}
/* Place a point inside the diamond top-face (centered at +TH/2 from sy) */
function diamondPos(rnd, marginA = 0.85) {
const a = rnd() - 0.5, b = rnd() - 0.5;
return { dx: (a + b) * TW/2 * marginA, dy: (a - b) * TH/2 * marginA };
}

const RSS = {
stone:{lbl:"Stone",icon:"🪨",col:"#9898b0",bg:"rgba(100,100,130,.2)"},
wood: {lbl:"Wood", icon:"🪵",col:"#a07840",bg:"rgba(130,90,40,.2)" },
ore:  {lbl:"Ore",  icon:"⛏", col:"#4a90c0",bg:"rgba(40,100,160,.2)"},
gas:  {lbl:"Gas",  icon:"⚗",  col:"#80b040",bg:"rgba(80,150,40,.2)" },
};
const RKEYS = Object.keys(RSS);

/* ── TILE COLOURS ─────────────────────────────────── */
const TC = {
neutral:      {base:"#252830",bdr:"#353840",dot:"#555560"},
player:       {base:"#163020",bdr:"#266838",dot:"#3daa60",hq:"#0c4018"},
ai:           {base:"#280808",bdr:"#702020",dot:"#dd3322",hq:"#3c0606"},
pirates:      {base:"#2a1a08",bdr:"#6a3a10",dot:"#d4832a",hq:"#3a1a04"},
marines:      {base:"#0a1830",bdr:"#1a4080",dot:"#4488cc",hq:"#081020"},
bountyhunters:{base:"#12101e",bdr:"#503878",dot:"#9955dd",hq:"#0e0b18"},
merfolk:      {base:"#081a28",bdr:"#105a78",dot:"#30b8c8",hq:"#041018"},
orcs:         {base:"#0e1e08",bdr:"#304a10",dot:"#6aa830",hq:"#081004"},
dragons:      {base:"#1e0808",bdr:"#701010",dot:"#cc3030",hq:"#140404"},
};

/* ── FACTIONS ─────────────────────────────────────── */
const FAC = {
player:       {n:"Your Faction",   s:"⚑",  key:"player"},
pirates:      {n:"Pirates",        s:"🏴‍☠️", key:"pirates"},
marines:      {n:"Marines",        s:"⚓",  key:"marines"},
bountyhunters:{n:"Wizards",        s:"🔮", key:"bountyhunters"},
merfolk:      {n:"MerFolk",        s:"🌊",  key:"merfolk"},
orcs:         {n:"Orcs",           s:"⚔️",  key:"orcs"},
dragons:      {n:"Dragons",        s:"🐉",  key:"dragons"},
};
const AI_FACTIONS = ["pirates","marines","bountyhunters","merfolk","orcs","dragons"];

/* ── ALIGNMENTS ───────────────────────────────────── */
const ALIGNMENT = {
humans:    {n:"Humans",   icon:"🛡", factions:["pirates","marines","bountyhunters"], color:"#c8a060"},
creatures: {n:"Creatures",icon:"🦎", factions:["merfolk","orcs","dragons"],          color:"#7aaa40"},
};
function getFactionAlignment(fk) {
return ALIGNMENT.humans.factions.includes(fk) ? "humans" : "creatures";
}

/* ── PLAYABLE FACTIONS (choose one) ──────────────── */
const PLAYABLE_FACTIONS = [
{key:"pirates",       n:"Pirates",        s:"🏴‍☠️", desc:"Masters of the sea and ambush.",   c:"#d4832a"},
{key:"marines",       n:"Marines",        s:"⚓",  desc:"Disciplined naval enforcers.",      c:"#4488cc"},
{key:"bountyhunters", n:"Wizards",        s:"🔮", desc:"Ancient wielders of arcane & healing arts.", c:"#9955dd"},
{key:"merfolk",       n:"MerFolk",        s:"🌊",  desc:"Ancient rulers of the deep.",       c:"#30b8c8"},
{key:"orcs",          n:"Orcs",           s:"⚔️",  desc:"Relentless warriors of the wilds.", c:"#6aa830"},
{key:"dragons",       n:"Dragons",        s:"🐉",  desc:"Feared overlords of fire and sky.", c:"#cc3030"},
];

/* ── HEROES ───────────────────────────────────────── */
const HDEFS = [
// Pirates
{id:"h1", n:"Redwake Fynn",    faction:"pirates",       star:5,atk:185,foc:0,  spd:88,icon:"🏴‍☠️",skill:"Siege Crush"},
{id:"h2", n:"Cutlass Mora",    faction:"pirates",       star:4,atk:155,foc:0,  spd:92,icon:"🗡", skill:"Eagle Eye"},
// Marines
{id:"h3", n:"Admiral Stonewall",faction:"marines",      star:5,atk:170,foc:0,  spd:65,icon:"⚓", skill:"Shield Wall"},
{id:"h4", n:"Sergeant Vael",   faction:"marines",       star:3,atk:120,foc:0,  spd:72,icon:"🪖", skill:"War Cry"},
// Wizards
{id:"h5", n:"Solarius Vex",    faction:"bountyhunters", star:5,atk:20, foc:230,spd:62,icon:"🔮", skill:"Arcane Tempest"},
{id:"h6", n:"Mira Ashveil",    faction:"bountyhunters", star:4,atk:15, foc:180,spd:70,icon:"✨", skill:"Mending Light"},
// MerFolk
{id:"h7", n:"Tidalborn Cael",  faction:"merfolk",       star:5,atk:165,foc:0,  spd:78,icon:"🌊", skill:"Tidal Wave"},
{id:"h8", n:"Coralspine Nyra", faction:"merfolk",       star:3,atk:115,foc:0,  spd:68,icon:"🐚", skill:"Root Bind"},
// Orcs
{id:"h9", n:"Grimtusk",        faction:"orcs",          star:5,atk:200,foc:0,  spd:60,icon:"⚔️", skill:"Thornstorm"},
{id:"h10",n:"Ashgrip",         faction:"orcs",          star:4,atk:160,foc:0,  spd:70,icon:"🪓", skill:"Shadow Clone"},
// Dragons
{id:"h11",n:"Emberclaw",       faction:"dragons",       star:5,atk:195,foc:0,  spd:75,icon:"🐉", skill:"Soul Drain"},
{id:"h12",n:"Scaleveil Dusk",  faction:"dragons",       star:3,atk:125,foc:0,  spd:85,icon:"🔥", skill:"Void Bolt"},
];

const SC = s => s===5?"#f0c040":s===4?"#a855f7":"#6b7280";
const SS = s => "★".repeat(s)+"☆".repeat(5-s);

function rollGacha(n, alignFactions) {
return Array.from({length:n}, (_,i) => {
const r = Math.random(), star = r<.03?5:r<.15?4:3;
const base = alignFactions ? HDEFS.filter(h => alignFactions.includes(h.faction)) : HDEFS;
const pool = base.filter(h => h.star===star);
const src = pool.length ? pool : base;
return {...src[Math.floor(Math.random()*src.length)], uid:`g${Date.now()}${i}`};
});
}

/* ── BUILDINGS ────────────────────────────────────── */
const RSS_BLDGS = new Set(["quarry","lumber","forge","refinery"]);

const BLDG = {
hq:            {n:"HQ",              icon:"🏰",max:10, desc:"Seat of power. Gates all other building upgrades. Most costly to upgrade.",cost:{stone:800, wood:600, ore:400, gas:300}},
quarry:        {n:"Quarry",          icon:"🪨",max:20, desc:"Produces Stone. +80/s per level.",                                     cost:{stone:50,  wood:30, ore:10, gas:0 }, rss:"stone",rate:80},
lumber:        {n:"Lumber Mill",     icon:"🪵",max:20, desc:"Produces Wood. +80/s per level.",                                      cost:{stone:30,  wood:50, ore:10, gas:0 }, rss:"wood", rate:80},
forge:         {n:"Ore Forge",       icon:"⛏", max:20, desc:"Produces Ore. +80/s per level.",                                       cost:{stone:40,  wood:20, ore:0,  gas:0 }, rss:"ore",  rate:80},
refinery:      {n:"Refinery",        icon:"⚗", max:20, desc:"Produces Gas. +50/s per level.",                                       cost:{stone:60,  wood:40, ore:30, gas:0 }, rss:"gas",  rate:50},
barracks:      {n:"Barracks",        icon:"🏕", max:10, desc:"Increases max troop capacity. Lv1=2k, Lv10=90k.",                     cost:{stone:80,  wood:80, ore:40, gas:20}},
training:      {n:"Training Grounds",icon:"⚔️", max:10, desc:"Increases max training batch size. Always trainable even at Lv0.",   cost:{stone:60,  wood:60, ore:30, gas:10}},
commandcenter: {n:"Command Center",  icon:"📡",max:10, desc:"+300 Command to all commanders per level.",                             cost:{stone:150, wood:120,ore:80, gas:60}},
healingtent:   {n:"Healing Tent",    icon:"⛺",max:10, desc:"Heals wounded troops. +5/s per level.",                                cost:{stone:60,  wood:80, ore:60, gas:0 }},
walls:         {n:"Walls",           icon:"🛡", max:10, desc:"Fortifies HQ defense. +10% DEF per level.",                           cost:{stone:100, wood:60, ore:0,  gas:0 }},
academy:       {n:"Academy",         icon:"📜",max:10, desc:"Boosts commander ATK & Focus. +5% per level.",                                 cost:{stone:120, wood:80, ore:60, gas:40}},
};

// Barracks capacity: Lv1=2000, Lv10=90000 (exponential curve)
function barracksCapacity(lvl) {
if (lvl <= 0) return 2000;
// Lv1→2000, Lv10→90000
return Math.round(2000 * Math.pow(45, (lvl - 1) / 9));
}

// Training batch options scale with Training Grounds level
function trainingBatches(lvl) {
const base = [100, 300];
if (lvl >= 2)  base.push(500);
if (lvl >= 4)  base.push(1000);
if (lvl >= 6)  base.push(2000);
if (lvl >= 8)  base.push(5000);
if (lvl >= 10) base.push(10000);
return base;
}

// Max troops trainable per queue at this training level
function maxTrainBatch(lvl) {
const batches = trainingBatches(lvl);
return batches[batches.length - 1];
}

// Training duration in seconds for a given amount at this training level
// Lv0: 1 troop/s, Lv5: 10 troops/s, Lv10: 50 troops/s
function trainRate(lvl) {
return Math.round(1 + lvl * 4.9);  // troops per second
}

// Max available level for a building given current HQ level
function maxAvailLevel(type, hqLvl) {
const absMax = BLDG[type].max;
if (type === "hq") return absMax;
const avail = RSS_BLDGS.has(type) ? hqLvl * 2 : hqLvl;
return Math.min(absMax, avail);
}

function upgCost(type, lvl) {
const b = BLDG[type].cost, m = Math.pow(1.8, lvl);
return Object.fromEntries(Object.entries(b).map(([k,v]) => [k, Math.round(v*m)]));
}

// Upgrade timer duration in ms — scales with new level
// HQ: 60s/lvl · Military/Command: 30s/lvl · Resource: 20s/lvl
function upgDuration(type, newLevel) {
if (type === "hq") return newLevel * 60000;
const isMilitary = ["barracks","training","commandcenter","walls","academy","healingtent"].includes(type);
return newLevel * (isMilitary ? 30000 : 20000);
}

/* ── COMMAND STAT ─────────────────────────────────── */
function cmdCommand(lvl, ccLvl) {
return (lvl||5) * 120 + (ccLvl||0) * 300;
}

/* ── HQ positions ─────────────────────────────────── */
const HQP = { player:{c:1, r:1}, ai:{c:4, r:4} };
const AI_HQ_KEY = `${HQP.ai.c},${HQP.ai.r}`;

/* ── WIN TILE — center of map ────────────────────── */
const WIN_C = 26, WIN_R = 26;
const WIN_KEY = `${WIN_C},${WIN_R}`;

/* ── ADJ KEYS ─────────────────────────────────────── */
function isShore(c, r) {
return c===0 || r===0 || c===COLS-1 || r===ROWS-1;
}
function adj(c, r) {
const isEven = r % 2 === 0;
const nbrs = isEven
  ? [[c-1,r],[c+1,r],[c-1,r-1],[c,r-1],[c-1,r+1],[c,r+1]]
  : [[c-1,r],[c+1,r],[c,r-1],[c+1,r-1],[c,r+1],[c+1,r+1]];
return nbrs
  .filter(([tc,tr]) => tc>=0 && tr>=0 && tc<COLS && tr<ROWS && !isShore(tc,tr))
  .map(([tc,tr]) => `${tc},${tr}`);
}

/* ── TROOP TYPES ──────────────────────────────────── */
const TROOP = {
infantry: {
label:"Infantry", icon:"🗡",  color:"#c8a060",
desc:"Sword & shield soldiers",
dmgType:"physical",
hp:120, atk:85, def:90, focus:25, spd:45, siege:1.0,
strong:["mage"],
weak:  ["horsemen"],
},
mage: {
label:"Mage",     icon:"🧙", color:"#70b870",
desc:"Arcane spellcasters",
dmgType:"magical",
hp:70,  atk:40, def:45, focus:110, spd:72, siege:0.3,
strong:["spearmen"],
weak:  ["infantry"],
},
spearmen: {
label:"Spearmen", icon:"🪃", color:"#8888e8",
desc:"Pike & spear formation",
dmgType:"physical",
hp:100, atk:75, def:70, focus:15, spd:58, siege:0.8,
strong:["horsemen"],
weak:  ["mage"],
},
horsemen: {
label:"Horsemen", icon:"🐴", color:"#d08040",
desc:"Fast mounted cavalry",
dmgType:"physical",
hp:90,  atk:95, def:60, focus:20, spd:110, siege:0.5,
strong:["infantry"],
weak:  ["spearmen"],
},
};
const TROOP_KEYS = Object.keys(TROOP);
/* BARRACKS_MAX is now dynamic — see barracksCapacity(lvl) */

/* ── COMMANDER LEVELS & XP ────────────────────────── */
const CMD_LVL_MIN = 5;
const CMD_LVL_MAX = 50;
function xpToNext(lvl) {
return Math.floor(100 * Math.pow(1.18, lvl - CMD_LVL_MIN));
}

/* ── TILE POWER LEVELS ────────────────────────────── */
// temporal dead zone — const declarations are not hoisted.
const POWER_DEFS = {
1: { label:"I",   color:"#6a9a6a", cmdLvl:2,  troops:200,  xpReward:30  },
2: { label:"II",  color:"#9a8a30", cmdLvl:6,  troops:600,  xpReward:80  },
3: { label:"III", color:"#9a5a30", cmdLvl:10, troops:1000, xpReward:180 },
4: { label:"IV",  color:"#9a3030", cmdLvl:15, troops:1500, xpReward:350 },
};

function tilePowerLevel(c, r) {
const dp = Math.max(Math.abs(c - HQP.player.c), Math.abs(r - HQP.player.r));
const da = Math.max(Math.abs(c - HQP.ai.c),     Math.abs(r - HQP.ai.r));
const dist = Math.min(dp, da);
if (dist <= 5)  return 1;
if (dist <= 12) return 2;
if (dist <= 20) return 3;
return 4;
}

function troopModifier(atkType, defType) {
if (!atkType || !defType) return 1.0;
if (TROOP[atkType]?.strong.includes(defType)) return 1.1;
if (TROOP[atkType]?.weak.includes(defType))   return 0.9;
return 1.0;
}

/* ── SIEGE ────────────────────────────────────────── */
const SIEGE_BASE     = 50;          // all non-HQ tiles
const SIEGE_HQ_BASE  = 50000;       // player HQ base
const SIEGE_RESET_MS = 60000;       // 60 seconds to reset defeated garrison

function hqSiegeValue(wallLvl) {
return SIEGE_HQ_BASE + (wallLvl||0) * 20000; // max 250,000 at Lv10
}

// Calculate siege power from surviving troops
function calcSiegePower(troops, troopType) {
if (!troops || troops <= 0) return 0;
const siegeRate = TROOP[troopType]?.siege || 0;
return Math.round(troops * siegeRate);
}

/* ── MAP GEN ──────────────────────────────────────── */
function genMap() {
const m = {};
for (let r = 0; r < ROWS; r++) {
for (let c = 0; c < COLS; c++) {
const k = `${c},${r}`;
const shore = isShore(c, r);
if (shore) {
m[k] = { c, r, k, terrain:"shore", rss:null, troopType:null, powerLevel:0,
defCmd:null, owner:null, garrison:0, siege:0, siegeMax:0,
garrisonDefeated:false, resetAt:null, isHQ:false, isWin:false, isShore:true };
continue;
}
const rss = RKEYS[Math.floor(Math.random() * RKEYS.length)];
const troopType = TROOP_KEYS[Math.floor(Math.random() * TROOP_KEYS.length)];
const pl = tilePowerLevel(c, r);
const pd = POWER_DEFS[pl];
m[k] = {
c, r, k,
terrain: clusteredTerrain(c, r),
rss,
troopType,
powerLevel: pl,
defCmd: {
lvl:      pd.cmdLvl,
troops:   pd.troops,
troopType,
atk:      80 + pd.cmdLvl * 8,
spd:      30 + pd.cmdLvl * 3,
},
owner: null,
garrison: pd.troops,
garrisonTroops: pd.troops,
hasAiCommander: false,
siege: SIEGE_BASE,
siegeMax: SIEGE_BASE,
garrisonDefeated: false,
resetAt: null,
isHQ: false,
isWin: false,
isShore: false,
};
}
}
// Player HQ at (1,1) — always grassland
const hqK = `${HQP.player.c},${HQP.player.r}`;
m[hqK] = {...m[hqK], owner:"player", isHQ:true, garrison:0, terrain:"grass", rss:null, defCmd:null,
siege: SIEGE_HQ_BASE, siegeMax: SIEGE_HQ_BASE, garrisonDefeated:false, resetAt:null};
// AI HQ at (COLS-2, ROWS-2) — always grassland, owned by AI
m[AI_HQ_KEY] = {...m[AI_HQ_KEY], owner:"ai", isHQ:true, garrison:0, terrain:"grass", rss:null, defCmd:null,
siege: SIEGE_HQ_BASE, siegeMax: SIEGE_HQ_BASE, garrisonDefeated:false, resetAt:null};
// Win tile at (25,25)
const winPD = POWER_DEFS[4];
m[WIN_KEY] = {
...m[WIN_KEY], isWin:true, terrain:"grass", rss:null, powerLevel:4,
garrison: winPD.troops,
siege: SIEGE_BASE, siegeMax: SIEGE_BASE, garrisonDefeated:false, resetAt:null,
defCmd:{ lvl:winPD.cmdLvl, troops:winPD.troops, troopType:TROOP_KEYS[0], atk:200, spd:75 },
};
// Ruin at (1,2)
const ruinK = "1,2";
m[ruinK] = {
...m[ruinK], isRuin:true, terrain:"ruin", rss:null, powerLevel:1,
owner: null, garrison:100,
siege: 1300, siegeMax: 1300,
garrisonDefeated:false, resetAt:null,
defCmd:{ lvl:1, troops:100, troopType:TROOP_KEYS[0], atk:80, spd:30 },
};
return m;
}

/* ── SKILL DEFINITIONS ────────────────────────────── */
// (dmgMult/defMult/healPct). Only SKILLS is used by simBattle.
const SKILLS = {
"Siege Crush":   { round:1,  desc:"Crushing blow — troops deal 40% bonus damage this round.",       troopMult:1.40, cmdMult:1.0  },
"War Cry":       { round:2,  desc:"Battle cry — troops deal 25% bonus damage rounds 2–10.",         troopBuff:0.25, cmdMult:1.0  },
"Shield Wall":   { round:3,  desc:"Defensive formation — reduces incoming damage by 35% this round.",defBuff:0.35,  cmdMult:1.0  },
"Tidal Wave":    { round:4,  desc:"Devastating wave — commander strikes twice this round.",          cmdHits:2,     troopMult:1.0 },
"Foresight":     { round:5,  desc:"Tactical insight — nullifies enemy skill effect this round.",     nullifyEnemy:true            },
"Anchor Strike": { round:6,  desc:"Powerful anchor blow — commander deals 60% bonus damage.",        cmdMult:1.60,  troopMult:1.0 },
"Thornstorm":    { round:3,  desc:"Thorn barrage — troops deal 30% bonus damage this round.",       troopMult:1.30, cmdMult:1.0  },
"Eagle Eye":     { round:2,  desc:"Precision aim — 50% chance to score a critical hit (+50% dmg).", crit:0.50,     troopMult:1.0 },
"Root Bind":     { round:4,  desc:"Root the enemy — slows them, reducing their damage by 25% rounds 4–10.", rootDebuff:0.25      },
"Soul Drain":    { round:1,  desc:"Soul drain — heals commander HP equal to damage dealt.",          cmdMult:1.20,  drain:true   },
"Void Bolt":     { round:5,  desc:"Piercing void bolt — ignores 50% of enemy defense.",             pierce:0.50,   troopMult:1.0 },
"Shadow Clone":  { round:3,  desc:"Shadow clone — troops attack twice this round.",                 troopHits:2,   cmdMult:1.0   },
};

/* ── GARRISON HELPER ─────────────────────────────── */
// Returns the correct power-level defCmd for an AI-owned tile with no AI commander
function garrisonDefCmd(tile) {
  const plvl = tile.powerLevel || 1;
  const pd   = POWER_DEFS[plvl] || POWER_DEFS[1];
  return {
    lvl:      pd.cmdLvl,
    troops:   tile.garrisonTroops || pd.troops,
    troopType: tile.troopType,
    atk:  80 + pd.cmdLvl * 8,
    spd:  30 + pd.cmdLvl * 3,
  };
}
// Normalise a defender tile so its defCmd always reflects the actual garrison
// (i.e. for AI tiles whose commander has marched away, use power-level stats)
function resolvedDefTile(tile) {
  if (tile.owner === "ai" && !tile.hasAiCommander) {
    return {...tile, defCmd: garrisonDefCmd(tile)};
  }
  return tile;
}

/* ── 10-ROUND BATTLE ENGINE ──────────────────────── */
function simBattle(cmd, attackerTroops, defTile, wallLvl) {
const terrDef = TERR[defTile.terrain]?.def || 0;
const fort    = defTile.isHQ ? (wallLvl||0)*10 : 0;
const dc      = defTile.defCmd;
const mod     = troopModifier(cmd.troopType, dc?.troopType || defTile.troopType || null);
const modLabel = mod===1.1 ? "⚔ STRONG" : mod===0.9 ? "🛡 WEAK" : "◆ NEUTRAL";

const atkLvl    = cmd.lvl || 5;
const atkCmdAtk = (cmd.atk || 150) * Math.pow(1.20, atkLvl - 5);
const atkCmdSpd = cmd.spd || 60;
const atkSkill  = cmd.skill || "";
const atkSkillDef = SKILLS[atkSkill] || null;

const defLvl    = dc ? dc.lvl : 2;
const defTroops = dc ? dc.troops : (defTile.garrison || defTile.garrisonTroops || 30);
const defCmdAtk = (dc ? dc.atk : 80) * Math.pow(1.20, Math.max(0, defLvl - 2));
const defCmdSpd = dc ? (dc.spd || 40) : 40;
const defTerrBonus = 1 + (terrDef + fort) / 100;

// Troop stat lookups
const atkTT  = cmd.troopType ? TROOP[cmd.troopType] : null;
const defTT  = (dc?.troopType || defTile.troopType) ? TROOP[dc?.troopType || defTile.troopType] : null;
const atkTroopSpd = atkTT ? atkTT.spd : 50;
const defTroopSpd = defTT ? defTT.spd : 50;

// HP pools — use troop HP stat per troop if available, else flat 10
const atkTroopHpPer = atkTT ? atkTT.hp : 10;
const defTroopHpPer = defTT ? defTT.hp : 10;
let atkTroopHp = attackerTroops * atkTroopHpPer;
let defTroopHp = defTroops * defTroopHpPer;
const atkTroopHpStart = atkTroopHp;

// Damage calculation helpers
// Physical: ATK vs DEF, scaled by level and troop count
const calcPhysAtk = (tt, count, lvlMult, terrMult=1) => {
if (!tt || count <= 0) return 0;
const surviving = Math.max(1, Math.ceil(count));
const raw = surviving * tt.atk * lvlMult * terrMult * (0.85 + Math.random() * 0.30);
return Math.max(1, Math.round(raw / 10));
};
const calcPhysDef = (tt) => tt ? tt.def : 30;

// Magical: FOCUS vs FOCUS
const calcMagAtk = (tt, count, lvlMult, terrMult=1) => {
if (!tt || count <= 0) return 0;
const surviving = Math.max(1, Math.ceil(count));
const raw = surviving * tt.focus * lvlMult * terrMult * (0.85 + Math.random() * 0.30);
return Math.max(1, Math.round(raw / 10));
};
const calcMagRes = (tt) => tt ? tt.focus : 20;

// Apply damage from attacker troop to defender troop HP
const applyTroopDmg = (atkTroopType, defTroopType, atkCount, defHP, lvlMult, terrMult=1) => {
const aTT = TROOP[atkTroopType];
const dTT = TROOP[defTroopType] || null;
if (!aTT) return {dmg:0, newHp:defHP};
let raw, resist;
if (aTT.dmgType === "magical") {
raw    = calcMagAtk(aTT, atkCount, lvlMult, terrMult);
resist = calcMagRes(dTT);
} else {
raw    = calcPhysAtk(aTT, atkCount, lvlMult, terrMult);
resist = calcPhysDef(dTT);
}
const dmgReduction = Math.max(0, 1 - resist / (resist + 80));
const dmg = Math.max(1, Math.round(raw * dmgReduction * mod));
return {dmg, newHp: Math.max(0, defHP - dmg)};
};

const atkLvlMult = Math.pow(1.20, atkLvl - 5);
const defLvlMult = Math.pow(1.20, Math.max(0, defLvl - 2));

let atkTroopBuff  = 1.0;
let defRootDebuff = 1.0;

const report = {
atkName:cmd.n, atkIcon:cmd.icon||"⚔", atkLvl, atkTroopType:cmd.troopType,
atkTroopsStart:attackerTroops, defTroopsStart:defTroops, defLvl,
defCmdName:`Garrison Lv${defLvl}`, defCmdIcon:"🛡",
terrain:defTile.terrain, modLabel,
rounds:[], atkTroopsEnd:attackerTroops, defTroopsEnd:defTroops, won:false, xpGain:0,
};

for (let round = 1; round <= 10; round++) {
const roundLog = { round, actions: [] };
if (atkTroopHp <= 0 && defTroopHp <= 0) break;
if (atkTroopHp <= 0) { roundLog.actions.push({actor:"SYSTEM",action:"Attackers routed!",dmg:0}); report.rounds.push(roundLog); break; }
if (defTroopHp <= 0) { roundLog.actions.push({actor:"SYSTEM",action:"Defenders defeated!",dmg:0}); report.rounds.push(roundLog); break; }

// Skill processing
const skillFires = atkSkillDef && atkSkillDef.round === round;
let skillNullified=false, thisCmdMult=1.0, thisTroopMult=atkTroopBuff;
let cmdHitsThisRound=1, troopHitsThisRound=1, critChance=0;

if (skillFires) {
  const sk = atkSkillDef;
  roundLog.actions.push({actor:cmd.n, action:`✨ ${atkSkill} — ${sk.desc}`, dmg:0, isSkill:true});
  if (sk.troopMult)    thisTroopMult  *= sk.troopMult;
  if (sk.troopBuff)    { atkTroopBuff += sk.troopBuff; thisTroopMult = atkTroopBuff; }
  if (sk.cmdMult)      thisCmdMult     = sk.cmdMult;
  if (sk.cmdHits)      cmdHitsThisRound = sk.cmdHits;
  if (sk.troopHits)    troopHitsThisRound = sk.troopHits;
  if (sk.crit)         critChance      = sk.crit;
  if (sk.defBuff)      thisCmdMult    *= (1 - sk.defBuff);
  if (sk.rootDebuff)   defRootDebuff   = 1 - sk.rootDebuff;
  if (sk.nullifyEnemy) skillNullified  = true;
}

const defDmgMult = defRootDebuff;

// Build 4-entity initiative order: [{id, spd, act}]
const entities = [
  { id:"atkCmd",   spd: atkCmdSpd,   side:"atk" },
  { id:"atkTroop", spd: atkTroopSpd, side:"atk" },
  { id:"defCmd",   spd: defCmdSpd,   side:"def" },
  { id:"defTroop", spd: defTroopSpd, side:"def" },
].sort((a, b) => b.spd - a.spd || (a.side==="atk" ? -1 : 1)); // ties: attacker first

for (const entity of entities) {
  if (atkTroopHp <= 0 && defTroopHp <= 0) break;

  if (entity.id === "atkCmd") {
    if (defTroopHp <= 0) continue;
    for (let h = 0; h < cmdHitsThisRound; h++) {
      const isCrit = Math.random() < critChance;
      // Commanders deal physical damage always (for now)
      const defRes = defTT ? calcPhysDef(defTT) : 30;
      const dmgReduction = Math.max(0, 1 - defRes / (defRes + 80));
      const raw = atkCmdAtk * thisCmdMult * (isCrit?1.5:1.0) * (0.85+Math.random()*0.30) * defTerrBonus;
      const dmg = Math.max(1, Math.round(raw * dmgReduction));
      defTroopHp = Math.max(0, defTroopHp - dmg);
      roundLog.actions.push({actor:cmd.n, action:`${cmd.n} struck enemy troops${isCrit?" (CRITICAL!)":""}`, dmg, isPlayer:true});
    }
  }

  else if (entity.id === "atkTroop") {
    if (!atkTT || atkTroopHp <= 0 || defTroopHp <= 0) continue;
    for (let h = 0; h < troopHitsThisRound; h++) {
      const atkCount = Math.ceil(atkTroopHp / atkTroopHpPer);
      const res = applyTroopDmg(cmd.troopType, dc?.troopType||defTile.troopType, atkCount * thisTroopMult, defTroopHp, atkLvlMult);
      defTroopHp = res.newHp;
      roundLog.actions.push({actor:"Troops", action:`${atkTT?.icon||"⚔"} ${atkTT?.label||"Troops"} attacked enemy soldiers`, dmg:res.dmg, isPlayer:true});
    }
  }

  else if (entity.id === "defCmd") {
    if (skillNullified || atkTroopHp <= 0) continue;
    const atkRes = atkTT ? calcPhysDef(atkTT) : 30;
    const dmgReduction = Math.max(0, 1 - atkRes / (atkRes + 80));
    const raw = defCmdAtk * defDmgMult * defTerrBonus * (0.85+Math.random()*0.30) * 0.8;
    const dmg = Math.max(1, Math.round(raw * dmgReduction));
    atkTroopHp = Math.max(0, atkTroopHp - dmg);
    roundLog.actions.push({actor:"Enemy Cmd", action:`Enemy commander struck your troops`, dmg, isPlayer:false});
  }

  else if (entity.id === "defTroop") {
    if (skillNullified || !defTT || defTroopHp <= 0 || atkTroopHp <= 0) continue;
    const defCount = Math.ceil(defTroopHp / defTroopHpPer);
    const res = applyTroopDmg(dc?.troopType||defTile.troopType, cmd.troopType, defCount * defDmgMult, atkTroopHp, defLvlMult, defTerrBonus);
    atkTroopHp = res.newHp;
    roundLog.actions.push({actor:"Defenders", action:`${defTT.icon} ${defTT.label} attacked your soldiers`, dmg:res.dmg, isPlayer:false});
  }
}

report.rounds.push(roundLog);

}

const won = atkTroopHp > 0 || (atkTroopHp <= 0 && defTroopHp <= 0);
const defTroopsLeft = Math.max(0, Math.round(defTroopHp / defTroopHpPer));
const finalAtkLost = won
? Math.min(attackerTroops - 1, Math.max(1, Math.round((atkTroopHpStart - Math.max(0, atkTroopHp)) / atkTroopHpPer)))
: Math.min(attackerTroops, Math.round(attackerTroops * (0.35 + Math.random() * 0.20)));

const xpGain = won ? (POWER_DEFS[defTile.powerLevel||1]?.xpReward || 30) : 0;
const atkPow = attackerTroops * Math.pow(1.20, atkLvl - 5) * mod;
const defPow = defTroops * Math.pow(1.20, Math.max(0, defLvl - 2)) * defTerrBonus;
const powerRatio = atkPow / Math.max(1, defPow);
const pct = Math.round(Math.min(99, Math.max(1, 100 / (1 + Math.pow(Math.max(0.00001, 1/powerRatio), 3.5)))));

report.won = won;
report.atkTroopsEnd = Math.max(0, attackerTroops - finalAtkLost);
report.defTroopsEnd = defTroopsLeft;
report.xpGain = xpGain;
report.pct = pct;

return {won, lost:finalAtkLost, atk:Math.round(atkPow), def:Math.round(defPow), pct, mod, modLabel, xpGain, report};
}

/* ── BFS PATHFINDING ──────────────────────────────── */
function bfsPath(fromKey, toKey) {
if (fromKey === toKey) return [fromKey];
const [fc, fr] = fromKey.split(",").map(Number);
const [tc, tr] = toKey.split(",").map(Number);
const queue = [[fromKey, [fromKey]]];
const visited = new Set([fromKey]);
while (queue.length) {
const [cur, path] = queue.shift();
const [cc, cr] = cur.split(",").map(Number);
for (const nk of adj(cc, cr)) {
if (visited.has(nk)) continue;
visited.add(nk);
const newPath = [...path, nk];
if (nk === toKey) return newPath;
queue.push([nk, newPath]);
}
}
return null; // no path found
}

/* ── MARCH STEP DURATION ──────────────────────────── */
// Effective SPD = 80% troop SPD + 20% commander SPD
// If no troops assigned, use commander SPD only
function effectiveMarchSpd(cmdSpd, troopType) {
if (!troopType || !TROOP[troopType]) return cmdSpd || 60;
const tSpd = TROOP[troopType].spd;
return Math.round(tSpd * 0.80 + (cmdSpd || 60) * 0.20);
}
function marchStepMs(effSpd) {
return Math.max(200, 1400 - (effSpd || 60) * 10);
}

/* ══════════════════════════════════════════════════
COMPONENT
══════════════════════════════════════════════════ */
export default function RiseToWar() {
/* ── screens ── */
const [screen,  setScreen]  = useState("title");
const [facKey,  setFacKey]  = useState("pirates");
const [facName, setFacName] = useState("Pirates");
const playerAlignment = getFactionAlignment(facKey);

/* ── faction-aware commander init ── */
const makeStartCmds = (fk) => {
const hqk = `${HQP.player.c},${HQP.player.r}`;
const starters = HDEFS.filter(h => h.faction === fk);
return starters.map((h,i) => ({...h, uid:`p${i}`, owner:"player", troops:0, troopType:null, tk:hqk, lvl:5, xp:0}));
};

/* ── game state ── */
const [tiles,  setTiles]   = useState({});
const [rss,    setRss]     = useState({stone:300, wood:300, ore:300, gas:300});
const [gems,   setGems]    = useState(600);
const [cmds,   setCmds]    = useState(() => makeStartCmds("pirates"));
const [coll,   setColl]    = useState(() => HDEFS.filter(h => h.faction === "pirates"));
const [bldgs,  setBldgs]   = useState({hq:1, quarry:0, lumber:0, forge:0, refinery:0, barracks:0, training:0, commandcenter:0, healingtent:0, walls:0, academy:0});
const [upgQueue, setUpgQueue] = useState({}); // { [bldgType]: { endsAt, startedAt, newLvl, dur } }

/* ── AI enemy state ── */
const [aiFaction, setAiFaction] = useState(null);
const [aiRss, setAiRss] = useState({stone:300, wood:300, ore:300, gas:300});
const [aiBldgs, setAiBldgs] = useState({hq:1,quarry:0,lumber:0,forge:0,refinery:0,barracks:0,training:0,commandcenter:0,healingtent:0,walls:0,academy:0});
const [aiBarracksPool, setAiBarracksPool] = useState(barracksCapacity(0));
const aiLastActionRef = useRef(0);
// Refs so AI tick can read latest state without stale closures
const cmdsRef        = useRef([]);
const tilesRef       = useRef({});
const aiRssRef       = useRef({stone:300,wood:300,ore:300,gas:300});
const aiBldgsRef     = useRef({hq:1,quarry:0,lumber:0,forge:0,refinery:0,barracks:0,training:0,commandcenter:0,healingtent:0,walls:0,academy:0});
const aiPoolRef      = useRef(barracksCapacity(0));
const [barracksPool, setBarracks] = useState(barracksCapacity(0));
const [woundedTroops, setWounded] = useState(0);
const [trainingQueue, setTrainingQueue] = useState(null); // {amount, remaining, total, cost}
const [trainSlider, setTrainSlider] = useState(100);
const [bLog,   setBLog]    = useState([]);
const [battles, setBattles] = useState([]);
const [showBattleLog, setShowBattleLog] = useState(false);
const [battleLogView, setBattleLogView] = useState("simple");
const [selectedBattle, setSelectedBattle] = useState(0);
const [unseenBattles, setUnseenBattles] = useState(0);

/* ── UI ── */
const [mode,    setMode]    = useState("view");
const [selKey,  setSelKey]  = useState(null);
const [popupPos, setPopupPos] = useState(null); // {x, y} screen coords for floating popup
const [atkKey,  setAtkKey]  = useState(null);
const [mvCmd,   setMvCmd]   = useState(null);
const [pickCmd, setPick]    = useState(null);
const [reinCmd, setReinCmd] = useState(null);
const [reinMarches, setReinMarches] = useState([]); // [{uid, cmdUid, amount, path, step, stepMs, lastStepTime}]
const [sliderVals, setSliderVals] = useState({});
const [popupMode, setPopupMode] = useState("main"); // "main"|"editArmy"|"recallPick"
const [editArmyCmd, setEditArmyCmd] = useState(null);
const [floats,  setFloats]  = useState([]);
const [winner,  setWinner]  = useState(null);
const [deletingTiles, setDeletingTiles] = useState({}); // { [tileKey]: startedAt }
const [deletingSecsLeft, setDeletingSecsLeft] = useState({}); // { [tileKey]: secsLeft }

/* ── menus ── */
const [hqOpen, setHqOpen]  = useState(false);
const [hqTab,  setHqTab]   = useState("overview");
const [gRes,   setGRes]    = useState([]);
const [showG,  setShowG]   = useState(false);

/* ── map pan + zoom ── */
const panRef   = useRef({x:4,y:4});
const [panSt,  setPanSt]   = useState({x:4,y:4});
const [zoom,   setZoom]    = useState(1);
const zoomRef  = useRef(1);
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5];

/* ══════════════════════════════════════════════════
EFFECTS
══════════════════════════════════════════════════ */

useEffect(() => {
if (screen==="game" && Object.keys(tiles).length===0) setTiles(genMap());
}, [screen]);

useEffect(() => {
zoomRef.current = zoom;
}, [zoom]);

// Keep refs in sync so AI tick always reads fresh state
useEffect(() => { cmdsRef.current    = cmds;        }, [cmds]);
useEffect(() => { tilesRef.current   = tiles;       }, [tiles]);
useEffect(() => { aiRssRef.current   = aiRss;       }, [aiRss]);
useEffect(() => { aiBldgsRef.current = aiBldgs;     }, [aiBldgs]);
useEffect(() => { aiPoolRef.current  = aiBarracksPool; }, [aiBarracksPool]);

useEffect(() => {
if (screen!=="game") return;
const id = setInterval(() => {
setRss(p => {
const n = {stone: p.stone+5, wood: p.wood+5, ore: p.ore+5, gas: p.gas+5};
Object.values(tiles).forEach(t => {
if (t.owner==="player" && t.rss) n[t.rss] += 50;
});
return {
stone: Math.min(99999, n.stone),
wood:  Math.min(99999, n.wood),
ore:   Math.min(99999, n.ore),
gas:   Math.min(99999, n.gas),
};
});
}, 1000);
return () => clearInterval(id);
}, [screen, tiles]);

// AI resource tick — mirrors player resource income
useEffect(() => {
if (screen !== "game" || !aiFaction) return;
const id = setInterval(() => {
setAiRss(p => {
const n = {stone: p.stone+5, wood: p.wood+5, ore: p.ore+5, gas: p.gas+5};
Object.values(tiles).forEach(t => {
if (t.owner === "ai" && t.rss) {
const bldgForRss = t.rss==="stone"?"quarry":t.rss==="wood"?"lumber":t.rss==="ore"?"forge":"refinery";
n[t.rss] += 50 * Math.max(1, aiBldgs[bldgForRss]||1);
}
});
return {
stone: Math.min(99999, n.stone),
wood:  Math.min(99999, n.wood),
ore:   Math.min(99999, n.ore),
gas:   Math.min(99999, n.gas),
};
});
}, 1000);
return () => clearInterval(id);
}, [screen, aiFaction, tiles, aiBldgs]);

// AI march tick — only marching is throttled to 45 seconds
useEffect(() => {
if (screen !== "game" || !aiFaction) return;
const id = setInterval(() => {
  const now = Date.now();
  if (now - aiLastActionRef.current < 45000) return;

  const curCmds    = cmdsRef.current;
  const curTiles   = tilesRef.current;
  const curAiBldgs = aiBldgsRef.current;
  const aiCmds     = curCmds.filter(c => c.owner === "ai");
  const aiTileKeys = new Set(Object.keys(curTiles).filter(k => curTiles[k]?.owner === "ai"));

  // Send an idle AI commander with troops toward WIN_KEY
  const idleWithTroops = aiCmds.filter(c => !c.march && (c.troops||0) > 0);
  for (const cmd of idleWithTroops) {
    const [cc, cr] = cmd.tk.split(",").map(Number);
    const adjTiles = adj(cc, cr).filter(k => !aiTileKeys.has(k) && curTiles[k] && !curTiles[k].isShore);
    if (!adjTiles.length) continue;
    const target = adjTiles.reduce((best, k) => {
      const [tc, tr] = k.split(",").map(Number);
      const d = Math.abs(tc - WIN_C) + Math.abs(tr - WIN_R);
      return d < best.d ? {k, d} : best;
    }, {k: null, d: Infinity});
    if (!target.k) continue;
    const path = bfsPath(cmd.tk, target.k);
    if (!path || path.length < 2) continue;
    const stepMs = marchStepMs(effectiveMarchSpd(cmd.spd||60, cmd.troopType));
    setCmds(p => p.map(c => c.uid === cmd.uid
      ? {...c, march:{type:"attack",path,step:0,dest:target.k,origin:cmd.tk,stepMs,lastStepTime:now}}
      : c));
    aiLastActionRef.current = now; // throttle: next march no sooner than 45s
    return;
  }
}, 3000); // poll every 3s; march throttle enforced via ref
return () => clearInterval(id);
}, [screen, aiFaction]);

// AI economy tick — train, assign, upgrade happen freely (every 5s)
useEffect(() => {
if (screen !== "game" || !aiFaction) return;
const id = setInterval(() => {
  const curCmds    = cmdsRef.current;
  const curAiRss   = aiRssRef.current;
  const curAiBldgs = aiBldgsRef.current;
  const curAiPool  = aiPoolRef.current;
  const aiCmds     = curCmds.filter(c => c.owner === "ai");

  // ACTION 1: Assign troops to idle AI commander at AI HQ with 0 troops
  const idleNoTroops = aiCmds.filter(c => !c.march && !(c.troops||0) && c.tk === AI_HQ_KEY);
  if (idleNoTroops.length && curAiPool > 0) {
    const cmd = idleNoTroops[0];
    const cmdCap = cmdCommand(cmd.lvl||5, curAiBldgs.commandcenter||0);
    const assign = Math.min(cmdCap, curAiPool);
    const tType = TROOP_KEYS[Math.floor(Math.random() * TROOP_KEYS.length)];
    setAiBarracksPool(p => Math.max(0, p - assign));
    setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, troops:assign, troopType:tType} : c));
    return;
  }

  // ACTION 2: Train troops if pool has room
  const aiBarrCap = barracksCapacity(curAiBldgs.barracks||0);
  if (curAiPool < aiBarrCap) {
    const trainAmt = Math.min(500, aiBarrCap - curAiPool);
    const cost = {stone:trainAmt*2, wood:trainAmt*2, ore:trainAmt, gas:Math.floor(trainAmt*0.5)};
    if (Object.entries(cost).every(([k,v]) => (curAiRss[k]||0) >= v)) {
      setAiRss(p => ({stone:p.stone-cost.stone, wood:p.wood-cost.wood, ore:p.ore-cost.ore, gas:p.gas-cost.gas}));
      setAiBarracksPool(p => Math.min(aiBarrCap, p + trainAmt));
      return;
    }
  }

  // ACTION 3: Upgrade a building (AI upgrades are instant — no timer for AI)
  const upgPriority = ["quarry","lumber","forge","barracks","training","refinery","commandcenter","walls"];
  for (const bType of upgPriority) {
    const curLvl = curAiBldgs[bType]||0;
    const avail = maxAvailLevel(bType, curAiBldgs.hq||1);
    if (curLvl >= avail) continue;
    const cost = upgCost(bType, curLvl);
    if (!Object.entries(cost).every(([k,v]) => (curAiRss[k]||0) >= v)) continue;
    setAiRss(p => Object.fromEntries(Object.entries(p).map(([k,v]) => [k, v-(cost[k]||0)])));
    setAiBldgs(p => {
      const next = {...p, [bType]: (p[bType]||0)+1};
      if (bType === "barracks") setAiBarracksPool(pool => Math.min(barracksCapacity(next.barracks), pool));
      return next;
    });
    return;
  }
}, 5000);
return () => clearInterval(id);
}, [screen, aiFaction]);

useEffect(() => {
if (screen!=="game") return;
const id = setInterval(() => {
const tentLvl = bldgs.healingtent || 0;
if (tentLvl < 1) return;
const healRate = tentLvl * 5;
setWounded(w => {
if (w <= 0) return 0;
const healed = Math.min(w, healRate);
setBarracks(pool => Math.min(barracksCapacity(bldgs.barracks||0), pool + healed));
return Math.max(0, w - healed);
});
}, 1000);
return () => clearInterval(id);
}, [screen, bldgs.healingtent]);

// Training queue tick — runs every second, delivers troops at trainRate(lvl)/s
useEffect(() => {
if (screen!=="game") return;
const id = setInterval(() => {
setTrainingQueue(q => {
if (!q) return null;
const rate = trainRate(bldgs.training||0);
const delivered = Math.min(q.remaining, rate);
const newRemaining = q.remaining - delivered;
setBarracks(pool => Math.min(barracksCapacity(bldgs.barracks||0), pool + delivered));
if (newRemaining <= 0) return null;
return {...q, remaining: newRemaining};
});
}, 1000);
return () => clearInterval(id);
}, [screen, bldgs.training, bldgs.barracks]);

// Tile deletion countdown — single interval handles all queued deletions in parallel
useEffect(() => {
if (Object.keys(deletingTiles).length === 0) return;
const id = setInterval(() => {
  const now = Date.now();
  const expired = [];
  const newSecs = {};
  Object.entries(deletingTiles).forEach(([key, startedAt]) => {
    const elapsed = now - startedAt;
    newSecs[key] = Math.max(0, Math.ceil((15000 - elapsed) / 1000));
    if (elapsed >= 15000) expired.push(key);
  });
  setDeletingSecsLeft(newSecs);
  if (expired.length > 0) {
    // Reset each expired tile to neutral
    setTiles(p => {
      const next = {...p};
      expired.forEach(key => {
        const t = next[key];
        if (!t || t.owner !== "player") return;
        const pl = t.powerLevel || 1;
        const pd = POWER_DEFS[pl];
        next[key] = {
          ...t,
          owner: null,
          garrison: pd ? pd.troops : 50,
          siege: t.siegeMax ?? SIEGE_BASE,
          siegeMax: t.siegeMax ?? SIEGE_BASE,
          garrisonDefeated: false,
          resetAt: null,
          defCmd: pd ? { lvl: pd.cmdLvl, troops: pd.troops, troopType: TROOP_KEYS[0], atk: 80, spd: 40 } : null,
        };
      });
      return next;
    });
    // Evict any commanders standing on the abandoned tiles — march them to HQ
    const hqKey = `${HQP.player.c},${HQP.player.r}`;
    setCmds(prev => prev.map(cmd => {
      if (cmd.owner !== "player" || !expired.includes(cmd.tk) || cmd.tk === hqKey) return cmd;
      if (cmd.march) return cmd; // already marching
      const retreatPath = bfsPath(cmd.tk, hqKey);
      const stepMs = marchStepMs(effectiveMarchSpd(cmd.spd || 60, null));
      if (retreatPath && retreatPath.length >= 2) {
        return {...cmd, march: { type:"move", path:retreatPath, step:0, dest:hqKey, origin:cmd.tk, stepMs, lastStepTime:Date.now() }};
      }
      return {...cmd, tk: hqKey}; // fallback teleport
    }));
    expired.forEach(key => floaty("🏳 Tile abandoned", "#a08060", key));
    setDeletingTiles(prev => {
      const next = {...prev};
      expired.forEach(key => delete next[key]);
      return next;
    });
    setDeletingSecsLeft(prev => {
      const next = {...prev};
      expired.forEach(key => delete next[key]);
      return next;
    });
  }
}, 250);
return () => clearInterval(id);
}, [deletingTiles]);

// March tick — advances marching commanders step by step
useEffect(() => {
if (screen !== "game") return;
const id = setInterval(() => {
const now = Date.now();
setCmds(prev => {
let changed = false;
const next = prev.map(cmd => {
if (!cmd.march) return cmd;
const m = cmd.march;
const elapsed = now - m.lastStepTime;
if (elapsed < m.stepMs) return cmd;
const nextStep = m.step + 1;
// arrived at destination
if (nextStep >= m.path.length) {
changed = true;
const dest = m.path[m.path.length - 1];
if (m.type === "attack") {
// battle fires via separate effect watching for arrived attack marches
return {...cmd, tk: dest, march: {...m, step: nextStep, arrived: true}};
}
return {...cmd, tk: dest, march: null};
}
changed = true;
return {...cmd, tk: m.path[nextStep], march: {...m, step: nextStep, lastStepTime: now}};
});
return changed ? next : prev;
});
}, 100);
return () => clearInterval(id);
}, [screen]);

// Attack arrival — fire battle when a PLAYER attack march arrives
useEffect(() => {
if (screen !== "game") return;
const arrivedAttackers = cmds.filter(c => c.owner === "player" && c.march?.arrived && c.march?.type === "attack");
if (!arrivedAttackers.length) return;
arrivedAttackers.forEach(cmd => {
const destKey = cmd.tk;
const defTile = tiles[destKey];
if (!defTile || defTile.owner === "player") {
// tile already captured or owned — just clear march
setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march: null} : c));
return;
}
// Bounce check — if the player no longer owns any tile adjacent to the target,
// the attack has no valid foothold (e.g. the origin tile was deleted mid-march)
const [dc, dr] = destKey.split(",").map(Number);
const hasFoothold = adj(dc, dr).some(k => tiles[k]?.owner === "player");
if (!hasFoothold) {
const hqKey = `${HQP.player.c},${HQP.player.r}`;
const stepMs = marchStepMs(effectiveMarchSpd(cmd.spd || 60, cmd.troopType));
const retreatPath = bfsPath(destKey, hqKey);
setCmds(p => p.map(c => {
  if (c.uid !== cmd.uid) return c;
  if (retreatPath && retreatPath.length >= 2) {
    return {...c, march: { type:"move", path:retreatPath, step:0, dest:hqKey, origin:destKey, stepMs, lastStepTime:Date.now() }};
  }
  return {...c, tk: hqKey, march: null};
}));
floaty("⚠ No foothold — retreating", "#cc8030", destKey);
return;
}
// If garrison is defeated, skip battle — just apply siege damage
if (defTile.garrisonDefeated) {
const newTroops = cmd.troops || 0;
const siegePower = calcSiegePower(newTroops, cmd.troopType);
const currentSiege = defTile.siege ?? SIEGE_BASE;
const originKey2 = cmd.march?.origin || `${HQP.player.c},${HQP.player.r}`;
let siegeCaptured = false;
if (siegePower >= currentSiege) {
siegeCaptured = true;
setTiles(p => ({...p, [destKey]: {
...p[destKey],
owner:"player", garrison:0,
siege: defTile.siegeMax ?? SIEGE_BASE,
garrisonDefeated: false, resetAt: null,
}}));
setGems(g => g + 8);
floaty("⚔ CAPTURED!", "#3daa60", destKey);
if (destKey === WIN_KEY) setWinner("player");
} else {
setTiles(p => ({...p, [destKey]: {
...p[destKey],
siege: currentSiege - siegePower,
resetAt: Date.now() + SIEGE_RESET_MS,
}}));
floaty(`🔨 SIEGE ${currentSiege - siegePower}/${defTile.siegeMax??SIEGE_BASE}`, "#d0a030", destKey);
}
// Return to origin unless we just captured the tile
const returnTk = siegeCaptured ? destKey : originKey2;
setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march: null, tk: returnTk} : c));
return;
}
const wallLvl = bldgs.walls || 0;
const originKey = cmd.march?.origin || `${HQP.player.c},${HQP.player.r}`;
const hqKey = `${HQP.player.c},${HQP.player.r}`;
// Live check: AI commander is "present" only if idle on this exact tile right now
const hasAiCmd = cmds.some(c => c.owner === "ai" && c.tk === destKey && !c.march);
// If no AI commander present, fight the power-level garrison instead of stale defCmd
const effectiveDefTile = hasAiCmd ? defTile : {...defTile, defCmd: garrisonDefCmd(defTile)};

// ── Stage 1: Fight whoever is on the tile (AI commander or garrison) ──
const res = simBattle(cmd, cmd.troops || 50, effectiveDefTile, wallLvl);
const troopsAfterS1 = res.won ? Math.max(0, (cmd.troops || 0) - res.lost) : 0;

// ── Handle Stage 1 loss ──
if (!res.won) {
  floaty("💀 DEFEATED — retreating", "#cc3030", destKey);
  setCmds(p => p.map(c => {
    if (c.uid !== cmd.uid) return c;
    let updated = {...c, troops: 0, tk: originKey, march: null};
    const retreatPath = bfsPath(originKey, hqKey);
    if (retreatPath && retreatPath.length >= 2) {
      const stepMs = marchStepMs(effectiveMarchSpd(c.spd || 60, null));
      updated = {...updated, march: {type:"move", path:retreatPath, step:0, dest:hqKey, origin:originKey, stepMs, lastStepTime:Date.now()}};
    } else { updated = {...updated, tk: hqKey}; }
    if (!res.xpGain) return updated;
    let newXp = (updated.xp||0) + res.xpGain, newLvl = updated.lvl||5, leveled = false;
    while (newLvl < CMD_LVL_MAX) { const needed = xpToNext(newLvl); if (newXp >= needed) { newXp -= needed; newLvl++; leveled = true; } else break; }
    if (newLvl >= CMD_LVL_MAX) newXp = 0;
    if (leveled) floaty(`⬆ Lv${newLvl}!`, "#f0c040", originKey);
    return {...updated, xp: newXp, lvl: newLvl};
  }));
  if (res.report) { setBattles(p => [res.report, ...p].slice(0, 99)); setSelectedBattle(0); setUnseenBattles(n => n + 1); }
  setBLog(p => [`❌ ${cmd.n} Lv${cmd.lvl||5}${cmd.troopType?" "+TROOP[cmd.troopType].icon:""} defeated — retreating to HQ · ${res.modLabel}`, ...p].slice(0, 99));
  return;
}

// ── Stage 1 won ──
if (res.report) { setBattles(p => [res.report, ...p].slice(0, 99)); setSelectedBattle(0); setUnseenBattles(n => n + 1); }

// ── Stage 2: If AI commander was present, now fight the tile's original garrison ──
let finalTroops = troopsAfterS1;
let res2 = null;
if (hasAiCmd) {
  floaty("⚔ Commander routed — garrison defends!", "#d0a030", destKey);
  const plvl = defTile.powerLevel || 1;
  const pd2 = POWER_DEFS[plvl] || POWER_DEFS[1];
  const garrisonTile = {
    ...defTile,
    defCmd: {
      lvl:   pd2.cmdLvl,
      troops: defTile.garrisonTroops || pd2.troops,
      troopType: defTile.troopType,
      atk:  80 + pd2.cmdLvl * 8,
      spd:  30 + pd2.cmdLvl * 3,
    },
  };
  res2 = simBattle({...cmd, troops: troopsAfterS1}, troopsAfterS1, garrisonTile, wallLvl);
  finalTroops = res2.won ? Math.max(0, troopsAfterS1 - res2.lost) : 0;

  if (!res2.won) {
    // Lost to garrison — clear AI commander, start reset timer, retreat
    floaty("💀 DEFEATED by garrison — retreating", "#cc3030", destKey);
    setTiles(p => ({...p, [destKey]: {
      ...p[destKey],
      defCmd: null, hasAiCommander: false,
      garrisonDefeated: true, resetAt: Date.now() + SIEGE_RESET_MS,
    }}));
    setCmds(p => p.map(c => {
      if (c.uid !== cmd.uid) return c;
      let updated = {...c, troops: 0, tk: originKey, march: null};
      const retreatPath = bfsPath(originKey, hqKey);
      if (retreatPath && retreatPath.length >= 2) {
        const stepMs = marchStepMs(effectiveMarchSpd(c.spd || 60, null));
        updated = {...updated, march: {type:"move", path:retreatPath, step:0, dest:hqKey, origin:originKey, stepMs, lastStepTime:Date.now()}};
      } else { updated = {...updated, tk: hqKey}; }
      if (!res2.xpGain) return updated;
      let newXp = (updated.xp||0) + res2.xpGain, newLvl = updated.lvl||5, leveled = false;
      while (newLvl < CMD_LVL_MAX) { const needed = xpToNext(newLvl); if (newXp >= needed) { newXp -= needed; newLvl++; leveled = true; } else break; }
      if (newLvl >= CMD_LVL_MAX) newXp = 0;
      if (leveled) floaty(`⬆ Lv${newLvl}!`, "#f0c040", originKey);
      return {...updated, xp: newXp, lvl: newLvl};
    }));
    if (res2.report) { setBattles(p => [res2.report, ...p].slice(0, 99)); setUnseenBattles(n => n + 1); }
    setBLog(p => [`❌ ${cmd.n} defeated by garrison after routing commander · ${res2.modLabel}`, ...p].slice(0, 99));
    return;
  }
  if (res2.report) { setBattles(p => [res2.report, ...p].slice(0, 99)); setUnseenBattles(n => n + 1); }
}

// ── Both stages won — now check siege ──
const siegePower = calcSiegePower(finalTroops, cmd.troopType);
const currentSiege = defTile.siege ?? SIEGE_BASE;
let tileCaptured = false;

if (siegePower >= currentSiege) {
  tileCaptured = true;
  setTiles(p => ({...p, [destKey]: {
    ...p[destKey],
    owner:"player", garrison:0,
    siege: defTile.siegeMax ?? SIEGE_BASE,
    garrisonDefeated: false, resetAt: null,
    defCmd: null, hasAiCommander: false,
  }}));
  setGems(g => g + 8);
  floaty("⚔ CAPTURED!", "#3daa60", destKey);
  if (destKey === WIN_KEY) setWinner("player");
} else {
  const newSiege = currentSiege - siegePower;
  setTiles(p => ({...p, [destKey]: {
    ...p[destKey],
    siege: newSiege,
    garrisonDefeated: true,
    resetAt: Date.now() + SIEGE_RESET_MS,
    defCmd: null, hasAiCommander: false,
  }}));
  floaty(`⚔ SIEGE ${newSiege}/${defTile.siegeMax??SIEGE_BASE} — not captured`, "#d0a030", destKey);
}

const wc = Math.floor(((cmd.troops||0) - finalTroops) * 0.30);
if (wc > 0) { setWounded(w => w + wc); floaty(`🏥 +${wc} wounded`, "#88aaff", destKey); }

const finalTk = tileCaptured ? destKey : originKey;
setCmds(p => p.map(c => {
  if (c.uid !== cmd.uid) return c;
  let updated = {...c, troops: finalTroops, tk: finalTk, march: null};
  const xpSrc = res2 || res;
  if (!xpSrc.xpGain) return updated;
  let newXp = (updated.xp||0) + xpSrc.xpGain, newLvl = updated.lvl||5, leveled = false;
  while (newLvl < CMD_LVL_MAX) { const needed = xpToNext(newLvl); if (newXp >= needed) { newXp -= needed; newLvl++; leveled = true; } else break; }
  if (newLvl >= CMD_LVL_MAX) newXp = 0;
  if (leveled) floaty(`⬆ Lv${newLvl}!`, "#f0c040", finalTk);
  return {...updated, xp: newXp, lvl: newLvl};
}));
const stageLabel = hasAiCmd ? " (2-stage)" : "";
setBLog(p => [
  `✅ ${cmd.n} Lv${cmd.lvl||5}${cmd.troopType?" "+TROOP[cmd.troopType].icon:""}${stageLabel} ${tileCaptured?"captured tile":"siege dealt"} · ${res.modLabel}`,
  ...p
].slice(0, 99));
});

}, [cmds, screen]);

// AI attack arrival — fire battle when an AI attack march arrives
useEffect(() => {
if (screen !== "game") return;
const arrivedAI = cmds.filter(c => c.owner === "ai" && c.march?.arrived && c.march?.type === "attack");
if (!arrivedAI.length) return;
arrivedAI.forEach(cmd => {
  const destKey = cmd.tk;
  const defTile = tiles[destKey];
  // Already ours or invalid — clear march
  if (!defTile || defTile.owner === "ai") {
    setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march: null} : c));
    return;
  }
  // Adjacency check — AI must have a foothold
  const [dc, dr] = destKey.split(",").map(Number);
  const hasFoothold = adj(dc, dr).some(k => tiles[k]?.owner === "ai");
  if (!hasFoothold) {
    setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march: null, tk: AI_HQ_KEY} : c));
    return;
  }
  // If garrison already defeated, apply siege only
  if (defTile.garrisonDefeated) {
    const siegePower = calcSiegePower(cmd.troops||0, cmd.troopType);
    const currentSiege = defTile.siege ?? SIEGE_BASE;
    if (siegePower >= currentSiege) {
      const isPlayerHQ = defTile.isHQ && defTile.owner === "player";
      setTiles(p => ({...p, [destKey]:{...p[destKey], owner:"ai", garrison:0,
        siege: defTile.siegeMax ?? SIEGE_BASE, garrisonDefeated:false, resetAt:null,
        defCmd:{ lvl:cmd.lvl||5, troops:Math.floor((cmd.troops||0)*0.6), troopType:cmd.troopType||TROOP_KEYS[0], atk:(cmd.atk||150), spd:(cmd.spd||60) }
      }}));
      floaty("⚠ ENEMY CAPTURED TILE!", "#dd3322", destKey);
      if (destKey === WIN_KEY || isPlayerHQ) setWinner("ai");
      setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march:null} : c));
    } else {
      setTiles(p => ({...p, [destKey]:{...p[destKey], siege:currentSiege-siegePower, resetAt:Date.now()+SIEGE_RESET_MS}}));
      setCmds(p => p.map(c => c.uid === cmd.uid ? {...c, march:null, tk:cmd.march?.origin||AI_HQ_KEY} : c));
    }
    return;
  }
  // Full battle
  const wallLvl = defTile.owner === "player" && defTile.isHQ ? (bldgs.walls||0) : 0;
  const res = simBattle(cmd, cmd.troops||50, defTile, wallLvl);
  const newTroops = res.won ? Math.max(0, (cmd.troops||0) - res.lost) : 0;
  const originKey = cmd.march?.origin || AI_HQ_KEY;
  let tileCaptured = false;
  if (res.won) {
    const siegePower = calcSiegePower(newTroops, cmd.troopType);
    const currentSiege = defTile.siege ?? SIEGE_BASE;
    if (siegePower >= currentSiege) {
      tileCaptured = true;
      const isPlayerHQ = defTile.isHQ && defTile.owner === "player";
      setTiles(p => ({...p, [destKey]:{...p[destKey], owner:"ai", garrison:0,
        siege: 300, siegeMax: 300, garrisonDefeated:false, resetAt:null,
        hasAiCommander: true,
        defCmd:{ lvl:cmd.lvl||5, troops:Math.floor(newTroops*0.6), troopType:cmd.troopType||TROOP_KEYS[0], atk:(cmd.atk||150), spd:(cmd.spd||60) }
      }}));
      floaty("⚠ ENEMY CAPTURED TILE!", "#dd3322", destKey);
      if (destKey === WIN_KEY || isPlayerHQ) setWinner("ai");
    } else {
      setTiles(p => ({...p, [destKey]:{...p[destKey], siege:currentSiege-siegePower, garrisonDefeated:true, resetAt:Date.now()+SIEGE_RESET_MS}}));
    }
  }
  const finalTk = tileCaptured ? destKey : originKey;
  setCmds(p => p.map(c => {
    if (c.uid !== cmd.uid) return c;
    let updated = {...c, troops: newTroops, tk: finalTk, march: null};
    if (!res.won) {
      const retreatPath = bfsPath(finalTk, AI_HQ_KEY);
      if (retreatPath && retreatPath.length >= 2) {
        const stepMs = marchStepMs(effectiveMarchSpd(c.spd||60, null));
        updated = {...updated, march:{type:"move",path:retreatPath,step:0,dest:AI_HQ_KEY,origin:finalTk,stepMs,lastStepTime:Date.now()}};
      } else {
        updated = {...updated, tk: AI_HQ_KEY};
      }
    }
    // XP gain
    if (!res.xpGain) return updated;
    let newXp = (updated.xp||0) + res.xpGain, newLvl = updated.lvl||5;
    while (newLvl < CMD_LVL_MAX) {
      const needed = xpToNext(newLvl);
      if (newXp >= needed) { newXp -= needed; newLvl++; } else break;
    }
    if (newLvl >= CMD_LVL_MAX) newXp = 0;
    return {...updated, xp: newXp, lvl: newLvl};
  }));
  setBLog(p => [
    `${res.won?"🔴":"✅"} ENEMY ${cmd.n} Lv${cmd.lvl||5} ${res.won?"captured":"repelled"} tile`,
    ...p
  ].slice(0, 99));
});
}, [cmds, screen, tiles, bldgs.walls]); // floaty omitted — defined later, stable via closure


/* ══════════════════════════════════════════════════
ACTIONS (defined before onTileClick — referenced there)
══════════════════════════════════════════════════ */
const floaty = useCallback((txt, col, k) => {
const [fc, fr] = k.split(",").map(Number);
const tile = tilesRef.current[k];
const { cx, cy } = isoXY(fc, fr);
const elev = tile?.isHQ ? 14 : tile?.isWin ? 10 : 4;
const screenX = cx * zoomRef.current + panRef.current.x;
const screenY = (cy - elev) * zoomRef.current + panRef.current.y + 38;
const id = Date.now()+Math.random();
setFloats(f => [...f, {id,txt,col,x:screenX,y:screenY}]);
setTimeout(() => setFloats(f => f.filter(x => x.id!==id)), 1800);
}, []);

// Siege reset timer — restores defeated garrisons after 60s
useEffect(() => {
if (screen !== "game") return;
const id = setInterval(() => {
const now = Date.now();
setTiles(prev => {
let changed = false;
const next = {...prev};
Object.values(next).forEach(tile => {
if (tile.garrisonDefeated && tile.resetAt && now >= tile.resetAt) {
changed = true;
next[tile.k] = {
...tile,
siege: tile.siegeMax,
garrisonDefeated: false,
resetAt: null,
};
}
});
return changed ? next : prev;
});
}, 1000);
return () => clearInterval(id);
}, [screen]);
useEffect(() => {
if (screen !== "game") return;
const id = setInterval(() => {
const now = Date.now();
setReinMarches(prev => {
if (!prev.length) return prev;
const next = [];
prev.forEach(rm => {
const elapsed = now - rm.lastStepTime;
if (elapsed < rm.stepMs) { next.push(rm); return; }
const nextStep = rm.step + 1;
if (nextStep >= rm.path.length) {
setCmds(cmds => cmds.map(c => c.uid === rm.cmdUid
? {...c, troops: (c.troops||0) + rm.amount}
: c));
floaty(`+${rm.amount} reinforcements arrived!`, "#88aaff", rm.path[rm.path.length-1]);
} else {
next.push({...rm, step: nextStep, lastStepTime: now});
}
});
return next;
});
}, 100);
return () => clearInterval(id);
}, [screen, floaty]);

const startMarch = useCallback((cmd, destKey) => {
if (!cmd || !destKey || cmd.march) return;
if (!cmd.troops || cmd.troops < 1) { floaty("⚠ Assign troops first!", "#cc8030", cmd.tk); return; }
const destTile = tiles[destKey];
const type = destTile?.owner === "player" ? "move" : "attack";
// Move marches can only go to player-owned tiles
if (type === "move" && destTile?.owner !== "player") return;
const path = bfsPath(cmd.tk, destKey);
if (!path || path.length < 2) return;
const stepMs = marchStepMs(effectiveMarchSpd(cmd.spd || 60, cmd.troopType));
setCmds(p => p.map(c => c.uid === cmd.uid ? {
...c,
march: { type, path, step: 0, dest: destKey, origin: cmd.tk, stepMs, lastStepTime: Date.now() }
} : c));
setMode("view"); setMvCmd(null); setSelKey(null); setPopupPos(null);
}, [tiles, floaty]);

const recallMarch = useCallback((uid) => {
setCmds(prev => {
const cmd = prev.find(c => c.uid === uid);
if (!cmd?.march) return prev;
const m = cmd.march;
const reversePath = [...m.path.slice(0, m.step + 1)].reverse();
if (reversePath.length < 2) {
return prev.map(c => c.uid === uid ? {...c, march: null} : c);
}
return prev.map(c => c.uid === uid ? {
...c,
march: { type:"move", path: reversePath, step: 0, dest: m.origin, origin: cmd.tk, stepMs: m.stepMs, lastStepTime: Date.now() }
} : c);
});
}, []);

const recallStationary = useCallback((uid) => {
setCmds(prev => {
const cmd = prev.find(c => c.uid === uid);
if (!cmd || cmd.march) return prev; // only for idle commanders
const hqKey = `${HQP.player.c},${HQP.player.r}`;
if (cmd.tk === hqKey) return prev; // already at HQ
const path = bfsPath(cmd.tk, hqKey);
if (!path || path.length < 2) return prev;
const stepMs = marchStepMs(effectiveMarchSpd(cmd.spd || 60, cmd.troopType));
return prev.map(c => c.uid === uid ? {
...c,
march: { type:"move", path, step:0, dest:hqKey, origin:cmd.tk, stepMs, lastStepTime:Date.now() }
} : c);
});
}, []);

const startReinforcement = useCallback((cmd, amount) => {
if (!cmd || amount <= 0) return;
const hqKey = `${HQP.player.c},${HQP.player.r}`;
const path = bfsPath(hqKey, cmd.tk);
if (!path || path.length < 2) return;
setBarracks(pool => Math.max(0, pool - amount));
const effSpd = effectiveMarchSpd(cmd.spd || 60, cmd.troopType);
const stepMs = Math.max(100, Math.floor(marchStepMs(effSpd) / 2));
setReinMarches(prev => [...prev, {
uid: `rein_${Date.now()}`, cmdUid: cmd.uid, amount,
path, step: 0, stepMs, lastStepTime: Date.now()
}]);
setMode("view"); setReinCmd(null);
setSliderVals(v => ({...v, [`rein_${cmd.uid}`]: undefined}));
}, []);

const onTileClick = useCallback((k, e) => {
if (e?.stopPropagation) e.stopPropagation();
const tile = tiles[k];
if (!tile) return;

if (mode === "selectMarchDest" && mvCmd) {
  if (k === mvCmd.tk) { setMode("view"); setMvCmd(null); return; }
  if (tile.owner !== "player") { floaty("⚠ Can only move to owned tiles", "#cc8030", k); return; }
  startMarch(mvCmd, k);
  return;
}

if (tile.isHQ && tile.owner === "player") {
  setHqOpen(true); setMode("view"); setSelKey(null); setPopupPos(null); setAtkKey(null); setPick(null); return;
}

const vis = TERR_VIS[tile.terrain] || TERR_VIS.grass;
const elev = tile.isHQ ? 14 : tile.isWin ? 10 : 4;
const {cx, cy} = isoXY(tile.c, tile.r);
const screenX = cx * zoom + panRef.current.x;
const screenY = (cy - elev) * zoom + panRef.current.y + 38;
const POPUP_W = 180, POPUP_H = 160;
const px = Math.min(window.innerWidth - POPUP_W - 8, Math.max(8, screenX - POPUP_W/2));
const py = Math.max(46, screenY - POPUP_H - 16);

setSelKey(k);
setPopupPos({x: px, y: py});
setPopupMode("main");
setEditArmyCmd(null);
setMode("view"); setAtkKey(null); setPick(null); setMvCmd(null); setReinCmd(null);

}, [tiles, mode, mvCmd, startMarch, zoom, floaty]);

/* ══════════════════════════════════════════════════
COMPUTED
══════════════════════════════════════════════════ */
const pKeys = useMemo(() =>
new Set(Object.keys(tiles).filter(k => tiles[k]?.owner==="player")),
[tiles]);

const cByTile = useMemo(() => {
const m = {};
cmds.forEach(c => { if (c.tk) { m[c.tk]=m[c.tk]||[]; m[c.tk].push(c); } });
return m;
}, [cmds]);

const selTile  = selKey ? tiles[selKey] : null;
const atkTile  = atkKey ? tiles[atkKey] : null;
const panelOpen = (mode==="selectMarchDest"||mode==="reinforce") && !hqOpen;

const cmdsOnSel = useMemo(() =>
selKey ? (cByTile[selKey]||[]).filter(c => c.owner==="player") : [],
[selKey, cByTile]);

const selAdjToPlayer = useMemo(() => {
if (!selTile || selTile.owner==="player") return false;
return adj(selTile.c, selTile.r).some(ak => tiles[ak]?.owner==="player");
}, [selTile, tiles]);

const cmdsAdjToSel = useMemo(() => {
if (!selAdjToPlayer) return [];
return cmds.filter(cmd =>
cmd.owner === "player" &&
cmd.tk &&
(cmd.troops||0) > 0 &&
!cmd.march
);
}, [selAdjToPlayer, cmds]);

const canAtk = !!(selTile && selTile.owner!=="player" && selAdjToPlayer);

const marchingToSel = useMemo(() =>
selKey ? cmds.filter(c => c.march?.dest === selKey && c.owner === "player") : [],
[selKey, cmds]);

const pull = useCallback(n => {
const cost = n===1?160:1400;
if (gems<cost) return;
setGems(g => g-cost);
const alignFactions = ALIGNMENT[playerAlignment]?.factions;
const res = rollGacha(n, alignFactions);
setGRes(res); setShowG(true);
const hqk = `${HQP.player.c},${HQP.player.r}`;
setCmds(p => {
const nx = [...p];
res.forEach(h => { if (!nx.find(x=>x.id===h.id)) nx.push({...h, uid:h.uid, troops:0, troopType:null, tk:hqk, owner:"player", lvl:5, xp:0}); });
return nx;
});
setColl(p => { const nx=[...p]; res.forEach(h=>{if(!nx.find(x=>x.id===h.id))nx.push(h);}); return nx; });
}, [gems, playerAlignment]);

const canAfford = useCallback(c =>
Object.entries(c).every(([k,v]) => (rss[k]||0)>=v),
[rss]);

const queueTraining = useCallback((amount) => {
if (trainingQueue) return; // queue already active
const cap = barracksCapacity(bldgs.barracks||0);
if (barracksPool + amount > cap) return; // would exceed capacity
const cost = {stone: amount*2, wood: amount*2, ore: amount, gas: Math.floor(amount*0.5)};
if (!canAfford(cost)) return;
setRss(p => ({stone:p.stone-cost.stone, wood:p.wood-cost.wood, ore:p.ore-cost.ore, gas:p.gas-cost.gas}));
setTrainingQueue({amount, remaining: amount, total: amount, cost});
}, [canAfford, bldgs.barracks, barracksPool, trainingQueue]);

const assignTroops = useCallback((uid, troopType, newTotal) => {
setCmds(prev => {
const cmd = prev.find(c => c.uid===uid);
if (!cmd) return prev;
const commandCap = cmdCommand(cmd.lvl||5, bldgs.commandcenter||0);
const oldTroops = (cmd.troopType && cmd.troopType !== troopType) ? 0 : (cmd.troops||0);
const oldReturning = (cmd.troopType && cmd.troopType !== troopType) ? (cmd.troops||0) : 0;
const capped = Math.min(newTotal, commandCap);
const canDraw = barracksPool + oldReturning;
const delta = capped - oldTroops;
const finalTotal = delta > 0
? oldTroops + Math.min(delta, canDraw)
: capped;
setBarracks(pool => {
const poolAfterReturn = pool + oldReturning;
const drawn = Math.max(0, finalTotal - oldTroops);
const returned = Math.max(0, oldTroops - finalTotal);
return poolAfterReturn - drawn + returned;
});
return prev.map(c => c.uid===uid ? {...c, troopType, troops: finalTotal} : c);
});
}, [barracksPool, bldgs.commandcenter]);

const returnTroops = useCallback((uid) => {
setCmds(prev => {
const cmd = prev.find(c => c.uid===uid);
if (!cmd || !cmd.troops) return prev;
const returning = cmd.troops || 0;
setBarracks(pool => pool + returning);
return prev.map(c => c.uid===uid ? {...c, troops:0, troopType:null} : c);
});
}, []);

const doReinforce = useCallback((uid, amount) => {
setCmds(prev => {
const cmd = prev.find(c => c.uid===uid);
if (!cmd || !cmd.troopType) return prev;
const commandCap = cmdCommand(cmd.lvl||5, bldgs.commandcenter||0);
const room = commandCap - (cmd.troops||0);
const actual = Math.min(amount, barracksPool, room);
if (actual <= 0) return prev;
setBarracks(pool => Math.max(0, pool - actual));
return prev.map(c => c.uid===uid ? {...c, troops:(c.troops||0)+actual} : c);
});
}, [barracksPool, bldgs.commandcenter]);

// Upgrade completion ticker — checks every 500ms
useEffect(() => {
if (screen !== "game") return;
const id = setInterval(() => {
  const now = Date.now();
  setUpgQueue(q => {
    const done = Object.entries(q).filter(([,v]) => v.endsAt <= now);
    if (!done.length) return q;
    done.forEach(([type, {newLvl}]) => {
      setBldgs(p => {
        const next = {...p, [type]: newLvl};
        if (type === "barracks") setBarracks(pool => Math.min(pool, barracksCapacity(newLvl)));
        return next;
      });
    });
    return Object.fromEntries(Object.entries(q).filter(([,v]) => v.endsAt > now));
  });
}, 500);
return () => clearInterval(id);
}, [screen]);

const upgrade = useCallback(type => {
const lvl = bldgs[type]||0;
const hqLvl = bldgs.hq||1;
const avail = maxAvailLevel(type, hqLvl);
if (lvl >= avail) return;
if (upgQueue[type]) return; // already building
const c = upgCost(type, lvl);
if (!canAfford(c)) return;
const dur = upgDuration(type, lvl + 1);
setRss(p => Object.fromEntries(Object.entries(p).map(([k,v]) => [k, v-(c[k]||0)])));
setUpgQueue(q => ({...q, [type]: {endsAt: Date.now()+dur, startedAt: Date.now(), newLvl: lvl+1, dur}}));
}, [bldgs, canAfford, upgQueue]);

/* ══════════════════════════════════════════════════
TITLE
══════════════════════════════════════════════════ */
if (screen==="title") return (
<div style={{position:"relative",width:"100vw",height:"100vh",background:"radial-gradient(ellipse at 50% 45%, #3a1a08 0%, #1a0a04 55%, #0a0502 100%)",overflow:"hidden"}}>
<style>{CSS}</style>

  {/* Local keyframes for floating coins */}
  <style>{`
    @keyframes coinDrift {
      0%   { transform: translate3d(0, 105vh, 0) rotate(0deg); opacity: 0; }
      6%   { opacity: 1; }
      94%  { opacity: 1; }
      100% { transform: translate3d(var(--drift), -20vh, 0) rotate(1080deg); opacity: 0; }
    }
    @keyframes coinSpin {
      0%   { transform: scaleX(1); }
      50%  { transform: scaleX(0.2); }
      100% { transform: scaleX(1); }
    }
    @keyframes coinBurst {
      0%   { transform: translate3d(0, 0, 0) rotate(0deg) scale(0.4); opacity: 0; }
      15%  { opacity: 1; }
      100% { transform: translate3d(var(--bx), var(--by), 0) rotate(720deg) scale(1); opacity: 0; }
    }
  `}</style>

  {/* Treasure chest + chalice scene */}
  <svg viewBox="0 0 1000 720" preserveAspectRatio="xMidYMid meet"
       style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:0}}>
    <defs>
      <radialGradient id="halo" cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#ffe080" stopOpacity=".95"/>
        <stop offset=".35" stopColor="#f0a020" stopOpacity=".55"/>
        <stop offset="1" stopColor="#000" stopOpacity="0"/>
      </radialGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a3010"/>
        <stop offset=".5" stopColor="#3a1d08"/>
        <stop offset="1" stopColor="#2a1404"/>
      </linearGradient>
      <linearGradient id="woodLid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6a3a14"/>
        <stop offset="1" stopColor="#3a1d08"/>
      </linearGradient>
      <linearGradient id="iron" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a4a3a"/>
        <stop offset="1" stopColor="#1a1208"/>
      </linearGradient>
      <linearGradient id="goldFace" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fce27a"/>
        <stop offset=".45" stopColor="#f0c040"/>
        <stop offset="1" stopColor="#8a5a10"/>
      </linearGradient>
      <linearGradient id="goldEdge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#a0701a"/>
        <stop offset=".5" stopColor="#fce27a"/>
        <stop offset="1" stopColor="#a0701a"/>
      </linearGradient>
      <radialGradient id="gemShine" cx=".35" cy=".3" r=".7">
        <stop offset="0" stopColor="#ff8a8a"/>
        <stop offset=".55" stopColor="#c01818"/>
        <stop offset="1" stopColor="#5a0606"/>
      </radialGradient>
      <radialGradient id="ruby" cx=".35" cy=".3" r=".75">
        <stop offset="0" stopColor="#ff8a8a"/>
        <stop offset=".55" stopColor="#c01818"/>
        <stop offset="1" stopColor="#5a0606"/>
      </radialGradient>
      <radialGradient id="sapphire" cx=".35" cy=".3" r=".75">
        <stop offset="0" stopColor="#a0c8ff"/>
        <stop offset=".55" stopColor="#2050c8"/>
        <stop offset="1" stopColor="#0a1a4a"/>
      </radialGradient>
      <radialGradient id="emerald" cx=".35" cy=".3" r=".75">
        <stop offset="0" stopColor="#a0f0a8"/>
        <stop offset=".55" stopColor="#1a8a3a"/>
        <stop offset="1" stopColor="#0a3a18"/>
      </radialGradient>
      <radialGradient id="amethyst" cx=".35" cy=".3" r=".75">
        <stop offset="0" stopColor="#e0a8ff"/>
        <stop offset=".55" stopColor="#7028c0"/>
        <stop offset="1" stopColor="#2a0a5a"/>
      </radialGradient>
      <radialGradient id="pearl" cx=".3" cy=".25" r=".8">
        <stop offset="0" stopColor="#fff8e8"/>
        <stop offset=".7" stopColor="#d8c8a0"/>
        <stop offset="1" stopColor="#8a7058"/>
      </radialGradient>
    </defs>

    {/* Glow halo from chalice */}
    <circle cx="500" cy="380" r="400" fill="url(#halo)"/>

    {/* Light rays */}
    <g opacity=".28" style={{mixBlendMode:"screen"}}>
      {Array.from({length:14}).map((_,i)=>{
        const a = (i*(360/14) - 90)*Math.PI/180;
        const x2=500+Math.cos(a)*620, y2=380+Math.sin(a)*620;
        return <line key={i} x1="500" y1="380" x2={x2} y2={y2} stroke="#ffd060" strokeWidth="2"/>;
      })}
    </g>

    {/* Open chest LID (tilted back) */}
    <g transform="translate(500 230) rotate(-7)">
      <path d="M-240 -45 L240 -45 L240 110 L-240 110 Z" fill="url(#woodLid)" stroke="#1a0a04" strokeWidth="3"/>
      <line x1="-240" y1="5" x2="240" y2="5" stroke="#2a1404" strokeWidth="2"/>
      <line x1="-240" y1="55" x2="240" y2="55" stroke="#2a1404" strokeWidth="2"/>
      <rect x="-210" y="-45" width="20" height="155" fill="url(#iron)"/>
      <rect x="190" y="-45" width="20" height="155" fill="url(#iron)"/>
      <rect x="-240" y="-45" width="480" height="14" fill="url(#iron)"/>
      {[-170,-110,-50,10,70,130,180].map(x=>(
        <circle key={x} cx={x} cy="-38" r="3" fill="#3a2818"/>
      ))}
      {/* hinge bolts */}
      <circle cx="-210" cy="105" r="4" fill="#1a1208"/>
      <circle cx="210"  cy="105" r="4" fill="#1a1208"/>
    </g>

    {/* Chest BODY */}
    <g transform="translate(500 540)">
      <path d="M-290 -130 L290 -130 L290 145 L-290 145 Z" fill="url(#wood)" stroke="#1a0a04" strokeWidth="4"/>
      <ellipse cx="0" cy="-130" rx="290" ry="34" fill="#1a0a04"/>
      <ellipse cx="0" cy="-130" rx="266" ry="24" fill="#0a0502"/>
      <ellipse cx="0" cy="-122" rx="248" ry="14" fill="#f0a020" opacity=".75"/>
      {/* Plank seams */}
      <line x1="-290" y1="-50" x2="290" y2="-50" stroke="#1a0a04" strokeWidth="2"/>
      <line x1="-290" y1="25"  x2="290" y2="25"  stroke="#1a0a04" strokeWidth="2"/>
      <line x1="-290" y1="90"  x2="290" y2="90"  stroke="#1a0a04" strokeWidth="2"/>
      {/* Iron bands */}
      <rect x="-250" y="-130" width="22" height="275" fill="url(#iron)" stroke="#0a0502" strokeWidth="1"/>
      <rect x="228"  y="-130" width="22" height="275" fill="url(#iron)" stroke="#0a0502" strokeWidth="1"/>
      <rect x="-290" y="120"  width="580" height="25" fill="url(#iron)" stroke="#0a0502" strokeWidth="1"/>
      {/* Lock plate */}
      <rect x="-34" y="-10" width="68" height="78" fill="url(#iron)" stroke="#0a0502" strokeWidth="2" rx="4"/>
      <circle cx="0" cy="22" r="10" fill="#1a1208"/>
      <rect x="-3" y="22" width="6" height="24" fill="#1a1208"/>
      {/* Iron feet */}
      <rect x="-280" y="140" width="40" height="20" fill="url(#iron)" stroke="#0a0502" strokeWidth="1" rx="3"/>
      <rect x="240"  y="140" width="40" height="20" fill="url(#iron)" stroke="#0a0502" strokeWidth="1" rx="3"/>

      {/* ─── TREASURE INSIDE CHEST ─── */}
      {/* Back row gold pile (deep in chest) */}
      <ellipse cx="-180" cy="-118" rx="34" ry="8"  fill="#f0c040"/>
      <ellipse cx="-110" cy="-122" rx="38" ry="9"  fill="#fce27a"/>
      <ellipse cx="-30"  cy="-118" rx="40" ry="10" fill="#f0c040"/>
      <ellipse cx="60"   cy="-124" rx="44" ry="9"  fill="#fce27a"/>
      <ellipse cx="140"  cy="-120" rx="38" ry="8"  fill="#f0c040"/>
      <ellipse cx="200"  cy="-122" rx="30" ry="7"  fill="#fce27a"/>

      {/* Gold bars stacked */}
      <g transform="translate(-200 -110)">
        <rect x="-30" y="-7" width="60" height="14" rx="2" fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <rect x="-26" y="-6" width="52" height="3"  rx="1" fill="#fce27a"/>
        <rect x="-22" y="-18" width="46" height="11" rx="2" fill="#fce27a" stroke="#8a5a10" strokeWidth="1"/>
        <rect x="-18" y="-17" width="38" height="2"  rx="1" fill="#fff2c8"/>
      </g>
      <g transform="translate(180 -108)">
        <rect x="-28" y="-6" width="56" height="13" rx="2" fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <rect x="-24" y="-5" width="48" height="3"  rx="1" fill="#fce27a"/>
      </g>

      {/* Crown — left side */}
      <g transform="translate(-90 -108)">
        <path d="M-30 6 L-30 -8 L-18 4 L-10 -14 L0 4 L10 -14 L18 4 L30 -8 L30 6 Z"
              fill="#fce27a" stroke="#5a3a08" strokeWidth="1.2"/>
        <rect x="-30" y="6" width="60" height="6" fill="#f0c040" stroke="#5a3a08" strokeWidth="1"/>
        <circle cx="-18" cy="-10" r="2.5" fill="url(#ruby)"/>
        <circle cx="0"   cy="-12" r="2.8" fill="url(#emerald)"/>
        <circle cx="18"  cy="-10" r="2.5" fill="url(#sapphire)"/>
      </g>

      {/* Pearl necklace draped over front */}
      <g>
        <path d="M -140 -116 Q -90 -98 -40 -110 Q 10 -120 60 -100 Q 110 -86 160 -110"
              fill="none" stroke="#d8c8a0" strokeWidth="1"/>
        {[[-140,-116],[-122,-110],[-104,-104],[-86,-102],[-66,-104],[-48,-108],[-26,-114],[-6,-118],[14,-116],[36,-110],[58,-100],[78,-94],[100,-92],[122,-96],[144,-104],[160,-110]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r="3" fill="url(#pearl)"/>
        ))}
      </g>

      {/* Big gems on the pile (in front, at chest opening) */}
      <g>
        {/* Ruby */}
        <polygon points="-220,-104 -208,-118 -196,-104 -208,-90"
                 fill="url(#ruby)" stroke="#3a0606" strokeWidth="1.2"/>
        <polygon points="-216,-104 -208,-114 -200,-104 -208,-94"
                 fill="#ffb0b0" opacity=".5"/>

        {/* Sapphire */}
        <polygon points="220,-100 232,-114 244,-100 232,-86"
                 fill="url(#sapphire)" stroke="#0a1a4a" strokeWidth="1.2"/>
        <polygon points="224,-100 232,-110 240,-100 232,-90"
                 fill="#c8e0ff" opacity=".5"/>

        {/* Emerald */}
        <polygon points="-50,-100 -38,-114 -26,-100 -38,-86"
                 fill="url(#emerald)" stroke="#0a3a18" strokeWidth="1.2"/>
        <polygon points="-46,-100 -38,-110 -30,-100 -38,-90"
                 fill="#c0f0c8" opacity=".5"/>

        {/* Amethyst */}
        <polygon points="100,-100 112,-114 124,-100 112,-86"
                 fill="url(#amethyst)" stroke="#2a0a5a" strokeWidth="1.2"/>
        <polygon points="104,-100 112,-110 120,-100 112,-90"
                 fill="#f0c8ff" opacity=".5"/>
      </g>

      {/* Coins spilling over the front edge */}
      <g>
        <circle cx="-244" cy="-110" r="11" fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="-224" cy="-92"  r="9"  fill="#fce27a" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="-200" cy="-72"  r="8"  fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="-180" cy="-50"  r="9"  fill="#fce27a" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="-156" cy="-32"  r="7"  fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>

        <circle cx="232" cy="-105" r="11" fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="252" cy="-86"  r="9"  fill="#fce27a" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="232" cy="-66"  r="8"  fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="250" cy="-46"  r="9"  fill="#fce27a" stroke="#8a5a10" strokeWidth="1"/>
        <circle cx="226" cy="-28"  r="7"  fill="#f0c040" stroke="#8a5a10" strokeWidth="1"/>

        {/* Coins on ground next to chest */}
        <ellipse cx="-260" cy="155" rx="14" ry="3.5" fill="#f0c040" stroke="#8a5a10" strokeWidth=".8"/>
        <ellipse cx="-238" cy="158" rx="11" ry="3"   fill="#fce27a" stroke="#8a5a10" strokeWidth=".8"/>
        <ellipse cx="265"  cy="155" rx="14" ry="3.5" fill="#f0c040" stroke="#8a5a10" strokeWidth=".8"/>
        <ellipse cx="244"  cy="158" rx="11" ry="3"   fill="#fce27a" stroke="#8a5a10" strokeWidth=".8"/>
      </g>
    </g>

    {/* CHALICE - large, prominent, in middle, rising from the treasure */}
    <g transform="translate(500 400)">
      <ellipse cx="0" cy="155" rx="120" ry="14" fill="#000" opacity=".55"/>
      <rect x="-95" y="118" width="190" height="34" rx="6" fill="url(#goldEdge)" stroke="#5a3a08" strokeWidth="2"/>
      <rect x="-82" y="106" width="164" height="14" rx="4" fill="url(#goldEdge)"/>
      <rect x="-22" y="0" width="44" height="118" fill="url(#goldEdge)" stroke="#5a3a08" strokeWidth="2"/>
      <ellipse cx="0" cy="60" rx="34" ry="10" fill="url(#goldEdge)" stroke="#5a3a08" strokeWidth="2"/>
      <ellipse cx="0" cy="0" rx="50" ry="11" fill="url(#goldEdge)" stroke="#5a3a08" strokeWidth="2"/>
      <path d="M-86 -110 Q-86 0 0 0 Q86 0 86 -110 Z" fill="url(#goldFace)" stroke="#5a3a08" strokeWidth="3"/>
      <ellipse cx="0" cy="-110" rx="86" ry="20" fill="#f6d268" stroke="#5a3a08" strokeWidth="3"/>
      <ellipse cx="0" cy="-113" rx="76" ry="14" fill="#3a1606" opacity=".75"/>
      <ellipse cx="-28" cy="-118" rx="28" ry="5" fill="#fff2c8" opacity=".6"/>
      <path d="M-70 -90 Q-54 -28 -10 -6" stroke="#fff2c8" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".5"/>
      <circle cx="0" cy="-58" r="22" fill="url(#gemShine)" stroke="#3a0606" strokeWidth="2"/>
      <circle cx="-7" cy="-65" r="7" fill="#ffd0d0" opacity=".85"/>
    </g>
  </svg>

  {/* Floating coin sparkles drifting upward */}
  <div style={{position:"absolute",inset:0,zIndex:1,pointerEvents:"none",overflow:"hidden"}}>
    {[
      {left:"3%",  size:22, dur:9,   delay:0,    drift:"40px"},
      {left:"8%",  size:16, dur:7,   delay:2.4,  drift:"-30px"},
      {left:"13%", size:20, dur:11,  delay:5.1,  drift:"50px"},
      {left:"18%", size:14, dur:6,   delay:1.2,  drift:"-20px"},
      {left:"23%", size:24, dur:10,  delay:3.6,  drift:"60px"},
      {left:"28%", size:18, dur:8,   delay:0.8,  drift:"-40px"},
      {left:"33%", size:20, dur:9.5, delay:4.2,  drift:"30px"},
      {left:"38%", size:16, dur:7.5, delay:6.0,  drift:"-50px"},
      {left:"43%", size:22, dur:11,  delay:2.0,  drift:"40px"},
      {left:"48%", size:18, dur:8.5, delay:5.5,  drift:"-30px"},
      {left:"53%", size:14, dur:6.5, delay:3.3,  drift:"25px"},
      {left:"58%", size:24, dur:10.5,delay:1.6,  drift:"-45px"},
      {left:"63%", size:18, dur:9,   delay:7.2,  drift:"30px"},
      {left:"68%", size:20, dur:8,   delay:0.4,  drift:"-35px"},
      {left:"73%", size:16, dur:7,   delay:4.8,  drift:"40px"},
      {left:"78%", size:22, dur:10,  delay:2.8,  drift:"-50px"},
      {left:"83%", size:18, dur:9.5, delay:6.5,  drift:"25px"},
      {left:"88%", size:24, dur:11,  delay:1.0,  drift:"-30px"},
      {left:"93%", size:16, dur:7.5, delay:3.9,  drift:"35px"},
      {left:"97%", size:20, dur:9,   delay:5.8,  drift:"-25px"},
    ].map((c,i)=>(
      <div key={i} style={{
        position:"absolute",
        left:c.left,
        bottom:0,
        width:c.size, height:c.size,
        "--drift": c.drift,
        animation:`coinDrift ${c.dur}s linear ${c.delay}s infinite`,
        filter:"drop-shadow(0 0 6px rgba(255,210,80,.9))",
      }}>
        <div style={{
          width:"100%", height:"100%",
          borderRadius:"50%",
          background:"radial-gradient(circle at 35% 30%, #fff8d8, #f0c040 55%, #7a4a08)",
          border:"1.5px solid #5a3a08",
          boxShadow:"0 0 14px rgba(255,210,80,.85), inset 0 0 4px rgba(255,255,200,.6)",
          animation:`coinSpin ${c.dur/3}s ease-in-out infinite`,
        }}/>
      </div>
    ))}

    {/* Coin burst from inside the chest */}
    {[
      {bx:"-260px", by:"-280px", size:18, dur:3.8, delay:0},
      {bx:"-190px", by:"-340px", size:14, dur:4.2, delay:0.6},
      {bx:"-110px", by:"-380px", size:20, dur:3.4, delay:1.2},
      {bx:"-40px",  by:"-360px", size:16, dur:4.0, delay:1.8},
      {bx:"60px",   by:"-380px", size:18, dur:3.6, delay:2.4},
      {bx:"140px",  by:"-340px", size:14, dur:4.4, delay:0.3},
      {bx:"220px",  by:"-300px", size:20, dur:3.8, delay:0.9},
      {bx:"290px",  by:"-240px", size:16, dur:4.0, delay:1.5},
      {bx:"-310px", by:"-220px", size:14, dur:4.2, delay:2.1},
      {bx:"-230px", by:"-160px", size:18, dur:3.6, delay:2.7},
      {bx:"260px",  by:"-160px", size:18, dur:3.4, delay:1.0},
      {bx:"330px",  by:"-100px", size:14, dur:4.0, delay:0.5},
    ].map((c,i)=>(
      <div key={`b${i}`} style={{
        position:"absolute",
        left:"50%", top:"55%",
        width:c.size, height:c.size,
        marginLeft:-c.size/2, marginTop:-c.size/2,
        "--bx": c.bx, "--by": c.by,
        animation:`coinBurst ${c.dur}s ease-out ${c.delay}s infinite`,
        filter:"drop-shadow(0 0 8px rgba(255,210,80,1))",
      }}>
        <div style={{
          width:"100%", height:"100%",
          borderRadius:"50%",
          background:"radial-gradient(circle at 35% 30%, #fff8d8, #f0c040 55%, #7a4a08)",
          border:"1.5px solid #5a3a08",
          boxShadow:"0 0 12px rgba(255,210,80,.9), inset 0 0 4px rgba(255,255,200,.6)",
          animation:`coinSpin ${c.dur/2}s ease-in-out infinite`,
        }}/>
      </div>
    ))}
  </div>

  {/* Title overlay (top) */}
  <div style={{position:"absolute",top:"5%",left:0,right:0,display:"flex",flexDirection:"column",alignItems:"center",zIndex:2,padding:"0 24px",pointerEvents:"none"}}>
    <h1 style={{fontFamily:"'Cinzel Decorative',serif",fontSize:"clamp(26px,7vw,56px)",fontWeight:900,background:"linear-gradient(135deg,#f0c040,#c03030,#f0c040)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite",textAlign:"center",margin:0,filter:"drop-shadow(0 2px 12px rgba(240,160,40,.35))"}}>FOOL'S GOLD</h1>
    <p style={{fontFamily:"'Crimson Pro',serif",fontStyle:"italic",color:"#d8a868",fontSize:13,letterSpacing:".22em",marginTop:4,textShadow:"0 1px 6px rgba(0,0,0,.8)"}}>CONQUER · SUMMON · DOMINATE</p>
  </div>

  {/* Buttons */}
  <div style={{position:"absolute",bottom:"14%",left:0,right:0,display:"flex",flexDirection:"column",alignItems:"center",gap:10,zIndex:2,padding:"0 24px"}}>
    <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:240}}>
      <button className="btn" onClick={() => setScreen("faction")} style={{padding:"13px",background:"linear-gradient(135deg,#7a1010,#c03030)",border:"1px solid #e04040",color:"#f0c040",fontSize:14,fontWeight:700,boxShadow:"0 4px 18px rgba(0,0,0,.6)"}}>⚔ BEGIN CAMPAIGN</button>
      <button className="btn" onClick={() => setScreen("gacha")}   style={{padding:"11px",background:"rgba(80,30,110,.65)",border:"1px solid #9940cc",color:"#e8c8ff",fontSize:13,boxShadow:"0 4px 18px rgba(0,0,0,.6)"}}>✦ SUMMON HEROES</button>
    </div>
  </div>

  {/* Faction badges */}
  <div style={{position:"absolute",bottom:"4%",left:0,right:0,display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",zIndex:2,padding:"0 24px"}}>
    {PLAYABLE_FACTIONS.map(f => (
      <div key={f.key} style={{padding:"4px 10px",background:"rgba(0,0,0,.5)",border:`1px solid ${f.c}50`,borderRadius:3,fontSize:10,color:f.c,fontFamily:"'Cinzel',serif"}}>{f.s} {f.n}</div>
    ))}
  </div>
</div>

);

/* ══════════════════════════════════════════════════
FACTION SELECT
══════════════════════════════════════════════════ */
if (screen==="faction") return (
<div style={{width:"100vw",height:"100vh",background:"#0a0c10",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20,overflow:"auto"}}>
<style>{CSS}</style>
<h2 style={{fontFamily:"'Cinzel Decorative',serif",fontSize:"clamp(15px,4vw,26px)",background:"linear-gradient(135deg,#f0c040,#c03030,#f0c040)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite",marginBottom:4,textAlign:"center"}}>CHOOSE YOUR FACTION</h2>
<p style={{fontFamily:"'Crimson Pro',serif",fontStyle:"italic",color:"#5a4a3a",fontSize:11,marginBottom:18,textAlign:"center"}}>Your alignment determines which heroes you can summon.</p>
{Object.entries(ALIGNMENT).map(([alnKey, aln]) => (
<div key={alnKey} style={{maxWidth:1100,width:"100%",marginBottom:20}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
<span style={{fontSize:18}}>{aln.icon}</span>
<span style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:13,color:aln.color,letterSpacing:".12em"}}>{aln.n.toUpperCase()}</span>
<div style={{flex:1,height:1,background:`${aln.color}30`,marginLeft:6}}/>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:10}}>
{PLAYABLE_FACTIONS.filter(f => aln.factions.includes(f.key)).map(f => {
const starters = HDEFS.filter(h => h.faction === f.key);
return (
<button key={f.key} className="btn"
onClick={() => {
const hqk = `${HQP.player.c},${HQP.player.r}`;
const startCmds = starters.map((h,i) => ({...h, uid:`p${i}`, owner:"player", troops:0, troopType:null, tk:hqk, lvl:5, xp:0}));
// Pick AI faction from opposite alignment
const playerAlign = getFactionAlignment(f.key);
const oppAlign = playerAlign === "humans" ? "creatures" : "humans";
const oppFactions = ALIGNMENT[oppAlign].factions;
const aiFk = oppFactions[Math.floor(Math.random() * oppFactions.length)];
const aiStarters = HDEFS.filter(h => h.faction === aiFk);
const aiCmds = aiStarters.map((h,i) => ({...h, uid:`ai${i}`, owner:"ai", troops:0, troopType:null, tk:AI_HQ_KEY, lvl:5, xp:0}));
setFacKey(f.key);
setFacName(f.n);
setAiFaction(aiFk);
setAiRss({stone:300,wood:300,ore:300,gas:300});
setAiBldgs({hq:1,quarry:0,lumber:0,forge:0,refinery:0,barracks:0,training:0,commandcenter:0,healingtent:0,walls:0,academy:0});
setAiBarracksPool(barracksCapacity(0));
aiLastActionRef.current = 0;
setCmds([...startCmds, ...aiCmds]);
setColl(starters);
setTiles({});
setScreen("game");
}}
style={{background:"rgba(255,255,255,.03)",border:`1px solid ${f.c}50`,borderRadius:8,padding:"14px 12px",color:"#e0d0c0",textAlign:"left"}}>
<div style={{fontSize:26,marginBottom:4}}>{f.s}</div>
<div style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:13,color:f.c,marginBottom:4}}>{f.n}</div>
<div style={{fontSize:9,color:"#5a5060",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginBottom:6}}>{f.desc}</div>
<div style={{fontSize:8,color:"#6a6070",fontFamily:"'Cinzel',serif",marginBottom:2}}>STARTING COMMANDERS</div>
{starters.map(h => (
<div key={h.id} style={{display:"flex",alignItems:"center",gap:4,marginTop:3}}>
<span style={{fontSize:12}}>{h.icon}</span>
<span style={{fontSize:9,color:"#c0b090",fontFamily:"'Cinzel',serif"}}>{h.n}</span>
<span style={{fontSize:8,color:h.star===5?"#f0c040":h.star===4?"#a855f7":"#6b7280",marginLeft:"auto"}}>{h.star}★</span>
</div>
))}
</button>
);
})}
</div>
</div>
))}
<button className="btn" onClick={() => setScreen("title")} style={{padding:"7px 18px",background:"none",border:"1px solid #222",color:"#444",fontSize:11}}>← Back</button>
</div>
);

/* ══════════════════════════════════════════════════
GACHA
══════════════════════════════════════════════════ */
if (screen==="gacha") return (
<div style={{width:"100vw",height:"100vh",background:"#0a0c10",overflow:"auto",padding:16}}>
<style>{CSS}</style>
<div style={{maxWidth:620,margin:"0 auto"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
<div>
<h2 style={{fontFamily:"'Cinzel Decorative',serif",fontSize:"clamp(13px,4vw,20px)",background:"linear-gradient(135deg,#bb88ee,#8840cc,#bb88ee)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite"}}>✦ HERO SUMMONS</h2>
<p style={{fontSize:9,color:"#6a5a7a",letterSpacing:".1em",fontFamily:"'Crimson Pro',serif"}}>3% 5★ · 12% 4★ · 85% 3★</p>
<div style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",background:`${ALIGNMENT[playerAlignment].color}15`,border:`1px solid ${ALIGNMENT[playerAlignment].color}40`,borderRadius:3}}>
<span style={{fontSize:11}}>{ALIGNMENT[playerAlignment].icon}</span>
<span style={{fontSize:8,color:ALIGNMENT[playerAlignment].color,fontFamily:"'Cinzel',serif",letterSpacing:".08em"}}>{ALIGNMENT[playerAlignment].n} pool only</span>
</div>
</div>
<div style={{padding:"4px 10px",background:"rgba(240,192,64,.1)",border:"1px solid rgba(240,192,64,.25)",borderRadius:3,color:"#f0c040",fontFamily:"'Cinzel',serif",fontSize:11}}>💎 {gems}</div>
</div>
<div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
{[{n:1,cost:160},{n:10,cost:1400}].map(({n,cost}) => (
<button key={n} className="btn" onClick={() => pull(n)} disabled={gems<cost}
style={{flex:1,minWidth:120,padding:"12px 8px",background:gems>=cost?"linear-gradient(135deg,rgba(120,50,150,.3),rgba(120,50,150,.1))":"rgba(255,255,255,.02)",border:`1px solid ${gems>=cost?"#9940cc":"#181818"}`,color:gems>=cost?"#bb88ee":"#2a2a2a",textAlign:"center",fontSize:12}}>
<div style={{fontSize:15,marginBottom:2}}>{n===1?"✦":"✦✦✦"}</div>
<div style={{fontWeight:700}}>x{n} Summon</div>
<div style={{fontSize:9,color:"#9940cc",marginTop:2}}>💎 {cost}</div>
</button>
))}
</div>
{showG && gRes.length>0 && (
<div style={{marginBottom:18}}>
<div style={{fontSize:8,color:"#7a6a8a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:7}}>SUMMONED</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:6}}>
{gRes.map((h,i) => (
<div key={h.uid} style={{background:"rgba(255,255,255,.04)",border:`2px solid ${SC(h.star)}`,borderRadius:6,padding:8,textAlign:"center",animation:`popIn .3s ease ${i*.06}s both`,boxShadow:h.star===5?`0 0 14px ${SC(h.star)}55`:"none"}}>
<div style={{fontSize:24}}>{h.icon}</div>
<div style={{color:SC(h.star),fontSize:8}}>{SS(h.star)}</div>
<div style={{fontFamily:"'Cinzel',serif",fontSize:8,fontWeight:700,color:"#e0d0c0",lineHeight:1.3,marginTop:2}}>{h.n}</div>
</div>
))}
</div>
</div>
)}
<div style={{marginBottom:14}}>
{(() => {
const aln = ALIGNMENT[playerAlignment];
const alnFactions = PLAYABLE_FACTIONS.filter(f => aln.factions.includes(f.key));
const alnHeroes = HDEFS.filter(h => aln.factions.includes(h.faction));
const ownedCount = alnHeroes.filter(h => coll.find(x => x.id===h.id)).length;
return (<>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
<span style={{fontSize:14}}>{aln.icon}</span>
<span style={{fontFamily:"'Cinzel',serif",fontSize:8,color:aln.color,letterSpacing:".1em"}}>{aln.n.toUpperCase()} COLLECTION</span>
<span style={{fontSize:8,color:"#5a4a3a",fontFamily:"'Cinzel',serif",marginLeft:"auto"}}>{ownedCount}/{alnHeroes.length}</span>
</div>
{alnFactions.map(f => (
<div key={f.key} style={{marginBottom:10}}>
<div style={{fontSize:8,color:f.c,fontFamily:"'Cinzel',serif",letterSpacing:".08em",marginBottom:4}}>{f.s} {f.n}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(84px,1fr))",gap:5}}>
{HDEFS.filter(h => h.faction===f.key).map(h => {
const owned = coll.find(x => x.id===h.id);
return (
<div key={h.id} style={{background:"rgba(255,255,255,.02)",border:`1px solid ${owned?SC(h.star)+"70":"#131318"}`,borderRadius:5,padding:6,textAlign:"center",opacity:owned?1:.28,filter:owned?"none":"grayscale(1)"}}>
<div style={{fontSize:20}}>{owned?h.icon:"❓"}</div>
<div style={{color:SC(h.star),fontSize:7}}>{SS(h.star)}</div>
<div style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"#c0b090",lineHeight:1.3,marginTop:1}}>{owned?h.n:"???"}</div>
</div>
);
})}
</div>
</div>
))}
</>);
})()}
</div>
<button className="btn" onClick={() => setScreen(Object.keys(tiles).length?"game":"title")} style={{padding:"8px 16px",background:"none",border:"1px solid #1e1e1e",color:"#444",fontSize:11}}>← Back</button>
</div>
</div>
);

/* ══════════════════════════════════════════════════
GAME
══════════════════════════════════════════════════ */
return (
<div style={{width:"100vw",height:"100vh",position:"relative",overflow:"hidden",background:"#0e1014",userSelect:"none",touchAction:"none"}}>
<style>{CSS}</style>

  {/* ══ HUD ══ */}
  <div style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"rgba(4,6,10,.96)",borderBottom:"1px solid #1c180e",padding:"5px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,flexWrap:"wrap",minHeight:38}}>
    <div style={{display:"flex",alignItems:"center",gap:7}}>
      <span style={{fontFamily:"'Cinzel Decorative',serif",fontSize:11,background:"linear-gradient(135deg,#f0c040,#c03030,#f0c040)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite"}}>RTW</span>
      <span style={{color:"#221800",fontSize:9}}>|</span>
      <span style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#3daa60"}}>{facName}</span>
      <span style={{color:"#221800",fontSize:9}}>|</span>
      <span style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"#3a4a3a"}}>{pKeys.size} tiles</span>
    </div>
    <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
      {RKEYS.map(k => (
        <div key={k} style={{display:"flex",alignItems:"center",gap:2,padding:"2px 6px",background:RSS[k].bg,border:`1px solid ${RSS[k].col}30`,borderRadius:3,fontSize:10,color:RSS[k].col,fontFamily:"'Cinzel',serif",whiteSpace:"nowrap"}}>
          {RSS[k].icon}{Math.floor(rss[k]).toLocaleString()}
        </div>
      ))}
      <div style={{padding:"2px 6px",background:"rgba(240,192,64,.08)",border:"1px solid rgba(240,192,64,.2)",borderRadius:3,color:"#f0c040",fontFamily:"'Cinzel',serif",fontSize:10,whiteSpace:"nowrap"}}>💎{gems}</div>
    </div>
    <div style={{display:"flex",gap:5}}>
      <button className="btn" onClick={() => { setHqOpen(true); setHqTab("overview"); setSelKey(null); setMode("view"); }} style={{padding:"4px 10px",background:"rgba(240,192,64,.07)",border:"1px solid rgba(240,192,64,.2)",color:"#f0c040",fontSize:10}}>🏰 HQ</button>
      <button className="btn" onClick={() => setScreen("gacha")} style={{padding:"4px 10px",background:"rgba(120,50,150,.14)",border:"1px solid rgba(153,64,204,.25)",color:"#bb88ee",fontSize:10}}>✦ Summon</button>
    </div>
  </div>

  {/* ══ MAP — PixiJS ISOMETRIC ══ */}
  <MapRenderer
    tiles={tiles}
    cmds={cmds}
    selKey={selKey}
    mode={mode}
    mvCmd={mvCmd}
    panSt={panSt}
    zoom={zoom}
    ZOOM_LEVELS={ZOOM_LEVELS}
    onTileClick={onTileClick}
    onPanChange={np => { panRef.current = np; setPanSt(np); }}
    onZoomChange={setZoom}
  />
  <div style={{position:"fixed",right:10,top:46,zIndex:190,display:"flex",flexDirection:"column",gap:4}}>
    <button className="btn"
      onClick={() => setZoom(prev => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length-1, ZOOM_LEVELS.indexOf(prev)+1)])}
      style={{width:36,height:36,background:"rgba(8,10,14,.92)",border:"1px solid #2a2010",color:"#c8a060",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,boxShadow:"0 2px 8px rgba(0,0,0,.5)"}}>
      +
    </button>
    <div style={{textAlign:"center",fontSize:8,color:"#4a4a5a",fontFamily:"'Cinzel',serif",lineHeight:1.2,padding:"2px 0"}}>
      {Math.round(zoom*100)}%
    </div>
    <button className="btn"
      onClick={() => setZoom(prev => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(prev)-1)])}
      style={{width:36,height:36,background:"rgba(8,10,14,.92)",border:"1px solid #2a2010",color:"#c8a060",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,boxShadow:"0 2px 8px rgba(0,0,0,.5)"}}>
      −
    </button>
    <div style={{height:6}}/>
    <button className="btn"
      onClick={() => { setShowBattleLog(true); setSelectedBattle(0); setBattleLogView("simple"); setUnseenBattles(0); }}
      title="Battle Reports"
      style={{width:36,height:36,background:unseenBattles>0?"rgba(180,100,20,.18)":"rgba(8,10,14,.92)",border:`1px solid ${unseenBattles>0?"#c8802060":"#2a2010"}`,color:unseenBattles>0?"#c8a060":"#4a4a5a",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,boxShadow:"0 2px 8px rgba(0,0,0,.5)",position:"relative"}}>
      ⚔{unseenBattles>0&&(
        <div style={{position:"absolute",top:-4,right:-4,width:16,height:16,background:"#cc3030",borderRadius:"50%",fontSize:7,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontWeight:700}}>
          {Math.min(99,unseenBattles)}
        </div>
      )}
    </button>
  </div>

  {/* ══ FLOATIES ══ */}
  {floats.map(f => (
    <div key={f.id} style={{position:"fixed",left:f.x,top:f.y,zIndex:600,pointerEvents:"none",fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:12,color:f.col,animation:"floatUp 1.8s ease forwards",textShadow:"0 1px 6px rgba(0,0,0,.9)",whiteSpace:"nowrap"}}>
      {f.txt}
    </div>
  ))}

  {/* ══ TILE POPUP ══ */}
  {selKey && selTile && popupPos && !hqOpen && mode==="view" && (
    <div style={{position:"fixed",left:popupPos.x,top:popupPos.y,width:180,zIndex:500,background:"rgba(5,7,11,.96)",border:"1px solid #2a2418",borderRadius:6,boxShadow:"0 4px 20px rgba(0,0,0,.85)",animation:"fadeUp .15s ease",pointerEvents:"auto"}}>

      {/* Header */}
      <div style={{padding:"5px 7px 4px",borderBottom:"1px solid #1e1810",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          {popupMode!=="main" && (
            <button className="btn" onClick={() => { setPopupMode("main"); setEditArmyCmd(null); }}
              style={{background:"none",border:"none",color:"#6a5a4a",fontSize:10,padding:"0 2px"}}>←</button>
          )}
          <span style={{fontFamily:"'Cinzel',serif",fontSize:9,fontWeight:700,color:selTile.owner==="player"?TC.player.dot:selTile.owner==="ai"?"#dd4422":selTile.owner?TC[selTile.owner]?.dot||"#c8a060":"#a09080"}}>
            {popupMode==="editArmy"?"🔧 Edit Army":popupMode==="recallPick"?"↩ Recall Commander":selTile.isWin?"⚜ Holy Grail":selTile.isRuin?"🏚 Ruin":TERR[selTile.terrain]?.lbl||"Tile"}
          </span>
          {popupMode==="main" && selTile.owner==="ai" && (
            <span style={{fontSize:7,color:"#dd4422",fontFamily:"'Cinzel',serif",fontWeight:700,background:"rgba(200,50,30,.15)",padding:"1px 4px",borderRadius:3,border:"1px solid rgba(200,50,30,.35)"}}>
              ☠ ENEMY
            </span>
          )}
          {popupMode==="main" && selTile.powerLevel && !selTile.isHQ && (
            <span style={{fontSize:7,color:POWER_DEFS[selTile.powerLevel]?.color,fontFamily:"'Cinzel',serif",fontWeight:700,background:`${POWER_DEFS[selTile.powerLevel]?.color}18`,padding:"1px 4px",borderRadius:3,border:`1px solid ${POWER_DEFS[selTile.powerLevel]?.color}40`}}>
              P{POWER_DEFS[selTile.powerLevel]?.label}
            </span>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {popupMode==="main" && (
            <span style={{fontSize:7,color:"#6a9a6a",fontFamily:"'Cinzel',serif",letterSpacing:".05em",background:"rgba(106,154,106,.1)",padding:"1px 5px",borderRadius:3,border:"1px solid rgba(106,154,106,.28)",lineHeight:"14px"}}>
              {selTile.c},{selTile.r}
            </span>
          )}
          <button className="btn" onClick={() => { setSelKey(null); setPopupPos(null); setPopupMode("main"); setEditArmyCmd(null); }}
            style={{background:"none",border:"none",color:"#4a4040",fontSize:11,padding:"0 2px",lineHeight:1}}>✕</button>
        </div>
      </div>

      <div style={{padding:"5px 7px"}}>

        {/* ── MAIN MODE ── */}
        {popupMode==="main" && (<>

          {/* Resource */}
          {selTile.rss && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,padding:"3px 6px",background:"rgba(255,255,255,.03)",borderRadius:3,border:"1px solid #1e1810"}}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10}}>{RSS[selTile.rss].icon}</span>
                <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:RSS[selTile.rss].col,fontWeight:700}}>{RSS[selTile.rss].lbl}</span>
              </div>
              <span style={{fontSize:7,color:"#6a7a5a",fontFamily:"'Cinzel',serif"}}>+{BLDG[selTile.rss==="stone"?"quarry":selTile.rss==="wood"?"lumber":selTile.rss==="ore"?"forge":"refinery"]?.rate||50}/s</span>
            </div>
          )}

          {/* Siege value */}
          {!selTile.isHQ && (() => {
            const sv = selTile.siege ?? SIEGE_BASE;
            const sm = selTile.siegeMax ?? SIEGE_BASE;
            const pct = Math.round((sv / sm) * 100);
            const isDefeated = selTile.garrisonDefeated;
            const resetSecs = selTile.resetAt ? Math.max(0, Math.ceil((selTile.resetAt - Date.now()) / 1000)) : null;
            return (
              <div style={{marginBottom:4,padding:"3px 6px",background:"rgba(255,255,255,.03)",borderRadius:3,border:`1px solid ${isDefeated?"rgba(240,192,64,.3)":"#1e1810"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:isDefeated?"#f0c040":"#7a6a5a",fontWeight:700}}>
                    🏰 SIEGE{isDefeated?" — GARRISON DEFEATED":""}
                  </span>
                  <span style={{fontSize:7,color:pct>66?"#3daa60":pct>33?"#d0a030":"#cc3030",fontFamily:"'Cinzel',serif",fontWeight:700}}>
                    {sv}/{sm}
                  </span>
                </div>
                <div style={{height:3,background:"#181820",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:pct>66?"#3daa60":pct>33?"#d0a030":"#cc3030",borderRadius:2,transition:"width .3s"}}/>
                </div>
                {isDefeated && resetSecs !== null && (
                  <div style={{fontSize:6,color:"#8a7040",fontFamily:"'Crimson Pro',serif",marginTop:2}}>
                    Resets in {resetSecs}s
                  </div>
                )}
              </div>
            );
          })()}

          {/* Enemy garrison */}
          {selTile.owner !== "player" && (selTile.defCmd || selTile.owner === "ai") && (() => {
            const isAiOwned = selTile.owner === "ai";
            // Check live cmds — commander is "present" only if idle (not marching) on this tile
            const aiCmdPresent = isAiOwned && cmds.some(c => c.owner === "ai" && c.tk === selKey && !c.march);
            const isPureGarrison = isAiOwned && !aiCmdPresent;
            // For garrison tiles (no AI commander present), derive stats from powerLevel
            const dc = isPureGarrison ? garrisonDefCmd(selTile) : selTile.defCmd;
            if (!dc) return null;
            const tt = (!isAiOwned && dc.troopType) ? TROOP[dc.troopType] : null;
            return (
              <div style={{marginBottom:4,padding:"3px 6px",background:"rgba(200,40,40,.06)",borderRadius:3,border:"1px solid rgba(200,40,40,.2)"}}>
                <div style={{fontSize:7,color:"#8a5a4a",fontFamily:"'Cinzel',serif",letterSpacing:".06em",marginBottom:3}}>
                  {isAiOwned ? (aiCmdPresent ? "ENEMY COMMANDER" : "GARRISON") : "GARRISON"}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{textAlign:"center"}}><div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#e07050",fontWeight:700}}>Lv{dc.lvl}</div><div style={{fontSize:6,color:"#5a4a40"}}>Level</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#e07050",fontWeight:700}}>{dc.troops.toLocaleString()}</div><div style={{fontSize:6,color:"#5a4a40"}}>Troops</div></div>
                  {tt && <div style={{display:"flex",alignItems:"center",gap:3,marginLeft:"auto"}}><span style={{fontSize:10}}>{tt.icon}</span><span style={{fontSize:7,color:tt.color,fontFamily:"'Cinzel',serif"}}>{tt.label}</span></div>}
                  {isAiOwned && <div style={{marginLeft:"auto",fontSize:7,color:"#5a4040",fontFamily:"'Cinzel',serif",fontStyle:"italic"}}>???</div>}
                </div>
              </div>
            );
          })()}

          {/* Owned: commanders */}
          {selTile.owner === "player" && cmdsOnSel.length > 0 && (
            <div style={{marginBottom:4}}>
              <div style={{fontSize:7,color:"#4a6a4a",fontFamily:"'Cinzel',serif",letterSpacing:".06em",marginBottom:3}}>COMMANDERS</div>
              {cmdsOnSel.map(cmd => {
                const tt = cmd.troopType ? TROOP[cmd.troopType] : null;
                return (
                  <div key={cmd.uid} style={{display:"flex",alignItems:"center",gap:4,marginBottom:2,padding:"2px 4px",background:"rgba(60,170,80,.07)",borderRadius:3,border:"1px solid rgba(60,170,80,.2)"}}>
                    <span style={{fontSize:10}}>{cmd.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"#90c870",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cmd.n}</span>
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:6,color:"#f0c040",flexShrink:0}}>Lv{cmd.lvl||5}</span>
                      </div>
                      {tt && <div style={{fontSize:7,color:tt.color}}>{tt.icon} {(cmd.troops||0).toLocaleString()}</div>}
                    </div>
                    {cmd.march && <div style={{fontSize:6,color:"#f0c040",fontFamily:"'Cinzel',serif",flexShrink:0}}>→</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* En route */}
          {marchingToSel.length > 0 && (
            <div style={{marginBottom:4,padding:"3px 6px",background:"rgba(240,192,64,.05)",borderRadius:3,border:"1px solid rgba(240,192,64,.2)"}}>
              <div style={{fontSize:7,color:"#c8a040",fontFamily:"'Cinzel',serif",letterSpacing:".06em",marginBottom:2}}>EN ROUTE</div>
              {marchingToSel.map(cmd => {
                const eta = Math.ceil((cmd.march.path.length - cmd.march.step - 1) * cmd.march.stepMs / 1000);
                return (
                  <div key={cmd.uid} style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                    <span style={{fontSize:10}}>{cmd.icon}</span>
                    <span style={{fontSize:7,color:"#c0a860",fontFamily:"'Cinzel',serif",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cmd.n}</span>
                    <span style={{fontSize:6,color:cmd.march.type==="attack"?"#ff6666":"#44cc88",flexShrink:0}}>~{eta}s</span>
                    <button className="btn" onClick={() => recallMarch(cmd.uid)}
                      style={{padding:"1px 4px",fontSize:6,background:"rgba(200,60,60,.15)",border:"1px solid #cc4444",color:"#ff8888",flexShrink:0}}>↩</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
            {/* Attack */}
            {selTile.owner !== "player" && canAtk && (
              <button className="btn" onClick={() => { setAtkKey(selKey); setMode("pickAttackCmd"); setPick(null); }}
                style={{flex:1,padding:"5px 3px",background:"linear-gradient(135deg,rgba(140,20,20,.6),rgba(100,10,10,.4))",border:"1px solid #cc2020",color:"#f0a0a0",fontSize:9,fontWeight:700}}>
                ⚔ Attack
              </button>
            )}
            {/* Move — any owned tile, pick from ALL idle commanders */}
            {selTile.owner === "player" && cmds.filter(c=>c.owner==="player"&&!c.march&&(c.troops||0)>0).length > 0 && (
              <button className="btn" onClick={() => {
                const idleCmds = cmds.filter(c=>c.owner==="player"&&!c.march&&(c.troops||0)>0);
                setMvCmd(idleCmds[0]); setMode("selectMarchDest");
              }}
                style={{flex:1,padding:"5px 3px",background:"linear-gradient(135deg,rgba(20,80,40,.6),rgba(10,60,30,.4))",border:"1px solid #2a8040",color:"#80d090",fontSize:9,fontWeight:700}}>
                🚶 Move
              </button>
            )}
            {/* Reinforce */}
            {selTile.owner === "player" && cmdsOnSel.some(c=>c.troopType&&!c.march) && barracksPool > 0 && (
              <button className="btn" onClick={() => {
                const cmd = cmdsOnSel.find(c=>c.troopType&&!c.march);
                setReinCmd(cmd); setMode("reinforce");
              }}
                style={{flex:1,padding:"5px 3px",background:"linear-gradient(135deg,rgba(20,40,120,.6),rgba(10,30,100,.4))",border:"1px solid #2a40cc",color:"#80a0ff",fontSize:9,fontWeight:700}}>
                🔄
              </button>
            )}
            {/* Recall marching */}
            {selTile.owner === "player" && cmdsOnSel.some(c=>c.march) && (
              <button className="btn" onClick={() => cmdsOnSel.filter(c=>c.march).forEach(c=>recallMarch(c.uid))}
                style={{flex:1,padding:"5px 3px",background:"linear-gradient(135deg,rgba(120,40,40,.5),rgba(100,20,20,.3))",border:"1px solid #cc4444",color:"#ff9090",fontSize:9,fontWeight:700}}>
                ↩
              </button>
            )}
            {/* Recall stationary */}
            {selTile.owner === "player" && cmdsOnSel.some(c=>!c.march) && selKey !== `${HQP.player.c},${HQP.player.r}` && (
              <button className="btn" onClick={() => {
                const idle = cmdsOnSel.filter(c=>!c.march);
                if (idle.length === 1) { recallStationary(idle[0].uid); }
                else { setPopupMode("recallPick"); }
              }}
                style={{flex:1,padding:"5px 3px",background:"linear-gradient(135deg,rgba(100,60,20,.5),rgba(80,40,10,.3))",border:"1px solid #c89030",color:"#f0c040",fontSize:9,fontWeight:700}}>
                🏰
              </button>
            )}
            {/* Edit Army wrench */}
            {selTile.owner === "player" && cmdsOnSel.some(c=>c.troopType&&!c.march) && (
              <button className="btn" onClick={() => {
                const cmd = cmdsOnSel.find(c=>c.troopType&&!c.march);
                setEditArmyCmd(cmd); setPopupMode("editArmy");
              }}
                style={{flex:"0 0 auto",padding:"5px 7px",background:"linear-gradient(135deg,rgba(60,50,20,.5),rgba(40,30,10,.3))",border:"1px solid #7a6a30",color:"#c0a840",fontSize:11,fontWeight:700}}>
                🔧
              </button>
            )}
            {/* Abandon tile — red X, not available on HQ */}
            {selTile.owner === "player" && !selTile.isHQ && !deletingTiles[selKey] && (
              <button className="btn" onClick={() => {
                setDeletingTiles(prev => ({...prev, [selKey]: Date.now()}));
                setDeletingSecsLeft(prev => ({...prev, [selKey]: 15}));
              }}
                style={{flex:"0 0 auto",padding:"5px 7px",background:"linear-gradient(135deg,rgba(120,10,10,.6),rgba(80,0,0,.4))",border:"1px solid #cc1010",color:"#ff6060",fontSize:11,fontWeight:700}}>
                ✕
              </button>
            )}
          </div>

          {/* Deletion countdown bar */}
          {deletingTiles[selKey] && (
            <div style={{marginTop:6,padding:"5px 6px",background:"rgba(120,10,10,.15)",border:"1px solid #cc1010",borderRadius:4}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontFamily:"'Cinzel',serif",fontSize:7,color:"#ff6060",fontWeight:700,letterSpacing:".06em"}}>
                  🏳 ABANDONING IN {deletingSecsLeft[selKey] ?? 15}s
                </span>
                <button className="btn" onClick={() => {
                  setDeletingTiles(prev => { const n={...prev}; delete n[selKey]; return n; });
                  setDeletingSecsLeft(prev => { const n={...prev}; delete n[selKey]; return n; });
                }}
                  style={{padding:"2px 6px",background:"rgba(40,40,40,.6)",border:"1px solid #555",color:"#ccc",fontSize:7,fontWeight:700,borderRadius:3}}>
                  CANCEL
                </button>
              </div>
              <div style={{height:4,background:"rgba(0,0,0,.4)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${((deletingSecsLeft[selKey]??15)/15)*100}%`,background:"linear-gradient(90deg,#cc1010,#ff4040)",borderRadius:2,transition:"width .25s linear"}}/>
              </div>
            </div>
          )}

          {selTile.owner !== "player" && !canAtk && !selTile.isWin && (
            <div style={{fontSize:7,color:"#5a4a3a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginTop:3,textAlign:"center"}}>
              Own an adjacent tile to attack
            </div>
          )}

        </>)}

        {/* ── RECALL PICK MODE ── */}
        {popupMode==="recallPick" && (
          <div>
            <div style={{fontSize:7,color:"#8a7060",fontFamily:"'Cinzel',serif",letterSpacing:".06em",marginBottom:6}}>SELECT COMMANDER TO RECALL</div>
            {cmdsOnSel.filter(c=>!c.march).map(cmd => (
              <div key={cmd.uid} onClick={() => { recallStationary(cmd.uid); setPopupMode("main"); }}
                style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,padding:"4px 6px",background:"rgba(240,192,64,.07)",border:"1px solid rgba(240,192,64,.2)",borderRadius:4,cursor:"pointer"}}>
                <span style={{fontSize:14}}>{cmd.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"#e0d0c0",fontWeight:700}}>{cmd.n}</div>
                  <div style={{fontSize:7,color:"#7a7a5a"}}>{cmd.troopType?`${TROOP[cmd.troopType].icon} ${(cmd.troops||0).toLocaleString()}`:"No troops"}</div>
                </div>
                <span style={{fontSize:8,color:"#f0c040"}}>🏰</span>
              </div>
            ))}
          </div>
        )}

        {/* ── EDIT ARMY MODE ── */}
        {popupMode==="editArmy" && editArmyCmd && (() => {
          const cmd = editArmyCmd;
          const cur = cmd.troops || 0;
          const sk = `ea_${cmd.uid}`;
          const sv = sliderVals[sk] ?? cur;
          const toRemove = cur - sv;
          return (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,padding:"4px 6px",background:"rgba(60,170,80,.07)",borderRadius:3,border:"1px solid rgba(60,170,80,.2)"}}>
                <span style={{fontSize:16}}>{cmd.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:8,color:"#90c870",fontWeight:700}}>{cmd.n}</div>
                  {cmd.troopType && <div style={{fontSize:7,color:TROOP[cmd.troopType].color}}>{TROOP[cmd.troopType].icon} {TROOP[cmd.troopType].label}</div>}
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#6a5a4a",fontFamily:"'Cinzel',serif",marginBottom:3}}>
                <span>TROOPS</span>
                <span style={{color:toRemove>0?"#cc5050":"#3daa60"}}>{sv.toLocaleString()} / {cur.toLocaleString()}{toRemove>0&&<span style={{color:"#cc5050",marginLeft:4}}>(-{toRemove})</span>}</span>
              </div>
              <input type="range" min={0} max={cur} value={sv}
                onChange={e => setSliderVals(v=>({...v,[sk]:+e.target.value}))}
                style={{width:"100%",accentColor:"#cc5050",marginBottom:6}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:"#4a4a5a",marginBottom:6}}><span>0</span><span>{cur.toLocaleString()}</span></div>
              {toRemove > 0
                ? <button className="btn" onClick={() => {
                    setBarracks(p=>p+toRemove);
                    setCmds(p=>p.map(c=>c.uid===cmd.uid?{...c,troops:sv,troopType:sv===0?null:c.troopType}:c));
                    setEditArmyCmd({...cmd,troops:sv});
                    setSliderVals(v=>({...v,[sk]:undefined}));
                  }}
                  style={{width:"100%",padding:"6px",background:"linear-gradient(135deg,rgba(150,40,40,.4),rgba(150,40,40,.15))",border:"1px solid #cc4444",color:"#dd6666",fontSize:9,fontWeight:700}}>
                  Remove {toRemove.toLocaleString()} troops
                </button>
                : <div style={{fontSize:7,color:"#4a4a5a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",textAlign:"center"}}>Slide left to remove troops</div>
              }
            </div>
          );
        })()}
      </div>
    </div>
  )}

  {/* ══ BATTLE LOG PANEL ══ */}
  {showBattleLog && (
    <div style={{position:"fixed",top:46,right:52,width:300,maxHeight:"60vh",zIndex:300,background:"rgba(5,7,11,.97)",border:"1px solid #221e12",borderRadius:6,display:"flex",flexDirection:"column",boxShadow:"0 4px 24px rgba(0,0,0,.8)"}}>
      <div style={{padding:"8px 12px",borderBottom:"1px solid #221e12",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#c8a060",fontWeight:700}}>⚔ BATTLE REPORTS ({battles.length})</span>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {["simple","detailed"].map(v => (
            <button key={v} className="btn" onClick={() => setBattleLogView(v)}
              style={{padding:"2px 6px",fontSize:7,background:battleLogView===v?"rgba(240,192,64,.15)":"transparent",border:`1px solid ${battleLogView===v?"#f0c040":"#2a2010"}`,color:battleLogView===v?"#f0c040":"#6a5a4a"}}>
              {v}
            </button>
          ))}
          <button className="btn" onClick={() => setShowBattleLog(false)}
            style={{padding:"2px 8px",fontSize:9,background:"transparent",border:"1px solid #2a2010",color:"#5a4a3a",marginLeft:2}}>✕</button>
        </div>
      </div>
      <div className="scr" style={{flex:1,overflowY:"auto",padding:8}}>
        {battleLogView === "simple" ? (
          bLog.length === 0
            ? <div style={{fontSize:9,color:"#3a3040",padding:8,fontStyle:"italic",fontFamily:"'Crimson Pro',serif"}}>No battles yet.</div>
            : bLog.map((l,i) => (
              <div key={i} style={{fontSize:8,color:i===0?"#c0a880":"#5a4a3a",fontFamily:"'Crimson Pro',serif",marginBottom:4,lineHeight:1.5,borderBottom:"1px solid #1a1810",paddingBottom:4}}>{l}</div>
            ))
        ) : (
          battles.length === 0
            ? <div style={{fontSize:9,color:"#3a3040",padding:8,fontStyle:"italic",fontFamily:"'Crimson Pro',serif"}}>No battles yet.</div>
            : <>
              <div style={{display:"flex",gap:3,marginBottom:8,flexWrap:"wrap"}}>
                {battles.map((b,i) => (
                  <button key={i} className="btn" onClick={() => setSelectedBattle(i)}
                    style={{padding:"2px 6px",fontSize:7,background:i===selectedBattle?"rgba(240,192,64,.15)":"transparent",border:`1px solid ${i===selectedBattle?"#f0c040":"#2a2010"}`,color:i===selectedBattle?"#f0c040":"#5a4a3a"}}>
                    {b.won?"✅":"❌"}{i+1}
                  </button>
                ))}
              </div>
              {battles[selectedBattle] && (() => {
                const b = battles[selectedBattle];
                return (
                  <div>
                    <div style={{fontSize:9,color:"#c8a060",fontFamily:"'Cinzel',serif",marginBottom:3}}>{b.atkIcon} {b.atkName} Lv{b.atkLvl} vs {b.defCmdIcon} {b.defCmdName}</div>
                    <div style={{fontSize:8,color:"#6a5a4a",marginBottom:3}}>{b.modLabel} · {b.terrain} · <span style={{color:b.won?"#3daa60":"#cc3030"}}>{b.won?"⚔ VICTORY":"💀 DEFEAT"}</span>{b.won?` · +${b.xpGain}XP`:""}</div>
                    <div style={{fontSize:8,color:"#5a5060",marginBottom:8}}>Troops: {b.atkTroopsStart.toLocaleString()} → {b.atkTroopsEnd.toLocaleString()} (lost {(b.atkTroopsStart-b.atkTroopsEnd).toLocaleString()})</div>
                    {b.rounds.map((rd,ri) => (
                      <div key={ri} style={{marginBottom:5}}>
                        <div style={{fontSize:7,color:"#4a3a2a",borderBottom:"1px solid #1a1810",marginBottom:2,paddingBottom:1,fontFamily:"'Cinzel',serif"}}>Round {rd.round}</div>
                        {rd.actions.map((a,ai) => (
                          <div key={ai} style={{fontSize:7,lineHeight:1.5,color:a.isSkill?"#d0a860":a.isHeal?"#60c090":a.isPlayer===false?"#cc6060":a.isPlayer===true?"#60a0cc":"#6a6a7a"}}>
                            {a.action}{a.dmg>0?` [${a.dmg}]`:""}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
        )}
      </div>
    </div>
  )}

  {/* ══ WIN SCREEN ══ */}
  {winner && (() => {
    const isVictory = winner === "player";
    const aiName = aiFaction ? (FAC[aiFaction]?.n || aiFaction) : "Enemy";
    const headline = isVictory
      ? "VICTORY! THE HOLY GRAIL IS YOURS!"
      : `DEFEAT — ${aiName} claims the Holy Grail`;
    const flavour = isVictory
      ? "Your alliance stands victorious. The age of conquest is complete."
      : `The ${aiName} army has seized the Holy Grail. Rally your forces and try again.`;
    const gradBg = isVictory
      ? "linear-gradient(135deg,#f0c040,#e67e22,#f0c040)"
      : "linear-gradient(135deg,#cc3030,#881010,#cc3030)";
    return (
      <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:24}}>
        <div style={{fontSize:72}}>{isVictory?"🏆":"💀"}</div>
        <h2 style={{fontFamily:"'Cinzel Decorative',serif",fontSize:"clamp(20px,6vw,44px)",fontWeight:900,
          background:gradBg,backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:"shimmer 2s linear infinite",textAlign:"center"}}>
          {headline}
        </h2>
        <p style={{fontFamily:"'Crimson Pro',serif",fontStyle:"italic",color:"#7a6a5a",fontSize:13,textAlign:"center",maxWidth:360}}>
          {flavour}
        </p>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center"}}>
          <button className="btn" onClick={() => {
            setWinner(null);
            setTiles(genMap());
            setCmds(p => {
              const playerCmds = p.filter(c => c.owner==="player").map(c => ({...c, tk:`${HQP.player.c},${HQP.player.r}`, march:null, troops:0}));
              const curAiFk = aiFaction;
              const aiStarters = curAiFk ? HDEFS.filter(h => h.faction === curAiFk) : [];
              const aiCmds = aiStarters.map((h,i) => ({...h, uid:`ai${i}`, owner:"ai", troops:0, troopType:null, tk:AI_HQ_KEY, lvl:5, xp:0}));
              return [...playerCmds, ...aiCmds];
            });
            setMode("view"); setSelKey(null);
            setUpgQueue({});
            setBldgs({hq:1,quarry:0,lumber:0,forge:0,refinery:0,barracks:0,training:0,commandcenter:0,healingtent:0,walls:0,academy:0});
            setBarracks(barracksCapacity(0));
            setAiRss({stone:300,wood:300,ore:300,gas:300});
            setAiBldgs({hq:1,quarry:0,lumber:0,forge:0,refinery:0,barracks:0,training:0,commandcenter:0,healingtent:0,walls:0,academy:0});
            setAiBarracksPool(barracksCapacity(0));
            aiLastActionRef.current = 0;
          }}
            style={{padding:"12px 28px",background:"linear-gradient(135deg,#7a1010,#c03030)",border:"1px solid #e04040",color:"#f0c040",fontSize:13,fontWeight:700}}>
            ⚔ Play Again
          </button>
          <button className="btn" onClick={() => setScreen("title")}
            style={{padding:"12px 28px",background:"rgba(255,255,255,.04)",border:"1px solid #333",color:"#aaa",fontSize:13}}>
            ← Main Menu
          </button>
        </div>
      </div>
    );
  })()}

  {/* ══ BOTTOM PANEL — action modes only ══ */}
  {panelOpen && (
    <div className="panel" style={{position:"fixed",bottom:0,left:0,right:0,zIndex:9000,maxHeight:"50vh",display:"flex",flexDirection:"column",borderRadius:"10px 10px 0 0",animation:"fadeUp .18s ease",boxShadow:"0 -6px 32px rgba(0,0,0,.95)"}}>
      <div style={{padding:"9px 14px",borderBottom:"1px solid #221e12",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"rgba(255,255,255,.025)"}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn" onClick={() => { setMode("view"); setAtkKey(null); setPick(null); setMvCmd(null); setReinCmd(null); }}
            style={{background:"none",border:"1px solid #333",color:"#666",fontSize:10,padding:"2px 8px"}}>← Back</button>
          <span style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:12,color:"#c8a060"}}>
            {mode==="selectMarchDest"?"🚶 SELECT DESTINATION":"🔄 REINFORCE"}
          </span>
        </div>
        <button className="btn" onClick={() => { setMode("view"); setAtkKey(null); setPick(null); setMvCmd(null); setReinCmd(null); setSelKey(null); setPopupPos(null); }}
          style={{background:"none",border:"1px solid #2a2a2a",color:"#555",fontSize:10,padding:"2px 10px"}}>✕</button>
      </div>
      <div className="scr" style={{flex:1,overflowY:"auto",padding:"10px 14px"}}>

        {/* ── REINFORCE MODE ── */}
        {mode==="reinforce" && reinCmd && (
          <div>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,padding:"8px 10px",background:"rgba(30,60,120,.12)",border:"1px solid rgba(50,100,200,.3)",borderRadius:5}}>
              <span style={{fontSize:26}}>{reinCmd.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,color:"#e0d0c0"}}>{reinCmd.n} <span style={{color:"#f0c040",fontSize:9}}>Lv{reinCmd.lvl||5}</span></div>
                {reinCmd.troopType && (
                  <div style={{fontSize:9,color:TROOP[reinCmd.troopType].color}}>
                    {TROOP[reinCmd.troopType].icon} {TROOP[reinCmd.troopType].label} · <strong style={{color:"#e0d0c0"}}>{(reinCmd.troops||0).toLocaleString()}</strong> troops
                  </div>
                )}
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:9,color:"#6a7a9a",fontFamily:"'Cinzel',serif"}}>Barracks</div>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:12,color:barracksPool>0?"#88aaff":"#cc3030",fontWeight:700}}>{barracksPool.toLocaleString()}</div>
              </div>
            </div>

            {barracksPool > 0 ? (() => {
              const cap = cmdCommand(reinCmd.lvl||5, bldgs.commandcenter||0);
              const cur = reinCmd.troops||0;
              const room = Math.max(0, cap - cur);
              const maxAdd = Math.min(room, barracksPool);
              const sk = `rein_${reinCmd.uid}`;
              const sv = Math.min(sliderVals[sk] ?? 0, maxAdd);
              const hqKey = `${HQP.player.c},${HQP.player.r}`;
              const effSpd = effectiveMarchSpd(reinCmd.spd||60, reinCmd.troopType);
              const stepMs = Math.max(100, Math.floor(marchStepMs(effSpd) / 2));
              const path = bfsPath(hqKey, reinCmd.tk);
              const estSecs = path ? Math.ceil((path.length - 1) * stepMs / 1000) : "?";
              return (
                <div>
                  {room > 0 ? (<>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#6a7a9a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:4}}>
                      <span>SEND REINFORCEMENTS</span>
                      <span style={{color:sv>0?"#88aaff":"#4a5a7a"}}>{sv.toLocaleString()} troops{sv>0?` · ~${estSecs}s`:""}</span>
                    </div>
                    <input type="range" min={0} max={maxAdd} value={sv}
                      onChange={e => setSliderVals(v=>({...v,[sk]:+e.target.value}))}
                      style={{width:"100%",accentColor:"#3366cc",marginBottom:6}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#4a4a5a",marginBottom:10}}>
                      <span>0</span>
                      <span style={{color:"#5a6a8a"}}>Max: {maxAdd.toLocaleString()}</span>
                      <span>{maxAdd.toLocaleString()}</span>
                    </div>
                    {sv > 0
                      ? <button className="btn"
                          onClick={() => startReinforcement(reinCmd, sv)}
                          style={{width:"100%",padding:"10px",background:"linear-gradient(135deg,rgba(30,60,120,.5),rgba(30,60,120,.2))",border:"1px solid rgba(50,100,220,.5)",color:"#88aaff",fontSize:12,fontWeight:700}}>
                          🚶 March {sv.toLocaleString()} reinforcements (~{estSecs}s)
                        </button>
                      : <div style={{fontSize:8,color:"#4a4a5a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",textAlign:"center"}}>Slide right to set reinforcement size</div>
                    }
                  </>) : (
                    <div style={{padding:"8px 10px",background:"rgba(200,80,30,.08)",border:"1px solid rgba(200,80,30,.2)",borderRadius:4,fontSize:9,color:"#cc6030",fontFamily:"'Crimson Pro',serif"}}>
                      Army at full capacity ({cap.toLocaleString()}).
                    </div>
                  )}
                </div>
              );
            })() : (
              <div style={{padding:"10px",background:"rgba(200,50,50,.08)",border:"1px solid rgba(200,50,50,.2)",borderRadius:4,fontSize:9,color:"#cc6060",fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>
                Barracks is empty. Train more troops first.
              </div>
            )}
            <button className="btn" onClick={() => { setMode("view"); setReinCmd(null); }}
              style={{marginTop:10,padding:"7px 16px",background:"none",border:"1px solid #2a2a2a",color:"#555",fontSize:10}}>← Cancel</button>
          </div>
        )}

        {/* ── SELECT MARCH DESTINATION ── */}
        {mode==="selectMarchDest" && mvCmd && (
          <div>
            <div style={{padding:"8px 10px",background:"rgba(20,80,50,.12)",border:"1px solid rgba(40,140,80,.3)",borderRadius:5,marginBottom:10,fontSize:10,color:"#3dcc70",fontFamily:"'Crimson Pro',serif"}}>
              Tap <strong style={{color:"#f0c040"}}>{mvCmd.n}</strong>'s destination on the map.
              Tap a <strong style={{color:"#44ff88"}}>friendly tile</strong> to Move. To attack, use the Attack command on the target tile.
            </div>
            {cmdsOnSel.filter(c=>!c.march).length > 1 && (
              <div style={{marginBottom:10}}>
                <div style={{fontSize:8,color:"#8a7a6a",fontFamily:"'Cinzel',serif",letterSpacing:".1em",marginBottom:6}}>WHICH COMMANDER?</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {cmdsOnSel.filter(c=>!c.march).map(cmd => (
                    <div key={cmd.uid} onClick={() => setMvCmd(cmd)}
                      style={{background:mvCmd.uid===cmd.uid?"rgba(40,160,80,.2)":"rgba(255,255,255,.04)",border:`2px solid ${mvCmd.uid===cmd.uid?"#3daa60":"rgba(255,255,255,.08)"}`,borderRadius:7,padding:"8px 10px",cursor:"pointer",textAlign:"center",minWidth:80}}>
                      <div style={{fontSize:22}}>{cmd.icon}</div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"#e0d0c0",fontWeight:700}}>{cmd.n}</div>
                      <div style={{fontSize:8,color:"#3daa60"}}>{(cmd.troops||0).toLocaleString()} troops</div>
                      {mvCmd.uid===cmd.uid && <div style={{fontSize:7,color:"#3daa60",marginTop:2}}>✓ SELECTED</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="btn" onClick={() => { setMode("view"); setMvCmd(null); }}
              style={{padding:"7px 16px",background:"none",border:"1px solid #2a2a2a",color:"#555",fontSize:10}}>← Cancel</button>
          </div>
        )}

      </div>
    </div>
  )}

  {/* ══ COMMANDER PICKER — slides in from left ══ */}
  {mode==="pickAttackCmd" && atkKey && (
    <div style={{position:"fixed",top:38,left:0,bottom:0,width:280,zIndex:9500,background:"rgba(5,7,11,.97)",borderRight:"1px solid #3a2010",boxShadow:"4px 0 32px rgba(0,0,0,.9)",display:"flex",flexDirection:"column",animation:"slideInLeft .22s ease"}}>
      {/* Header */}
      <div style={{padding:"10px 12px",borderBottom:"1px solid #221e12",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"rgba(255,255,255,.025)"}}>
        <div>
          <div style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:12,color:"#c8a060"}}>⚔ SELECT COMMANDER</div>
          {atkKey && tiles[atkKey] && (
            <div style={{fontSize:8,color:"#7a5a4a",fontFamily:"'Crimson Pro',serif",marginTop:2}}>
              Attacking {TERR[tiles[atkKey].terrain]?.lbl}{tiles[atkKey].isHQ?" (HQ)":""} · {tiles[atkKey].garrison} garrison
              {(TERR[tiles[atkKey].terrain]?.def||0)!==0 && <span style={{color:TERR[tiles[atkKey].terrain]?.def>0?"#e08080":"#80e090"}}> · DEF {TERR[tiles[atkKey].terrain]?.def>0?"+":""}{TERR[tiles[atkKey].terrain]?.def}%</span>}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => { setMode("view"); setAtkKey(null); setPick(null); }}
          style={{background:"none",border:"1px solid #2a2a2a",color:"#555",fontSize:11,padding:"2px 8px"}}>✕</button>
      </div>

      {/* Commander list */}
      <div className="scr" style={{flex:1,overflowY:"auto",padding:"10px 12px"}}>
        {cmdsAdjToSel.length === 0 ? (
          <div style={{padding:"12px",background:"rgba(255,255,255,.02)",border:"1px solid #2a2020",borderRadius:5,fontSize:9,color:"#6a5a4a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",textAlign:"center"}}>
            No eligible commanders. A commander with troops must be on a player-owned tile to attack.
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {cmdsAdjToSel.map(cmd => {
              const at = tiles[atkKey];
              const picked = pickCmd?.uid === cmd.uid;
              const tt = cmd.troopType ? TROOP[cmd.troopType] : null;
              const defType = at?.defCmd?.troopType || at?.troopType || null;
              const mod = troopModifier(cmd.troopType, defType);
              const modColor = mod===1.1?"#3daa60":mod===0.9?"#cc3030":"#8a8a9a";
              const modLabel = mod===1.1?"⚔ STRONG":mod===0.9?"🛡 WEAK":"◆ NEUTRAL";
              const wp = (() => {
                const atkPow = (cmd.troops||0) * Math.pow(1.20,(cmd.lvl||5)-5) * mod;
                const dc = at?.defCmd;
                const defTroops = dc ? dc.troops : (at?.garrison||30);
                const defPow = defTroops * Math.pow(1.20,Math.max(0,(dc?.lvl||2)-2)) * (1+((TERR[at?.terrain]?.def||0)/100));
                if (atkPow<=0) return 1;
                return Math.round(Math.min(99,Math.max(1,100/(1+Math.pow(Math.max(0.00001,defPow/atkPow),3.5)))));
              })();
              return (
                <div key={cmd.uid} onClick={() => setPick(picked?null:cmd)}
                  style={{display:"flex",gap:10,alignItems:"center",padding:"10px 12px",background:picked?"rgba(60,170,100,.15)":"rgba(255,255,255,.03)",border:`2px solid ${picked?"#3daa60":"rgba(255,255,255,.06)"}`,borderRadius:8,cursor:"pointer",transition:"all .15s",boxShadow:picked?"0 0 12px rgba(60,170,100,.4)":"none"}}>
                  <div style={{fontSize:28,flexShrink:0}}>{cmd.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,color:picked?"#3daa60":"#e0d0c0",marginBottom:1}}>{cmd.n}</div>
                    <div style={{fontSize:8,color:SC(cmd.star),marginBottom:2}}>{SS(cmd.star)} · Lv{cmd.lvl||5}</div>
                    {tt
                      ? <div style={{fontSize:9,color:tt.color,fontWeight:700,marginBottom:2}}>{tt.icon} {tt.label} · {cmd.troops.toLocaleString()}</div>
                      : <div style={{fontSize:8,color:"#664a3a",fontStyle:"italic",marginBottom:2}}>No troops</div>}
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:8,color:modColor,fontWeight:700}}>{modLabel}</span>
                      <div style={{flex:1,height:3,background:"#181820",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${wp}%`,background:wp>=60?"#3daa60":wp>=40?"#d0a030":"#cc3030",borderRadius:2}}/>
                      </div>
                      <span style={{fontSize:8,color:wp>=60?"#3daa60":wp>=40?"#d0a030":"#cc3030",fontWeight:700,flexShrink:0}}>~{wp}%</span>
                    </div>
                  </div>
                  {picked && <div style={{fontSize:10,color:"#3daa60",flexShrink:0}}>✓</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* March button */}
      <div style={{padding:"12px",borderTop:"1px solid #221e12",flexShrink:0}}>
        <button className="btn" disabled={!pickCmd}
          onClick={() => { if (pickCmd && atkKey) { startMarch(pickCmd, atkKey); setAtkKey(null); setPick(null); setMode("view"); setSelKey(null); setPopupPos(null); } }}
          style={{width:"100%",padding:"13px",background:pickCmd?"linear-gradient(135deg,#881010,#cc2020,#881010)":"rgba(255,255,255,.02)",border:pickCmd?"2px solid #e03030":"2px solid #1a1a1a",color:pickCmd?"#f0c040":"#2a2a2a",fontSize:14,fontWeight:700,letterSpacing:".1em",boxShadow:pickCmd?"0 0 16px rgba(200,30,30,.45)":"none",transition:"all .2s",borderRadius:5}}>
          {pickCmd ? `⚔ MARCH! — ${pickCmd.n}` : "Select a commander"}
        </button>
      </div>
    </div>
  )}

  {/* ══ HQ MENU ══ */}
  {hqOpen && (
    <div style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"flex-end"}}
      onClick={() => setHqOpen(false)}>
      <div className="panel" onClick={e => e.stopPropagation()}
        style={{width:"100%",maxWidth:700,margin:"0 auto",maxHeight:"88vh",display:"flex",flexDirection:"column",borderRadius:"10px 10px 0 0",animation:"fadeUp .22s ease"}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid #221e12",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{fontFamily:"'Cinzel Decorative',serif",fontSize:13,background:"linear-gradient(135deg,#f0c040,#c03030,#f0c040)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite"}}>🏰 HEADQUARTERS</div>
          <button className="btn" onClick={() => setHqOpen(false)} style={{background:"none",border:"1px solid #2a2a2a",color:"#555",fontSize:11,padding:"3px 10px"}}>✕</button>
        </div>
        <div style={{display:"flex",borderBottom:"1px solid #221e12",flexShrink:0,overflowX:"auto"}}>
          {[["overview","📊","Overview"],["commanders","⚔","Commanders"],["army","🪖","Army"],["buildings","🏗","Buildings"],["troops","🔨","Troops"]].map(([id,icon,label]) => {
            const isActive = hqTab === id;
            return (
              <button key={id} className="btn" onClick={() => setHqTab(id)} style={{position:"relative",flex:isActive?"1 1 auto":"0 0 auto",padding:"10px 12px",background:isActive?"rgba(240,192,64,.1)":"none",borderBottom:isActive?"2px solid #f0c040":"2px solid transparent",color:isActive?"#f0c040":"#5a5050",fontSize:"clamp(9px,2vw,11px)",letterSpacing:".04em",whiteSpace:"nowrap",transition:"color .15s, background .15s"}}>
                {icon}{isActive && <span style={{marginLeft:5,fontFamily:"'Cinzel',serif",fontWeight:700}}>{label}</span>}
              </button>
            );
          })}
        </div>
        <div className="scr" style={{flex:1,overflowY:"auto",padding:12}}>

          {/* OVERVIEW */}
          {hqTab==="overview" && (
            <div>
              {/* Empire summary bar */}
              {(() => {
                const rssToBuilding = {stone:"quarry",wood:"lumber",ore:"forge",gas:"refinery"};
                const totalTroops = cmds.filter(c=>c.owner==="player").reduce((s,c)=>s+(c.troops||0),0);
                const activeCmds = cmds.filter(c=>c.owner==="player"&&c.march).length;
                return (
                  <>
                    <div style={{display:"flex",gap:6,marginBottom:10,padding:"8px 10px",background:"rgba(240,192,64,.05)",border:"1px solid rgba(240,192,64,.15)",borderRadius:6}}>
                      {[
                        {icon:"🗺",val:pKeys.size,lbl:"Tiles"},
                        {icon:"⚔",val:cmds.filter(c=>c.owner==="player").length,lbl:"Commanders"},
                        {icon:"🪖",val:totalTroops.toLocaleString(),lbl:"Troops"},
                        {icon:"🚶",val:activeCmds,lbl:"Marching"},
                      ].map(({icon,val,lbl}) => (
                        <div key={lbl} style={{flex:1,textAlign:"center"}}>
                          <div style={{fontSize:14}}>{icon}</div>
                          <div style={{fontFamily:"'Cinzel',serif",fontSize:12,fontWeight:700,color:"#e0d0c0",lineHeight:1.2}}>{val}</div>
                          <div style={{fontSize:7,color:"#6a5a4a",fontFamily:"'Cinzel',serif",letterSpacing:".04em"}}>{lbl}</div>
                        </div>
                      ))}
                    </div>
                    {/* Resources with production rates */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginBottom:12}}>
                      {RKEYS.map(k => {
                        const bldgKey = rssToBuilding[k];
                        const rate = (bldgs[bldgKey]||0) * (BLDG[bldgKey]?.rate||0);
                        const tileProd = Object.values(tiles).filter(t=>t.owner==="player"&&t.rss===k).length * 50;
                        const totalRate = rate + tileProd;
                        return (
                          <div key={k} style={{background:RSS[k].bg,border:`1px solid ${RSS[k].col}30`,borderRadius:5,padding:"8px 10px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div style={{fontSize:9,color:RSS[k].col,fontFamily:"'Cinzel',serif",fontWeight:700}}>{RSS[k].icon} {RSS[k].lbl}</div>
                              {totalRate>0 && <div style={{fontSize:7,color:RSS[k].col,opacity:.7,fontFamily:"'Cinzel',serif"}}>+{totalRate}/s</div>}
                            </div>
                            <div style={{fontSize:18,fontWeight:700,color:"#e0d0c0",fontFamily:"'Cinzel',serif",marginTop:2}}>{Math.floor(rss[k]).toLocaleString()}</div>
                          </div>
                        );
                      })}
                      <div style={{background:"rgba(240,192,64,.07)",border:"1px solid rgba(240,192,64,.2)",borderRadius:5,padding:"8px 10px"}}>
                        <div style={{fontSize:9,color:"#f0c040",fontFamily:"'Cinzel',serif",fontWeight:700}}>💎 Gems</div>
                        <div style={{fontSize:18,fontWeight:700,color:"#e0d0c0",fontFamily:"'Cinzel',serif",marginTop:2}}>{gems}</div>
                      </div>
                      <div style={{background:"rgba(40,100,60,.1)",border:"1px solid rgba(40,100,60,.3)",borderRadius:5,padding:"8px 10px"}}>
                        <div style={{fontSize:9,color:"#3daa60",fontFamily:"'Cinzel',serif",fontWeight:700}}>🗺 Tiles Owned</div>
                        <div style={{fontSize:18,fontWeight:700,color:"#e0d0c0",fontFamily:"'Cinzel',serif",marginTop:2}}>{pKeys.size}</div>
                      </div>
                    </div>
                  </>
                );
              })()}
              <div style={{marginBottom:12,padding:"10px 12px",background:"rgba(50,100,180,.08)",border:"1px solid rgba(80,140,220,.25)",borderRadius:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:"#88aaff",fontWeight:700}}>⛺ HEALING TENT — Lv{bldgs.healingtent||0}</div>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:12,color:woundedTroops>0?"#88aaff":"#4a4a6a",fontWeight:700}}>{woundedTroops.toLocaleString()} wounded</div>
                </div>
                {woundedTroops > 0 ? (
                  <>
                    <div style={{height:5,background:"#181820",borderRadius:3,overflow:"hidden",marginBottom:5}}>
                      <div style={{height:"100%",width:"100%",background:"linear-gradient(90deg,#3366cc,#88aaff)",borderRadius:3}}/>
                    </div>
                    <div style={{fontSize:8,color:"#6a7a9a",fontFamily:"'Crimson Pro',serif"}}>
                      Healing at <strong style={{color:"#88aaff"}}>{(bldgs.healingtent||0)*5}/sec</strong> → returning to barracks
                    </div>
                  </>
                ) : (
                  <div style={{fontSize:8,color:"#4a4a6a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>No wounded troops. 30% of battle casualties recover here.</div>
                )}
                {(bldgs.healingtent||0) < 1 && (
                  <div style={{fontSize:8,color:"#cc6030",fontFamily:"'Cinzel',serif",marginTop:4}}>⚠ Build a Healing Tent in Buildings to recover wounded troops.</div>
                )}
              </div>
              {bLog.length>0 && (
                <>
                  <div style={{fontSize:8,color:"#5a4030",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:5}}>BATTLE LOG</div>
                  {bLog.slice(0,6).map((l,i) => (
                    <div key={i} style={{fontSize:9,color:i===0?"#c0a880":"#3a3040",fontFamily:"'Crimson Pro',serif",marginBottom:3,borderBottom:"1px solid rgba(255,255,255,.02)",paddingBottom:2}}>{l}</div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* COMMANDERS */}
          {hqTab==="commanders" && (
            <div>
              <div style={{fontSize:9,color:"#5a4030",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:10}}>YOUR COMMANDERS ({cmds.filter(c=>c.owner==="player").length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {cmds.filter(c=>c.owner==="player").map(cmd => (
                  <div key={cmd.uid} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${SC(cmd.star)}40`,borderRadius:6,padding:"10px 12px",display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                    <div style={{fontSize:30,flexShrink:0}}>{cmd.icon}</div>
                    <div style={{flex:1,minWidth:130}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:12,color:"#e0d0c0"}}>{cmd.n}</span>
                        <span style={{color:SC(cmd.star),fontSize:9}}>{SS(cmd.star)}</span>
                        <span style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#f0c040",fontWeight:700}}>Lv{cmd.lvl||5}</span>
                      </div>
                      {(cmd.lvl||5) < CMD_LVL_MAX && (() => {
                        const needed = xpToNext(cmd.lvl||5);
                        const pct = Math.min(100, Math.floor(((cmd.xp||0)/needed)*100));
                        return (
                          <div style={{marginBottom:4}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#5a5a6a",marginBottom:2,fontFamily:"'Cinzel',serif"}}>
                              <span>XP</span><span>{cmd.xp||0}/{needed}</span>
                            </div>
                            <div style={{height:3,background:"#181820",borderRadius:2,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${pct}%`,background:"#f0c040",borderRadius:2,transition:"width .3s"}}/>
                            </div>
                          </div>
                        );
                      })()}
                      {(cmd.lvl||5) >= CMD_LVL_MAX && <div style={{fontSize:8,color:"#f0c040",fontFamily:"'Cinzel',serif",marginBottom:4}}>⭐ MAX LEVEL</div>}
                      {(() => {
                        const cap = cmdCommand(cmd.lvl||5, bldgs.commandcenter||0);
                        return (
                          <div style={{marginBottom:4,fontSize:8,color:"#7a8a9a",fontFamily:"'Cinzel',serif"}}>
                            📡 Command: <span style={{color:"#a0c0e0",fontWeight:700}}>{cap.toLocaleString()}</span>
                            <span style={{color:"#4a5a6a",marginLeft:4}}>({(cmd.lvl||5)}×120 + CC{bldgs.commandcenter||0}×300)</span>
                          </div>
                        );
                      })()}
                      <div style={{fontSize:9,color:"#7a6a5a",lineHeight:1.7,fontFamily:"'Crimson Pro',serif",marginBottom:4}}>
                        {/* Stat row */}
                        <div style={{display:"flex",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{color:"#e06040"}}>⚔ ATK <b style={{color:"#f08060"}}>{cmd.atk||0}</b></span>
                          <span style={{color:"#aa55ff"}}>✦ FOC <b style={{color:"#cc88ff"}}>{cmd.foc||0}</b></span>
                          <span style={{color:"#40a8e0"}}>💨 SPD <b style={{color:"#60c8ff"}}>{cmd.spd||0}</b></span>
                        </div>
                        {/* Skill */}
                        {(() => {
                          const isWiz = cmd.faction === "bountyhunters";
                          const isMend = cmd.skill === "Mending Light";
                          const skillColor = isWiz ? (isMend ? "#40e898" : "#bb66ff") : "#8030cc";
                          const skillPrefix = isWiz ? (isMend ? "💚 " : "🔮 ") : "⚔ ";
                          return <span style={{color:skillColor}}>{skillPrefix}{cmd.skill}</span>;
                        })()}<br/>
                        {(() => { const pf = PLAYABLE_FACTIONS.find(f=>f.key===cmd.faction); return pf ? <span style={{color:pf.c,fontSize:8}}>{pf.s} {pf.n}</span> : null; })()}<br/>
                        {(() => {
                          const isHQTile = cmd.tk === `${HQP.player.c},${HQP.player.r}`;
                          if (cmd.march) {
                            const destTerrain = tiles[cmd.march.dest]?.terrain;
                            const destLabel = cmd.march.dest === `${HQP.player.c},${HQP.player.r}` ? "HQ" : (destTerrain ? TERR[destTerrain]?.lbl||destTerrain : cmd.march.dest);
                            const eta = Math.ceil((cmd.march.path.length-cmd.march.step-1)*cmd.march.stepMs/1000);
                            const isAtk = cmd.march.type==="attack";
                            return <span style={{display:"inline-block",padding:"1px 6px",borderRadius:3,background:isAtk?"rgba(200,30,30,.2)":"rgba(40,140,80,.2)",border:`1px solid ${isAtk?"#cc3030":"#3daa60"}`,color:isAtk?"#ff8080":"#80d090",fontSize:8}}>{isAtk?"⚔":"🚶"} → {destLabel} (~{eta}s)</span>;
                          }
                          const terrLbl = isHQTile ? "HQ" : (tiles[cmd.tk]?.terrain ? TERR[tiles[cmd.tk].terrain]?.lbl||cmd.tk : cmd.tk);
                          const owned = tiles[cmd.tk]?.owner === "player";
                          return <span style={{display:"inline-block",padding:"1px 6px",borderRadius:3,background:isHQTile?"rgba(240,192,64,.15)":owned?"rgba(30,160,100,.15)":"rgba(100,100,100,.1)",border:`1px solid ${isHQTile?"rgba(240,192,64,.4)":owned?"rgba(30,160,100,.3)":"#333"}`,color:isHQTile?"#f0c040":owned?"#80d090":"#8a8a8a",fontSize:8}}>📍 {terrLbl}</span>;
                        })()}
                        {cmd.march && (
                          <button className="btn" onClick={() => recallMarch(cmd.uid)}
                            style={{marginLeft:6,padding:"1px 6px",background:"rgba(200,80,80,.2)",border:"1px solid #cc4444",color:"#ff8888",fontSize:7}}>↩ Recall</button>
                        )}
                      </div>
                    </div>
                    <div style={{textAlign:"center",flexShrink:0}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:16,color:cmd.troops>50?"#3daa60":"#cc3030",fontWeight:700}}>{cmd.troops||0}</div>
                      <div style={{fontSize:8,color:"#5a5060",marginBottom:4}}>troops</div>
                      <button className="btn" onClick={() => setHqTab("army")} style={{padding:"3px 8px",background:"rgba(40,100,60,.12)",border:"1px solid rgba(40,100,60,.35)",color:"#3daa60",fontSize:9}}>Assign</button>
                    </div>
                  </div>
                ))}
                {cmds.filter(c=>c.owner==="player").length===0 && <div style={{color:"#4a4050",fontSize:10,fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>No commanders. Summon heroes first.</div>}
              </div>
              <button className="btn" onClick={() => { setHqOpen(false); setScreen("gacha"); }} style={{marginTop:12,padding:"7px 16px",background:"rgba(120,50,150,.18)",border:"1px solid rgba(153,64,204,.35)",color:"#bb88ee",fontSize:11}}>✦ Summon More</button>
            </div>
          )}

          {/* BUILDINGS */}
          {hqTab==="buildings" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:9,color:"#5a4030",letterSpacing:".1em",fontFamily:"'Cinzel',serif"}}>BUILDINGS</div>
                <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"#f0c040",fontWeight:700}}>🏰 HQ Lv{bldgs.hq||1}</div>
              </div>
              <div style={{fontSize:8,color:"#4a3a2a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginBottom:10}}>HQ gates all upgrades. Resource buildings unlock 2 levels per HQ level.</div>
              {[
                {label:"⛏ Resource",keys:["quarry","lumber","forge","refinery"]},
                {label:"⚔ Military",keys:["barracks","training","commandcenter","healingtent","academy"]},
                {label:"🏛 Fortification",keys:["hq","walls"]},
              ].map(group => (
                <div key={group.label} style={{marginBottom:14}}>
                  <div style={{fontSize:8,color:"#5a4a30",letterSpacing:".12em",fontFamily:"'Cinzel',serif",fontWeight:700,marginBottom:6,paddingBottom:4,borderBottom:"1px solid #1e1810"}}>{group.label}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {group.keys.map(key => { const def = BLDG[key]; if (!def) return null;
                  const lvl = bldgs[key]||0;
                  const hqLvl = bldgs.hq||1;
                  const avail = maxAvailLevel(key, hqLvl);
                  const isAbsMax = lvl >= def.max;
                  const isGated = !isAbsMax && lvl >= avail;
                  const canUpgrade = !isAbsMax && !isGated;
                  const cost = canUpgrade ? upgCost(key, lvl) : null;
                  const ok = cost && canAfford(cost);
                  return (
                    <div key={key} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${isGated?"#3a2a10":"#221e12"}`,borderRadius:5,padding:"9px 12px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{fontSize:22,flexShrink:0}}>{def.icon}</div>
                      <div style={{flex:1,minWidth:140}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                          <span style={{fontFamily:"'Cinzel',serif",fontWeight:600,fontSize:11,color:"#e0d0c0"}}>{def.n}</span>
                          <span style={{fontSize:9,color:"#4a4030"}}>Lv{lvl} / <span style={{color:"#6a5a3a"}}>{avail}</span> <span style={{color:"#3a3030"}}>({def.max} max)</span></span>
                        </div>
                        <div style={{fontSize:9,color:"#6a5a50",fontFamily:"'Crimson Pro',serif",marginBottom:3}}>{def.desc}</div>
                        {def.rss && lvl>0 && <div style={{fontSize:9,color:RSS[def.rss]?.col}}>{RSS[def.rss]?.icon} +{(def.rate||0)*lvl}/s</div>}
                        {key==="barracks" && <div style={{fontSize:8,color:"#6a8aaa"}}>Capacity: {barracksCapacity(lvl).toLocaleString()}</div>}
                        {isGated && <div style={{fontSize:7,color:"#8a6020",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginTop:2}}>🔒 Upgrade HQ to unlock next level</div>}
                        <div style={{display:"flex",gap:1,marginTop:4}}>
                          {Array.from({length:Math.min(avail,20)}).map((_,i) => (
                            <div key={i} style={{flex:1,height:3,background:i<lvl?"#f0c040":i<avail?"#2a2010":"#181820",borderRadius:2,minWidth:2}}/>
                          ))}
                        </div>
                      </div>
                      {(() => {
                        const inProgress = upgQueue[key];
                        if (inProgress) {
                          const pct = Math.max(0, Math.min(100, ((Date.now() - inProgress.startedAt) / inProgress.dur) * 100));
                          const secsLeft = Math.max(0, Math.ceil((inProgress.endsAt - Date.now()) / 1000));
                          const mm = Math.floor(secsLeft / 60), ss = secsLeft % 60;
                          const timeStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
                          return (
                            <div style={{flexShrink:0,minWidth:80,textAlign:"right"}}>
                              <div style={{fontSize:8,color:"#f0c040",fontFamily:"'Cinzel',serif",marginBottom:3}}>
                                ⚙ Lv{inProgress.newLvl} · {timeStr}
                              </div>
                              <div style={{height:4,background:"#181820",borderRadius:2,overflow:"hidden",width:80}}>
                                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#c03030,#f0c040)",borderRadius:2,transition:"width .5s linear"}}/>
                              </div>
                            </div>
                          );
                        }
                        if (isAbsMax) return <div style={{fontSize:9,color:"#f0c040",fontFamily:"'Cinzel',serif",flexShrink:0}}>MAX</div>;
                        if (isGated)  return <div style={{fontSize:9,color:"#6a4a10",fontFamily:"'Cinzel',serif",flexShrink:0}}>🔒</div>;
                        if (!cost)    return null;
                        const nextDurMs = upgDuration(key, lvl+1);
                        const mm = Math.floor(nextDurMs/60000), ss = Math.floor((nextDurMs%60000)/1000);
                        const durStr = mm > 0 ? `${mm}m ${ss>0?ss+'s':''}` : `${ss}s`;
                        return (
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:8,marginBottom:2}}>
                              {Object.entries(cost).filter(([,v]) => v>0).map(([k,v]) => (
                                <span key={k} style={{marginRight:4,color:(rss[k]||0)>=v?RSS[k]?.col||"#888":"#cc3030",fontFamily:"'Cinzel',serif"}}>{RSS[k]?.icon||k}{v.toLocaleString()}</span>
                              ))}
                            </div>
                            <div style={{fontSize:7,color:"#5a4a2a",fontFamily:"'Crimson Pro',serif",marginBottom:3}}>⏱ {durStr}</div>
                            <button className="btn" disabled={!ok} onClick={() => upgrade(key)}
                              style={{padding:"4px 10px",background:ok?"linear-gradient(135deg,rgba(180,40,40,.4),rgba(180,40,40,.15))":"rgba(255,255,255,.02)",border:`1px solid ${ok?"#c03030":"#1a1a1a"}`,color:ok?"#f0c040":"#222",fontSize:10}}>
                              ▲ Upgrade
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ARMY */}
          {hqTab==="army" && (
            <div>
              <div style={{marginBottom:12,padding:"10px 12px",background:"rgba(255,255,255,.03)",border:"1px solid #2a2010",borderRadius:6}}>
                {(() => {
                  const cap = barracksCapacity(bldgs.barracks||0);
                  const pct = Math.min(100, Math.round((barracksPool/cap)*100));
                  return (<>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:"#c8a060",fontWeight:700}}>🏕 BARRACKS POOL — Lv{bldgs.barracks||0}</div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:13,color:pct>50?"#3daa60":pct>10?"#d0a030":"#cc3030",fontWeight:700}}>
                        {barracksPool.toLocaleString()} / {cap.toLocaleString()}
                      </div>
                    </div>
                    <div style={{height:6,background:"#181820",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${pct}%`,background:pct>50?"#3daa60":pct>10?"#d0a030":"#cc3030",borderRadius:3,transition:"width .3s"}}/>
                    </div>
                    <div style={{fontSize:8,color:"#5a5060",marginTop:4,fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>
                      Troops available to assign. Train more in the Troops tab.
                    </div>
                  </>);
                })()}
              </div>
              <div style={{marginBottom:12,padding:"8px 10px",background:"rgba(255,255,255,.02)",border:"1px solid #1e1e2a",borderRadius:5}}>
                <div style={{fontSize:8,color:"#6a5a4a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:5}}>COMBAT TRIANGLE · +10% strong / -10% weak</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                  {TROOP_KEYS.map(k => {
                    const t = TROOP[k];
                    return (
                      <div key={k} style={{fontSize:8,color:"#7a7a8a",fontFamily:"'Crimson Pro',serif",lineHeight:1.5}}>
                        <span style={{color:t.color,fontWeight:700}}>{t.icon} {t.label}: </span>
                        <span style={{color:"#3daa60"}}>▲{t.strong.map(s=>TROOP[s].label).join(",")}</span>
                        {" "}
                        <span style={{color:"#cc3030"}}>▼{t.weak.map(w=>TROOP[w].label).join(",")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {cmds.filter(c=>c.owner==="player").map(cmd => {
                const hqKey = `${HQP.player.c},${HQP.player.r}`;
                const isAtHQ = cmd.tk === hqKey;
                const commandCap = cmdCommand(cmd.lvl||5, bldgs.commandcenter||0);
                const troopPct = commandCap > 0 ? Math.min(100, Math.floor(((cmd.troops||0)/commandCap)*100)) : 0;
                return (
                  <div key={cmd.uid} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${cmd.troopType?TROOP[cmd.troopType].color+"60":"#221e12"}`,borderRadius:6,padding:"10px 12px",marginBottom:10}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:24}}>{cmd.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,color:"#e0d0c0"}}>{cmd.n} <span style={{color:"#f0c040",fontSize:9}}>Lv{cmd.lvl||5}</span></div>
                        <div style={{fontSize:9,color:cmd.troops>0?TROOP[cmd.troopType]?.color||"#3daa60":"#6a5a5a"}}>
                          {cmd.troops>0
                            ? <>{TROOP[cmd.troopType]?.icon} {TROOP[cmd.troopType]?.label} · <strong style={{color:"#e0d0c0"}}>{cmd.troops.toLocaleString()}</strong> / {commandCap.toLocaleString()}</>
                            : "No troops assigned"}
                        </div>
                        <div style={{fontSize:7,color:isAtHQ?"#3daa60":"#7a5a3a",marginTop:1,fontFamily:"'Cinzel',serif"}}>
                          {isAtHQ ? "🏰 At HQ" : `📍 ${cmd.tk} — recall to HQ to change type`}
                        </div>
                      </div>
                      {cmd.troops>0 && (
                        <button className="btn" onClick={() => returnTroops(cmd.uid)}
                          style={{padding:"3px 8px",background:"rgba(200,50,50,.15)",border:"1px solid rgba(200,50,50,.4)",color:"#cc5050",fontSize:8,flexShrink:0}}>
                          Return
                        </button>
                      )}
                    </div>
                    <div style={{marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#5a5060",marginBottom:2,fontFamily:"'Cinzel',serif"}}>
                        <span>📡 COMMAND</span>
                        <span style={{color:troopPct>=100?"#cc3030":troopPct>=75?"#d0a030":"#3daa60"}}>{(cmd.troops||0).toLocaleString()} / {commandCap.toLocaleString()}</span>
                      </div>
                      <div style={{height:4,background:"#181820",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${troopPct}%`,background:troopPct>=100?"#cc3030":troopPct>=75?"#d0a030":"#3daa60",borderRadius:2,transition:"width .3s"}}/>
                      </div>
                    </div>

                    {isAtHQ ? (
                      <>
                        <div style={{fontSize:8,color:"#6a5a4a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:6}}>SELECT TROOP TYPE</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:10}}>
                          {TROOP_KEYS.map(tk => {
                            const t = TROOP[tk];
                            const isActive = cmd.troopType === tk;
                            return (
                              <button key={tk} className="btn"
                                onClick={() => setCmds(p => p.map(c => c.uid===cmd.uid ? {...c, troopType:tk} : c))}
                                style={{
                                  padding:"6px 8px", textAlign:"left",
                                  background: isActive ? `rgba(${parseInt(t.color.slice(1,3),16)},${parseInt(t.color.slice(3,5),16)},${parseInt(t.color.slice(5,7),16)},0.2)` : "rgba(255,255,255,.03)",
                                  border: `1px solid ${isActive ? t.color : t.color+"40"}`,
                                  color: isActive ? t.color : "#8a8a9a",
                                  fontSize:10,
                                  boxShadow: isActive ? `0 0 8px ${t.color}40` : "none",
                                }}>
                                <div style={{fontSize:14,marginBottom:2}}>{t.icon}</div>
                                <div style={{fontFamily:"'Cinzel',serif",fontWeight:700,fontSize:9}}>{t.label}</div>
                                <div style={{fontSize:7,color:"#6a6a7a",marginTop:1}}>{t.desc}</div>
                                {isActive && <div style={{fontSize:7,color:t.color,marginTop:2}}>✓ SELECTED</div>}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div style={{marginBottom:10,padding:"8px 10px",background:"rgba(150,80,20,.08)",border:"1px solid rgba(150,80,20,.25)",borderRadius:4,display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:16}}>🔒</span>
                        <div>
                          <div style={{fontFamily:"'Cinzel',serif",fontSize:9,color:"#c8903a",fontWeight:700}}>TROOP TYPE LOCKED</div>
                          <div style={{fontSize:8,color:"#7a6a4a",fontFamily:"'Crimson Pro',serif",marginTop:1}}>
                            Return this commander to HQ to change their troop type.
                          </div>
                        </div>
                        {cmd.troopType && (
                          <div style={{marginLeft:"auto",textAlign:"center",flexShrink:0}}>
                            <div style={{fontSize:18}}>{TROOP[cmd.troopType].icon}</div>
                            <div style={{fontSize:7,color:TROOP[cmd.troopType].color,fontFamily:"'Cinzel',serif"}}>{TROOP[cmd.troopType].label}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {cmd.troopType && isAtHQ && (() => {
                      const sliderVal = sliderVals[cmd.uid] ?? (cmd.troops||0);
                      const maxSlider = Math.min(commandCap, barracksPool + (cmd.troops||0));
                      const delta = sliderVal - (cmd.troops||0);
                      return (
                        <div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#6a5a4a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:4}}>
                            <span>ASSIGN TROOPS</span>
                            <span style={{color:delta>0?"#3daa60":delta<0?"#cc5050":"#5a5060"}}>
                              {sliderVal.toLocaleString()} / {commandCap.toLocaleString()}
                              {delta!==0 && <span style={{marginLeft:4}}>{delta>0?`(+${delta})`:delta}</span>}
                            </span>
                          </div>
                          <input type="range" min={0} max={commandCap}
                            value={sliderVal}
                            onChange={e => setSliderVals(v=>({...v,[cmd.uid]:+e.target.value}))}
                            style={{width:"100%",accentColor:"#3daa60",marginBottom:8}}/>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#4a4a5a",marginBottom:8}}>
                            <span>0</span>
                            <span style={{color:"#5a7a5a"}}>Barracks: {barracksPool.toLocaleString()}</span>
                            <span>{commandCap.toLocaleString()}</span>
                          </div>
                          {delta!==0 && (
                            <button className="btn"
                              onClick={() => { assignTroops(cmd.uid, cmd.troopType, sliderVal); }}
                              style={{width:"100%",padding:"8px",background:delta>0?"linear-gradient(135deg,rgba(40,100,60,.5),rgba(40,100,60,.2))":"linear-gradient(135deg,rgba(150,40,40,.4),rgba(150,40,40,.15))",border:`1px solid ${delta>0?"#3daa60":"#cc4444"}`,color:delta>0?"#3dcc70":"#dd6666",fontSize:11,fontWeight:700}}>
                              {delta>0?`✓ Add ${delta} troops`:`✓ Remove ${Math.abs(delta)} troops`}
                            </button>
                          )}
                          {delta===0 && <div style={{fontSize:8,color:"#4a4a5a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",textAlign:"center"}}>Move slider to assign</div>}
                        </div>
                      );
                    })()}

                    {cmd.troopType && !isAtHQ && (() => {
                      const sliderVal = sliderVals[cmd.uid] ?? (cmd.troops||0);
                      const currentTroops = cmd.troops||0;
                      const toRemove = currentTroops - sliderVal;
                      return (
                        <div>
                          <div style={{fontSize:8,color:"#6a7a9a",letterSpacing:".1em",fontFamily:"'Cinzel',serif",marginBottom:4}}>
                            ✏️ EDIT ARMY — removal only · use Reinforce to add troops
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#5a6a7a",marginBottom:4,fontFamily:"'Cinzel',serif"}}>
                            <span>Troops</span>
                            <span style={{color:toRemove>0?"#cc5050":"#3daa60"}}>
                              {sliderVal.toLocaleString()} / {commandCap.toLocaleString()}
                              {toRemove>0 && <span style={{color:"#cc5050",marginLeft:4}}>(-{toRemove})</span>}
                            </span>
                          </div>
                          <input type="range" min={1} max={currentTroops}
                            value={sliderVal}
                            onChange={e => setSliderVals(v=>({...v,[cmd.uid]:+e.target.value}))}
                            style={{width:"100%",accentColor:"#cc5050",marginBottom:8}}/>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#4a4a5a",marginBottom:8}}>
                            <span>1</span>
                            <span>{currentTroops.toLocaleString()} (current)</span>
                          </div>
                          {toRemove>0 ? (
                            <button className="btn"
                              onClick={() => {
                                setBarracks(p => p + toRemove);
                                setCmds(p => p.map(c => c.uid===cmd.uid ? {...c, troops:sliderVal} : c));
                              }}
                              style={{width:"100%",padding:"8px",background:"linear-gradient(135deg,rgba(150,40,40,.4),rgba(150,40,40,.15))",border:"1px solid #cc4444",color:"#dd6666",fontSize:11,fontWeight:700}}>
                              ✓ Remove {toRemove} troops → Barracks
                            </button>
                          ) : (
                            <div style={{fontSize:8,color:"#4a4a5a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",textAlign:"center"}}>Slide left to remove troops</div>
                          )}
                        </div>
                      );
                    })()}

                    {!cmd.troopType && isAtHQ && (
                      <div style={{fontSize:8,color:"#5a5060",fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>Select a troop type above first.</div>
                    )}
                    {!cmd.troopType && !isAtHQ && (
                      <div style={{padding:"7px 10px",background:"rgba(50,100,180,.07)",border:"1px solid rgba(80,140,220,.2)",borderRadius:4,fontSize:8,color:"#6a7a9a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>
                        🔄 No troops assigned. Recall to HQ to assign a troop type.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TROOPS */}
          {hqTab==="troops" && (
            <div>
              {/* Barracks status */}
              {(() => {
                const cap = barracksCapacity(bldgs.barracks||0);
                const pct = Math.min(100, Math.round((barracksPool/cap)*100));
                return (
                  <div style={{marginBottom:12,padding:"10px 12px",background:"rgba(255,255,255,.03)",border:"1px solid #2a2010",borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:"#c8a060",fontWeight:700}}>🏕 BARRACKS — Lv{bldgs.barracks||0}</div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:13,color:pct>50?"#3daa60":pct>10?"#d0a030":"#cc3030",fontWeight:700}}>
                        {barracksPool.toLocaleString()} / {cap.toLocaleString()}
                      </div>
                    </div>
                    <div style={{height:6,background:"#181820",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${pct}%`,background:pct>50?"#3daa60":pct>10?"#d0a030":"#cc3030",borderRadius:3,transition:"width .3s"}}/>
                    </div>
                    <div style={{fontSize:7,color:"#5a4a3a",marginTop:3,fontFamily:"'Crimson Pro',serif"}}>Upgrade Barracks to increase capacity. Max Lv10 = 90,000</div>
                  </div>
                );
              })()}

              {/* Active training queue */}
              {trainingQueue && (() => {
                const pct = Math.round(((trainingQueue.total - trainingQueue.remaining) / trainingQueue.total) * 100);
                const rate = trainRate(bldgs.training||0);
                const secsLeft = Math.ceil(trainingQueue.remaining / rate);
                return (
                  <div style={{marginBottom:12,padding:"10px 12px",background:"rgba(40,80,160,.1)",border:"1px solid rgba(60,120,220,.35)",borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#88aaff",fontWeight:700}}>⚔️ TRAINING IN PROGRESS</div>
                      <div style={{fontSize:9,color:"#6a8aaa",fontFamily:"'Cinzel',serif"}}>{trainingQueue.remaining.toLocaleString()} left · ~{secsLeft}s</div>
                    </div>
                    <div style={{height:6,background:"#181820",borderRadius:3,overflow:"hidden",marginBottom:4}}>
                      <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#3366cc,#88aaff)",borderRadius:3,transition:"width 1s linear"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#4a5a7a",fontFamily:"'Crimson Pro',serif"}}>
                      <span>Training {trainingQueue.total.toLocaleString()} troops</span>
                      <span>{rate}/s · Lv{bldgs.training||0} Training Grounds</span>
                    </div>
                  </div>
                );
              })()}

              {/* Train troops slider */}
              {(() => {
                const cap = barracksCapacity(bldgs.barracks||0);
                const room = cap - barracksPool;
                const maxBatch = maxTrainBatch(bldgs.training||0);
                const sliderMax = Math.max(1, Math.min(maxBatch, room));
                const sliderVal = Math.min(trainSlider, sliderMax);
                const cost = {stone:sliderVal*2, wood:sliderVal*2, ore:sliderVal, gas:Math.floor(sliderVal*0.5)};
                const affordable = canAfford(cost);
                const rate = trainRate(bldgs.training||0);
                const estSecs = sliderVal > 0 ? Math.ceil(sliderVal / rate) : 0;
                const canQueue = !trainingQueue && sliderVal > 0 && affordable && room > 0;
                return (
                  <div style={{padding:"10px 12px",background:"rgba(255,255,255,.02)",border:"1px solid #1e1e2a",borderRadius:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"#c8a060",fontWeight:700}}>⚔️ TRAINING GROUNDS — Lv{bldgs.training||0}</div>
                      <div style={{fontSize:8,color:"#6a7a9a",fontFamily:"'Cinzel',serif"}}>{rate.toLocaleString()} troops/s</div>
                    </div>
                    {room <= 0 ? (
                      <div style={{fontSize:9,color:"#8a6020",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",padding:"4px 0"}}>Barracks full. Assign troops to commanders first.</div>
                    ) : trainingQueue ? (
                      <div style={{fontSize:9,color:"#6a7a9a",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",padding:"4px 0"}}>Training in progress. Queue another batch when complete.</div>
                    ) : (<>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#6a5a4a",fontFamily:"'Cinzel',serif",marginBottom:4}}>
                        <span>QUEUE SIZE</span>
                        <span style={{color:"#88aaff",fontWeight:700}}>{sliderVal.toLocaleString()} troops</span>
                      </div>
                      <input type="range" min={1} max={sliderMax} value={sliderVal}
                        onChange={e => setTrainSlider(+e.target.value)}
                        style={{width:"100%",accentColor:"#3366cc",marginBottom:6}}/>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#4a4a5a",marginBottom:8}}>
                        <span>1</span>
                        <span style={{color:"#5a6a7a"}}>Max: {sliderMax.toLocaleString()}</span>
                        <span>{sliderMax.toLocaleString()}</span>
                      </div>
                      <div style={{fontSize:8,marginBottom:8,lineHeight:1.8,flexWrap:"wrap",display:"flex",gap:6}}>
                        <span style={{color:affordable?RSS.stone.col:"#cc3030"}}>🪨{(sliderVal*2).toLocaleString()}</span>
                        <span style={{color:affordable?RSS.wood.col:"#cc3030"}}>🪵{(sliderVal*2).toLocaleString()}</span>
                        <span style={{color:affordable?RSS.ore.col:"#cc3030"}}>⛏{sliderVal.toLocaleString()}</span>
                        <span style={{color:affordable?RSS.gas.col:"#cc3030"}}>⚗{Math.floor(sliderVal*0.5).toLocaleString()}</span>
                        <span style={{color:"#5a6a7a"}}>· ~{estSecs}s</span>
                      </div>
                      <button className="btn" disabled={!canQueue}
                        onClick={() => queueTraining(sliderVal)}
                        style={{width:"100%",padding:"10px",background:canQueue?"linear-gradient(135deg,rgba(40,80,160,.5),rgba(40,80,160,.2))":"rgba(255,255,255,.02)",border:`1px solid ${canQueue?"rgba(60,120,220,.6)":"#181818"}`,color:canQueue?"#88aaff":"#2a2a2a",fontSize:12,fontWeight:700,letterSpacing:".08em"}}>
                        {canQueue?`⚔ Queue ${sliderVal.toLocaleString()} Troops`:!affordable?"Insufficient resources":"Training in progress"}
                      </button>
                    </>)}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )}

  {/* ══ MINIMAP ══ */}
  <div style={{position:"fixed",bottom:8,right:8,zIndex:180,width:96,height:74,background:"rgba(4,6,10,.92)",border:"1px solid #221e12",borderRadius:4,overflow:"hidden"}}>
    <svg width="96" height="74" viewBox={`0 0 ${COLS} ${ROWS}`} style={{display:"block"}}>
      {Object.values(tiles).map(t => {
        const fill = t.isWin && !t.owner ? "#f0c040"
          : t.owner==="player" ? "#3daa60"
          : "#2a2d35";
        return <rect key={t.k} x={t.c} y={t.r} width={1} height={1} fill={fill} opacity={t.owner||t.isWin?1:0.35}/>;
      })}
      <rect x={WIN_C-.3} y={WIN_R-.3} width={1.6} height={1.6} fill="none" stroke="#f0c040" strokeWidth=".4"/>
      {cmds.filter(c=>c.owner==="player").map(cmd => {
        if (!cmd.tk) return null;
        const [tc,tr] = cmd.tk.split(",").map(Number);
        return <rect key={cmd.uid} x={tc-.4} y={tr-.4} width={1.2} height={1.2} fill="#f0e030" opacity={.95}/>;
      })}
      <rect
        x={Math.max(0,-panSt.x/TW)} y={Math.max(0,-panSt.y/(TH/2))}
        width={Math.min(COLS, window.innerWidth/TW)} height={Math.min(ROWS, (window.innerHeight-38)/(TH/2))}
        fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".4"/>
    </svg>
    <div style={{position:"absolute",bottom:1,left:2,fontSize:6,color:"#3a3040",fontFamily:"'Cinzel',serif"}}>MINIMAP</div>
  </div>
  <div style={{position:"fixed",bottom:94,right:8,zIndex:179,display:"flex",flexDirection:"column",gap:2}}>
    {[["#3daa60","Your tiles"],["#c83222","Enemy tiles"],["#f0c040","⚜ Holy Grail"],["#2a2d35","Neutral"]].map(([col,lbl])=>(
      <div key={lbl} style={{display:"flex",alignItems:"center",gap:3}}>
        <div style={{width:7,height:7,background:col,borderRadius:1,flexShrink:0}}/>
        <span style={{fontSize:7,color:"#5a5a6a",fontFamily:"'Cinzel',serif",whiteSpace:"nowrap"}}>{lbl}</span>
      </div>
    ))}
  </div>
</div>

);
}