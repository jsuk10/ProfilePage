// 공간음향 차폐 계산 (3D 복셀 그리드). 화면과 상관없는 계산만 모았습니다. (Node 테스트에서도 씁니다)
//   1. 청취자 → 음원 직선 레이 (3D DDA). 막히지 않으면 차폐 0
//   2. 막힌 경우에만 복셀 A* 로 우회 경로를 찾습니다. (위아래를 포함한 26방향, 벽 모서리 사이로 빠져나가기 금지)
//      남은 후보의 예상 길이가 포화 임계를 넘으면 더 찾지 않고 멈춥니다. (컷오프)
//   3. 우회 비율, 차폐 계수 식은 2D 데모와 같습니다.
// 밀폐도는 청취자에서 26방향으로 레이를 쏴 히트 거리 평균으로 구합니다. (1 = 개방, 0 = 밀폐)
// 바닥 아래나 그리드 밖으로 나간 레이는 열린 공간으로 봅니다.
// 좌표: x = 가로 칸, y = 높이 칸(위로), z = 세로 칸. 한 칸 = 1m

import {
  OCCLUSION_K,
  SATURATION,
  SATURATION_RATIO,
  ENCLOSURE_RANGE,
  nearScale,
} from './spatial-audio-demo.js';

export const OPEN = 0;
export const WALL = 1;
export const OUTSIDE = -1;
export const IN_OPEN_SET = 1;
export const IN_CLOSED_SET = 2;

const EPSILON = 1e-9;
const MAX_LEVELS = 12;
const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

/* 그리드 ------------------------------------------------------------------ */

export class VoxelGrid {
  constructor(cols, levels, rows, cells = new Uint8Array(cols * levels * rows)) {
    this.cols = cols;
    this.levels = levels;
    this.rows = rows;
    this.cells = cells;
  }

  clone() {
    return new VoxelGrid(this.cols, this.levels, this.rows, this.cells.slice());
  }

  index(x, y, z) {
    return (y * this.rows + z) * this.cols + x;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.cols && y < this.levels && z < this.rows;
  }

  at(x, y, z) {
    return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : OUTSIDE;
  }

  set(x, y, z, value) {
    if (this.inside(x, y, z)) this.cells[this.index(x, y, z)] = value;
  }
}

const cleanLines = (value) => {
  const lines = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
};

// spatial-audio.yml 의 layers(아래 칸부터 한 칸 높이씩 쌓는 배치도) → { name, grid, listener, source }
// repeat: n 이면 같은 배치를 n 칸 높이로 쌓습니다. 청취자 / 음원 표시는 그 묶음의 맨 아래 칸에 놓습니다.
export function parseVoxelPreset(preset) {
  const layers = [];
  for (const layer of Array.isArray(preset?.layers) ? preset.layers : []) {
    const lines = cleanLines(layer?.map);
    const repeat = Math.min(Math.max(Number.parseInt(layer?.repeat, 10) || 1, 1), MAX_LEVELS);
    for (let index = 0; index < repeat; index++) layers.push({ lines, markers: index === 0 });
  }
  if (!layers.length) layers.push({ lines: [], markers: false });

  const rows = Math.max(4, ...layers.map((layer) => layer.lines.length));
  const cols = Math.max(4, ...layers.flatMap((layer) => layer.lines.map((line) => line.length)));
  const wanted = Number.parseInt(preset?.height, 10);
  const levels = Math.min(
    Math.max(Number.isFinite(wanted) && wanted >= layers.length ? wanted : layers.length + 2, 3),
    MAX_LEVELS,
  );
  const grid = new VoxelGrid(cols, levels, rows);
  let listener = null;
  let source = null;

  layers.slice(0, levels).forEach((layer, y) => {
    layer.lines.forEach((line, z) => {
      for (let x = 0; x < line.length; x++) {
        const mark = line[x];
        if (mark === '#') grid.set(x, y, z, WALL);
        else if (layer.markers && (mark === 'L' || mark === 'l')) listener ??= { x, y, z };
        else if (layer.markers && (mark === 'S' || mark === 's')) source ??= { x, y, z };
      }
    });
  });

  listener ??= { x: 1, y: Math.min(1, levels - 1), z: rows >> 1 };
  source ??= { x: cols - 2, y: Math.min(1, levels - 1), z: rows >> 1 };
  grid.set(listener.x, listener.y, listener.z, OPEN);
  grid.set(source.x, source.y, source.z, OPEN);
  return { name: String(preset?.name ?? ''), grid, listener, source };
}

export const cloneVoxelScene = (scene) => ({
  name: scene.name,
  grid: scene.grid.clone(),
  listener: { ...scene.listener },
  source: { ...scene.source },
});

// WebGL 을 쓸 수 없을 때 2D 데모에 넘길 배치도: 청취자 높이에서 자른 단면
export function sliceAtListener(scene) {
  const { grid, listener, source } = scene;
  const lines = [];
  for (let z = 0; z < grid.rows; z++) {
    let line = '';
    for (let x = 0; x < grid.cols; x++) {
      if (x === listener.x && z === listener.z) line += 'L';
      else if (x === source.x && z === source.z) line += 'S';
      else line += grid.at(x, listener.y, z) === WALL ? '#' : '.';
    }
    lines.push(line);
  }
  return { name: scene.name, map: lines.join('\n') };
}

/* 레이 ------------------------------------------------------------------- */

// (ox, oy, oz) 에서 (dx, dy, dz) 방향으로 t ∈ [0, maxT] 동안 지나는 칸을 차례로 검사합니다. (3D DDA)
// 칸 모서리나 꼭짓점을 정확히 지날 때는 한 축씩만 옮긴 이웃 칸이 모두 벽일 때만 막힌 것으로 봅니다.
export function traverse(grid, ox, oy, oz, dx, dy, dz, maxT) {
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  let cz = Math.floor(oz);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);
  const tx = sx ? Math.abs(1 / dx) : Infinity;
  const ty = sy ? Math.abs(1 / dy) : Infinity;
  const tz = sz ? Math.abs(1 / dz) : Infinity;
  let nx = sx > 0 ? (cx + 1 - ox) * tx : sx < 0 ? (ox - cx) * tx : Infinity;
  let ny = sy > 0 ? (cy + 1 - oy) * ty : sy < 0 ? (oy - cy) * ty : Infinity;
  let nz = sz > 0 ? (cz + 1 - oz) * tz : sz < 0 ? (oz - cz) * tz : Infinity;

  for (;;) {
    const t = Math.min(nx, ny, nz);
    if (t > maxT) return { blocked: false, t: maxT };

    const tolerance = EPSILON * Math.max(1, t);
    const ax = nx - t <= tolerance;
    const ay = ny - t <= tolerance;
    const az = nz - t <= tolerance;
    if (ax + ay + az > 1) {
      const sides = [];
      if (ax) sides.push(grid.at(cx + sx, cy, cz));
      if (ay) sides.push(grid.at(cx, cy + sy, cz));
      if (az) sides.push(grid.at(cx, cy, cz + sz));
      if (sides.every((cell) => cell === WALL)) {
        return { blocked: true, t, x: cx + (ax ? sx : 0), y: cy + (ay ? sy : 0), z: cz + (az ? sz : 0) };
      }
    }
    if (ax) {
      cx += sx;
      nx += tx;
    }
    if (ay) {
      cy += sy;
      ny += ty;
    }
    if (az) {
      cz += sz;
      nz += tz;
    }

    const cell = grid.at(cx, cy, cz);
    if (cell === OUTSIDE) return { blocked: false, outside: true, t };
    if (cell === WALL) return { blocked: true, t, x: cx, y: cy, z: cz };
  }
}

/* A* --------------------------------------------------------------------- */

// 26방향 이웃. 대각 이동은 거쳐 가는 칸(축 일부만 움직인 칸)이 모두 비어 있어야 갈 수 있습니다.
const NEIGHBORS = [];
for (let dy = -1; dy <= 1; dy++) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const axes = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (!axes) continue;
      const via = new Map();
      for (const [ex, ey, ez] of [[dx, 0, 0], [0, dy, 0], [0, 0, dz], [dx, dy, 0], [dx, 0, dz], [0, dy, dz]]) {
        const moved = Math.abs(ex) + Math.abs(ey) + Math.abs(ez);
        if (moved && moved < axes) via.set(`${ex},${ey},${ez}`, [ex, ey, ez]);
      }
      NEIGHBORS.push({ dx, dy, dz, cost: axes === 1 ? 1 : axes === 2 ? SQRT2 : SQRT3, via: [...via.values()] });
    }
  }
}

// 칸 수만큼 버퍼를 미리 잡아 두고 매번 재사용합니다. (탐색 중 새 할당 없음)
export class VoxelPathFinder {
  constructor() {
    this.capacity = 0;
  }

  ensure(size) {
    if (size <= this.capacity) return;
    this.capacity = size;
    this.g = new Float64Array(size);
    this.parent = new Int32Array(size);
    this.state = new Uint8Array(size);
    // 같은 칸을 더 짧은 비용으로 다시 넣는 방식이라 힙은 이웃 수(26)만큼 넉넉히 잡습니다.
    this.heapNodes = new Int32Array(size * 26 + 26);
    this.heapKeys = new Float64Array(size * 26 + 26);
  }

  push(node, key) {
    let index = this.heapSize++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.heapKeys[parent] <= key) break;
      this.heapNodes[index] = this.heapNodes[parent];
      this.heapKeys[index] = this.heapKeys[parent];
      index = parent;
    }
    this.heapNodes[index] = node;
    this.heapKeys[index] = key;
  }

  pop() {
    const top = this.heapNodes[0];
    const size = --this.heapSize;
    if (size === 0) return top;
    const lastNode = this.heapNodes[size];
    const lastKey = this.heapKeys[size];
    let index = 0;
    for (;;) {
      let child = index * 2 + 1;
      if (child >= size) break;
      if (child + 1 < size && this.heapKeys[child + 1] < this.heapKeys[child]) child += 1;
      if (this.heapKeys[child] >= lastKey) break;
      this.heapNodes[index] = this.heapNodes[child];
      this.heapKeys[index] = this.heapKeys[child];
      index = child;
    }
    this.heapNodes[index] = lastNode;
    this.heapKeys[index] = lastKey;
    return top;
  }

  // limit: 이 길이를 넘는 경로는 차폐가 이미 포화이므로 찾지 않습니다.
  search(grid, start, goal, limit) {
    const { cols, rows } = grid;
    const size = cols * rows * grid.levels;
    this.ensure(size);
    this.g.fill(Infinity, 0, size);
    this.parent.fill(-1, 0, size);
    this.state.fill(0, 0, size);
    this.heapSize = 0;

    // 26방향 이동 비용에 맞춘 거리 추정 (긴 축부터 √3, √2, 1 순으로 씁니다). 일관적이라 컷오프 판정에 씁니다.
    const estimate = (x, y, z) => {
      let a = Math.abs(x - goal.x);
      let b = Math.abs(y - goal.y);
      let c = Math.abs(z - goal.z);
      if (a < b) [a, b] = [b, a];
      if (b < c) [b, c] = [c, b];
      if (a < b) [a, b] = [b, a];
      return a + (SQRT2 - 1) * b + (SQRT3 - SQRT2) * c;
    };

    const startIndex = grid.index(start.x, start.y, start.z);
    const goalIndex = grid.index(goal.x, goal.y, goal.z);
    this.g[startIndex] = 0;
    this.state[startIndex] = IN_OPEN_SET;
    this.push(startIndex, estimate(start.x, start.y, start.z));
    let expanded = 0;

    while (this.heapSize > 0) {
      const key = this.heapKeys[0];
      const current = this.pop();
      if (this.state[current] === IN_CLOSED_SET) continue;
      // 휴리스틱이 일관적이라 꺼내는 순서대로 예상 길이가 커집니다. 넘었으면 남은 후보도 모두 넘습니다.
      if (key > limit + EPSILON) return { status: 'cutoff', expanded };
      this.state[current] = IN_CLOSED_SET;
      expanded += 1;

      if (current === goalIndex) {
        const path = [];
        for (let node = current; node !== -1; node = this.parent[node]) path.push(node);
        path.reverse();
        return { status: 'found', length: this.g[current], path, expanded };
      }

      const x = current % cols;
      const rest = (current - x) / cols;
      const z = rest % rows;
      const y = (rest - z) / rows;
      for (const { dx, dy, dz, cost, via } of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (grid.at(nx, ny, nz) !== OPEN) continue;
        let squeezed = false;
        for (const [ex, ey, ez] of via) {
          if (grid.at(x + ex, y + ey, z + ez) !== OPEN) {
            squeezed = true;
            break;
          }
        }
        if (squeezed) continue;
        const next = grid.index(nx, ny, nz);
        if (this.state[next] === IN_CLOSED_SET) continue;
        const g = this.g[current] + cost;
        if (g >= this.g[next]) continue;
        this.g[next] = g;
        this.parent[next] = current;
        this.state[next] = IN_OPEN_SET;
        this.push(next, g + estimate(nx, ny, nz));
      }
    }
    return { status: 'unreachable', expanded };
  }
}

// 칸 번호 → 칸 좌표
export function cellOf(grid, index) {
  const x = index % grid.cols;
  const rest = (index - x) / grid.cols;
  const z = rest % grid.rows;
  return { x, y: (rest - z) / grid.rows, z };
}

/* 평가 ------------------------------------------------------------------- */

// 26방향: 가로세로 6, 모서리 대각 12, 꼭짓점 대각 8
export const ENCLOSURE_DIRECTIONS = [];
for (let dy = -1; dy <= 1; dy++) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      const length = Math.hypot(dx, dy, dz);
      ENCLOSURE_DIRECTIONS.push([dx / length, dy / length, dz / length]);
    }
  }
}

function measureEnclosure(grid, ox, oy, oz) {
  const rays = [];
  let sum = 0;
  for (const [dx, dy, dz] of ENCLOSURE_DIRECTIONS) {
    const hit = traverse(grid, ox, oy, oz, dx, dy, dz, ENCLOSURE_RANGE);
    const distance = hit.blocked ? hit.t : ENCLOSURE_RANGE;
    sum += Math.min(distance, ENCLOSURE_RANGE) / ENCLOSURE_RANGE;
    rays.push({ dx, dy, dz, distance, blocked: hit.blocked });
  }
  return { openness: sum / ENCLOSURE_DIRECTIONS.length, rays };
}

export function evaluate(scene, finder) {
  const { grid, listener, source } = scene;
  const ox = listener.x + 0.5;
  const oy = listener.y + 0.5;
  const oz = listener.z + 0.5;
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const dz = source.z - listener.z;
  const straight = Math.hypot(dx, dy, dz);

  const result = {
    straight,
    near: nearScale(straight),
    los: traverse(grid, ox, oy, oz, dx, dy, dz, 1),
    search: null,
    ratio: 0,
    base: 0,
    occlusion: 0,
    enclosure: measureEnclosure(grid, ox, oy, oz),
  };

  if (result.los.blocked) {
    const search = finder.search(grid, listener, source, straight * (1 + SATURATION_RATIO));
    result.search = search;
    if (search.status === 'found') {
      result.ratio = (search.length - straight) / straight;
      result.base = 1 - Math.exp(-OCCLUSION_K * result.ratio);
    } else if (search.status === 'cutoff') {
      result.ratio = SATURATION_RATIO;
      result.base = SATURATION;
    } else {
      result.ratio = Infinity;
      result.base = 1;
    }
  }
  result.occlusion = result.base * result.near;
  return result;
}

/* 고르기 ----------------------------------------------------------------- */

// 화면에서 누른 곳: 카메라 레이가 처음 닿는 블록(hit)과 그 앞의 빈 칸(place, 블록을 놓을 자리)을 찾습니다.
// 블록에 닿기 전에 바닥(y = 0)에 닿으면 그 바닥 칸이 놓을 자리입니다.
export function pick(grid, origin, direction) {
  const o = [origin[0], origin[1], origin[2]];
  const d = [direction[0], direction[1], direction[2]];
  const max = [grid.cols, grid.levels, grid.rows];
  let enter = 0;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]) < 1e-12) {
      if (o[axis] < 0 || o[axis] > max[axis]) return null;
      continue;
    }
    let t0 = (0 - o[axis]) / d[axis];
    let t1 = (max[axis] - o[axis]) / d[axis];
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    exit = Math.min(exit, t1);
  }
  if (enter > exit) return null;

  const start = o.map((value, axis) => value + d[axis] * (enter + 1e-6));
  const cell = start.map((value, axis) => Math.min(Math.max(Math.floor(value), 0), max[axis] - 1));
  const step = d.map((value) => Math.sign(value));
  const delta = d.map((value) => (value ? Math.abs(1 / value) : Infinity));
  const next = cell.map((value, axis) =>
    step[axis] > 0 ? (value + 1 - o[axis]) / d[axis] : step[axis] < 0 ? (value - o[axis]) / d[axis] : Infinity,
  );

  let previous = null;
  for (let guard = 0; guard < max[0] + max[1] + max[2] + 3; guard++) {
    if (grid.at(cell[0], cell[1], cell[2]) === WALL) {
      return { hit: { x: cell[0], y: cell[1], z: cell[2] }, place: previous };
    }
    const axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
    previous = { x: cell[0], y: cell[1], z: cell[2] };
    cell[axis] += step[axis];
    if (cell[axis] < 0 || cell[axis] >= max[axis]) {
      return axis === 1 && step[1] < 0 ? { hit: null, ground: true, place: previous } : null;
    }
    next[axis] += delta[axis];
  }
  return null;
}
