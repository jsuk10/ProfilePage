// 공간음향 차폐 데모 (2D 셀 그리드)
// Like Or Die 의 차폐도 계산 흐름을 따라갑니다.
//   1. 청취자 → 음원 직선 레이. 막히지 않으면 차폐 0
//   2. 막힌 경우에만 셀 그리드 A* 로 우회 경로를 찾습니다. (8방향, 벽 모서리 사이로 빠져나가기 금지)
//      남은 후보의 예상 길이가 포화 임계를 넘으면 더 찾지 않고 멈춥니다. (컷오프)
//   3. 우회 비율 = (경로 길이 - 직선 거리) / 직선 거리
//   4. 차폐 계수 = (1 - e^(-k × 우회 비율)) × 근접 보정
// 밀폐도는 청취자에서 16방향으로 레이를 쏴 히트 거리 평균으로 구합니다. (1 = 개방, 0 = 밀폐)
// 계수는 시연용 값입니다.

import { escapeHtml } from './markdown.js';
import { soundGateMarkup, soundControlsMarkup, soundReadoutMarkup, soundHelpMarkup, bindSound } from './spatial-audio-sound.js';

export const OCCLUSION_K = 1.6;
export const SATURATION = 0.98; // 이 값에 닿으면 포화로 보고 탐색을 멈춥니다.
export const SATURATION_RATIO = -Math.log(1 - SATURATION) / OCCLUSION_K; // 차폐 계수 식을 역산한 컷오프 우회 비율
const NEAR_RANGE = 4; // m. 이보다 가까운 음원은 차폐를 약하게 적용
const NEAR_MIN_SCALE = 0.35; // 거리 0 일 때 차폐 배율
const ENCLOSURE_RAYS = 16;
export const ENCLOSURE_RANGE = 10; // m
const CURVE_MAX_RATIO = 3;
const EPSILON = 1e-9;

const OPEN = 0;
const WALL = 1;
const OUTSIDE = -1;

const IN_OPEN_SET = 1;
const IN_CLOSED_SET = 2;

const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const NAMES = { listener: '청취자', source: '음원' };

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

/* 그리드 ------------------------------------------------------------------ */

class Grid {
  constructor(cols, rows, walls = new Uint8Array(cols * rows)) {
    this.cols = cols;
    this.rows = rows;
    this.walls = walls;
  }

  clone() {
    return new Grid(this.cols, this.rows, this.walls.slice());
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return OUTSIDE;
    return this.walls[y * this.cols + x];
  }

  set(x, y, value) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.walls[y * this.cols + x] = value;
  }
}

// spatial-audio.yml 의 배치도 → { name, grid, listener, source }
function parsePreset(preset) {
  const lines = String(preset.map ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();

  const rows = Math.max(lines.length, 4);
  const cols = Math.max(4, ...lines.map((line) => line.length));
  const grid = new Grid(cols, rows);
  let listener = null;
  let source = null;

  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const mark = line[x];
      if (mark === '#') grid.set(x, y, WALL);
      else if (mark === 'L' || mark === 'l') listener = { x, y };
      else if (mark === 'S' || mark === 's') source = { x, y };
    }
  });

  listener ??= { x: 1, y: rows >> 1 };
  source ??= { x: cols - 2, y: rows >> 1 };
  grid.set(listener.x, listener.y, OPEN);
  grid.set(source.x, source.y, OPEN);
  return { name: String(preset.name ?? ''), grid, listener, source };
}

const cloneScene = (scene) => ({
  name: scene.name,
  grid: scene.grid.clone(),
  listener: { ...scene.listener },
  source: { ...scene.source },
});

/* 레이 ------------------------------------------------------------------- */

// (ox, oy) 에서 (dx, dy) 방향으로 t ∈ [0, maxT] 동안 지나는 칸을 차례로 검사합니다. (DDA)
// 칸 꼭짓점을 정확히 지날 때는 양옆 칸이 모두 벽일 때만 막힌 것으로 봅니다.
function traverse(grid, ox, oy, dx, dy, maxT) {
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = stepX ? Math.abs(1 / dx) : Infinity;
  const deltaY = stepY ? Math.abs(1 / dy) : Infinity;
  let nextX = stepX > 0 ? (cx + 1 - ox) * deltaX : stepX < 0 ? (ox - cx) * deltaX : Infinity;
  let nextY = stepY > 0 ? (cy + 1 - oy) * deltaY : stepY < 0 ? (oy - cy) * deltaY : Infinity;

  for (;;) {
    const t = Math.min(nextX, nextY);
    if (t > maxT) return { blocked: false, t: maxT };

    if (Math.abs(nextX - nextY) <= EPSILON * Math.max(1, t)) {
      if (grid.at(cx + stepX, cy) === WALL && grid.at(cx, cy + stepY) === WALL) {
        return { blocked: true, t, x: cx + stepX, y: cy + stepY };
      }
      cx += stepX;
      cy += stepY;
      nextX += deltaX;
      nextY += deltaY;
    } else if (nextX < nextY) {
      cx += stepX;
      nextX += deltaX;
    } else {
      cy += stepY;
      nextY += deltaY;
    }

    const cell = grid.at(cx, cy);
    if (cell === OUTSIDE) return { blocked: false, outside: true, t };
    if (cell === WALL) return { blocked: true, t, x: cx, y: cy };
  }
}

/* A* --------------------------------------------------------------------- */

// 칸 수만큼 버퍼를 미리 잡아 두고 매번 재사용합니다. (탐색 중 새 할당 없음)
class PathFinder {
  constructor() {
    this.capacity = 0;
  }

  ensure(size) {
    if (size <= this.capacity) return;
    this.capacity = size;
    this.g = new Float64Array(size);
    this.parent = new Int32Array(size);
    this.state = new Uint8Array(size);
    // 같은 칸을 더 짧은 비용으로 다시 넣는 방식이라 힙은 이웃 수(8)만큼 넉넉히 잡습니다.
    this.heapNodes = new Int32Array(size * 8 + 8);
    this.heapKeys = new Float64Array(size * 8 + 8);
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
    const { cols } = grid;
    const size = cols * grid.rows;
    this.ensure(size);
    this.g.fill(Infinity, 0, size);
    this.parent.fill(-1, 0, size);
    this.state.fill(0, 0, size);
    this.heapSize = 0;

    const octile = (x, y) => {
      const dx = Math.abs(x - goal.x);
      const dy = Math.abs(y - goal.y);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const startIndex = start.y * cols + start.x;
    const goalIndex = goal.y * cols + goal.x;
    this.g[startIndex] = 0;
    this.state[startIndex] = IN_OPEN_SET;
    this.push(startIndex, octile(start.x, start.y));
    let expanded = 0;

    while (this.heapSize > 0) {
      const estimate = this.heapKeys[0];
      const current = this.pop();
      if (this.state[current] === IN_CLOSED_SET) continue;
      // 휴리스틱이 일관적이라 꺼내는 순서대로 예상 길이가 커집니다. 넘었으면 남은 후보도 모두 넘습니다.
      if (estimate > limit + EPSILON) return { status: 'cutoff', expanded };
      this.state[current] = IN_CLOSED_SET;
      expanded += 1;

      if (current === goalIndex) {
        const path = [];
        for (let node = current; node !== -1; node = this.parent[node]) path.push(node);
        path.reverse();
        return { status: 'found', length: this.g[current], path, expanded };
      }

      const x = current % cols;
      const y = (current - x) / cols;
      for (const [dx, dy, cost] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (grid.at(nx, ny) !== OPEN) continue;
        if (dx && dy && (grid.at(x + dx, y) !== OPEN || grid.at(x, y + dy) !== OPEN)) continue;
        const next = ny * cols + nx;
        if (this.state[next] === IN_CLOSED_SET) continue;
        const g = this.g[current] + cost;
        if (g >= this.g[next]) continue;
        this.g[next] = g;
        this.parent[next] = current;
        this.state[next] = IN_OPEN_SET;
        this.push(next, g + octile(nx, ny));
      }
    }
    return { status: 'unreachable', expanded };
  }
}

/* 평가 ------------------------------------------------------------------- */

export const nearScale = (distance) =>
  distance >= NEAR_RANGE ? 1 : NEAR_MIN_SCALE + (1 - NEAR_MIN_SCALE) * (distance / NEAR_RANGE);

function measureEnclosure(grid, ox, oy) {
  const rays = [];
  let sum = 0;
  for (let index = 0; index < ENCLOSURE_RAYS; index++) {
    const angle = (index / ENCLOSURE_RAYS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const hit = traverse(grid, ox, oy, dx, dy, ENCLOSURE_RANGE);
    // 그리드 밖으로 나간 레이는 열린 공간으로 봅니다.
    const distance = hit.blocked ? hit.t : ENCLOSURE_RANGE;
    sum += Math.min(distance, ENCLOSURE_RANGE) / ENCLOSURE_RANGE;
    rays.push({ dx, dy, distance, blocked: hit.blocked });
  }
  return { openness: sum / ENCLOSURE_RAYS, rays };
}

function evaluate(scene, finder) {
  const { grid, listener, source } = scene;
  const ox = listener.x + 0.5;
  const oy = listener.y + 0.5;
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const straight = Math.hypot(dx, dy);

  const result = {
    straight,
    near: nearScale(straight),
    los: traverse(grid, ox, oy, dx, dy, 1),
    search: null,
    ratio: 0,
    base: 0,
    occlusion: 0,
    enclosure: measureEnclosure(grid, ox, oy),
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

// 직선이 막혔을 때 소리가 들려오는 자리 (3D 의 apparentSource 와 같음)
function apparentSource(scene, result) {
  if (!result.los.blocked || result.search?.status !== 'found') return null;
  const { grid, listener } = scene;
  const ox = listener.x + 0.5;
  const oy = listener.y + 0.5;
  let seen = null;
  for (const index of result.search.path.slice(1)) {
    const x = (index % grid.cols) + 0.5;
    const y = Math.floor(index / grid.cols) + 0.5;
    if (traverse(grid, ox, oy, x - ox, y - oy, 1).blocked) break;
    seen = [x, y];
  }
  if (!seen) return null;
  const length = Math.hypot(seen[0] - ox, seen[1] - oy) || 1;
  const distance = result.search.length;
  return { position: [ox + ((seen[0] - ox) / length) * distance, oy + ((seen[1] - oy) / length) * distance], distance };
}

/* 표시 ------------------------------------------------------------------- */

const CURVE = { left: 30, right: 232, top: 12, bottom: 108 };
const curveX = (ratio) =>
  CURVE.left + (Math.min(Math.max(ratio, 0), CURVE_MAX_RATIO) / CURVE_MAX_RATIO) * (CURVE.right - CURVE.left);
const curveY = (value) => CURVE.bottom - value * (CURVE.bottom - CURVE.top);

function curveMarkup(titleId) {
  let line = '';
  for (let index = 0; index <= 60; index++) {
    const ratio = (index / 60) * CURVE_MAX_RATIO;
    line += `${index ? 'L' : 'M'}${curveX(ratio).toFixed(1)} ${curveY(1 - Math.exp(-OCCLUSION_K * ratio)).toFixed(1)}`;
  }
  const area = `${line}L${CURVE.right} ${CURVE.bottom}L${CURVE.left} ${CURVE.bottom}Z`;
  const gridLines = [0, 0.5, 1]
    .map((value) => `<line x1="${CURVE.left}" x2="${CURVE.right}" y1="${curveY(value)}" y2="${curveY(value)}"/>`)
    .join('');
  const xTicks = [0, 1, 2, 3]
    .map((value) => `<text x="${curveX(value)}" y="${CURVE.bottom + 12}" text-anchor="middle">${value}</text>`)
    .join('');
  const yTicks = [0, 0.5, 1]
    .map((value) => `<text x="${CURVE.left - 6}" y="${curveY(value) + 3}" text-anchor="end">${value}</text>`)
    .join('');
  const cutoffX = curveX(SATURATION_RATIO).toFixed(1);

  return `
    <figure class="pf-curve">
      <svg viewBox="0 0 240 136" role="img" aria-labelledby="${titleId}">
        <title id="${titleId}">차폐 계수 곡선. 우회 비율이 커질수록 차폐 계수가 1에 가까워지고, 포화 임계에서 탐색을 멈춥니다.</title>
        <g class="pf-curve__grid">${gridLines}</g>
        <path class="pf-curve__area" d="${area}"/>
        <line class="pf-curve__cutoff" x1="${cutoffX}" x2="${cutoffX}" y1="${CURVE.top}" y2="${CURVE.bottom}"/>
        <text class="pf-curve__note" x="${Number(cutoffX) - 4}" y="${CURVE.bottom - 6}" text-anchor="end">컷오프</text>
        <path class="pf-curve__line" d="${line}"/>
        <g class="pf-curve__ticks">${xTicks}${yTicks}</g>
        <text class="pf-curve__axis" x="${(CURVE.left + CURVE.right) / 2}" y="134" text-anchor="middle">우회 비율</text>
        <g class="pf-curve__marker" data-curve-marker>
          <line class="pf-curve__guide" data-guide="x"/>
          <line class="pf-curve__guide" data-guide="y"/>
          <circle r="4.5" data-dot/>
        </g>
      </svg>
      <figcaption>우회 비율이 커질수록 1에 수렴하는 지수 포화 곡선입니다. 곡선 모양은 데모용이고, 점은 근접 보정 전 값입니다.</figcaption>
    </figure>`;
}

const READOUT = [
  ['straight', '직선 거리'],
  ['los', '직선 레이'],
  ['path', '우회 경로'],
  ['ratio', '우회 비율'],
  ['expanded', 'A* 확장 칸'],
  ['near', '근접 보정'],
];

export function panelMarkup(titleId, extra = '') {
  const rows = READOUT.map(
    ([key, label]) => `<div class="pf-readout__row"><dt>${label}</dt><dd data-out="${key}"></dd></div>`,
  ).join('');
  const meter = (key, label, hint) => `
        <div class="pf-readout__row pf-readout__row--meter">
          <dt>${label}${hint ? ` <span class="pf-readout__hint">${hint}</span>` : ''}</dt>
          <dd>
            <span class="pf-readout__value" data-out="${key}"></span>
            <span class="pf-meter" aria-hidden="true"><span class="pf-meter__fill" data-meter="${key}"></span></span>
          </dd>
        </div>`;
  return `
    <dl class="pf-readout">
      ${rows}
      ${meter('occlusion', '차폐 계수')}
      ${meter('enclosure', '밀폐도', '1 = 개방')}
    </dl>
    ${extra}
    ${curveMarkup(titleId)}`;
}

// 수치 패널(panelMarkup)을 계산 결과에 맞춰 채우는 함수를 돌려줍니다. 2D / 3D 데모가 같이 씁니다.
export function bindPanel(root) {
  const outputs = Object.fromEntries([...root.querySelectorAll('[data-out]')].map((node) => [node.dataset.out, node]));
  const meters = Object.fromEntries([...root.querySelectorAll('[data-meter]')].map((node) => [node.dataset.meter, node]));
  const marker = {
    dot: root.querySelector('[data-curve-marker] [data-dot]'),
    guideX: root.querySelector('[data-guide="x"]'),
    guideY: root.querySelector('[data-guide="y"]'),
  };

  return function render(r) {
    const fixed = (value, digits) => value.toFixed(digits);
    outputs.straight.textContent = `${fixed(r.straight, 1)}m`;
    outputs.los.textContent = r.los.blocked ? '막힘' : '통과';
    outputs.los.dataset.state = r.los.blocked ? 'blocked' : 'clear';

    if (!r.search) {
      outputs.path.textContent = '탐색 안 함';
      outputs.ratio.textContent = '0';
      outputs.expanded.textContent = '0칸';
    } else {
      outputs.expanded.textContent = `${r.search.expanded}칸`;
      if (r.search.status === 'found') {
        outputs.path.textContent = `${fixed(r.search.length, 1)}m`;
        outputs.ratio.textContent = fixed(r.ratio, 2);
      } else if (r.search.status === 'cutoff') {
        outputs.path.textContent = '컷오프 (포화)';
        outputs.ratio.textContent = `${fixed(SATURATION_RATIO, 2)} 이상`;
      } else {
        outputs.path.textContent = '경로 없음';
        outputs.ratio.textContent = '측정 불가';
      }
    }
    outputs.near.textContent = `× ${fixed(r.near, 2)}`;
    outputs.occlusion.textContent = fixed(r.occlusion, 2);
    outputs.enclosure.textContent = fixed(r.enclosure.openness, 2);
    meters.occlusion.style.transform = `scaleX(${r.occlusion.toFixed(3)})`;
    meters.enclosure.style.transform = `scaleX(${r.enclosure.openness.toFixed(3)})`;

    const x = curveX(Number.isFinite(r.ratio) ? r.ratio : CURVE_MAX_RATIO);
    const y = curveY(r.base);
    marker.dot.setAttribute('cx', x.toFixed(1));
    marker.dot.setAttribute('cy', y.toFixed(1));
    marker.guideX.setAttribute('x1', x.toFixed(1));
    marker.guideX.setAttribute('x2', x.toFixed(1));
    marker.guideX.setAttribute('y1', y.toFixed(1));
    marker.guideX.setAttribute('y2', String(CURVE.bottom));
    marker.guideY.setAttribute('x1', String(CURVE.left));
    marker.guideY.setAttribute('x2', x.toFixed(1));
    marker.guideY.setAttribute('y1', y.toFixed(1));
    marker.guideY.setAttribute('y2', y.toFixed(1));
  };
}

function bresenham(from, to, visit) {
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === to.x && y === to.y) return;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/* 마운트 ----------------------------------------------------------------- */

export function mountSpatialAudioDemo(container, { presets, idPrefix = 'spatial-audio' }) {
  const scenes = presets.map(parsePreset);
  if (!scenes.length) return;

  const helpId = `${idPrefix}-lab-help`;
  const curveTitleId = `${idPrefix}-lab-curve`;

  container.innerHTML = `
    <div class="pf-lab__stage">
      <div class="pf-lab__toolbar">
        <div class="pf-segmented" role="group" aria-label="배치">
          ${scenes
            .map(
              (scene, index) =>
                `<button type="button" class="pf-button pf-segmented__item" data-preset="${index}" aria-pressed="${index === 0}">${escapeHtml(scene.name || `배치 ${index + 1}`)}</button>`,
            )
            .join('')}
        </div>
        <div class="pf-lab__actions">
          <button type="button" class="pf-button pf-switch" role="switch" aria-checked="false" data-rays>
            <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>밀폐도 레이
          </button>
          <button type="button" class="pf-button pf-lab__reset" data-reset>배치 되돌리기</button>
        </div>
      </div>
      <div class="pf-lab__view">
        <canvas class="pf-lab__canvas" tabindex="0" role="application" aria-label="공간음향 차폐 데모 그리드" aria-describedby="${helpId}"></canvas>${soundGateMarkup()}
      </div>${soundControlsMarkup()}
      <ul class="pf-lab__legend" aria-label="그리드 보는 법">
        <li><span class="pf-lab__key pf-lab__key--wall" aria-hidden="true"></span>벽</li>
        <li><span class="pf-lab__key pf-lab__key--explored" aria-hidden="true"></span>A* 가 우회 경로를 찾으며 살펴본 칸</li>
        <li><span class="pf-lab__key pf-lab__key--path" aria-hidden="true"></span>우회 경로</li>
        <li><span class="pf-lab__key pf-lab__key--blocked" aria-hidden="true"></span>막힌 직선 레이</li>
      </ul>
      <div class="pf-lab__help" id="${helpId}">
        <p>청취자와 음원 점을 끌어 옮기고, 빈 칸을 누르거나 끌면 벽을 세우고 벽을 누르면 지웁니다.
        키보드로는 방향키로 선택한 점을 옮기고, Space 로 청취자 / 음원을 바꿉니다.</p>
        ${soundHelpMarkup()}
      </div>
    </div>
    <div class="pf-lab__panel">${panelMarkup(curveTitleId, soundReadoutMarkup())}</div>
    <p class="pf-visually-hidden" aria-live="polite" data-live></p>`;

  const canvas = container.querySelector('canvas');
  const context = canvas.getContext('2d');
  const live = container.querySelector('[data-live]');
  const render = bindPanel(container);
  const sound = bindSound(container, { live });
  const presetButtons = [...container.querySelectorAll('[data-preset]')];
  const raysSwitch = container.querySelector('[data-rays]');

  const finder = new PathFinder();
  let presetIndex = 0;
  let scene = cloneScene(scenes[0]);
  let result = null;
  let active = 'source';
  let showRays = false;
  let drag = null;
  let view = { width: 0, height: 0, cell: 0, dpr: 1 };
  let colors = null;
  let visible = true;
  let frameId = 0;

  function readColors() {
    const style = getComputedStyle(container);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    colors = {
      grid: read('--pf-lab-grid', 'rgba(246, 241, 255, 0.07)'),
      wall: read('--pf-lab-wall', '#cbbdf0'),
      explored: read('--pf-lab-explored', 'rgba(242, 165, 214, 0.14)'),
      ray: read('--pf-lab-ray', 'rgba(246, 241, 255, 0.5)'),
      ink: read('--pf-ink', '#f6f1ff'),
      accent: read('--pf-accent', '#f2a5d6'),
      surface: read('--pf-lab-surface', '#1e0d42'),
      font: style.fontFamily || 'sans-serif',
    };
  }

  /* 그리기 */

  const shouldAnimate = () => visible && !reduceMotion.matches && !document.hidden;

  const focusVisible = () => {
    try {
      return canvas.matches(':focus-visible');
    } catch {
      return document.activeElement === canvas;
    }
  };

  function requestDraw() {
    if (!frameId) frameId = window.requestAnimationFrame(frame);
  }

  function frame(now) {
    frameId = 0;
    draw(now);
    if (shouldAnimate()) frameId = window.requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view = { width: rect.width, height: rect.height, cell: rect.width / scene.grid.cols, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    requestDraw();
  }

  function strokeLine(x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  function drawHandle(x, y, radius, fill) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = colors.surface;
    context.stroke();
  }

  function drawLabel(text, x, y, radius) {
    const size = Math.round(Math.min(13, Math.max(10, view.cell * 0.55)));
    context.font = `600 ${size}px ${colors.font}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const half = context.measureText(text).width / 2;
    const left = Math.min(Math.max(x, half + 2), view.width - half - 2);
    let top = y - radius - 6;
    if (top - size < 0) top = y + radius + size + 4;
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = colors.surface;
    context.strokeText(text, left, top);
    context.fillStyle = colors.ink;
    context.fillText(text, left, top);
  }

  function draw(now = performance.now()) {
    const { cell, dpr, width, height } = view;
    if (!cell || !result) return;
    const { grid, listener, source } = scene;
    const { cols, rows } = grid;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.lineCap = 'butt';
    context.lineJoin = 'miter';

    // 격자
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 1; x < cols; x++) {
      const px = Math.round(x * cell) + 0.5;
      context.moveTo(px, 0);
      context.lineTo(px, height);
    }
    for (let y = 1; y < rows; y++) {
      const py = Math.round(y * cell) + 0.5;
      context.moveTo(0, py);
      context.lineTo(width, py);
    }
    context.stroke();

    // A* 가 확장한 칸
    if (result.search) {
      context.fillStyle = colors.explored;
      const { state } = finder;
      for (let index = 0; index < cols * rows; index++) {
        if (state[index] !== IN_CLOSED_SET) continue;
        const x = index % cols;
        const y = (index - x) / cols;
        context.fillRect(x * cell + 1, y * cell + 1, cell - 1, cell - 1);
      }
    }

    // 벽
    context.fillStyle = colors.wall;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid.walls[y * cols + x] !== WALL) continue;
        const left = Math.floor(x * cell);
        const top = Math.floor(y * cell);
        context.fillRect(left, top, Math.ceil((x + 1) * cell) - left, Math.ceil((y + 1) * cell) - top);
      }
    }

    const lx = (listener.x + 0.5) * cell;
    const ly = (listener.y + 0.5) * cell;
    const sx = (source.x + 0.5) * cell;
    const sy = (source.y + 0.5) * cell;

    // 밀폐도 레이
    if (showRays) {
      context.strokeStyle = colors.ray;
      context.lineWidth = 1;
      context.globalAlpha = 0.55;
      context.beginPath();
      for (const ray of result.enclosure.rays) {
        context.moveTo(lx, ly);
        context.lineTo(lx + ray.dx * ray.distance * cell, ly + ray.dy * ray.distance * cell);
      }
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = colors.ray;
      for (const ray of result.enclosure.rays) {
        if (!ray.blocked) continue;
        context.beginPath();
        context.arc(lx + ray.dx * ray.distance * cell, ly + ray.dy * ray.distance * cell, 2, 0, Math.PI * 2);
        context.fill();
      }
    }

    // 직선 레이: 막혔으면 히트 지점까지 실선, 그 뒤는 점선
    if (result.los.blocked) {
      const hx = lx + (sx - lx) * result.los.t;
      const hy = ly + (sy - ly) * result.los.t;
      context.strokeStyle = colors.ink;
      context.lineWidth = 1.5;
      context.globalAlpha = 0.75;
      strokeLine(lx, ly, hx, hy);
      context.setLineDash([3, 4]);
      context.globalAlpha = 0.35;
      strokeLine(hx, hy, sx, sy);
      context.setLineDash([]);
      context.globalAlpha = 1;
      const mark = Math.max(3, cell * 0.22);
      context.lineWidth = 2;
      strokeLine(hx - mark, hy - mark, hx + mark, hy + mark);
      strokeLine(hx - mark, hy + mark, hx + mark, hy - mark);
    } else {
      context.strokeStyle = colors.accent;
      context.lineWidth = 2.5;
      context.lineCap = 'round';
      strokeLine(lx, ly, sx, sy);
    }

    // A* 우회 경로
    if (result.search?.status === 'found') {
      context.strokeStyle = colors.accent;
      context.lineWidth = 2.5;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      result.search.path.forEach((index, step) => {
        const x = ((index % cols) + 0.5) * cell;
        const y = (Math.floor(index / cols) + 0.5) * cell;
        if (step) context.lineTo(x, y);
        else context.moveTo(x, y);
      });
      context.stroke();
    }

    // 음원 파동
    const radius = Math.max(5, cell * 0.36);
    context.strokeStyle = colors.accent;
    context.lineWidth = 1.5;
    if (shouldAnimate()) {
      for (let ring = 0; ring < 2; ring++) {
        const phase = (now / 1800 + ring / 2) % 1;
        context.globalAlpha = (1 - phase) * 0.6;
        context.beginPath();
        context.arc(sx, sy, radius + phase * cell * 2.2, 0, Math.PI * 2);
        context.stroke();
      }
    } else {
      context.globalAlpha = 0.4;
      context.beginPath();
      context.arc(sx, sy, radius + cell, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;

    drawHandle(lx, ly, radius, colors.ink);
    drawHandle(sx, sy, radius, colors.accent);

    // 키보드로 고른 점 표시
    if (focusVisible()) {
      const [ax, ay] = active === 'source' ? [sx, sy] : [lx, ly];
      context.strokeStyle = colors.ink;
      context.lineWidth = 1.5;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.arc(ax, ay, radius + 5, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    drawLabel(NAMES.listener, lx, ly, radius);
    drawLabel(NAMES.source, sx, sy, radius);
  }

  // 단면이라 높이는 없습니다. 화면 위쪽이 청취자가 보는 방향입니다.
  function soundFrame() {
    const via = apparentSource(scene, result);
    return {
      listener: [scene.listener.x + 0.5, 0.5, scene.listener.y + 0.5],
      source: [scene.source.x + 0.5, 0.5, scene.source.y + 0.5],
      straight: result.straight,
      apparent: via ? [via.position[0], 0.5, via.position[1]] : null,
      pathLength: via?.distance ?? result.straight,
      blocked: result.los.blocked,
      forward: [0, 0, -1],
      occlusion: result.occlusion,
      openness: result.enclosure.openness,
    };
  }

  function update() {
    result = evaluate(scene, finder);
    render(result);
    sound.update(soundFrame());
    requestDraw();
  }

  function announce(prefix) {
    const r = result;
    const los = r.los.blocked ? '직선 레이 막힘' : '직선 레이 통과';
    live.textContent = `${prefix ? `${prefix}. ` : ''}${los}, 차폐 계수 ${r.occlusion.toFixed(2)}, 밀폐도 ${r.enclosure.openness.toFixed(2)}`;
  }

  function loadScene(index, message) {
    presetIndex = index;
    scene = cloneScene(scenes[index]);
    presetButtons.forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
    canvas.style.aspectRatio = `${scene.grid.cols} / ${scene.grid.rows}`;
    resize();
    update();
    announce(message);
  }

  /* 조작 */

  const isHandle = (x, y) =>
    (scene.listener.x === x && scene.listener.y === y) || (scene.source.x === x && scene.source.y === y);

  function moveHandle(which, x, y) {
    const other = which === 'source' ? scene.listener : scene.source;
    if (scene.grid.at(x, y) !== OPEN || (other.x === x && other.y === y)) return false;
    scene[which] = { x, y };
    return true;
  }

  function pointerCell(event) {
    const rect = canvas.getBoundingClientRect();
    const { cols, rows } = scene.grid;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * cols);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
    return { x: Math.min(Math.max(x, 0), cols - 1), y: Math.min(Math.max(y, 0), rows - 1) };
  }

  function handleAt(event) {
    const rect = canvas.getBoundingClientRect();
    const cell = rect.width / scene.grid.cols;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let found = null;
    let nearest = Math.max(cell * 0.85, event.pointerType === 'touch' ? 22 : 12);
    for (const which of ['source', 'listener']) {
      const point = scene[which];
      const distance = Math.hypot(px - (point.x + 0.5) * cell, py - (point.y + 0.5) * cell);
      if (distance <= nearest) {
        found = which;
        nearest = distance;
      }
    }
    return found;
  }

  function paint(x, y, value) {
    if (isHandle(x, y)) return;
    scene.grid.set(x, y, value);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const which = handleAt(event);
    canvas.setPointerCapture(event.pointerId);
    if (which) {
      drag = { kind: 'handle', which };
      active = which;
      canvas.style.cursor = 'grabbing';
    } else {
      const { x, y } = pointerCell(event);
      const value = scene.grid.at(x, y) === WALL ? OPEN : WALL;
      drag = { kind: 'paint', value, last: { x, y } };
      paint(x, y, value);
      update();
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return;
    if (!drag) {
      canvas.style.cursor = handleAt(event) ? 'grab' : 'crosshair';
      return;
    }
    const point = pointerCell(event);
    if (drag.kind === 'handle') {
      if (moveHandle(drag.which, point.x, point.y)) update();
    } else if (point.x !== drag.last.x || point.y !== drag.last.y) {
      bresenham(drag.last, point, (x, y) => paint(x, y, drag.value));
      drag.last = point;
      update();
    }
  });

  const endDrag = (event) => {
    if (!drag || !event.isPrimary) return;
    const message = drag.kind === 'handle' ? `${NAMES[drag.which]} 이동` : drag.value === WALL ? '벽 세움' : '벽 지움';
    drag = null;
    canvas.style.cursor = handleAt(event) ? 'grab' : 'crosshair';
    announce(message);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  canvas.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const point = scene[active];
      if (moveHandle(active, point.x + arrow[0], point.y + arrow[1])) {
        update();
        announce(`${NAMES[active]} ${scene[active].x + 1}, ${scene[active].y + 1}`);
      } else {
        announce(`${NAMES[active]}, 그쪽으로는 옮길 수 없습니다`);
      }
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      active = active === 'source' ? 'listener' : 'source';
      requestDraw();
      live.textContent = `${NAMES[active]} 선택`;
    }
  });
  canvas.addEventListener('focus', requestDraw);
  canvas.addEventListener('blur', requestDraw);

  presetButtons.forEach((button, index) => {
    button.addEventListener('click', () => loadScene(index, `${scenes[index].name} 배치`));
  });
  container.querySelector('[data-reset]').addEventListener('click', () => {
    loadScene(presetIndex, '배치를 처음으로 되돌렸습니다');
  });
  raysSwitch.addEventListener('click', () => {
    showRays = !showRays;
    raysSwitch.setAttribute('aria-checked', String(showRays));
    requestDraw();
  });

  /* 크기, 화면 노출 */

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  const syncSound = () => sound.setActive(visible && !document.hidden);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      syncSound();
      if (visible) requestDraw();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', () => {
    syncSound();
    requestDraw();
  });
  reduceMotion.addEventListener?.('change', requestDraw);
  document.fonts?.ready.then(requestDraw);

  readColors();
  canvas.style.aspectRatio = `${scene.grid.cols} / ${scene.grid.rows}`;
  update();
  resize();
  syncSound();
}

// 테스트용: 계산 부분만 따로 씁니다.
export const internals = { parsePreset, evaluate, traverse, PathFinder, SATURATION_RATIO };
