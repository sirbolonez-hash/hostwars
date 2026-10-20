// Unit movement for phase 5 of the tick: path requests under a budget, path following
// with the current, separation between bodies, walls, and stuck handling.
// Integer maths throughout; every loop runs in entity-id order.

import type { SimContext } from '../context';
import { isqrt, SUB } from '../core/fixed';
import type { Entity, MoveState, World } from '../core/world';
import { centreOf, CLASS_SIZE, nodeOf } from './grid';
import { bodyClear, checkRadius, nodesClear, smoothPath } from './los';
import { assignSlots, nearestPassable } from './slots';

/** Node expansions allowed per tick across all searches (one search may finish past it). */
export const PATH_BUDGET = 8000;
/** A repath waits behind player orders, but no longer than this many ticks. */
export const REPATH_AGING = 20;
/** Progress window: a travelling unit must get a quarter tile closer to its goal every 3 s. */
export const PROGRESS_WINDOW = 60;
export const PROGRESS_MIN = 64;
export const GIVE_UP_STALLS = 10;
const REPATH_AT = new Set([2, 5, 8]);
/** Group path sharing: how near a member must start, how long a shared path is offered. */
const SHARE_REACH = 8;
/** Within this distance of a waypoint, a unit that can already reach the next one moves on. */
const WAYPOINT_LOOKAHEAD = 384;
const SHARE_TTL = 200;
const SHARE_PER_GROUP = 16;
const SHARE_MAX = 48;
/** Budget charged for attaching to a shared path (fixed, so the charge never depends on caches). */
const SHARE_COST = 24;

export type MoveEvent = { type: 'arrived'; entity: number } | { type: 'blocked'; entity: number };

function unitSize(ctx: SimContext, e: Entity): number {
  return CLASS_SIZE[ctx.catalog.units.get(e.type)!.navClass];
}

function radius(ctx: SimContext, e: Entity): number {
  return ctx.catalog.units.get(e.type)!.radius;
}

function enqueue(world: World, id: number, prio: 0 | 1): void {
  world.pathQueue = world.pathQueue.filter((r) => r.id !== id);
  world.pathQueue.push({ id, prio, t: world.tick });
}

export function clearMove(world: World, e: Entity): void {
  e.mv = null;
  world.pathQueue = world.pathQueue.filter((r) => r.id !== e.id);
}

/** Orders a group to (x, y): each unit gets its own arrival slot and a path request. */
export function issueMove(world: World, ctx: SimContext, units: Entity[], x: number, y: number): void {
  if (units.length === 0) return;
  const tx = Math.floor(x / SUB);
  const ty = Math.floor(y / SUB);
  if (units.length === 1) {
    const e = units[0]!;
    e.order = { kind: 'move', x, y };
    travelTo(world, ctx, e, x, y);
    if (e.mv) e.order = { kind: 'move', x: e.mv.gx, y: e.mv.gy };
    return;
  }
  const grp = world.nextGroup++;
  const req = units.map((e) => {
    const dx = e.x - x;
    const dy = e.y - y;
    return { id: e.id, size: unitSize(ctx, e), d2: dx * dx + dy * dy };
  });
  const slots = assignSlots(ctx.nav, tx, ty, req);
  for (const e of units) {
    const s = slots.get(e.id);
    const [gx, gy] = s ? centreOf(s[0], s[1], unitSize(ctx, e)) : [x, y];
    startMove(world, e, gx, gy, grp);
  }
}

function startMove(world: World, e: Entity, gx: number, gy: number, grp: number): void {
  e.order = { kind: 'move', x: gx, y: gy };
  setTravel(world, e, gx, gy, grp);
}

function setTravel(world: World, e: Entity, gx: number, gy: number, grp: number): void {
  e.mv = { gx, gy, path: [], i: 0, waiting: true, best: dist(e.x, e.y, gx, gy), since: world.tick, stalls: 0, grp };
  enqueue(world, e.id, 0);
}

/**
 * Sends one unit to (x, y) without touching its order: the exact point if it can stand
 * there, otherwise the nearest spot it can. Used by orders that travel as one of their
 * steps (gathering). Movement ends by clearing `mv`; the order's owner decides what next.
 */
export function travelTo(world: World, ctx: SimContext, e: Entity, x: number, y: number): void {
  const size = unitSize(ctx, e);
  const [nx, ny] = nodeOf(x, y, size);
  const exact = ctx.nav.passable(nx, ny, size);
  const node = exact ? [nx, ny] : nearestPassable(ctx.nav, nx, ny, size);
  const [gx, gy] = exact ? [x, y] : node ? centreOf(node[0]!, node[1]!, size) : [x, y];
  setTravel(world, e, gx, gy, 0);
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return isqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

/**
 * Builds a path for a group member from a path a groupmate already found. The member keeps
 * its offset from the groupmate's start while the ground allows it (so the group stays wide
 * in the open) and draws in towards the shared line where it narrows (a choke). It leaves
 * the line where its own goal is in sight. Returns null when it cannot join or leave.
 */
function attachToShared(ctx: SimContext, sx: number, sy: number, gx: number, gy: number, size: number, r: number, tiles: number[]): number[] | null {
  const nav = ctx.nav;
  const n = tiles.length / 2;
  let ox = sx - tiles[0]!;
  let oy = sy - tiles[1]!;
  if (Math.max(Math.abs(ox), Math.abs(oy)) > SHARE_REACH) return null;
  const wantX = ox;
  const wantY = oy;
  const out = [sx, sy];
  let px = sx;
  let py = sy;
  for (let k = 1; k < n; k++) {
    const tx = tiles[2 * k]!;
    const ty = tiles[2 * k + 1]!;
    // grow back one step towards the wanted offset, then shrink until the step is clear
    if (ox !== wantX) ox += Math.sign(wantX - ox);
    if (oy !== wantY) oy += Math.sign(wantY - oy);
    for (;;) {
      const qx = tx + ox;
      const qy = ty + oy;
      if (nav.passable(qx, qy, size) && nodesClear(nav, px, py, qx, qy, size, r)) {
        if (qx !== px || qy !== py) out.push(qx, qy);
        px = qx;
        py = qy;
        break;
      }
      if (ox === 0 && oy === 0) return null; // the shared line itself is blocked from here
      ox = Math.trunc(ox / 2);
      oy = Math.trunc(oy / 2);
    }
    if (Math.max(Math.abs(px - gx), Math.abs(py - gy)) <= SHARE_REACH * 2 && nodesClear(nav, px, py, gx, gy, size, r)) {
      out.push(gx, gy);
      return out;
    }
  }
  if (nodesClear(nav, px, py, gx, gy, size, r)) {
    out.push(gx, gy);
    return out;
  }
  return null;
}

function computePath(world: World, ctx: SimContext, e: Entity, mv: MoveState): number {
  const nav = ctx.nav;
  const size = unitSize(ctx, e);
  const prefix: number[] = [];
  let [sx, sy] = nodeOf(e.x, e.y, size);
  if (!nav.passable(sx, sy, size)) {
    const near = nearestPassable(nav, sx, sy, size, 3);
    if (!near) {
      mv.path = [];
      mv.i = 0;
      return 0;
    }
    [sx, sy] = near;
    prefix.push(...centreOf(sx, sy, size));
  }
  let [gx, gy] = nodeOf(mv.gx, mv.gy, size);
  let exactGoal = nav.passable(gx, gy, size);
  if (!exactGoal) {
    const near = nearestPassable(nav, gx, gy, size);
    if (near) [gx, gy] = near;
  }
  let res: { nodes: number[]; reachedGoal: boolean; expanded: number } | null = null;
  if (mv.grp !== 0 && exactGoal) {
    for (const gp of world.groupPaths) {
      if (gp.grp !== mv.grp || gp.size !== size) continue;
      const nodes = attachToShared(ctx, sx, sy, gx, gy, size, radius(ctx, e), gp.tiles);
      if (nodes) {
        res = { nodes, reachedGoal: true, expanded: SHARE_COST };
        break;
      }
    }
  }
  if (!res) {
    res = ctx.astar.search(sx, sy, gx, gy, size, nav.w * nav.h);
    if (mv.grp !== 0 && res.reachedGoal) {
      const mine = world.groupPaths.filter((gp) => gp.grp === mv.grp && gp.size === size);
      if (mine.length < SHARE_PER_GROUP) {
        world.groupPaths.push({ grp: mv.grp, size, tiles: res.nodes, t: world.tick });
        if (world.groupPaths.length > SHARE_MAX) world.groupPaths.shift();
      }
    }
  }
  const smooth = smoothPath(nav, res.nodes, size, radius(ctx, e));
  const path = [...prefix];
  for (let k = 0; k < smooth.length; k += 2) path.push(...centreOf(smooth[k]!, smooth[k + 1]!, size));
  if (res.reachedGoal && exactGoal) {
    if (path.length >= 2) path.splice(path.length - 2, 2);
    path.push(mv.gx, mv.gy);
  } else {
    // the goal cannot be reached (or stood on): the closest reachable point becomes the goal
    const end = res.nodes.length >= 2 ? centreOf(res.nodes[res.nodes.length - 2]!, res.nodes[res.nodes.length - 1]!, size) : centreOf(sx, sy, size);
    if (path.length === 0 || path[path.length - 2] !== end[0] || path[path.length - 1] !== end[1]) path.push(end[0], end[1]);
    mv.gx = end[0];
    mv.gy = end[1];
    if (e.order.kind === 'move') e.order = { kind: 'move', x: end[0], y: end[1] };
  }
  mv.path = path;
  mv.i = 0;
  return res.expanded;
}

/** Runs queued path searches until the tick's budget is spent. Returns expansions used. */
export function processPathQueue(world: World, ctx: SimContext, index: Map<number, Entity>): number {
  if (world.groupPaths.length > 0 && world.groupPaths[0]!.t + SHARE_TTL <= world.tick) {
    world.groupPaths = world.groupPaths.filter((gp) => gp.t + SHARE_TTL > world.tick);
  }
  if (world.pathQueue.length === 0) return 0;
  const key = (r: { prio: number; t: number }) => r.t + (r.prio === 1 ? REPATH_AGING : 0);
  world.pathQueue.sort((a, b) => key(a) - key(b) || a.id - b.id);
  let used = 0;
  let k = 0;
  while (k < world.pathQueue.length && used < PATH_BUDGET) {
    const r = world.pathQueue[k++]!;
    const e = index.get(r.id);
    if (!e || !e.mv || !e.mv.waiting) continue;
    used += computePath(world, ctx, e, e.mv);
    e.mv.waiting = false;
    e.mv.best = dist(e.x, e.y, e.mv.gx, e.mv.gy);
    e.mv.since = world.tick;
  }
  world.pathQueue.splice(0, k);
  return used;
}

/**
 * A building appeared on tiles (tx, ty, fw, fh): units standing there step to the nearest
 * open spot, and every travelling unit whose remaining path now runs into something searches
 * again (player-order priority, so the detour comes at once).
 */
export function afterFootprintChange(world: World, ctx: SimContext, tx: number, ty: number, fw: number, fh: number): void {
  const nav = ctx.nav;
  for (const e of world.entities) {
    if (e.building) continue;
    const size = unitSize(ctx, e);
    const ux = Math.floor(e.x / SUB);
    const uy = Math.floor(e.y / SUB);
    if (ux >= tx && ux < tx + fw && uy >= ty && uy < ty + fh) {
      const [nx, ny] = nodeOf(e.x, e.y, size);
      const spot = nearestPassable(nav, nx, ny, size, 8);
      if (spot) [e.x, e.y] = centreOf(spot[0], spot[1], size);
    }
    const mv = e.mv;
    if (!mv || mv.waiting) continue;
    const r = checkRadius(size, radius(ctx, e));
    let px = e.x;
    let py = e.y;
    let clear = true;
    for (let k = mv.i; k < mv.path.length && clear; k += 2) {
      clear = bodyClear(nav, px, py, mv.path[k]!, mv.path[k + 1]!, r);
      px = mv.path[k]!;
      py = mv.path[k + 1]!;
    }
    if (!clear) {
      mv.waiting = true;
      enqueue(world, e.id, 0);
    }
  }
}

/** Ends travel. A plain move order ends with it (and reports); any other order carries on from here. */
function endTravel(e: Entity, events: MoveEvent[], type: MoveEvent['type']): void {
  e.mv = null;
  if (e.order.kind !== 'move') return;
  e.order = { kind: 'idle' };
  events.push({ type, entity: e.id });
}

function arrive(e: Entity, events: MoveEvent[]): void {
  endTravel(e, events, 'arrived');
}

const DIR8_X = [256, 181, 0, -181, -256, -181, 0, 181];
const DIR8_Y = [0, 181, 256, 181, 0, -181, -256, -181];

/** Phase 5 after the path queue: follow paths, separate bodies, keep out of walls, detect stalls. */
export function moveUnits(world: World, ctx: SimContext, events: MoveEvent[]): void {
  const nav = ctx.nav;
  const units = world.entities.filter((e) => !e.building);
  const startX = new Map<number, number>();
  const startY = new Map<number, number>();
  // heading of each travelling unit (length 256), used to pass oncoming units on the right
  const headX = new Map<number, number>();
  const headY = new Map<number, number>();

  // 1. follow paths
  for (const e of units) {
    startX.set(e.id, e.x);
    startY.set(e.id, e.y);
    const mv = e.mv;
    if (!mv || mv.waiting) continue;
    if (mv.i >= mv.path.length) {
      if (mv.path.length === 0) endTravel(e, events, 'blocked');
      else arrive(e, events);
      continue;
    }
    const def = ctx.catalog.units.get(e.type)!;
    // an intermediate waypoint is done once the unit is close to it, or once the next one
    // is already in reach: in a crowd nobody has to touch the exact point
    if (mv.i + 2 < mv.path.length) {
      const cx = mv.path[mv.i]! - e.x;
      const cy = mv.path[mv.i + 1]! - e.y;
      const cd = isqrt(cx * cx + cy * cy);
      if (cd <= def.radius || (cd <= WAYPOINT_LOOKAHEAD && bodyClear(nav, e.x, e.y, mv.path[mv.i + 2]!, mv.path[mv.i + 3]!, checkRadius(CLASS_SIZE[def.navClass], def.radius)))) {
        mv.i += 2;
      }
    }
    const wx = mv.path[mv.i]!;
    const wy = mv.path[mv.i + 1]!;
    const dx = wx - e.x;
    const dy = wy - e.y;
    const d = isqrt(dx * dx + dy * dy);
    if (d > 0) {
      headX.set(e.id, Math.trunc((dx * 256) / d));
      headY.set(e.id, Math.trunc((dy * 256) / d));
    }
    const tile = nav.tileAt(e.x, e.y);
    const f = nav.flowFactor(tile, dx, dy);
    const slowed = e.slow && e.slow.until > world.tick ? 1000 - e.slow.pct : 1000;
    const step = Math.max(1, Math.trunc((Math.trunc((def.speed * f) / 1000) * slowed) / 1000));
    if (d <= step) {
      e.x = wx;
      e.y = wy;
      mv.i += 2;
      if (mv.i >= mv.path.length) arrive(e, events);
    } else {
      e.x += Math.trunc((dx * step) / d);
      e.y += Math.trunc((dy * step) / d);
    }
  }

  // 2. separation: every overlapping pair pushes apart; pushes are summed, then applied,
  //    so the result does not depend on the order pairs are visited
  const CELL = 512;
  const cells = new Map<number, Entity[]>();
  const cw = Math.ceil(world.mapW / CELL) + 1;
  for (const e of units) {
    const k = Math.floor(e.y / CELL) * cw + Math.floor(e.x / CELL);
    const list = cells.get(k);
    if (list) list.push(e);
    else cells.set(k, [e]);
  }
  const pushX = new Map<number, number>();
  const pushY = new Map<number, number>();
  const moving = (e: Entity) => e.mv !== null && !e.mv.waiting;
  // carriers on a gather order pass through other bodies, so a mining line never jams
  for (const a of units) {
    if (a.gather) continue;
    const ra = radius(ctx, a);
    const cx = Math.floor(a.x / CELL);
    const cy = Math.floor(a.y / CELL);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = cells.get((cy + oy) * cw + cx + ox);
        if (!list) continue;
        for (const b of list) {
          if (b.id <= a.id || b.gather) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = ra + radius(ctx, b);
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          const d = isqrt(d2);
          let nx: number;
          let ny: number;
          if (d === 0) {
            const k = (a.id * 7 + b.id * 13) % 8;
            nx = DIR8_X[k]!;
            ny = DIR8_Y[k]!;
          } else {
            nx = Math.trunc((dx * 256) / d);
            ny = Math.trunc((dy * 256) / d);
          }
          const overlap = rr - d;
          // a unit on the move yields less than one standing still
          const ma = moving(a);
          const mb = moving(b);
          const wa = ma === mb ? 500 : ma ? 250 : 750;
          const wb = 1000 - wa;
          let ax = -Math.trunc((nx * overlap * wa) / 256000);
          let ay = -Math.trunc((ny * overlap * wa) / 256000);
          let bx = Math.trunc((nx * overlap * wb) / 256000);
          let by = Math.trunc((ny * overlap * wb) / 256000);
          // oncoming traffic: both step to their own right, so they slide past each other
          const hax = headX.get(a.id);
          const hbx = headX.get(b.id);
          if (ma && mb && hax !== undefined && hbx !== undefined) {
            const hay = headY.get(a.id)!;
            const hby = headY.get(b.id)!;
            if (hax * hbx + hay * hby < -46341) { // more than 135° apart
              ax += Math.trunc((-hay * overlap) / 512);
              ay += Math.trunc((hax * overlap) / 512);
              bx += Math.trunc((-hby * overlap) / 512);
              by += Math.trunc((hbx * overlap) / 512);
            }
          }
          pushX.set(a.id, (pushX.get(a.id) ?? 0) + ax);
          pushY.set(a.id, (pushY.get(a.id) ?? 0) + ay);
          pushX.set(b.id, (pushX.get(b.id) ?? 0) + bx);
          pushY.set(b.id, (pushY.get(b.id) ?? 0) + by);
        }
      }
    }
  }
  for (const e of units) {
    const r = radius(ctx, e);
    const cap = r >> 1;
    let px = pushX.get(e.id) ?? 0;
    let py = pushY.get(e.id) ?? 0;
    const pl = isqrt(px * px + py * py);
    if (pl > cap) {
      px = Math.trunc((px * cap) / pl);
      py = Math.trunc((py * cap) / pl);
    }
    e.x += px;
    e.y += py;
  }

  // 3. walls and buildings: push each body out of blocked tiles around it
  for (const e of units) {
    const r = radius(ctx, e);
    for (let pass = 0; pass < 2; pass++) {
      const tx = Math.floor(e.x / SUB);
      const ty = Math.floor(e.y / SUB);
      for (let y = ty - 1; y <= ty + 1; y++) {
        for (let x = tx - 1; x <= tx + 1; x++) {
          if (!nav.blocked(x, y)) continue;
          const qx = Math.min(Math.max(e.x, x * SUB), x * SUB + SUB - 1);
          const qy = Math.min(Math.max(e.y, y * SUB), y * SUB + SUB - 1);
          const dx = e.x - qx;
          const dy = e.y - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 === 0 || d2 >= r * r) continue;
          const d = isqrt(d2);
          e.x += Math.trunc((dx * (r - d)) / d);
          e.y += Math.trunc((dy * (r - d)) / d);
        }
      }
    }
    e.x = Math.min(Math.max(e.x, 0), world.mapW - 1);
    e.y = Math.min(Math.max(e.y, 0), world.mapH - 1);
    if (nav.blocked(Math.floor(e.x / SUB), Math.floor(e.y / SUB))) {
      e.x = startX.get(e.id)!;
      e.y = startY.get(e.id)!;
    }
  }

  // 4. progress: repath when stalled, settle when crowded near the goal, give up eventually
  for (const e of units) {
    const mv = e.mv;
    if (!mv || mv.waiting) continue;
    const dg = dist(e.x, e.y, mv.gx, mv.gy);
    if (dg < mv.best - PROGRESS_MIN) {
      mv.best = dg;
      mv.since = world.tick;
      mv.stalls = 0;
      continue;
    }
    if (world.tick - mv.since < PROGRESS_WINDOW) continue;
    mv.stalls++;
    mv.since = world.tick;
    mv.best = dg;
    if (dg <= SUB + 2 * radius(ctx, e)) {
      arrive(e, events);
    } else if (mv.stalls >= GIVE_UP_STALLS) {
      endTravel(e, events, 'blocked');
    } else if (REPATH_AT.has(mv.stalls)) {
      mv.waiting = true;
      enqueue(world, e.id, 1);
    }
  }
}
