// 툴 데모 (type: lab 섹션, content/prasia-lab.yml / like-or-die-lab.yml). demos 의 kind 마다 아래 mount 함수 하나입니다.
//   nevercook  콘텐츠 브라우저 폴더 / 섬네일을 누르면 NeverCook 아이콘이 붙고 떨어집니다. (DOM)
//   tray       트레이 아이콘 메뉴와 풍선 메시지, 풍선을 누르면 게임 창이 앞으로 옵니다. (DOM)
//   notify     게임이 뒤에 있을 때 Slate 알림을 띄우고, 누르면 게임 창이 앞으로 옵니다. (DOM)
//   minimap    웨이포인트를 순회하며 노드마다 DrawCall / Primitive 를 재고 색으로 표시합니다. (Canvas 2D)
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

/* NeverCook 콘텐츠 브라우저 ------------------------------------------------- */

const NEVERCOOK_ICON = `<svg class="pf-cb__badge" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <rect x="1" y="1" width="22" height="22" rx="5" fill="rgba(16, 16, 22, 0.9)" stroke="rgba(255, 255, 255, 0.2)"/>
  <g stroke="#f4f4f4" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.8l7 3.6v8.6l-7 3.6-7-3.6V7.4z"/><path d="M5 7.4l7 3.6 7-3.6M12 11V19.6"/>
  </g>
  <path d="M4.5 4.5l15 15" stroke="rgba(10, 10, 14, 0.9)" stroke-width="5" stroke-linecap="round"/>
  <path d="M4.5 4.5l15 15" stroke="#ff4747" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

const FOLDER_ICON = `<svg class="pf-cb__folder" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M6 16a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="#8a7a55"/>
  <path d="M6 26h52v24a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="#c9b37c"/>
</svg>`;

export function mountNeverCook(container, config) {
  const text = (value) => String(value ?? '').trim();
  const folders = (Array.isArray(config?.folders) ? config.folders : [])
    .map((folder) => (typeof folder === 'string' ? { name: folder } : folder))
    .filter((folder) => folder && text(folder.name))
    .map((folder) => ({ name: text(folder.name), kind: 'folder', on: Boolean(folder.nevercook) }));
  const marked = new Set((Array.isArray(config?.marked) ? config.marked : []).map(text));
  const assets = (Array.isArray(config?.assets) ? config.assets : [])
    .map(text)
    .filter(Boolean)
    .map((name, index) => ({ name, kind: 'asset', on: marked.has(name), index }));
  const items = [...folders, ...assets];
  if (!items.length) return;
  const columns = Math.max(1, Math.round(num(config?.columns, assets.length || 1)));
  const rows = Math.max(1, Math.ceil(assets.length / columns));
  const sprite = text(config?.sprite);
  const path = text(config?.path) || 'Content';

  const thumb = (item) => {
    if (item.kind === 'folder') return `<span class="pf-cb__thumb pf-cb__thumb--folder">${FOLDER_ICON}${NEVERCOOK_ICON}</span>`;
    const col = item.index % columns;
    const row = Math.floor(item.index / columns);
    const position = `${columns > 1 ? (col / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
    const style = sprite ? ` style="background-image: url('${escapeHtml(sprite)}'); background-size: ${columns * 100}% ${rows * 100}%; background-position: ${position};"` : '';
    return `<span class="pf-cb__thumb"${style}>${NEVERCOOK_ICON}</span>`;
  };
  const tile = (item) => `
        <li${item.on ? '' : ' class="is-off"'}>
          <button type="button" class="pf-button pf-cb__tile${item.on ? ' is-nevercook' : ''}" data-asset="${escapeHtml(item.name)}" data-kind="${item.kind}" aria-pressed="${item.on}">
            ${thumb(item)}
            <span class="pf-cb__name">${escapeHtml(item.name)}</span>
            <span class="pf-cb__type">${item.kind === 'folder' ? 'Folder' : 'Material'}</span>
          </button>
        </li>`;

  container.innerHTML = `
    <div class="pf-cb">
      <div class="pf-cb__bar">
        <span class="pf-cb__path">${escapeHtml(path)}</span>
        <button type="button" class="pf-button pf-switch pf-cb__filter" role="switch" aria-checked="false" data-filter>
          <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>NeverCook 만 보기
        </button>
        <span class="pf-cb__count" data-count></span>
      </div>
      <ul class="pf-cb__grid" style="--pf-cb-columns: ${Math.min(items.length, 8)}">${items.map(tile).join('')}
      </ul>
      <p class="pf-cb__hint">폴더나 섬네일을 누르면 NeverCook 에 넣거나 뺍니다. 아이콘이 붙은 폴더와 에셋은 쿠킹(패키징)에서 빠집니다.</p>
      <p class="pf-cb__list" data-list aria-live="polite"></p>
    </div>`;

  const tiles = [...container.querySelectorAll('[data-asset]')];
  const filter = container.querySelector('[data-filter]');
  const count = container.querySelector('[data-count]');
  const list = container.querySelector('[data-list]');
  let filtered = false;

  function render() {
    const names = tiles
      .filter((button) => button.classList.contains('is-nevercook'))
      .map((button) => (button.dataset.kind === 'folder' ? `${button.dataset.asset}/` : button.dataset.asset));
    count.textContent = `NeverCook ${names.length} / ${tiles.length}`;
    list.textContent = names.length ? `NeverCook 목록 (${names.length}): ${names.join(', ')}` : 'NeverCook 목록이 비어 있습니다.';
    tiles.forEach((button) => {
      button.parentElement.classList.toggle('is-off', !button.classList.contains('is-nevercook'));
    });
    container.querySelector('.pf-cb__grid').classList.toggle('is-filtered', filtered);
  }

  tiles.forEach((button) => {
    button.addEventListener('click', () => {
      const on = !button.classList.contains('is-nevercook');
      button.classList.toggle('is-nevercook', on);
      button.setAttribute('aria-pressed', String(on));
      render();
    });
  });
  filter.addEventListener('click', () => {
    filtered = !filtered;
    filter.setAttribute('aria-checked', String(filtered));
    render();
  });
  render();
}

/* 윈도우 트레이 알림 + 풍선 메시지 ------------------------------------------- */

const BALLOON_MS = 7000;
const SYS_ICONS = `
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 6h3l3-3v10l-3-3H2z" fill="currentColor"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 6.5a9 9 0 0 1 12 0M4.5 9a5.5 5.5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="12" r="1.3" fill="currentColor"/></svg>`;

export function mountTray(container, config) {
  const app = String(config?.app ?? '게임').trim();
  const balloon = String(config?.balloon ?? '').trim();
  const windowImage = String(config?.window ?? '').trim();
  const eventName = String(config?.event ?? '알림').trim();
  if (!balloon) return;

  container.innerHTML = `
    <div class="pf-tray__controls">
      <button type="button" class="pf-button pf-lab__reset" data-notify>${escapeHtml(eventName)} 알림 보내기</button>
      <button type="button" class="pf-button pf-lab__reset" data-relaunch hidden>게임 다시 실행</button>
      <span class="pf-tray__status" data-status aria-live="polite"></span>
    </div>
    <div class="pf-win" data-desktop>
      <div class="pf-win__window" data-window hidden>
        <div class="pf-win__title"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}<span class="pf-win__title-buttons" aria-hidden="true">− □ ×</span></div>
        ${windowImage ? `<img src="${escapeHtml(windowImage)}" alt="${escapeHtml(app)} 게임 화면" loading="lazy" decoding="async">` : ''}
      </div>
      <button type="button" class="pf-button pf-win__balloon" data-balloon hidden>
        <img src="${escapeHtml(balloon)}" alt="${escapeHtml(app)} 풍선 메시지: 파티에 초대되었습니다. 누르면 게임 창이 앞으로 옵니다." decoding="async">
      </button>
      <ul class="pf-win__menu" data-menu role="menu" hidden>
        <li><button type="button" class="pf-button" role="menuitem" data-menu-item="show">Show Game</button></li>
        <li><button type="button" class="pf-button" role="menuitem" data-menu-item="hide">Hide Game</button></li>
        <li><button type="button" class="pf-button" role="menuitem" data-menu-item="exit">Exit</button></li>
      </ul>
      <div class="pf-win__taskbar">
        <span class="pf-win__start" aria-hidden="true"></span>
        <button type="button" class="pf-button pf-win__task" data-task hidden><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}</button>
        <span class="pf-win__tray">
          <span class="pf-win__sys" aria-hidden="true">${SYS_ICONS}</span>
          <button type="button" class="pf-button pf-win__tray-icon" data-tray aria-label="${escapeHtml(app)} 트레이 아이콘 메뉴" aria-haspopup="menu" aria-expanded="false"><span class="pf-win__app-icon" aria-hidden="true"></span></button>
          <span class="pf-win__clock" aria-hidden="true">오후 9:41</span>
        </span>
      </div>
    </div>`;

  const pick = (selector) => container.querySelector(selector);
  const desktop = pick('[data-desktop]');
  const win = pick('[data-window]');
  const balloonButton = pick('[data-balloon]');
  const menu = pick('[data-menu]');
  const task = pick('[data-task]');
  const tray = pick('[data-tray]');
  const notify = pick('[data-notify]');
  const relaunch = pick('[data-relaunch]');
  const status = pick('[data-status]');
  let running = true;
  let shown = false;
  let front = false;
  let balloonTimer = 0;

  const say = (text) => {
    status.textContent = text;
  };
  function setFront(value) {
    front = value && shown;
    win.classList.toggle('is-front', front);
    task.classList.toggle('is-active', front);
  }
  function showWindow() {
    win.hidden = false;
    task.hidden = false;
    shown = true;
    setFront(true);
    win.classList.remove('is-restoring');
    void win.offsetWidth;
    win.classList.add('is-restoring');
  }
  function hideWindow() {
    win.hidden = true;
    task.hidden = true;
    shown = false;
    setFront(false);
  }
  function hideBalloon() {
    window.clearTimeout(balloonTimer);
    balloonButton.classList.remove('is-shown');
    balloonButton.hidden = true;
  }
  function showBalloon() {
    if (!running) return;
    balloonButton.hidden = false;
    void balloonButton.offsetWidth;
    balloonButton.classList.add('is-shown');
    window.clearTimeout(balloonTimer);
    balloonTimer = window.setTimeout(hideBalloon, BALLOON_MS);
    say(`${eventName} 풍선 메시지가 떴습니다. 눌러 보세요.`);
  }
  function closeMenu() {
    menu.hidden = true;
    tray.setAttribute('aria-expanded', 'false');
  }

  notify.addEventListener('click', showBalloon);
  balloonButton.addEventListener('click', (event) => {
    event.stopPropagation();
    hideBalloon();
    showWindow();
    say('풍선 메시지를 눌러 숨겨 둔 게임 창을 복원하고 포그라운드로 가져왔습니다.');
  });
  tray.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    tray.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-menu-item]');
    if (!item) return;
    event.stopPropagation();
    closeMenu();
    if (item.dataset.menuItem === 'show') {
      showWindow();
      say('Show Game: 게임 창을 보이고 앞으로 가져왔습니다.');
    } else if (item.dataset.menuItem === 'hide') {
      hideWindow();
      say('Hide Game: 게임 창을 숨겼습니다. 트레이 아이콘만 남습니다.');
    } else {
      hideWindow();
      hideBalloon();
      running = false;
      tray.hidden = true;
      notify.disabled = true;
      relaunch.hidden = false;
      say('Exit: 게임을 끝냈습니다.');
    }
  });
  task.addEventListener('click', (event) => {
    event.stopPropagation();
    setFront(true);
  });
  win.addEventListener('click', (event) => {
    event.stopPropagation();
    setFront(true);
  });
  desktop.addEventListener('click', () => {
    closeMenu();
    if (front) {
      setFront(false);
      say('바탕화면을 눌렀습니다. 게임 창이 뒤로 갔습니다.');
    }
  });
  relaunch.addEventListener('click', () => {
    running = true;
    tray.hidden = false;
    notify.disabled = false;
    relaunch.hidden = true;
    hideWindow();
    say('게임을 다시 실행했습니다. 창은 트레이로 숨겨 둔 상태입니다.');
  });
  say('게임은 켜져 있지만 창은 트레이로 숨겨 둔 상태입니다.');
}

/* Slate 백그라운드 알림 ------------------------------------------------------ */

const BANNER_MS = 5000;

export function mountNotify(container, config) {
  const text = (value) => String(value ?? '').trim();
  const app = text(config?.app) || '게임';
  const editor = text(config?.editor) || 'Unreal Editor';
  const banner = text(config?.banner);
  const windowImage = text(config?.window);
  const events = (Array.isArray(config?.events) ? config.events : [])
    .map((event) => (typeof event === 'string' ? { label: event } : event))
    .filter((event) => event && text(event.label))
    .map((event) => ({ label: text(event.label), always: Boolean(event.always) }));
  if (!banner || !events.length) return;

  container.innerHTML = `
    <div class="pf-tray__controls">
      ${events.map((event, index) => `<button type="button" class="pf-button pf-lab__reset" data-event="${index}">${escapeHtml(event.label)}</button>`).join('')}
      <span class="pf-tray__status" data-status aria-live="polite"></span>
    </div>
    <div class="pf-win pf-win--notify" data-desktop>
      <div class="pf-win__window pf-win__window--editor" data-window="editor">
        <div class="pf-win__title"><span class="pf-win__app-icon pf-win__app-icon--editor" aria-hidden="true"></span>${escapeHtml(editor)}<span class="pf-win__title-buttons" aria-hidden="true">− □ ×</span></div>
        <div class="pf-win__editor" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      <div class="pf-win__window pf-win__window--game" data-window="game">
        <div class="pf-win__title"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}<span class="pf-win__title-buttons" aria-hidden="true">− □ ×</span></div>
        ${windowImage ? `<img src="${escapeHtml(windowImage)}" alt="${escapeHtml(app)} 게임 화면" loading="lazy" decoding="async">` : ''}
      </div>
      <button type="button" class="pf-button pf-win__balloon pf-win__banner" data-banner hidden>
        <img src="${escapeHtml(banner)}" alt="${escapeHtml(text(config?.banner_alt) || `${app} 알림. 누르면 게임 창이 앞으로 옵니다.`)}" decoding="async">
      </button>
      <div class="pf-win__taskbar">
        <span class="pf-win__start" aria-hidden="true"></span>
        <button type="button" class="pf-button pf-win__task" data-task="editor"><span class="pf-win__app-icon pf-win__app-icon--editor" aria-hidden="true"></span>${escapeHtml(editor)}</button>
        <button type="button" class="pf-button pf-win__task" data-task="game"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}</button>
        <span class="pf-win__tray">
          <span class="pf-win__sys" aria-hidden="true">${SYS_ICONS}</span>
          <span class="pf-win__clock" aria-hidden="true">오후 9:41</span>
        </span>
      </div>
    </div>`;

  const status = container.querySelector('[data-status]');
  const bannerButton = container.querySelector('[data-banner]');
  const windows = Object.fromEntries([...container.querySelectorAll('[data-window]')].map((node) => [node.dataset.window, node]));
  const tasks = Object.fromEntries([...container.querySelectorAll('[data-task]')].map((node) => [node.dataset.task, node]));
  let front = 'editor';
  let bannerTimer = 0;

  const say = (message) => {
    status.textContent = message;
  };
  function setFront(which) {
    front = which;
    for (const key of Object.keys(windows)) {
      windows[key].classList.toggle('is-front', key === which);
      tasks[key].classList.toggle('is-active', key === which);
    }
  }
  function hideBanner() {
    window.clearTimeout(bannerTimer);
    bannerButton.classList.remove('is-shown');
    bannerButton.hidden = true;
  }
  function showBanner() {
    bannerButton.hidden = false;
    void bannerButton.offsetWidth;
    bannerButton.classList.add('is-shown');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(hideBanner, BANNER_MS);
  }

  container.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => {
      const event = events[Number(button.dataset.event)];
      if (front === 'game' && !event.always) {
        hideBanner();
        say(`${event.label}: 게임이 앞에 있어 알림을 띄우지 않습니다. (게임이 뒤에 있을 때만 뜹니다)`);
        return;
      }
      showBanner();
      say(event.always ? `${event.label}: 에디터가 앞에 있어도 알림을 띄웁니다. 5초 뒤 저절로 닫힙니다.` : `${event.label}: 게임이 뒤에 있어 알림을 띄웠습니다. 5초 뒤 저절로 닫힙니다.`);
    });
  });
  bannerButton.addEventListener('click', (event) => {
    event.stopPropagation();
    hideBanner();
    setFront('game');
    say('알림을 눌러 게임 창을 앞으로 가져왔습니다. 알림 창은 포커스를 받지 않는 topmost 창이라 이 클릭이 창을 올릴 권한이 됩니다.');
  });
  for (const key of Object.keys(windows)) {
    windows[key].addEventListener('click', (event) => {
      event.stopPropagation();
      setFront(key);
    });
    tasks[key].addEventListener('click', (event) => {
      event.stopPropagation();
      setFront(key);
    });
  }
  setFront('editor');
  say('에디터가 앞에 있고 게임은 뒤에 있습니다. 이벤트를 눌러 보세요.');
}
