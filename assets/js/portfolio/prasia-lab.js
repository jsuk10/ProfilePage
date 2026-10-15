// 프라시아 전기 툴 데모 (content/prasia-lab.yml)
//   미니맵: 웨이포인트를 순회하며 노드마다 DrawCall / Primitive 를 재고 색으로 표시합니다. (Canvas 2D)
//   크래시: Backtrace 에 들어온 크래시가 담당자 멘션까지 가는 흐름을 단계별로 보여 줍니다. (DOM)
// 지도, 수치, 이름은 데모용입니다.

import { escapeHtml } from './markdown.js';

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

const num = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
const format = (value) => Math.round(value).toLocaleString('ko-KR');

/* 미니맵 ----------------------------------------------------------------- */

const ZONE_ALPHA = { water: [0.42, 0.58, 0.86, 0.22], forest: [0.4, 0.74, 0.5, 0.18], town: [0.95, 0.85, 0.6, 0.14] };
const SPEED = 0.22; // 지도 폭 기준, 초당 이동 비율
const POP_MS = 320;

export function mountMinimap(container, config) {
  const points = (Array.isArray(config?.waypoints) ? config.waypoints : [])
    .map((point, index) => ({
      name: String(point?.name ?? `노드 ${index + 1}`),
      x: clamp01(num(point?.x, 0.5)),
      y: clamp01(num(point?.y, 0.5)),
      draw: num(point?.draw),
      prims: num(point?.prims),
      measured: 0,
    }))
    .filter((point) => point.draw > 0);
  if (points.length < 2) return;
  const zones = (Array.isArray(config?.zones) ? config.zones : [])
    .map((zone) => ({ kind: String(zone?.kind ?? 'town'), x: num(zone?.x), y: num(zone?.y), w: num(zone?.w), h: num(zone?.h) }))
    .filter((zone) => zone.w > 0 && zone.h > 0);
  const maxDraw = Math.max(...points.map((point) => point.draw));
  let threshold = num(config?.threshold, 1500);

  container.innerHTML = `
    <div class="pf-minimap__view">
      <canvas class="pf-minimap__canvas" role="img" aria-label="웨이포인트 미니맵. 순회하면 노드마다 DrawCall 을 재서 색으로 표시합니다."></canvas>
      <div class="pf-minimap__tip" data-tip hidden></div>
    </div>
    <div class="pf-minimap__bar">
      <button type="button" class="pf-button pf-lab__reset" data-run>순회 시작</button>
      <label class="pf-lab__volume pf-minimap__threshold">DrawCall 기준
        <input type="range" min="800" max="${Math.ceil(maxDraw / 100) * 100}" step="50" value="${threshold}" data-threshold>
        <output data-threshold-out>${format(threshold)}</output>
      </label>
      <ul class="pf-lab__legend" aria-label="색 뜻">
        <li><span class="pf-lab__key pf-lab__key--ok" aria-hidden="true"></span>기준의 70% 미만</li>
        <li><span class="pf-lab__key pf-lab__key--warn" aria-hidden="true"></span>70% 이상</li>
        <li><span class="pf-lab__key pf-lab__key--over" aria-hidden="true"></span>기준 초과</li>
      </ul>
    </div>
    <div class="pf-minimap__rank" data-rank aria-live="polite"></div>`;

  const canvas = container.querySelector('canvas');
  const context = canvas.getContext('2d');
  const tip = container.querySelector('[data-tip]');
  const runButton = container.querySelector('[data-run]');
  const slider = container.querySelector('[data-threshold]');
  const sliderOut = container.querySelector('[data-threshold-out]');
  const rank = container.querySelector('[data-rank]');

  let size = { width: 0, height: 0, dpr: 1 };
  let colors = null;
  let frameId = 0;
  let marker = null; // { segment, t, lastTime }
  let done = false;
  let hover = null;

  function readColors() {
    const style = getComputedStyle(container);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    colors = {
      surface: read('--pf-lab-surface', '#1e0d42'),
      grid: read('--pf-lab-grid', 'rgba(246, 241, 255, 0.06)'),
      ink: read('--pf-ink', '#f6f1ff'),
      muted: read('--pf-text-muted', 'rgba(246, 241, 255, 0.68)'),
      accent: read('--pf-accent', '#f2a5d6'),
      ok: read('--pf-after', '#38aa76'),
      warn: read('--pf-lab-warn', '#e9b84a'),
      over: read('--pf-before', '#b83a58'),
      font: style.fontFamily || 'sans-serif',
    };
  }

  const level = (draw) => (draw >= threshold ? 'over' : draw >= threshold * 0.7 ? 'warn' : 'ok');
  const px = (point) => [point.x * size.width, point.y * size.height];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { width: rect.width, height: rect.height, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    draw();
  }

  function draw(now = performance.now()) {
    const { width, height, dpr } = size;
    if (!width) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = colors.surface;
    context.fillRect(0, 0, width, height);

    for (const zone of zones) {
      const [r, g, b, a] = ZONE_ALPHA[zone.kind] ?? ZONE_ALPHA.town;
      context.fillStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
      context.beginPath();
      context.roundRect(zone.x * width, zone.y * height, zone.w * width, zone.h * height, 10);
      context.fill();
    }

    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.beginPath();
    const cell = width / 12;
    for (let x = cell; x < width; x += cell) {
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, height);
    }
    for (let y = cell; y < height; y += cell) {
      context.moveTo(0, Math.round(y) + 0.5);
      context.lineTo(width, Math.round(y) + 0.5);
    }
    context.stroke();

    context.strokeStyle = colors.muted;
    context.globalAlpha = 0.45;
    context.setLineDash([4, 5]);
    context.lineWidth = 1.5;
    context.beginPath();
    points.forEach((point, index) => {
      const [x, y] = px(point);
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;

    const radius = Math.max(5, Math.min(9, width / 60));
    points.forEach((point) => {
      const [x, y] = px(point);
      const measured = point.measured > 0;
      const pop = measured ? Math.min(1, (now - point.measured) / POP_MS) : 0;
      const scale = measured ? 1 + (1 - pop) * 0.9 : 1;
      context.beginPath();
      context.arc(x, y, radius * scale, 0, Math.PI * 2);
      context.fillStyle = measured ? colors[level(point.draw)] : 'rgba(246, 241, 255, 0.18)';
      context.fill();
      context.lineWidth = point === hover ? 3 : 1.5;
      context.strokeStyle = point === hover ? colors.ink : colors.surface;
      context.stroke();
      if (measured && level(point.draw) === 'over') {
        context.beginPath();
        context.arc(x, y, radius * scale + 4, 0, Math.PI * 2);
        context.strokeStyle = colors.over;
        context.globalAlpha = 0.5;
        context.lineWidth = 1.5;
        context.stroke();
        context.globalAlpha = 1;
      }
    });

    if (marker) {
      const from = points[marker.segment];
      const to = points[marker.segment + 1];
      const [ax, ay] = px(from);
      const [bx, by] = px(to);
      const x = ax + (bx - ax) * marker.t;
      const y = ay + (by - ay) * marker.t;
      context.beginPath();
      context.arc(x, y, radius * 0.7, 0, Math.PI * 2);
      context.fillStyle = colors.accent;
      context.fill();
      context.beginPath();
      context.arc(x, y, radius * 1.6, 0, Math.PI * 2);
      context.strokeStyle = colors.accent;
      context.globalAlpha = 0.5;
      context.stroke();
      context.globalAlpha = 1;
    }

    const labelSize = Math.round(Math.min(12, Math.max(9, width / 48)));
    context.font = `600 ${labelSize}px ${colors.font}`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    points.forEach((point) => {
      if (!point.measured && point !== hover) return;
      const [x, y] = px(point);
      const text = point.measured ? format(point.draw) : point.name;
      context.lineWidth = 3;
      context.strokeStyle = colors.surface;
      context.strokeText(text, x, y + radius + 3);
      context.fillStyle = point.measured && level(point.draw) === 'over' ? colors.ink : colors.muted;
      context.fillText(text, x, y + radius + 3);
    });
  }

  function step(now) {
    frameId = 0;
    if (!marker) return;
    const elapsed = (now - marker.lastTime) / 1000;
    marker.lastTime = now;
    const from = points[marker.segment];
    const to = points[marker.segment + 1];
    const length = Math.hypot(to.x - from.x, (to.y - from.y) * (size.height / size.width)) || 0.01;
    marker.t += (elapsed * SPEED) / length;
    while (marker && marker.t >= 1) {
      to.measured = now;
      marker.segment += 1;
      marker.t -= 1;
      if (marker.segment >= points.length - 1) {
        marker = null;
        finish();
      }
    }
    draw(now);
    const popping = points.some((point) => point.measured && now - point.measured < POP_MS);
    if (marker || popping) frameId = window.requestAnimationFrame(step);
  }

  function renderRank() {
    const measured = points.filter((point) => point.measured);
    if (!measured.length) {
      rank.innerHTML = '';
      return;
    }
    const over = measured.filter((point) => level(point.draw) === 'over').length;
    const top = [...measured].sort((a, b) => b.draw - a.draw).slice(0, 3);
    rank.innerHTML = `
      <p class="pf-minimap__rank-title">최적화 우선순위 <span class="pf-readout__hint">${measured.length}개 측정, 기준 초과 ${over}개</span></p>
      <ol>${top
        .map(
          (point) =>
            `<li class="is-${level(point.draw)}"><span>${escapeHtml(point.name)}</span><span class="pf-minimap__value">DrawCall ${format(point.draw)} · Prim ${point.prims.toFixed(1)}M</span></li>`,
        )
        .join('')}</ol>`;
  }

  function finish() {
    done = true;
    runButton.textContent = '다시 순회';
    renderRank();
  }

  function start() {
    points.forEach((point) => {
      point.measured = 0;
    });
    done = false;
    rank.innerHTML = '';
    if (reduceMotion.matches) {
      const now = performance.now() - POP_MS;
      points.forEach((point) => {
        point.measured = now;
      });
      finish();
      draw();
      return;
    }
    points[0].measured = performance.now();
    marker = { segment: 0, t: 0, lastTime: performance.now() };
    runButton.textContent = '순회 중…';
    if (!frameId) frameId = window.requestAnimationFrame(step);
  }

  runButton.addEventListener('click', start);
  slider.addEventListener('input', () => {
    threshold = num(slider.value, threshold);
    sliderOut.textContent = format(threshold);
    if (done) renderRank();
    draw();
  });

  function nearest(event) {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let found = null;
    let best = 16;
    for (const point of points) {
      const [x, y] = px(point);
      const distance = Math.hypot(mx - x, my - y);
      if (distance < best) {
        best = distance;
        found = point;
      }
    }
    return found;
  }

  canvas.addEventListener('pointermove', (event) => {
    const point = nearest(event);
    if (point !== hover) {
      hover = point;
      draw();
    }
    if (!point) {
      tip.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const [x, y] = px(point);
    tip.hidden = false;
    tip.textContent = point.measured
      ? `${point.name} · DrawCall ${format(point.draw)} · Primitive ${point.prims.toFixed(1)}M`
      : `${point.name} · 아직 측정 전`;
    tip.style.left = `${Math.min(Math.max(x, 70), rect.width - 70)}px`;
    tip.style.top = `${y}px`;
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    tip.hidden = true;
    draw();
  });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  readColors();
  resize();
}

/* 크래시 흐름 ------------------------------------------------------------- */

const PLATFORMS = {
  Windows: { type: '크래시', detail: 'Access Violation', arch: 'Win64' },
  iOS: { type: 'OOM', detail: '메모리 종료', arch: 'arm64' },
  Android: { type: 'ANR', detail: '응답 없음 8.2초', arch: 'arm64-v8a' },
};
const FRAMES = ['UAnimInstance::NativeUpdateAnimation', 'FStreamingManager::UpdateResourceStreaming', 'UGameplayStatics::SpawnEmitterAtLocation'];
const STEP_MS = 850;

export function mountCrashFlow(container, config) {
  const steps = (Array.isArray(config?.steps) ? config.steps : []).filter((step) => step && String(step.title ?? '').trim());
  if (!steps.length) return;

  container.innerHTML = `
    <div class="pf-crash__controls">
      <div class="pf-segmented" role="group" aria-label="플랫폼">
        ${Object.keys(PLATFORMS)
          .map((name, index) => `<button type="button" class="pf-button pf-segmented__item" data-platform="${name}" aria-pressed="${index === 0}">${name}</button>`)
          .join('')}
      </div>
      <button type="button" class="pf-button pf-switch" role="switch" aria-checked="false" data-live>
        <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>라이브 빌드
      </button>
      <button type="button" class="pf-button pf-lab__reset pf-crash__fire" data-fire>크래시 발생</button>
    </div>
    <div class="pf-crash__flow">
      <div class="pf-crash__event" data-event hidden></div>
      <ol class="pf-crash__steps">
        ${steps
          .map(
            (step) => `
          <li data-step>
            <span class="pf-crash__dot" aria-hidden="true"></span>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p data-text></p>
              <p class="pf-crash__detail" data-detail></p>
            </div>
          </li>`,
          )
          .join('')}
      </ol>
      <div class="pf-crash__card" data-card hidden></div>
    </div>
    <p class="pf-visually-hidden" aria-live="polite" data-live-text></p>`;

  const platformButtons = [...container.querySelectorAll('[data-platform]')];
  const liveSwitch = container.querySelector('[data-live]');
  const fire = container.querySelector('[data-fire]');
  const event = container.querySelector('[data-event]');
  const items = [...container.querySelectorAll('[data-step]')];
  const card = container.querySelector('[data-card]');
  const liveText = container.querySelector('[data-live-text]');

  let platform = 'Windows';
  let live = false;
  let run = 0;
  let build = 12480;
  const timers = [];

  function stepText(step) {
    if (step.dev || step.live) return String(live ? step.live ?? step.dev : step.dev ?? step.live);
    return String(step.text ?? '');
  }

  function render() {
    items.forEach((item, index) => {
      item.querySelector('[data-text]').textContent = stepText(steps[index]);
    });
  }

  function reset() {
    timers.splice(0).forEach((id) => window.clearTimeout(id));
    items.forEach((item) => {
      item.classList.remove('is-active', 'is-done');
      item.querySelector('[data-detail]').textContent = '';
    });
    event.hidden = true;
    card.hidden = true;
    fire.textContent = '크래시 발생';
  }

  function details(info, frame) {
    const buildText = `#${build} (${platform} ${info.arch}, ${live ? '라이브' : '개발'})`;
    return [
      `심볼 매칭 완료 · 빌드 ${buildText}`,
      `${info.type} · ${info.detail} · ${frame}`,
      live ? `소스 컨트롤 수정 내역 조사 → 최근 수정자 찾음 (CL ${build * 10 + 7})` : `IP 추적 → 크래시 발생자: 개발 기기 ${(run % 7) + 2}번`,
      `Teams 카드 발송 · ${live ? '최근 수정자' : '크래시 발생자'} 멘션`,
    ];
  }

  function trigger() {
    reset();
    run += 1;
    build += 1;
    const info = PLATFORMS[platform];
    const frame = FRAMES[run % FRAMES.length];
    const lines = details(info, frame);
    event.hidden = false;
    event.innerHTML = `
      <span class="pf-crash__badge">${escapeHtml(info.type)}</span>
      <span><strong>${escapeHtml(platform)}</strong> · 빌드 #${build} · ${live ? '라이브' : '개발'} 빌드</span>
      <code>${escapeHtml(frame)}</code>`;
    fire.textContent = '처리 중…';
    const instant = reduceMotion.matches;
    const at = (index, fn) => {
      if (instant) fn();
      else timers.push(window.setTimeout(fn, index));
    };
    items.forEach((item, index) => {
      at(STEP_MS * index + 200, () => {
        item.classList.add('is-active');
      });
      at(STEP_MS * (index + 1), () => {
        item.classList.remove('is-active');
        item.classList.add('is-done');
        item.querySelector('[data-detail]').textContent = lines[index] ?? '';
      });
    });
    at(STEP_MS * (items.length + 1), () => {
      card.hidden = false;
      card.innerHTML = `
        <p class="pf-crash__card-head"><span class="pf-crash__app" aria-hidden="true">B</span>Backtrace 알림 <span class="pf-readout__hint">Teams</span></p>
        <p><strong>@${live ? '최근 수정자' : '크래시 발생자'}</strong> ${escapeHtml(info.type)} 1건 · ${escapeHtml(platform)} · 빌드 #${build}</p>
        <p><code>${escapeHtml(frame)}</code></p>
        <p class="pf-crash__card-foot">${live ? `CL ${build * 10 + 7} 수정 내역 기준` : `개발 기기 ${(run % 7) + 2}번에서 발생`} · Backtrace 에서 열기 →</p>`;
      fire.textContent = '다시 보기';
      liveText.textContent = `${info.type} 알림이 ${live ? '최근 수정자' : '크래시 발생자'}에게 갔습니다.`;
    });
  }

  platformButtons.forEach((button) => {
    button.addEventListener('click', () => {
      platform = button.dataset.platform;
      platformButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      reset();
    });
  });
  liveSwitch.addEventListener('click', () => {
    live = !live;
    liveSwitch.setAttribute('aria-checked', String(live));
    render();
    reset();
  });
  fire.addEventListener('click', trigger);

  render();
}
