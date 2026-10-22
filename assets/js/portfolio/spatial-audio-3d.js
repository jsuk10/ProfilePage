// 공간음향 차폐 데모 (3D 복셀 화면)
// 계산은 spatial-audio-voxel.js, 오른쪽 수치 패널은 spatial-audio-demo.js 의 것을 같이 씁니다.
// 3D 라이브러리 없이 WebGL2 로 직접 그립니다.
//   불투명: 바닥, 격자, 블록(인스턴싱으로 한 번에), 청취자 / 음원
//   선:     직선 레이, A* 우회 경로, 밀폐도 레이. 화면 픽셀 두께로 넓힌 사각형으로 그립니다.
//   비침:   벽 뒤에 가린 점과 경로는 깊이 비교를 뒤집어(GREATER) 한 번 더 흐리게 그려서 벽 너머도 보이게 합니다.
// 화면 밖이거나 움직임 줄이기 설정이면 바뀔 때만 그립니다.

import { escapeHtml } from './markdown.js';
import { t } from './i18n.js';
import { panelMarkup, bindPanel } from './spatial-audio-demo.js';
import { soundGateMarkup, soundControlsMarkup, soundReadoutMarkup, soundHelpMarkup, bindSound } from './spatial-audio-sound.js';
import {
  OPEN,
  WALL,
  IN_CLOSED_SET,
  parseVoxelPreset,
  cloneVoxelScene,
  evaluate,
  apparentSource,
  VoxelPathFinder,
  cellOf,
  pick,
} from './spatial-audio-voxel.js';

const NAMES = { listener: t('청취자', 'Listener'), source: t('음원', 'Source'), virtual: t('가상 음원', 'Virtual source') };
const FOV = (38 * Math.PI) / 180;
const PHI_MIN = 0.3; // 거의 위에서 내려다보기
const PHI_MAX = 1.4; // 거의 옆에서 보기
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.6;
const DRAG_THRESHOLD = 5; // px. 이보다 덜 움직이면 누른 것으로 봅니다.
const HANDLE_RADIUS = 0.3;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

export function supportsWebGL2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

/* 수학 ------------------------------------------------------------------- */

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(eye, target, up) {
  const z = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

// out = a × b (열 우선 4x4)
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

const placeAndScale = (x, y, z, scale) =>
  new Float32Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, z, 1]);

/* 색 --------------------------------------------------------------------- */

function parseColor(value, fallback) {
  const text = String(value ?? '').trim();
  let match = /^#([0-9a-f]{6})$/i.exec(text);
  if (match) {
    const n = Number.parseInt(match[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  match = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
  }
  return fallback;
}

const alpha = (color, value) => [color[0], color[1], color[2], value];
const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

/* 셰이더 ----------------------------------------------------------------- */

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aOffset;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNormal;
void main() {
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * (uModel * vec4(aPosition, 1.0) + vec4(aOffset, 0.0));
}`;

// 반 램버트 조명: 빛을 등진 면도 너무 까맣지 않게 합니다. uAmbient = 1 이면 조명 없이 색 그대로
const MESH_FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
uniform vec4 uColor;
uniform vec3 uLight;
uniform float uAmbient;
out vec4 outColor;
void main() {
  float light = 0.5 + 0.5 * dot(normalize(vNormal), uLight);
  outColor = vec4(uColor.rgb * mix(light, 1.0, uAmbient), uColor.a);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec3 aOffset;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main() {
  gl_Position = uViewProj * (uModel * vec4(aPosition, 1.0) + vec4(aOffset, 0.0));
}`;

// 선분 양 끝을 화면에 옮긴 뒤 수직 방향으로 픽셀 두께만큼 넓혀 사각형으로 그립니다. (끝은 두께 절반만큼 늘림)
const THICK_VS = `#version 300 es
layout(location = 0) in vec3 aStart;
layout(location = 1) in vec3 aEnd;
layout(location = 2) in vec2 aCorner;
uniform mat4 uViewProj;
uniform vec2 uHalfViewport;
uniform float uHalfWidth;
void main() {
  vec4 a = uViewProj * vec4(aStart, 1.0);
  vec4 b = uViewProj * vec4(aEnd, 1.0);
  vec2 along = b.xy / b.w * uHalfViewport - a.xy / a.w * uHalfViewport;
  float size = length(along);
  vec2 dir = size > 1e-4 ? along / size : vec2(1.0, 0.0);
  vec2 side = vec2(-dir.y, dir.x);
  vec4 point = aCorner.x < 0.5 ? a : b;
  vec2 offset = (side * aCorner.y + dir * (aCorner.x * 2.0 - 1.0)) * uHalfWidth;
  point.xy += offset / uHalfViewport * point.w;
  gl_Position = point;
}`;

const POINT_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
uniform float uSize;
uniform float uWorld;
uniform float uFocal;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  gl_PointSize = uWorld > 0.5 ? uSize * uFocal / gl_Position.w : uSize;
}`;

const FLAT_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

const ROUND_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  outColor = uColor;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getShaderInfoLog(shader) || '셰이더 컴파일 실패');
  }
  return shader;
}

function createProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(program) || '셰이더 연결 실패');
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
  for (let index = 0; index < count; index++) {
    const { name } = gl.getActiveUniform(program, index);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

/* 모양 ------------------------------------------------------------------- */

// 한 변 1, 가운데가 원점인 정육면체. 면마다 바깥에서 볼 때 반시계 순서입니다. (뒷면 컬링)
function cubeGeometry() {
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach(([n, u, v], face) => {
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(...[0, 1, 2].map((axis) => n[axis] * 0.5 + u[axis] * su * 0.5 + v[axis] * sv * 0.5));
      normals.push(...n);
    }
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

// 정육면체 모서리 12개 (선)
function cubeEdges(size = 1, origin = [0, 0, 0], extent = [size, size, size]) {
  const out = [];
  const [ox, oy, oz] = origin;
  const corner = (i) => [ox + ((i & 1) ? extent[0] : 0), oy + ((i & 2) ? extent[1] : 0), oz + ((i & 4) ? extent[2] : 0)];
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      if (a & bit) continue;
      out.push(...corner(a), ...corner(a | bit));
    }
  }
  return new Float32Array(out);
}

function sphereGeometry(rings = 12, segments = 20) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      positions.push(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const array = new Float32Array(positions);
  return { positions: array, normals: array, indices: new Uint16Array(indices) };
}

// 선분 [ax, ay, az, bx, by, bz] 목록 → 두꺼운 선 정점 (선분마다 삼각형 2개)
const CORNERS = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
function thickVertices(segments) {
  const out = new Float32Array(segments.length * 6 * 8);
  let offset = 0;
  for (const segment of segments) {
    for (const [end, side] of CORNERS) {
      out.set(segment, offset);
      out[offset + 6] = end;
      out[offset + 7] = side;
      offset += 8;
    }
  }
  return out;
}

/* 그리기 도구 ------------------------------------------------------------ */

class VoxelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'low-power' });
    if (!this.gl) throw new Error('WebGL2 를 쓸 수 없습니다.');
    this.init();
  }

  // 컨텍스트를 잃었다가 되찾으면 다시 부릅니다.
  init() {
    const { gl } = this;
    this.programs = {
      mesh: createProgram(gl, MESH_VS, MESH_FS),
      line: createProgram(gl, LINE_VS, FLAT_FS),
      thick: createProgram(gl, THICK_VS, FLAT_FS),
      point: createProgram(gl, POINT_VS, ROUND_FS),
    };
    this.blockOffsets = gl.createBuffer();
    this.blockCount = 0;
    this.cube = this.meshVAO(cubeGeometry(), this.blockOffsets);
    this.cubeLines = this.lineVAO(cubeEdges(1, [-0.5, -0.5, -0.5]), this.blockOffsets);
    this.sphere = this.meshVAO(sphereGeometry());
    this.ground = this.meshVAO({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    });
    this.gridLines = this.lineVAO(new Float32Array(0));
    this.volumeLines = this.lineVAO(new Float32Array(0));
    this.points = {};
    this.thick = {};
    // 인스턴싱하지 않는 그리기에서 aOffset 은 이 값(0)을 씁니다.
    gl.vertexAttrib3f(2, 0, 0, 0);
    gl.vertexAttrib3f(1, 0, 1, 0);
  }

  meshVAO(geometry, instances = null) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.attribute(0, geometry.positions, 3);
    if (geometry.normals) this.attribute(1, geometry.normals, 3);
    if (instances) this.instanced(instances);
    let count = geometry.positions.length / 3;
    if (geometry.indices) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
      count = geometry.indices.length;
    }
    gl.bindVertexArray(null);
    return { vao, count, indexed: Boolean(geometry.indices) };
  }

  lineVAO(positions, instances = null) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = this.attribute(0, positions, 3, gl.DYNAMIC_DRAW);
    if (instances) this.instanced(instances);
    gl.bindVertexArray(null);
    return { vao, buffer, count: positions.length / 3 };
  }

  attribute(location, data, size, usage = this.gl.STATIC_DRAW) {
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  instanced(buffer) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
  }

  setLines(item, positions) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    item.count = positions.length / 3;
  }

  setBlocks(offsets) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blockOffsets);
    gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.DYNAMIC_DRAW);
    this.blockCount = offsets.length / 3;
  }

  // 점 묶음 (위치만)
  setPoints(name, positions) {
    const { gl } = this;
    let item = this.points[name];
    if (!item) {
      item = this.lineVAO(new Float32Array(0));
      this.points[name] = item;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    item.count = positions.length / 3;
  }

  // 두꺼운 선 묶음: 시작(3) 끝(3) 모서리(2)를 한 버퍼에 번갈아 담습니다.
  setThick(name, segments) {
    const { gl } = this;
    let item = this.thick[name];
    if (!item) {
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      gl.bindVertexArray(null);
      item = { vao, buffer, count: 0 };
      this.thick[name] = item;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, thickVertices(segments), gl.DYNAMIC_DRAW);
    item.count = segments.length * 6;
  }

  use(name) {
    const program = this.programs[name];
    if (this.current !== program) {
      this.gl.useProgram(program.program);
      this.current = program;
    }
    return program.uniforms;
  }

  begin(view) {
    const { gl } = this;
    this.view = view;
    this.current = null;
    gl.viewport(0, 0, view.width, view.height);
    gl.clearColor(...view.clear);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const name of ['mesh', 'line', 'thick', 'point']) {
      const uniforms = this.use(name);
      gl.uniformMatrix4fv(uniforms.uViewProj, false, view.viewProj);
    }
    const thick = this.use('thick');
    gl.uniform2f(thick.uHalfViewport, view.width / 2, view.height / 2);
    const point = this.use('point');
    gl.uniform1f(point.uFocal, view.focal);
    const mesh = this.use('mesh');
    gl.uniform3fv(mesh.uLight, view.light);
  }

  // 깊이 / 섞기 상태: opaque(불투명), blend(반투명, 깊이 안 씀), ghost(가려진 부분만), overlay(항상 위)
  mode(name) {
    const { gl } = this;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(name === 'ghost' ? gl.GREATER : gl.LEQUAL);
    gl.depthMask(name === 'opaque');
    if (name === 'opaque') gl.disable(gl.BLEND);
    else gl.enable(gl.BLEND);
    if (name === 'overlay') gl.disable(gl.DEPTH_TEST);
  }

  mesh(item, { color, model = IDENTITY, ambient = 0.35, instances = 0, cull = true }) {
    const { gl } = this;
    const uniforms = this.use('mesh');
    gl.uniformMatrix4fv(uniforms.uModel, false, model);
    gl.uniform4fv(uniforms.uColor, color);
    gl.uniform1f(uniforms.uAmbient, ambient);
    if (cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(item.vao);
    if (instances) gl.drawElementsInstanced(gl.TRIANGLES, item.count, gl.UNSIGNED_SHORT, 0, instances);
    else if (item.indexed) gl.drawElements(gl.TRIANGLES, item.count, gl.UNSIGNED_SHORT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, item.count);
    gl.disable(gl.CULL_FACE);
  }

  lines(item, { color, model = IDENTITY, instances = 0 }) {
    if (!item?.count) return;
    const { gl } = this;
    const uniforms = this.use('line');
    gl.uniformMatrix4fv(uniforms.uModel, false, model);
    gl.uniform4fv(uniforms.uColor, color);
    gl.bindVertexArray(item.vao);
    if (instances) gl.drawArraysInstanced(gl.LINES, 0, item.count, instances);
    else gl.drawArrays(gl.LINES, 0, item.count);
  }

  thickLines(name, { color, width }) {
    const item = this.thick[name];
    if (!item?.count) return;
    const { gl } = this;
    const uniforms = this.use('thick');
    gl.uniform4fv(uniforms.uColor, color);
    gl.uniform1f(uniforms.uHalfWidth, (width * this.view.dpr) / 2);
    gl.bindVertexArray(item.vao);
    gl.drawArrays(gl.TRIANGLES, 0, item.count);
  }

  dots(name, { color, size, world = false }) {
    const item = this.points[name];
    if (!item?.count) return;
    const { gl } = this;
    const uniforms = this.use('point');
    gl.uniform4fv(uniforms.uColor, color);
    gl.uniform1f(uniforms.uSize, world ? size : size * this.view.dpr);
    gl.uniform1f(uniforms.uWorld, world ? 1 : 0);
    gl.bindVertexArray(item.vao);
    gl.drawArrays(gl.POINTS, 0, item.count);
  }
}

/* 마운트 ----------------------------------------------------------------- */

export function mountSpatialAudio3D(container, { presets, idPrefix = 'spatial-audio' }) {
  const scenes = presets.map(parseVoxelPreset);
  if (!scenes.length) return;

  const helpId = `${idPrefix}-lab-help`;
  const curveTitleId = `${idPrefix}-lab-curve`;

  container.innerHTML = `
    <div class="pf-lab__stage">
      <div class="pf-lab__toolbar">
        <div class="pf-segmented" role="group" aria-label="${t('배치', 'Layout')}">
          ${scenes
            .map(
              (scene, index) =>
                `<button type="button" class="pf-button pf-segmented__item" data-preset="${index}" aria-pressed="${index === 0}">${escapeHtml(scene.name || t(`배치 ${index + 1}`, `Layout ${index + 1}`))}</button>`,
            )
            .join('')}
        </div>
        <div class="pf-lab__actions">
          <div class="pf-segmented" role="group" aria-label="${t('블록 도구', 'Block tool')}">
            <button type="button" class="pf-button pf-segmented__item" data-tool="place" aria-pressed="true">${t('블록 놓기', 'Place block')}</button>
            <button type="button" class="pf-button pf-segmented__item" data-tool="erase" aria-pressed="false">${t('블록 지우기', 'Remove block')}</button>
          </div>
          <button type="button" class="pf-button pf-switch" role="switch" aria-checked="true" data-virtual>
            <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>${t('가상 음원', 'Virtual source')}
          </button>
          <button type="button" class="pf-button pf-switch" role="switch" aria-checked="false" data-rays>
            <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>${t('밀폐도 레이', 'Enclosure rays')}
          </button>
          <button type="button" class="pf-button pf-lab__reset" data-reset>${t('배치 되돌리기', 'Reset layout')}</button>
        </div>
      </div>
      <div class="pf-lab__view">
        <canvas class="pf-lab__canvas pf-lab__canvas--3d" tabindex="0" role="application" aria-label="${t('공간음향 차폐 데모 3D 장면', 'Spatial audio occlusion demo 3D scene')}" aria-describedby="${helpId}"></canvas>
        <div class="pf-lab__labels" aria-hidden="true">
          <span class="pf-lab__label" data-label="listener">${NAMES.listener}</span>
          <span class="pf-lab__label" data-label="source">${NAMES.source}</span>
          <span class="pf-lab__label pf-lab__label--virtual" data-label="virtual" hidden>${NAMES.virtual}</span>
        </div>
        <p class="pf-lab__hint" aria-hidden="true" data-hint>${t('3D · 끌어서 돌려 보기', '3D · Drag to rotate')}</p>${soundGateMarkup()}
      </div>${soundControlsMarkup()}
      <ul class="pf-lab__legend" aria-label="${t('장면 범례', 'Scene legend')}">
        <li><span class="pf-lab__key pf-lab__key--wall" aria-hidden="true"></span>${t('블록', 'Block')}</li>
        <li><span class="pf-lab__key pf-lab__key--dot" aria-hidden="true"></span>${t('A* 가 우회 경로를 찾으며 살펴본 칸', 'Cells A* explored while searching for a detour')}</li>
        <li><span class="pf-lab__key pf-lab__key--path" aria-hidden="true"></span>${t('우회 경로', 'Detour path')}</li>
        <li><span class="pf-lab__key pf-lab__key--blocked" aria-hidden="true"></span>${t('막힌 직선 레이', 'Blocked direct ray')}</li>
        <li><span class="pf-lab__key pf-lab__key--virtual" aria-hidden="true"></span>${t('회절 가상 음원 (소리가 들려오는 자리)', 'Diffraction virtual source (where the sound comes from)')}</li>
      </ul>
      <div class="pf-lab__help" id="${helpId}">
        <p>${t(
          '가상 음원 스위치를 켜면 직선이 막혔을 때 소리가 들려오는 자리를 그립니다. 우회 경로에서 청취자에게 보이는 마지막 꺾인 점(문, 벽 끝) 방향으로 직선 거리만큼 떨어진 자리이고, 실제 구현에서는 이 위치를 Wwise 음원 포지션으로 넘겨 벽 너머가 아니라 뚫린 쪽에서 들리게 했습니다.',
          'Turn on Virtual source to see where the sound comes from when the direct line is blocked. It sits toward the last corner on the detour path that the listener can see (a door or wall edge), at the direct distance. In the real implementation, this position was passed to Wwise as the emitter position, so the sound comes from the opening instead of through the wall.',
        )}</p>
        <p>${t(
          '화면을 끌면 시점이 돌아가고 청취자와 음원은 끌어서 옮깁니다. 블록 놓기를 고른 뒤 바닥이나 블록 면을 누르면 그 자리에 블록이 생기고, 블록 지우기를 고른 뒤 누르면 지워집니다. 벽에 가린 점과 경로는 흐리게 비쳐 보입니다.',
          'Drag the view to rotate it, and drag the listener and source to move them. With Place block selected, click the floor or a block face to add a block there; with Remove block selected, click a block to delete it. Points and paths hidden behind walls show through faintly.',
        )}</p>
        <p>${t(
          '키보드로는 방향키로 선택한 점을 옮기고 PageUp / PageDown 으로 높이를 바꿉니다. Space 로 청취자 / 음원을 바꾸고 [ ] 로 시점을 돌립니다. 확대는 Ctrl + 휠이나 두 손가락으로 합니다.',
          'With the keyboard, arrow keys move the selected point and PageUp / PageDown change its height. Space switches between listener and source, and [ ] rotate the view. Zoom with Ctrl + wheel or a two-finger pinch.',
        )}</p>
        ${soundHelpMarkup()}
      </div>
    </div>
    <div class="pf-lab__panel">${panelMarkup(curveTitleId, soundReadoutMarkup())}</div>
    <p class="pf-visually-hidden" aria-live="polite" data-live></p>`;

  const canvas = container.querySelector('canvas');
  const renderer = new VoxelRenderer(canvas);
  const live = container.querySelector('[data-live]');
  const hint = container.querySelector('[data-hint]');
  const labels = {
    listener: container.querySelector('[data-label="listener"]'),
    source: container.querySelector('[data-label="source"]'),
    virtual: container.querySelector('[data-label="virtual"]'),
  };
  const renderPanel = bindPanel(container);
  const sound = bindSound(container, { live });
  const presetButtons = [...container.querySelectorAll('[data-preset]')];
  const toolButtons = [...container.querySelectorAll('[data-tool]')];
  const raysSwitch = container.querySelector('[data-rays]');
  const virtualSwitch = container.querySelector('[data-virtual]');

  const finder = new VoxelPathFinder();
  let presetIndex = 0;
  let scene = cloneVoxelScene(scenes[0]);
  let result = null;
  let active = 'source';
  let tool = 'place';
  let showRays = false;
  let showVirtual = true;
  let virtual = null; // 회절 가상 음원 (apparentSource)
  let hover = null;
  let gesture = null;
  const pointers = new Map();
  const orbit = { theta: Math.PI / 2 - 0.55, phi: 0.95, zoom: 1 };
  let size = { width: 0, height: 0, dpr: 1 };
  let camera = null;
  let baseDistance = 30;
  let colors = null;
  let visible = true;
  let frameId = 0;
  let lost = false;

  function readColors() {
    const style = getComputedStyle(container);
    const read = (name, fallback) => parseColor(style.getPropertyValue(name), fallback);
    const surface = read('--pf-lab-surface', [0.118, 0.051, 0.259, 1]);
    const ink = read('--pf-ink', [0.965, 0.945, 1, 1]);
    colors = {
      surface,
      ink,
      ground: mix(surface, ink, 0.05),
      wall: read('--pf-lab-wall', [0.796, 0.741, 0.941, 1]),
      accent: read('--pf-accent', [0.949, 0.647, 0.839, 1]),
      ray: read('--pf-lab-ray', [0.965, 0.945, 1, 0.55]),
    };
  }

  /* 카메라 */

  const sceneTarget = () => [scene.grid.cols / 2, scene.grid.levels * 0.3, scene.grid.rows / 2];

  function eyeAt(target, distance) {
    const { theta, phi } = orbit;
    return [
      target[0] + distance * Math.sin(phi) * Math.cos(theta),
      target[1] + distance * Math.cos(phi),
      target[2] + distance * Math.sin(phi) * Math.sin(theta),
    ];
  }

  // 그리드 상자의 꼭짓점 8개가 모두 화면 안에 들어오는 가장 가까운 거리. 배치를 바꾸거나 크기가 바뀔 때만 다시 잽니다.
  // (돌리는 동안 거리가 출렁이지 않게 끌기 중에는 그대로 둡니다)
  function fitDistance() {
    const { cols, levels, rows } = scene.grid;
    const aspect = size.width / size.height || 1.6;
    const target = sceneTarget();
    const projection = perspective(FOV, aspect, 0.1, 1000);
    const corners = [];
    for (let index = 0; index < 8; index++) {
      corners.push([index & 1 ? cols : 0, index & 2 ? levels : 0, index & 4 ? rows : 0]);
    }
    const fits = (distance) => {
      const m = multiply(projection, lookAt(eyeAt(target, distance), target, [0, 1, 0]));
      return corners.every(([x, y, z]) => {
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w <= 0) return false;
        const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
        const py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
        return Math.abs(px) <= 0.94 && Math.abs(py) <= 0.9;
      });
    };
    let low = 1;
    let high = 400;
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) high = middle;
      else low = middle;
    }
    baseDistance = high;
  }

  function updateCamera() {
    const aspect = size.width / size.height || 1.6;
    const target = sceneTarget();
    const distance = baseDistance * orbit.zoom;
    const eye = eyeAt(target, distance);
    const forward = normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const right = normalize3(cross3(forward, [0, 1, 0]));
    const up = cross3(right, forward);
    const projection = perspective(FOV, aspect, 0.1, distance * 4);
    camera = {
      eye,
      forward,
      right,
      up,
      aspect,
      viewProj: multiply(projection, lookAt(eye, target, [0, 1, 0])),
    };
    if (result) sound.update(soundFrame());
  }

  function rayFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const tan = Math.tan(FOV / 2);
    const { forward, right, up, aspect, eye } = camera;
    const direction = normalize3([0, 1, 2].map((axis) => forward[axis] + right[axis] * nx * tan * aspect + up[axis] * ny * tan));
    return { origin: eye, direction };
  }

  function project(point) {
    const m = camera.viewProj;
    const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
    const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    if (w <= 0) return null;
    return { x: ((x / w + 1) / 2) * size.width, y: ((1 - y / w) / 2) * size.height };
  }

  const center = (cell) => [cell.x + 0.5, cell.y + 0.5, cell.z + 0.5];

  /* 장면 버퍼 */

  function rebuildBlocks() {
    const { grid } = scene;
    const offsets = [];
    for (let y = 0; y < grid.levels; y++) {
      for (let z = 0; z < grid.rows; z++) {
        for (let x = 0; x < grid.cols; x++) {
          if (grid.cells[grid.index(x, y, z)] === WALL) offsets.push(x + 0.5, y + 0.5, z + 0.5);
        }
      }
    }
    renderer.setBlocks(new Float32Array(offsets));
  }

  function rebuildFrame() {
    const { cols, levels, rows } = scene.grid;
    const grid = [];
    for (let x = 0; x <= cols; x++) grid.push(x, 0.002, 0, x, 0.002, rows);
    for (let z = 0; z <= rows; z++) grid.push(0, 0.002, z, cols, 0.002, z);
    renderer.setLines(renderer.gridLines, new Float32Array(grid));
    renderer.setLines(renderer.volumeLines, cubeEdges(1, [0, 0, 0], [cols, levels, rows]));
  }

  function rebuildResult() {
    const { grid, listener, source } = scene;
    const from = center(listener);
    const to = center(source);

    const explored = [];
    if (result.search) {
      const { state } = finder;
      const total = grid.cols * grid.rows * grid.levels;
      for (let index = 0; index < total; index++) {
        if (state[index] !== IN_CLOSED_SET) continue;
        explored.push(...center(cellOf(grid, index)));
      }
    }
    renderer.setPoints('explored', new Float32Array(explored));

    const path = [];
    const joints = [];
    if (result.search?.status === 'found') {
      const cells = result.search.path.map((index) => center(cellOf(grid, index)));
      for (let step = 1; step < cells.length; step++) path.push([...cells[step - 1], ...cells[step]]);
      cells.forEach((point) => joints.push(...point));
    }
    renderer.setThick('path', path);
    renderer.setPoints('joints', new Float32Array(joints));

    // 직선 레이: 막혔으면 히트 지점까지 실선, 그 뒤는 점선
    if (result.los.blocked) {
      const t = result.los.t;
      const hit = [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * t);
      renderer.setThick('los', [[...from, ...hit]]);
      renderer.setThick('dashes', dashedSegments(hit, to));
      renderer.setPoints('hit', new Float32Array(hit));
      renderer.setThick('clear', []);
    } else {
      renderer.setThick('clear', [[...from, ...to]]);
      renderer.setThick('los', []);
      renderer.setThick('dashes', []);
      renderer.setPoints('hit', new Float32Array(0));
    }

    // 회절 가상 음원: 청취자 → 꺾인 점 → 가상 음원 점선, 꺾인 점 표시
    virtual = apparentSource(scene, result);
    if (virtual) {
      renderer.setThick('virtualLine', dashedSegments(from, virtual.position, 0.35));
      renderer.setPoints('corner', new Float32Array(virtual.corner));
    } else {
      renderer.setThick('virtualLine', []);
      renderer.setPoints('corner', new Float32Array(0));
    }

    const rays = [];
    const hits = [];
    for (const ray of result.enclosure.rays) {
      const end = [from[0] + ray.dx * ray.distance, from[1] + ray.dy * ray.distance, from[2] + ray.dz * ray.distance];
      rays.push([...from, ...end]);
      if (ray.blocked) hits.push(...end);
    }
    renderer.setThick('rays', rays);
    renderer.setPoints('rayHits', new Float32Array(hits));
  }

  // a 에서 b 까지 점선 선분
  function dashedSegments(a, b, dash = 0.45) {
    const dashes = [];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const count = Math.max(1, Math.floor(length / dash));
    for (let index = 0; index < count; index += 2) {
      const s = index / count;
      const e = Math.min(1, (index + 1) / count);
      dashes.push(
        [0, 1, 2].map((axis) => a[axis] + (b[axis] - a[axis]) * s).concat([0, 1, 2].map((axis) => a[axis] + (b[axis] - a[axis]) * e)),
      );
    }
    return dashes;
  }

  function rebuildHover() {
    if (!hover) {
      renderer.setThick('hover', []);
      return;
    }
    const lines = cubeEdges(1, [hover.x - 0.01, hover.y - 0.01, hover.z - 0.01], [1.02, 1.02, 1.02]);
    const segments = [];
    for (let index = 0; index < lines.length; index += 6) segments.push(lines.subarray(index, index + 6));
    renderer.setThick('hover', segments);
  }

  // 음원 파동: 음원 높이의 수평 원 두 개가 퍼져 나가며 옅어집니다.
  function setWaves(now, animate) {
    const [sx, sy, sz] = center(scene.source);
    const rings = animate ? [0, 0.5].map((offset) => (now / 1800 + offset) % 1) : [0.45];
    const segments = [];
    const strengths = [];
    for (const phase of rings) {
      const radius = HANDLE_RADIUS + phase * 2.2;
      const steps = 40;
      for (let index = 0; index < steps; index++) {
        const a = (index / steps) * Math.PI * 2;
        const b = ((index + 1) / steps) * Math.PI * 2;
        segments.push([sx + Math.cos(a) * radius, sy, sz + Math.sin(a) * radius, sx + Math.cos(b) * radius, sy, sz + Math.sin(b) * radius]);
      }
      strengths.push(animate ? (1 - phase) * 0.6 : 0.4);
    }
    renderer.setThick('waves', segments);
    return strengths;
  }

  /* 그리기 */

  const shouldAnimate = () => visible && !reduceMotion.matches && !document.hidden && !lost;

  const focusVisible = () => {
    try {
      return canvas.matches(':focus-visible');
    } catch {
      return document.activeElement === canvas;
    }
  };

  function requestDraw() {
    if (!frameId && !lost) frameId = window.requestAnimationFrame(frame);
  }

  function frame(now) {
    frameId = 0;
    draw(now);
    if (shouldAnimate()) frameId = window.requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { width: rect.width, height: rect.height, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    fitDistance();
    updateCamera();
    requestDraw();
  }

  function draw(now = performance.now()) {
    if (!result || !camera || !size.width || lost) return;
    const gl = renderer.gl;
    const { grid, listener, source } = scene;
    const animate = shouldAnimate();
    const waves = setWaves(now, animate);

    renderer.begin({
      width: canvas.width,
      height: canvas.height,
      dpr: size.dpr,
      clear: colors.surface,
      viewProj: camera.viewProj,
      focal: canvas.height / 2 / Math.tan(FOV / 2),
      light: normalize3([0.45, 1, 0.3]),
    });

    // 불투명: 바닥, 블록, 청취자 / 음원
    renderer.mode('opaque');
    renderer.mesh(renderer.ground, {
      color: colors.ground,
      ambient: 1,
      cull: false,
      model: new Float32Array([grid.cols, 0, 0, 0, 0, 1, 0, 0, 0, 0, grid.rows, 0, 0, 0, 0, 1]),
    });
    if (renderer.blockCount) renderer.mesh(renderer.cube, { color: colors.wall, instances: renderer.blockCount });
    const handles = [
      ['listener', listener, colors.ink],
      ['source', source, colors.accent],
    ];
    for (const [, cell, color] of handles) {
      const [x, y, z] = center(cell);
      renderer.mesh(renderer.sphere, { color, ambient: 0.6, model: placeAndScale(x, y, z, HANDLE_RADIUS) });
    }

    // 반투명: 격자, 블록 모서리, 경로와 레이
    renderer.mode('blend');
    renderer.lines(renderer.gridLines, { color: alpha(colors.ink, 0.08) });
    renderer.lines(renderer.volumeLines, { color: alpha(colors.ink, 0.16) });
    if (renderer.blockCount) {
      renderer.lines(renderer.cubeLines, {
        color: alpha(colors.surface, 0.45),
        model: placeAndScale(0, 0, 0, 1.004),
        instances: renderer.blockCount,
      });
    }
    renderer.dots('explored', { color: alpha(colors.accent, 0.42), size: 0.16, world: true });
    if (showRays) {
      renderer.thickLines('rays', { color: alpha(colors.ray, 0.45), width: 1 });
      renderer.dots('rayHits', { color: colors.ray, size: 4 });
    }
    renderer.thickLines('clear', { color: colors.accent, width: 2.5 });
    renderer.thickLines('los', { color: alpha(colors.ink, 0.75), width: 1.5 });
    renderer.thickLines('dashes', { color: alpha(colors.ink, 0.35), width: 1.5 });
    renderer.dots('hit', { color: colors.ink, size: 7 });
    renderer.thickLines('path', { color: colors.accent, width: 3 });
    renderer.dots('joints', { color: colors.accent, size: 3 });
    const drawVirtual = showVirtual && virtual;
    if (drawVirtual) {
      renderer.thickLines('virtualLine', { color: alpha(colors.accent, 0.7), width: 1.5 });
      renderer.dots('corner', { color: colors.ink, size: 6 });
      const [vx, vy, vz] = virtual.position;
      renderer.mesh(renderer.sphere, { color: alpha(colors.accent, 0.55), ambient: 0.7, model: placeAndScale(vx, vy, vz, HANDLE_RADIUS) });
    }

    // 비침: 블록에 가린 부분만 흐리게 한 번 더
    renderer.mode('ghost');
    for (const [, cell, color] of handles) {
      const [x, y, z] = center(cell);
      renderer.mesh(renderer.sphere, { color: alpha(color, 0.75), ambient: 1, model: placeAndScale(x, y, z, HANDLE_RADIUS) });
    }
    if (drawVirtual) {
      const [vx, vy, vz] = virtual.position;
      renderer.mesh(renderer.sphere, { color: alpha(colors.accent, 0.35), ambient: 1, model: placeAndScale(vx, vy, vz, HANDLE_RADIUS) });
      renderer.thickLines('virtualLine', { color: alpha(colors.accent, 0.4), width: 1.5 });
      renderer.dots('corner', { color: alpha(colors.ink, 0.45), size: 6 });
    }
    renderer.dots('explored', { color: alpha(colors.accent, 0.16), size: 0.16, world: true });
    renderer.thickLines('path', { color: alpha(colors.accent, 0.6), width: 3 });
    renderer.thickLines('clear', { color: alpha(colors.accent, 0.6), width: 2.5 });
    renderer.thickLines('los', { color: alpha(colors.ink, 0.25), width: 1.5 });
    renderer.thickLines('dashes', { color: alpha(colors.ink, 0.3), width: 1.5 });
    renderer.dots('hit', { color: alpha(colors.ink, 0.45), size: 7 });

    // 음원 파동
    renderer.mode('blend');
    if (waves.length === 1) {
      renderer.thickLines('waves', { color: alpha(colors.accent, waves[0]), width: 1.5 });
    } else {
      // 두 원을 한 버퍼에 담았으므로 절반씩 나눠 그립니다.
      const item = renderer.thick.waves;
      const half = item.count / 2;
      const uniforms = renderer.use('thick');
      gl.uniform1f(uniforms.uHalfWidth, (1.5 * size.dpr) / 2);
      gl.bindVertexArray(item.vao);
      waves.forEach((strength, index) => {
        gl.uniform4fv(uniforms.uColor, alpha(colors.accent, strength));
        gl.drawArrays(gl.TRIANGLES, index * half, half);
      });
    }

    // 놓을 자리 / 지울 블록 미리보기는 항상 위에
    renderer.mode('overlay');
    if (hover) renderer.thickLines('hover', { color: hover.kind === 'erase' ? colors.ink : colors.accent, width: 2 });
    gl.bindVertexArray(null);

    // 이름표
    const showActive = focusVisible();
    for (const [name, cell] of handles) {
      const point = project([cell.x + 0.5, cell.y + 0.5 + HANDLE_RADIUS + 0.12, cell.z + 0.5]);
      const label = labels[name];
      label.hidden = !point;
      if (point) label.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%)`;
      label.classList.toggle('is-active', showActive && active === name);
    }
    const virtualPoint = drawVirtual
      ? project([virtual.position[0], virtual.position[1] + HANDLE_RADIUS + 0.12, virtual.position[2]])
      : null;
    labels.virtual.hidden = !virtualPoint;
    if (virtualPoint) {
      labels.virtual.style.transform = `translate(${virtualPoint.x.toFixed(1)}px, ${virtualPoint.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /* 수치 */

  // 소리는 청취자 자리에서 화면을 보는 방향으로 듣습니다. (카메라 방향을 바닥에 눕힌 것)
  function soundFrame() {
    const via = apparentSource(scene, result);
    const forward = camera ? camera.forward : [0, 0, -1];
    return {
      listener: center(scene.listener),
      source: center(scene.source),
      straight: result.straight,
      apparent: via?.position ?? null,
      apparentDistance: via?.distance ?? result.straight,
      blocked: result.los.blocked,
      forward: [forward[0], 0, forward[2]],
      occlusion: result.occlusion,
      openness: result.enclosure.openness,
    };
  }

  function update() {
    result = evaluate(scene, finder);
    renderPanel(result);
    sound.update(soundFrame());
    rebuildResult();
    requestDraw();
  }

  function announce(prefix) {
    const r = result;
    const los = r.los.blocked ? t('직선 레이 막힘', 'Direct ray blocked') : t('직선 레이 통과', 'Direct ray clear');
    const occlusion = r.occlusion.toFixed(2);
    const openness = r.enclosure.openness.toFixed(2);
    const status = t(`${los}, 차폐 계수 ${occlusion}, 밀폐도 ${openness}`, `${los}, occlusion ${occlusion}, enclosure ${openness}`);
    live.textContent = `${prefix ? `${prefix}. ` : ''}${status}`;
  }

  function loadScene(index, message) {
    presetIndex = index;
    scene = cloneVoxelScene(scenes[index]);
    hover = null;
    presetButtons.forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
    if (size.width) fitDistance();
    updateCamera();
    rebuildFrame();
    rebuildBlocks();
    rebuildHover();
    update();
    if (message) announce(message);
  }

  /* 조작 */

  const isHandle = (cell) =>
    ['listener', 'source'].some((name) => scene[name].x === cell.x && scene[name].y === cell.y && scene[name].z === cell.z);

  function moveHandle(which, cell) {
    const other = which === 'source' ? scene.listener : scene.source;
    if (scene.grid.at(cell.x, cell.y, cell.z) !== OPEN) return false;
    if (other.x === cell.x && other.y === cell.y && other.z === cell.z) return false;
    scene[which] = { x: cell.x, y: cell.y, z: cell.z };
    return true;
  }

  // 누른 곳에 가장 가까운 청취자 / 음원.
  // 화면에서 손가락은 24px, 마우스는 14px 안이면 잡고, 확대해서 구가 더 크게 보이면 구 안을 눌러도 잡습니다.
  function handleAt(ray, event) {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const reach = event.pointerType === 'touch' ? 24 : 14;
    let found = null;
    let nearest = Infinity;
    for (const which of ['source', 'listener']) {
      const c = center(scene[which]);
      const point = project(c);
      if (!point) continue;
      const onScreen = Math.hypot(point.x - px, point.y - py);
      const oc = [c[0] - ray.origin[0], c[1] - ray.origin[1], c[2] - ray.origin[2]];
      const t = dot3(oc, ray.direction);
      const inSphere = t > 0 && dot3(oc, oc) - t * t <= 0.6 * 0.6;
      if ((onScreen <= reach || inSphere) && onScreen < nearest) {
        found = which;
        nearest = onScreen;
      }
    }
    return found;
  }

  // 끌기: 그 점의 높이에 있는 수평면과 레이가 만나는 칸으로 옮깁니다.
  function cellOnPlane(ray, level) {
    const planeY = level + 0.5;
    if (Math.abs(ray.direction[1]) < 1e-4) return null;
    const t = (planeY - ray.origin[1]) / ray.direction[1];
    if (t <= 0) return null;
    const { cols, rows } = scene.grid;
    const x = Math.floor(ray.origin[0] + ray.direction[0] * t);
    const z = Math.floor(ray.origin[2] + ray.direction[2] * t);
    return { x: Math.min(Math.max(x, 0), cols - 1), y: level, z: Math.min(Math.max(z, 0), rows - 1) };
  }

  function target(ray) {
    const found = pick(scene.grid, ray.origin, ray.direction);
    if (!found) return null;
    if (tool === 'erase') return found.hit ? { ...found.hit, kind: 'erase' } : null;
    const cell = found.place;
    if (!cell || scene.grid.at(cell.x, cell.y, cell.z) !== OPEN || isHandle(cell)) return null;
    return { ...cell, kind: 'place' };
  }

  function setHover(next) {
    const same = hover && next && hover.x === next.x && hover.y === next.y && hover.z === next.z && hover.kind === next.kind;
    if (same || (!hover && !next)) return;
    hover = next;
    rebuildHover();
    requestDraw();
  }

  function apply(cell) {
    if (!cell) return;
    scene.grid.set(cell.x, cell.y, cell.z, cell.kind === 'erase' ? OPEN : WALL);
    rebuildBlocks();
    update();
    announce(cell.kind === 'erase' ? t('블록 지움', 'Block removed') : t('블록 놓음', 'Block placed'));
  }

  function hideHint() {
    hint?.classList.add('is-hidden');
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: orbit.zoom };
      return;
    }
    if (pointers.size > 2) return;
    const ray = rayFromPointer(event);
    const which = handleAt(ray, event);
    if (which) {
      gesture = { kind: 'handle', which };
      active = which;
      setHover(null);
      canvas.classList.add('is-grabbing');
    } else {
      gesture = { kind: 'press', x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture) {
      if (event.pointerType === 'touch') return;
      const ray = rayFromPointer(event);
      const overHandle = handleAt(ray, event);
      canvas.style.cursor = overHandle ? 'grab' : '';
      setHover(overHandle ? null : target(ray));
      return;
    }
    if (gesture.kind === 'pinch') {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      orbit.zoom = Math.min(Math.max((gesture.zoom * gesture.distance) / distance, ZOOM_MIN), ZOOM_MAX);
      updateCamera();
      requestDraw();
      return;
    }
    if (gesture.kind === 'handle') {
      const cell = cellOnPlane(rayFromPointer(event), scene[gesture.which].y);
      if (cell && moveHandle(gesture.which, cell)) update();
      return;
    }
    if (gesture.kind === 'press' && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > DRAG_THRESHOLD) {
      gesture.kind = 'orbit';
      setHover(null);
      canvas.classList.add('is-grabbing');
      hideHint();
    }
    if (gesture.kind === 'orbit') {
      orbit.theta += (event.clientX - gesture.lastX) * 0.008;
      orbit.phi = Math.min(Math.max(orbit.phi - (event.clientY - gesture.lastY) * 0.006, PHI_MIN), PHI_MAX);
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      updateCamera();
      requestDraw();
    }
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (!gesture) return;
    const ended = gesture;
    if (ended.kind === 'pinch') {
      if (!pointers.size) gesture = null;
      return;
    }
    gesture = null;
    canvas.classList.remove('is-grabbing');
    if (event.type === 'pointercancel') return;
    if (ended.kind === 'press') {
      const ray = rayFromPointer(event);
      apply(target(ray));
      // 마우스는 그 자리에 그대로 있으니, 바뀐 장면 기준으로 미리보기를 다시 잡습니다.
      if (event.pointerType !== 'touch') setHover(target(ray));
    } else if (ended.kind === 'handle') {
      announce(t(`${NAMES[ended.which]} 이동`, `${NAMES[ended.which]} moved`));
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (event) => {
    if (!gesture && event.pointerType !== 'touch') setHover(null);
  });

  // Ctrl + 휠(노트북 터치패드의 두 손가락 확대 포함)만 확대로 씁니다. 그냥 휠은 페이지 스크롤입니다.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      orbit.zoom = Math.min(Math.max(orbit.zoom * Math.exp(event.deltaY * 0.002), ZOOM_MIN), ZOOM_MAX);
      updateCamera();
      requestDraw();
    },
    { passive: false },
  );

  // 방향키는 지금 보는 방향 기준으로 옮깁니다. (화면 위쪽 = 카메라가 바라보는 쪽)
  function screenStep(key) {
    const flat = (v) => normalize3([v[0], 0, v[2]]);
    const forward = flat(camera.forward);
    const right = flat(camera.right);
    const vector = { ArrowUp: forward, ArrowDown: forward.map((v) => -v), ArrowRight: right, ArrowLeft: right.map((v) => -v) }[key];
    return Math.abs(vector[0]) >= Math.abs(vector[2]) ? [Math.sign(vector[0]), 0] : [0, Math.sign(vector[2])];
  }

  canvas.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const point = scene[active];
    let next = null;
    if (event.key.startsWith('Arrow')) {
      const [dx, dz] = screenStep(event.key);
      next = { x: point.x + dx, y: point.y, z: point.z + dz };
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      next = { x: point.x, y: point.y + (event.key === 'PageUp' ? 1 : -1), z: point.z };
    }
    if (next) {
      event.preventDefault();
      if (moveHandle(active, next)) {
        update();
        announce(
          t(
            `${NAMES[active]} 가로 ${next.x + 1}, 세로 ${next.z + 1}, 높이 ${next.y}`,
            `${NAMES[active]} at X ${next.x + 1}, Z ${next.z + 1}, height ${next.y}`,
          ),
        );
      } else {
        announce(t(`${NAMES[active]}, 그쪽으로는 옮길 수 없습니다`, `${NAMES[active]} can't move there`));
      }
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      active = active === 'source' ? 'listener' : 'source';
      requestDraw();
      live.textContent = t(`${NAMES[active]} 선택`, `${NAMES[active]} selected`);
    } else if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      orbit.theta += event.key === '[' ? -Math.PI / 12 : Math.PI / 12;
      updateCamera();
      requestDraw();
      hideHint();
    }
  });
  canvas.addEventListener('focus', requestDraw);
  canvas.addEventListener('blur', requestDraw);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    renderer.init();
    rebuildFrame();
    rebuildBlocks();
    rebuildHover();
    rebuildResult();
    requestDraw();
  });

  presetButtons.forEach((button, index) => {
    button.addEventListener('click', () => loadScene(index, t(`${scenes[index].name} 배치`, `${scenes[index].name} layout`)));
  });
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      tool = button.dataset.tool;
      toolButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      setHover(null);
    });
  });
  container.querySelector('[data-reset]').addEventListener('click', () => {
    loadScene(presetIndex, t('배치를 처음으로 되돌렸습니다', 'Layout reset'));
  });
  raysSwitch.addEventListener('click', () => {
    showRays = !showRays;
    raysSwitch.setAttribute('aria-checked', String(showRays));
    requestDraw();
  });
  virtualSwitch.addEventListener('click', () => {
    showVirtual = !showVirtual;
    virtualSwitch.setAttribute('aria-checked', String(showVirtual));
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

  readColors();
  resize();
  loadScene(0);
  syncSound();
}
