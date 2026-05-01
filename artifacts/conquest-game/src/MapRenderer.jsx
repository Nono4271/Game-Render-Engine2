import { useEffect, useRef, useCallback } from "react";
import * as PIXI from "pixi.js";

/* ─── Tile geometry (mirror of Game.jsx constants) ──────────────────────── */
const TW = 72, TH = 36, TOP_PAD = 60, SW = 40;
const COLS = 53, ROWS = 53;
const ISO_W = (COLS + 1) * TW + TW / 2;
const ISO_H = ROWS * (TH / 2) + TH + SW + TOP_PAD + 40;

function isoXY(c, r) {
  return { cx: c * TW + (r % 2 === 0 ? TW / 2 : TW), cy: r * (TH / 2) + TOP_PAD };
}

/* ─── Hex string → PIXI number ──────────────────────────────────────────── */
const hc = h => parseInt(h.slice(1), 16);

/* ─── Terrain visual palette ─────────────────────────────────────────────── */
const TV = {
  grass:    { ul: hc('#5a6e48'), ur: hc('#4a5e38'), ll: hc('#3a4e2e'), lr: hc('#2a3e1e'), lw: hc('#242e1c'), rw: hc('#1c2416'), mid: hc('#3a4e2e'), acc: hc('#4a6038') },
  forest:   { ul: hc('#2e6a32'), ur: hc('#206424'), ll: hc('#185618'), lr: hc('#104810'), lw: hc('#0e2810'), rw: hc('#0a200c'), mid: hc('#1e4a22'), acc: hc('#2a6030') },
  mountain: { ul: hc('#a89578'), ur: hc('#8e7b5e'), ll: hc('#6e604a'), lr: hc('#504838'), lw: hc('#3a3028'), rw: hc('#2c2420'), mid: hc('#6a5c48'), acc: hc('#8a7860') },
  desert:   { ul: hc('#dab878'), ur: hc('#baa060'), ll: hc('#9a8048'), lr: hc('#7a6030'), lw: hc('#5a4c28'), rw: hc('#443a20'), mid: hc('#8a7840'), acc: hc('#a09050') },
  ruin:     { ul: hc('#605a56'), ur: hc('#504a46'), ll: hc('#3e3a36'), lr: hc('#2e2a26'), lw: hc('#1e1c1a'), rw: hc('#181614'), mid: hc('#3a3430'), acc: hc('#504846') },
  shore:    { ul: hc('#cdb882'), ur: hc('#b8a070'), ll: hc('#a89060'), lr: hc('#887050'), lw: hc('#7a6040'), rw: hc('#5a4830'), mid: hc('#b09060'), acc: hc('#c8a870') },
};
const TV_DEF = TV.grass;

/* ─── Resource prop colors ───────────────────────────────────────────────── */
const RC = {
  wood:  { shadow: 0x0a1a08, trunk: 0x5a3a18, dark: 0x1a4010, mid: 0x2a6018, light: 0x3a8a22, hi: 0x60c040 },
  stone: { shadow: 0x181820, dark: 0x3a3a48, mid: 0x6a6a7a, light: 0x9a9aaa, hi: 0xc8c8d8 },
  ore:   { shadow: 0x0a0a18, dark: 0x1a2a50, mid: 0x2a4a80, light: 0x4a7ac0, hi: 0x88b8f0, glow: 0xaad4ff },
  gas:   { shadow: 0x0a1a08, dark: 0x1a4a20, mid: 0x28802a, light: 0x50c050, hi: 0x90f090, glow: 0xb0ffb0 },
};

/* ─── Pan clamping ───────────────────────────────────────────────────────── */
function clampPan(x, y) {
  return {
    x: Math.min(60, Math.max(-(ISO_W - window.innerWidth + 60), x)),
    y: Math.min(60, Math.max(-(ISO_H - (window.innerHeight - 40) + 60), y)),
  };
}

/* ─── World coords → tile key ────────────────────────────────────────────── */
function worldToKey(wx, wy, tiles) {
  const rEst = Math.round((wy - TOP_PAD) / (TH / 2));
  for (let dr = -2; dr <= 2; dr++) {
    const r = rEst + dr;
    if (r < 0 || r >= ROWS) continue;
    const cEst = Math.round((wx - (r % 2 === 0 ? TW / 2 : TW)) / TW);
    for (let dc = -2; dc <= 2; dc++) {
      const c = cEst + dc;
      if (c < 0 || c >= COLS) continue;
      const key = `${c},${r}`;
      if (!tiles[key]) continue;
      const tile = tiles[key];
      const { cx, cy } = isoXY(c, r);
      const elev = tile.isHQ ? 14 : tile.isWin ? 10 : 4;
      const sy = cy - elev;
      if (Math.abs(wx - cx) / (TW / 2) + Math.abs(wy - (sy + TH / 2)) / (TH / 2) <= 1.08) return key;
    }
  }
  return null;
}

/* ─── Deterministic per-tile RNG ─────────────────────────────────────────── */
function tileRng(c, r) {
  let s = (((c + 1) * 73856093) ^ ((r + 1) * 19349663)) | 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
}

/* ─── Commander tile index ───────────────────────────────────────────────── */
function buildCByTile(cmds) {
  const m = {};
  cmds.forEach(c => { if (!c.tk) return; (m[c.tk] = m[c.tk] || []).push(c); });
  return m;
}

/* ─── Dirty hash (skip redraws when nothing visual changed) ─────────────── */
function tileHash(tile, selKey, mode, hasCmds, mvCmdUid) {
  const k = `${tile.c},${tile.r}`;
  return `${tile.owner}|${tile.garrison}|${tile.hasAiCommander}|${tile.garrisonDefeated}|${tile.powerLevel}|${selKey === k}|${mode}|${hasCmds}|${mvCmdUid || ""}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   TILE DRAWING
══════════════════════════════════════════════════════════════════════════ */
function drawTile(gfx, tile, selKey, mode, hasCmds, mvCmdUid) {
  const { c, r, terrain, owner, isHQ, isWin, rss, powerLevel } = tile;
  const key = `${c},${r}`;
  const isSel = selKey === key;
  const isMvTgt = mode === "selectMarchDest" && mvCmdUid && owner === "player";
  const elev = isHQ ? 14 : isWin ? 10 : 4;
  const { cx, cy } = isoXY(c, r);
  const sy = cy - elev;
  const mid = sy + TH / 2;

  /* flat polygon arrays for PIXI */
  const TOP  = [cx, sy,  cx+TW/2, mid, cx, sy+TH, cx-TW/2, mid];
  const LW   = [cx-TW/2, mid, cx, sy+TH, cx, sy+TH+SW, cx-TW/2, mid+SW];
  const RW   = [cx, sy+TH, cx+TW/2, mid, cx+TW/2, mid+SW, cx, sy+TH+SW];
  /* top-face quadrant triangles (gradient simulation) */
  const TUL  = [cx, sy, cx-TW/2, mid, cx, mid];
  const TUR  = [cx, sy, cx, mid, cx+TW/2, mid];
  const TLL  = [cx-TW/2, mid, cx, sy+TH, cx, mid];
  const TLR  = [cx, mid, cx, sy+TH, cx+TW/2, mid];

  const v = TV[terrain] || TV_DEF;
  gfx.clear();

  /* ── Walls ── */
  const lWc = (isHQ && owner) ? (owner === "player" ? hc('#1a5228') : hc('#3c0606')) : v.lw;
  const rWc = (isHQ && owner) ? (owner === "player" ? hc('#1a5228') : hc('#3c0606')) : v.rw;
  gfx.beginFill(lWc); gfx.drawPolygon(LW); gfx.endFill();
  gfx.beginFill(rWc); gfx.drawPolygon(RW); gfx.endFill();
  if (owner) {
    const wt = owner === "player" ? 0x1ea0b4 : 0xdc3c28;
    gfx.beginFill(wt, 0.38); gfx.drawPolygon(LW); gfx.endFill();
    gfx.beginFill(wt, 0.38); gfx.drawPolygon(RW); gfx.endFill();
  }

  /* ── Top face ── */
  if (isWin && !owner) {
    gfx.beginFill(0x2a2000); gfx.drawPolygon(TOP); gfx.endFill();
    gfx.beginFill(0xf0c040, 0.55); gfx.drawPolygon(TOP); gfx.endFill();
    gfx.lineStyle(2, 0xf0c040, 0.8); gfx.drawPolygon(TOP); gfx.lineStyle(0);
  } else {
    gfx.beginFill(v.ul); gfx.drawPolygon(TUL); gfx.endFill();
    gfx.beginFill(v.ur); gfx.drawPolygon(TUR); gfx.endFill();
    gfx.beginFill(v.ll); gfx.drawPolygon(TLL); gfx.endFill();
    gfx.beginFill(v.lr); gfx.drawPolygon(TLR); gfx.endFill();
    if (!owner) {
      gfx.beginFill(v.acc, 0.18); gfx.drawPolygon(TOP); gfx.endFill();
    }
  }

  /* ── Ownership tint ── */
  if (owner) {
    const ot = owner === "player" ? 0x1ea0b4 : 0xdc3c28;
    gfx.beginFill(ot, 0.28); gfx.drawPolygon(TOP); gfx.endFill();
    if (!isSel) {
      gfx.lineStyle(1.5, ot, 0.85); gfx.drawPolygon(TOP); gfx.lineStyle(0);
    }
  }

  /* ── Move mode dim ── */
  if (mode === "selectMarchDest" && owner !== "player") {
    gfx.beginFill(0x000000, 0.50); gfx.drawPolygon(TOP); gfx.endFill();
  }

  /* ── Move target highlight ── */
  if (isMvTgt) {
    gfx.beginFill(0x28dc6e, 0.22); gfx.drawPolygon(TOP); gfx.endFill();
  }

  /* props drawn in separate layer above gap/blend — see drawAllProps */

  /* ── Commander highlight border ── */
  if (hasCmds && !isSel) {
    gfx.lineStyle(2, 0xf0dc3c, 0.9); gfx.drawPolygon(TOP); gfx.lineStyle(0);
  }

  /* ── HQ castle ── */
  if (isHQ) {
    const fc  = owner === "player" ? 0x4dcc70 : owner === "ai" ? 0xdd4422 : 0xdddddd;
    const fc2 = owner === "player" ? 0x1a5228 : owner === "ai" ? 0x5c1008 : 0x333333;
    const bx = cx, by = sy - 2;
    gfx.beginFill(0x000000, 0.35); gfx.drawEllipse(bx, by+2, 14, 5); gfx.endFill();
    gfx.beginFill(fc2);
    gfx.drawPolygon([bx, by-20, bx+12, by-10, bx, by+2, bx-12, by-10]);
    gfx.endFill();
    gfx.beginFill(fc, 0.6);
    gfx.drawPolygon([bx, by-20, bx+12, by-10, bx+12, by-2, bx, by-12]);
    gfx.endFill();
    for (let dx = -8; dx <= 8; dx += 4) {
      gfx.beginFill(fc); gfx.drawRect(bx+dx-1.5, by-26, 3, 7); gfx.endFill();
    }
  }

  /* ── Selection border ── */
  if (isSel) {
    gfx.lineStyle(2.5, 0xffffff, 0.9); gfx.drawPolygon(TOP); gfx.lineStyle(0);
  }
}

/* ─── Resource props ─────────────────────────────────────────────────────── */
function drawRssProp(gfx, rss, cx, sy, c, r, pl) {
  const rnd = tileRng(c, r);
  const col = RC[rss] || RC.wood;
  const ground = sy + TH / 2 + 1;

  if (rss === "wood") {
    const n = Math.min(4, pl + 1);
    for (let i = 0; i < n; i++) {
      const dx = (rnd() - 0.5) * TW * 0.46;
      const dy = (rnd() - 0.5) * TH * 0.32;
      const sz = 5 + rnd() * 3 + pl * 1.2;
      const bx = cx + dx, by = ground + dy;

      /* shadow on ground */
      gfx.beginFill(col.shadow, 0.55);
      gfx.drawEllipse(bx, by + sz * 0.15, sz * 0.55, sz * 0.18);
      gfx.endFill();

      /* trunk */
      const tw = Math.max(1.5, sz * 0.18), th = sz * 0.55;
      gfx.beginFill(col.trunk);
      gfx.drawRect(bx - tw / 2, by - th, tw, th);
      gfx.endFill();

      /* canopy — three stacked layers, darkest at base */
      const layers = [
        { yOff: 0,       rx: sz * 0.68, ry: sz * 0.52, col: col.dark,  alpha: 1 },
        { yOff: -sz*0.28, rx: sz * 0.55, ry: sz * 0.44, col: col.mid,   alpha: 1 },
        { yOff: -sz*0.52, rx: sz * 0.38, ry: sz * 0.32, col: col.light, alpha: 1 },
      ];
      for (const l of layers) {
        gfx.lineStyle(0.8, col.dark, 0.6);
        gfx.beginFill(l.col, l.alpha);
        gfx.drawEllipse(bx, by - th + l.yOff, l.rx, l.ry);
        gfx.endFill();
        gfx.lineStyle(0);
      }
      /* highlight */
      gfx.beginFill(col.hi, 0.35);
      gfx.drawEllipse(bx - sz * 0.18, by - th - sz * 0.4, sz * 0.2, sz * 0.15);
      gfx.endFill();
    }

  } else if (rss === "stone") {
    const n = Math.min(5, pl + 2);
    for (let i = 0; i < n; i++) {
      const dx = (rnd() - 0.5) * TW * 0.44;
      const dy = (rnd() - 0.5) * TH * 0.32;
      const sz = 4 + rnd() * 3 + pl * 0.9;
      const bx = cx + dx, by = ground + dy;
      const skew = (rnd() - 0.5) * sz * 0.3;

      /* drop shadow */
      gfx.beginFill(col.shadow, 0.5);
      gfx.drawEllipse(bx + 1, by + 2, sz * 0.75, sz * 0.28);
      gfx.endFill();

      /* main rock body — irregular polygon */
      const pts = [
        bx + skew,        by - sz * 0.85,   // top
        bx + sz * 0.65,   by - sz * 0.35,   // top-right
        bx + sz * 0.72,   by + sz * 0.1,    // right
        bx + sz * 0.3,    by + sz * 0.38,   // bottom-right
        bx - sz * 0.3,    by + sz * 0.38,   // bottom-left
        bx - sz * 0.72,   by + sz * 0.1,    // left
        bx - sz * 0.55,   by - sz * 0.45,   // top-left
      ];
      gfx.lineStyle(1, col.dark, 0.9);
      gfx.beginFill(col.mid);
      gfx.drawPolygon(pts);
      gfx.endFill();
      gfx.lineStyle(0);

      /* dark shadow face — bottom right triangle */
      gfx.beginFill(col.dark, 0.5);
      gfx.drawPolygon([
        bx + sz * 0.3,  by + sz * 0.38,
        bx + sz * 0.72, by + sz * 0.1,
        bx + sz * 0.65, by - sz * 0.35,
        bx + skew * 0.5, by - sz * 0.1,
      ]);
      gfx.endFill();

      /* highlight face — upper left */
      gfx.beginFill(col.hi, 0.5);
      gfx.drawPolygon([
        bx + skew,       by - sz * 0.85,
        bx - sz * 0.55,  by - sz * 0.45,
        bx - sz * 0.2,   by - sz * 0.1,
        bx + skew * 0.5, by - sz * 0.5,
      ]);
      gfx.endFill();
    }

  } else if (rss === "ore") {
    /* crystal cluster */
    const n = Math.min(5, pl + 2);
    for (let i = 0; i < n; i++) {
      const dx = (rnd() - 0.5) * TW * 0.4;
      const dy = (rnd() - 0.5) * TH * 0.28;
      const sz = 4 + rnd() * 3 + pl * 0.9;
      const bx = cx + dx, by = ground + dy;
      const lean = (rnd() - 0.5) * sz * 0.5;

      /* glow base */
      gfx.beginFill(col.glow, 0.12);
      gfx.drawEllipse(bx, by + sz * 0.05, sz * 0.7, sz * 0.22);
      gfx.endFill();

      /* crystal shard — elongated hexagon */
      const hw = sz * 0.28;
      const crystal = [
        bx + lean,        by - sz * 1.1,     // tip
        bx + lean + hw,   by - sz * 0.5,     // upper-right
        bx + hw * 1.1,    by,                // lower-right
        bx,               by + sz * 0.22,    // base-center
        bx - hw * 1.1,    by,                // lower-left
        bx + lean - hw,   by - sz * 0.5,     // upper-left
      ];
      gfx.lineStyle(1, col.dark, 1);
      gfx.beginFill(col.mid);
      gfx.drawPolygon(crystal);
      gfx.endFill();
      gfx.lineStyle(0);

      /* bright left face */
      gfx.beginFill(col.light, 0.65);
      gfx.drawPolygon([
        bx + lean,       by - sz * 1.1,
        bx + lean - hw,  by - sz * 0.5,
        bx - hw * 1.1,   by,
        bx,              by + sz * 0.05,
        bx + lean * 0.4, by - sz * 0.4,
      ]);
      gfx.endFill();

      /* specular highlight near tip */
      gfx.beginFill(col.hi, 0.8);
      gfx.drawEllipse(bx + lean - hw * 0.3, by - sz * 0.88, sz * 0.1, sz * 0.18);
      gfx.endFill();
    }

  } else {
    /* gas — glowing orbs */
    const n = Math.min(3, pl + 1);
    for (let i = 0; i < n; i++) {
      const dx = (rnd() - 0.5) * TW * 0.38;
      const dy = (rnd() - 0.5) * TH * 0.24;
      const sz = 4 + rnd() * 2.5 + pl * 0.8;
      const bx = cx + dx, by = ground + dy;

      /* outer glow ring */
      gfx.beginFill(col.glow, 0.08);
      gfx.drawEllipse(bx, by - sz * 0.3, sz * 1.1, sz * 0.85);
      gfx.endFill();

      /* mid glow */
      gfx.beginFill(col.light, 0.18);
      gfx.drawEllipse(bx, by - sz * 0.35, sz * 0.82, sz * 0.62);
      gfx.endFill();

      /* main orb */
      gfx.lineStyle(0.8, col.dark, 0.7);
      gfx.beginFill(col.mid, 0.88);
      gfx.drawEllipse(bx, by - sz * 0.42, sz * 0.58, sz * 0.46);
      gfx.endFill();
      gfx.lineStyle(0);

      /* bright core */
      gfx.beginFill(col.hi, 0.55);
      gfx.drawEllipse(bx - sz * 0.14, by - sz * 0.6, sz * 0.22, sz * 0.17);
      gfx.endFill();

      /* small floating bubble above */
      const bub = sz * 0.18;
      const bubX = bx + (rnd() - 0.5) * sz * 0.4;
      const bubY = by - sz * 0.95 - rnd() * sz * 0.3;
      gfx.lineStyle(0.6, col.mid, 0.6);
      gfx.beginFill(col.light, 0.25);
      gfx.drawCircle(bubX, bubY, bub);
      gfx.endFill();
      gfx.lineStyle(0);
    }
  }
}

/* ─── Gap-fill diamonds (between adjacent column tiles same row) ─────────── */
function drawGapFills(gfx, tiles) {
  gfx.clear();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const k1 = `${c},${r}`, k2 = `${c+1},${r}`;
      const t1 = tiles[k1], t2 = tiles[k2];
      if (!t1 || !t2) continue;
      const v1 = TV[t1.terrain] || TV_DEF;
      const v2 = TV[t2.terrain] || TV_DEF;
      const e1 = t1.isHQ ? 14 : t1.isWin ? 10 : 4;
      const e2 = t2.isHQ ? 14 : t2.isWin ? 10 : 4;
      const { cx: cx1, cy: cy1 } = isoXY(c, r);
      const { cx: cx2, cy: cy2 } = isoXY(c+1, r);
      const xS = cx1 + TW / 2;
      const ey = ((cy1 - e1) + (cy2 - e2)) / 2;
      const yT = ey + TH / 2, yM = ey + TH * 3 / 4, yB = ey + TH;
      const xL = xS - TW / 4, xR = xS + TW / 4;
      gfx.beginFill(v1.acc); gfx.drawPolygon([xS,yT, xL,yM, xS,yB]); gfx.endFill();
      gfx.beginFill(v2.acc); gfx.drawPolygon([xS,yT, xR,yM, xS,yB]); gfx.endFill();
    }
  }
}

/* ─── Biome edge blending ────────────────────────────────────────────────── */
function drawBlend(gfx, tiles) {
  gfx.clear();
  for (const [key, tile] of Object.entries(tiles)) {
    if (tile.isShore || tile.isHQ) continue;
    const { c, r, terrain } = tile;
    const { cx, cy } = isoXY(c, r);
    const elev = tile.isWin ? 10 : 4;
    const sy = cy - elev;
    const mid = sy + TH / 2;
    const isEven = r % 2 === 0;
    const nbrs = isEven
      ? [{ e:"TL",nc:c-1,nr:r-1 },{ e:"TR",nc:c,nr:r-1 },{ e:"BL",nc:c-1,nr:r+1 },{ e:"BR",nc:c,nr:r+1 }]
      : [{ e:"TL",nc:c,nr:r-1 },{ e:"TR",nc:c+1,nr:r-1 },{ e:"BL",nc:c,nr:r+1 },{ e:"BR",nc:c+1,nr:r+1 }];
    for (const { e, nc, nr } of nbrs) {
      const nt = tiles[`${nc},${nr}`];
      if (!nt || nt.isShore || nt.terrain === terrain) continue;
      const nv = TV[nt.terrain] || TV_DEF;
      let pts;
      if      (e==="TL") pts = [cx,mid, cx,sy, cx-TW/2,mid];
      else if (e==="TR") pts = [cx,mid, cx,sy, cx+TW/2,mid];
      else if (e==="BL") pts = [cx,mid, cx-TW/2,mid, cx,sy+TH];
      else               pts = [cx,mid, cx+TW/2,mid, cx,sy+TH];
      gfx.beginFill(nv.mid, 0.24); gfx.drawPolygon(pts); gfx.endFill();
    }
  }
}

/* ─── All props in one pass (drawn above gap/blend layers) ──────────────── */
function drawAllProps(gfx, tiles) {
  gfx.clear();
  for (const tile of Object.values(tiles)) {
    if (!tile.rss || tile.isHQ || tile.isWin) continue;
    const { cx, cy } = isoXY(tile.c, tile.r);
    const sy = cy - 4;
    drawRssProp(gfx, tile.rss, cx, sy, tile.c, tile.r, tile.powerLevel || 1);
  }
}

/* ─── Per-frame animations (ticker driven) ───────────────────────────────── */
function drawAnimations(gfx, tiles, t) {
  if (!gfx || !tiles) return;
  gfx.clear();

  for (const tile of Object.values(tiles)) {
    if (!tile.rss || tile.isHQ || tile.isWin) continue;

    const { cx, cy } = isoXY(tile.c, tile.r);
    const sy = cy - 4;
    const ground = sy + TH / 2 + 1;
    const pl = tile.powerLevel || 1;
    const phase0 = (tile.c * 1.618 + tile.r * 2.414) % (Math.PI * 2);

    if (tile.rss === 'gas') {
      const rnd = tileRng(tile.c, tile.r);
      const n = Math.min(3, pl + 1);
      for (let i = 0; i < n; i++) {
        const dx = (rnd() - 0.5) * TW * 0.38;
        const dy = (rnd() - 0.5) * TH * 0.24;
        const sz = 4 + rnd() * 2.5 + pl * 0.8;
        const bx = cx + dx, by = ground + dy;
        rnd(); rnd(); // consume static bubX / bubY calls

        const phase = (t * 1.1 + phase0 + i * 1.4) % (Math.PI * 2);
        const pulse  = 0.5 + 0.5 * Math.sin(phase);

        /* pulsing outer glow */
        gfx.beginFill(RC.gas.glow, 0.06 + pulse * 0.1);
        gfx.drawEllipse(bx, by - sz * 0.3, sz * 1.25 + pulse * sz * 0.2, sz * 0.95 + pulse * sz * 0.12);
        gfx.endFill();

        /* floating bubble that bobs */
        const bubOff = Math.sin(t * 1.4 + phase0 + i * 2.1) * sz * 0.15;
        gfx.lineStyle(0.5, RC.gas.mid, 0.5);
        gfx.beginFill(RC.gas.hi, 0.12 + pulse * 0.1);
        gfx.drawCircle(bx, by - sz * 0.98 + bubOff, sz * 0.2);
        gfx.endFill();
        gfx.lineStyle(0);
      }

    } else if (tile.rss === 'ore') {
      const rnd = tileRng(tile.c, tile.r);
      const n = Math.min(5, pl + 2);
      for (let i = 0; i < n; i++) {
        const dx   = (rnd() - 0.5) * TW * 0.4;
        const dy   = (rnd() - 0.5) * TH * 0.28;
        const sz   = 4 + rnd() * 3 + pl * 0.9;
        const lean = (rnd() - 0.5) * sz * 0.5;
        const bx = cx + dx, by = ground + dy;

        const phase   = (t * 0.9 + phase0 + i * 2.3) % (Math.PI * 2);
        const sparkle = Math.max(0, Math.sin(phase));

        if (sparkle > 0.55) {
          const intensity = (sparkle - 0.55) / 0.45;
          /* bright glint at tip */
          gfx.beginFill(RC.ore.hi, intensity * 0.95);
          gfx.drawCircle(bx + lean - sz * 0.1, by - sz * 1.0, sz * 0.16);
          gfx.endFill();
          /* cross flare lines */
          const sw = sz * 0.28 * intensity;
          gfx.lineStyle(0.8, RC.ore.glow, intensity * 0.7);
          gfx.moveTo(bx + lean - sz * 0.1 - sw, by - sz * 1.0);
          gfx.lineTo(bx + lean - sz * 0.1 + sw, by - sz * 1.0);
          gfx.moveTo(bx + lean - sz * 0.1, by - sz * 1.0 - sw * 0.6);
          gfx.lineTo(bx + lean - sz * 0.1, by - sz * 1.0 + sw * 0.6);
          gfx.lineStyle(0);
        }
      }

    } else if (tile.rss === 'wood') {
      const rnd = tileRng(tile.c, tile.r);
      const n = Math.min(4, pl + 1);
      for (let i = 0; i < n; i++) {
        const dx = (rnd() - 0.5) * TW * 0.46;
        const dy = (rnd() - 0.5) * TH * 0.32;
        const sz = 5 + rnd() * 3 + pl * 1.2;
        const bx = cx + dx, by = ground + dy;
        const th = sz * 0.55;

        const phase = (t * 0.4 + phase0 + i * 1.7) % (Math.PI * 2);
        const sway  = Math.sin(phase) * sz * 0.07;

        /* swaying canopy highlight */
        gfx.beginFill(RC.wood.hi, 0.15 + Math.abs(Math.sin(phase)) * 0.12);
        gfx.drawEllipse(
          bx - sz * 0.18 + sway,
          by - th - sz * 0.4 - Math.abs(Math.sin(phase)) * sz * 0.04,
          sz * 0.22, sz * 0.16
        );
        gfx.endFill();
      }
    }
  }
}

/* ─── March lines ────────────────────────────────────────────────────────── */
function drawMarchLines(gfx, cmds, tiles) {
  gfx.clear();
  cmds.forEach(cmd => {
    if (!cmd.march || cmd.owner !== "player") return;
    const m = cmd.march;
    const path = m.path.slice(m.step);
    if (path.length < 2) return;
    const col = m.type === "attack" ? 0xff4444 : 0x44ff88;
    const pts = path.map(k => {
      const [tc, tr] = k.split(",").map(Number);
      const t = tiles[k];
      const elev = t?.isHQ ? 14 : t?.isWin ? 10 : 4;
      const { cx, cy } = isoXY(tc, tr);
      return { x: cx, y: cy - elev + TH / 2 };
    });
    /* shadow */
    gfx.lineStyle(5, 0x000000, 0.32);
    gfx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => gfx.lineTo(p.x, p.y));
    /* main */
    gfx.lineStyle(2.5, col, 0.9);
    gfx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => gfx.lineTo(p.x, p.y));
    gfx.lineStyle(0);
    /* destination indicator */
    const last = pts[pts.length - 1];
    gfx.beginFill(col, 0.18); gfx.drawCircle(last.x, last.y, 8); gfx.endFill();
    gfx.beginFill(col, 0.85); gfx.drawCircle(last.x, last.y, 5); gfx.endFill();
    gfx.beginFill(0xffffff, 0.9); gfx.drawCircle(last.x, last.y, 2.5); gfx.endFill();
  });
}

/* ─── Commander icons (ellipse halos) ───────────────────────────────────── */
function drawCmdIcons(gfx, cmds, tiles) {
  gfx.clear();
  const byTile = buildCByTile(cmds);
  for (const [key, tileCmds] of Object.entries(byTile)) {
    const tile = tiles[key];
    if (!tile) continue;
    const { cx, cy } = isoXY(tile.c, tile.r);
    const elev = tile.isHQ ? 14 : tile.isWin ? 10 : 4;
    const sy = cy - elev;
    const playerG = tileCmds.filter(c => c.owner === "player");
    const aiG = tileCmds.filter(c => c.owner !== "player");
    const groups = [];
    if (playerG.length) groups.push({ cmds: playerG, col: 0xf0dc3c });
    if (aiG.length)     groups.push({ cmds: aiG,     col: 0xdd3322 });
    groups.forEach(({ cmds: grp, col }, gi) => {
      const ey = sy + TH * 0.72 - gi * 6;
      gfx.beginFill(col, 0.13);
      gfx.lineStyle(1.4, col, 1);
      gfx.drawEllipse(cx, ey, 15, 5);
      gfx.lineStyle(0);
      gfx.endFill();
      /* small dots for each commander (up to 3) */
      const visible = grp.slice(0, 3);
      const spacing = visible.length > 1 ? 10 : 0;
      visible.forEach((cmd, i) => {
        const dx = (i - (visible.length - 1) / 2) * spacing;
        gfx.beginFill(col, 0.85);
        gfx.drawCircle(cx + dx, ey - 3, 4);
        gfx.endFill();
        gfx.beginFill(0xffffff, 0.5);
        gfx.drawCircle(cx + dx - 1, ey - 4, 1.5);
        gfx.endFill();
      });
      if (grp.length > 3) {
        gfx.beginFill(col, 0.7);
        gfx.drawCircle(cx + 14, ey - 8, 5);
        gfx.endFill();
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   MAP RENDERER COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export function MapRenderer({ tiles, cmds, selKey, mode, mvCmd, panSt, zoom, ZOOM_LEVELS, onTileClick, onPanChange, onZoomChange }) {
  const containerRef   = useRef(null);
  const appRef         = useRef(null);
  const worldRef       = useRef(null);
  const tileContRef    = useRef(null); // PIXI.Container for tiles
  const gapGfxRef      = useRef(null);
  const blendGfxRef    = useRef(null);
  const propsGfxRef    = useRef(null); // props layer — above gap/blend
  const animGfxRef     = useRef(null); // ticker-driven animation layer
  const marchGfxRef    = useRef(null);
  const cmdGfxRef      = useRef(null);
  const tileGfxMap     = useRef(new Map()); // key → { gfx, hash }
  const needsFullRedraw = useRef(true);

  /* live refs so init-effect callbacks always have fresh values */
  const panRef    = useRef(panSt);
  const zoomRef   = useRef(zoom);
  const tilesRef  = useRef(tiles);
  const cmdsRef   = useRef(cmds);
  const selRef    = useRef(selKey);
  const modeRef   = useRef(mode);
  const mvCmdRef  = useRef(mvCmd);
  const ZOOM_REF  = useRef(ZOOM_LEVELS);

  /* callbacks ref so init handlers don't stale-close */
  const onTileClickRef = useRef(onTileClick);
  const onPanChangeRef = useRef(onPanChange);
  const onZoomChangeRef = useRef(onZoomChange);

  useEffect(() => { tilesRef.current = tiles; }, [tiles]);
  useEffect(() => { cmdsRef.current  = cmds;  }, [cmds]);
  useEffect(() => { selRef.current   = selKey; }, [selKey]);
  useEffect(() => { modeRef.current  = mode;  }, [mode]);
  useEffect(() => { mvCmdRef.current = mvCmd; }, [mvCmd]);
  useEffect(() => { onTileClickRef.current  = onTileClick;  }, [onTileClick]);
  useEffect(() => { onPanChangeRef.current  = onPanChange;  }, [onPanChange]);
  useEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { ZOOM_REF.current = ZOOM_LEVELS; }, [ZOOM_LEVELS]);

  /* drag state — mutated directly for zero-rerender panning */
  const drag      = useRef(false);
  const didDrag   = useRef(false);
  const dragFrom  = useRef({ x: 0, y: 0 });
  const pinchDist0 = useRef(null);
  const pinchZoom0 = useRef(zoom);
  const tDragFrom  = useRef({ x: 0, y: 0 });
  const tDidDrag   = useRef(false);

  /* ── INIT PIXI ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = Math.max(200, el.clientWidth || window.innerWidth);
    const h = Math.max(200, el.clientHeight || (window.innerHeight - 38));
    const baseOpts = {
      width: w, height: h,
      backgroundColor: 0x091e32,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    };
    let app;
    try { app = new PIXI.Application(baseOpts); }
    catch (_) {
      try { app = new PIXI.Application({ ...baseOpts, forceCanvas: true }); }
      catch (e2) { console.warn("PixiJS init failed:", e2); return; }
    }
    app.view.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%";
    el.appendChild(app.view);
    appRef.current = app;

    const world = new PIXI.Container();
    app.stage.addChild(world);
    worldRef.current = world;
    world.x = panRef.current.x;
    world.y = panRef.current.y;
    world.scale.set(zoomRef.current);

    /* layer order: tiles → gapFill → blend → props → animFX → marchLines → cmdIcons */
    const tileCont = new PIXI.Container();
    world.addChild(tileCont);
    tileContRef.current = tileCont;

    const gapGfx = new PIXI.Graphics();
    world.addChild(gapGfx);
    gapGfxRef.current = gapGfx;

    const blendGfx = new PIXI.Graphics();
    world.addChild(blendGfx);
    blendGfxRef.current = blendGfx;

    const propsGfx = new PIXI.Graphics();
    world.addChild(propsGfx);
    propsGfxRef.current = propsGfx;

    const animGfx = new PIXI.Graphics();
    world.addChild(animGfx);
    animGfxRef.current = animGfx;

    const marchGfx = new PIXI.Graphics();
    world.addChild(marchGfx);
    marchGfxRef.current = marchGfx;

    const cmdGfx = new PIXI.Graphics();
    world.addChild(cmdGfx);
    cmdGfxRef.current = cmdGfx;

    needsFullRedraw.current = true;

    /* ── Animation ticker ── */
    let animTime = 0;
    const tickFn = () => {
      animTime += 0.025;
      try {
        drawAnimations(animGfxRef.current, tilesRef.current, animTime);
      } catch (e) {
        console.error("[MapRenderer] animation tick error:", e);
      }
    };
    app.ticker.add(tickFn);

    /* resize observer */
    const ro = new ResizeObserver(() => {
      if (appRef.current) appRef.current.renderer.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    /* ── Wheel zoom ── */
    const onWheel = e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const levels = ZOOM_REF.current;
      const idx = levels.indexOf(zoomRef.current);
      const ni = Math.max(0, Math.min(levels.length - 1, idx + delta));
      if (levels[ni] !== zoomRef.current) {
        zoomRef.current = levels[ni];
        if (worldRef.current) worldRef.current.scale.set(levels[ni]);
        onZoomChangeRef.current(levels[ni]);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    /* ── Touch ── */
    const onTS = e => {
      e.preventDefault();
      if (e.touches.length === 1) {
        tDragFrom.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        tDidDrag.current = false;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist0.current = Math.sqrt(dx*dx + dy*dy);
        pinchZoom0.current = zoomRef.current;
      }
    };
    const onTM = e => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - tDragFrom.current.x;
        const dy = e.touches[0].clientY - tDragFrom.current.y;
        if (Math.abs(dx)+Math.abs(dy) > 5) tDidDrag.current = true;
        tDragFrom.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (tDidDrag.current) {
          const np = clampPan(panRef.current.x+dx, panRef.current.y+dy);
          panRef.current = np;
          if (worldRef.current) { worldRef.current.x = np.x; worldRef.current.y = np.y; }
        }
      } else if (e.touches.length === 2 && pinchDist0.current !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const levels = ZOOM_REF.current;
        const rz = Math.min(levels[levels.length-1], Math.max(levels[0], pinchZoom0.current*(dist/pinchDist0.current)));
        const nz = levels.reduce((a,b) => Math.abs(b-rz) < Math.abs(a-rz) ? b : a);
        if (nz !== zoomRef.current) {
          zoomRef.current = nz;
          if (worldRef.current) worldRef.current.scale.set(nz);
          onZoomChangeRef.current(nz);
        }
      }
    };
    const onTE = e => {
      if (e.touches.length < 2) pinchDist0.current = null;
      if (e.touches.length === 0) {
        if (!tDidDrag.current) {
          const t = e.changedTouches[0];
          const rect = el.getBoundingClientRect();
          const wx = (t.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const wy = (t.clientY - rect.top  - panRef.current.y) / zoomRef.current;
          const key = worldToKey(wx, wy, tilesRef.current);
          if (key) onTileClickRef.current(key, e);
        }
        tDidDrag.current = false;
        onPanChangeRef.current(panRef.current);
      }
    };
    el.addEventListener("touchstart",  onTS, { passive: false });
    el.addEventListener("touchmove",   onTM, { passive: false });
    el.addEventListener("touchend",    onTE, { passive: false });
    el.addEventListener("touchcancel", onTE, { passive: false });

    return () => {
      ro.disconnect();
      app.ticker.remove(tickFn);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove", onTM);
      el.removeEventListener("touchend", onTE);
      el.removeEventListener("touchcancel", onTE);
      tileGfxMap.current.clear();
      app.destroy(true);
      appRef.current = null; worldRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Sync pan from props (zoom buttons, external pan changes) ── */
  useEffect(() => {
    panRef.current = panSt;
    if (worldRef.current) { worldRef.current.x = panSt.x; worldRef.current.y = panSt.y; }
  }, [panSt]);

  useEffect(() => {
    zoomRef.current = zoom;
    if (worldRef.current) worldRef.current.scale.set(zoom);
  }, [zoom]);

  /* ── Redraw tiles & overlays when state changes ── */
  useEffect(() => {
    const world = worldRef.current;
    const tileCont = tileContRef.current;
    if (!world || !tileCont) return;

    const cByTile = buildCByTile(cmds);
    const gfxMap  = tileGfxMap.current;

    /* remove tiles that no longer exist */
    for (const [k, entry] of gfxMap) {
      if (!tiles[k]) {
        tileCont.removeChild(entry.gfx);
        entry.gfx.destroy();
        gfxMap.delete(k);
      }
    }

    /* draw / update each tile */
    let didBlend = false;
    for (const [key, tile] of Object.entries(tiles)) {
      const hasCmds  = Boolean(cByTile[key]?.length);
      const mvCmdUid = mvCmd?.uid;
      const hash     = tileHash(tile, selKey, mode, hasCmds, mvCmdUid);

      let entry = gfxMap.get(key);
      if (!entry) {
        const gfx = new PIXI.Graphics();
        tileCont.addChild(gfx);
        entry = { gfx, hash: null };
        gfxMap.set(key, entry);
        didBlend = true; // new tile → rebuild blend
      }

      if (entry.hash !== hash) {
        entry.hash = hash;
        drawTile(entry.gfx, tile, selKey, mode, hasCmds, mvCmd?.uid);
      }
    }

    /* gap fills and blends — only rebuild when tiles change */
    if (needsFullRedraw.current || didBlend) {
      if (gapGfxRef.current)   drawGapFills(gapGfxRef.current, tiles);
      if (blendGfxRef.current) drawBlend(blendGfxRef.current, tiles);
      needsFullRedraw.current = false;
    }

    /* props — always redraw so they survive any rendering order edge case */
    if (propsGfxRef.current) {
      try {
        drawAllProps(propsGfxRef.current, tiles);
      } catch (e) {
        console.error("[MapRenderer] drawAllProps error:", e);
      }
    }

    /* march lines — player only (attack=red, move/reinforce=green) */
    if (marchGfxRef.current) drawMarchLines(marchGfxRef.current, cmds, tiles);

    /* commander icons */
    if (cmdGfxRef.current) drawCmdIcons(cmdGfxRef.current, cmds, tiles);

  }, [tiles, cmds, selKey, mode, mvCmd]);

  /* ── Mouse handlers ── */
  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    drag.current = true; didDrag.current = false;
    dragFrom.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback(e => {
    if (!drag.current) return;
    const dx = e.clientX - dragFrom.current.x;
    const dy = e.clientY - dragFrom.current.y;
    if (Math.abs(dx)+Math.abs(dy) > 4) didDrag.current = true;
    dragFrom.current = { x: e.clientX, y: e.clientY };
    if (didDrag.current) {
      const np = clampPan(panRef.current.x+dx, panRef.current.y+dy);
      panRef.current = np;
      if (worldRef.current) { worldRef.current.x = np.x; worldRef.current.y = np.y; }
    }
  }, []);

  const onMouseUp = useCallback(e => {
    if (e.button !== 0 && e.type !== "mouseleave") return;
    const wasDrag = didDrag.current;
    drag.current = false; didDrag.current = false;
    if (!wasDrag && e.type !== "mouseleave") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const wx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
        const wy = (e.clientY - rect.top  - panRef.current.y) / zoomRef.current;
        const key = worldToKey(wx, wy, tilesRef.current);
        if (key) onTileClickRef.current(key, e);
      }
    }
    onPanChangeRef.current(panRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", inset: 0, top: 38,
        userSelect: "none", touchAction: "none",
        background: "#091e32", overflow: "hidden",
        cursor: "grab",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
}
