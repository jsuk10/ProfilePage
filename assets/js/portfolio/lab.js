// 툴 데모 (type: lab 섹션, content/prasia-lab.yml / like-or-die-lab.yml). demos 의 kind 마다 아래 mount 함수 하나입니다.
//   nevercook  콘텐츠 브라우저 폴더 / 섬네일을 누르면 NeverCook 아이콘이 붙고 떨어집니다. (DOM)
//   tray       트레이 아이콘 메뉴와 풍선 메시지, 풍선을 누르면 게임 창이 앞으로 옵니다. (DOM)
//   notify     게임이 뒤에 있을 때 Slate 알림을 띄우고, 누르면 게임 창이 앞으로 옵니다. (DOM)
//   minimap    웨이포인트를 순회하며 노드마다 DrawCall / Primitive 를 재고 색으로 표시합니다. (Canvas 2D)
// 지도, 수치, 이름은 데모용입니다.

import { escapeHtml } from './markdown.js';
import { t } from './i18n.js';

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
      name: String(point?.name ?? t(`노드 ${index + 1}`, `Node ${index + 1}`)),
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
      <canvas class="pf-minimap__canvas" role="img" aria-label="${t('웨이포인트 미니맵. 순회하면 노드마다 DrawCall 을 재서 색으로 표시합니다.', 'Waypoint minimap. The tour measures DrawCalls at each node and colors it by load.')}"></canvas>
      <div class="pf-minimap__tip" data-tip hidden></div>
    </div>
    <div class="pf-minimap__bar">
      <button type="button" class="pf-button pf-lab__reset" data-run>${t('순회 시작', 'Start tour')}</button>
      <label class="pf-lab__volume pf-minimap__threshold">${t('DrawCall 기준', 'DrawCall limit')}
        <input type="range" min="800" max="${Math.ceil(maxDraw / 100) * 100}" step="50" value="${threshold}" data-threshold>
        <output data-threshold-out>${format(threshold)}</output>
      </label>
      <ul class="pf-lab__legend" aria-label="${t('색 뜻', 'Color legend')}">
        <li><span class="pf-lab__key pf-lab__key--ok" aria-hidden="true"></span>${t('기준의 70% 미만', 'Under 70% of limit')}</li>
        <li><span class="pf-lab__key pf-lab__key--warn" aria-hidden="true"></span>${t('70% 이상', '70% or more')}</li>
        <li><span class="pf-lab__key pf-lab__key--over" aria-hidden="true"></span>${t('기준 초과', 'Over limit')}</li>
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
      <p class="pf-minimap__rank-title">${t('최적화 우선순위', 'Optimization priority')} <span class="pf-readout__hint">${t(
        `${measured.length}개 측정, 기준 초과 ${over}개`,
        `${measured.length} ${measured.length === 1 ? 'node' : 'nodes'} measured, ${over} over limit`,
      )}</span></p>
      <ol>${top
        .map(
          (point) =>
            `<li class="is-${level(point.draw)}"><span>${escapeHtml(point.name)}</span><span class="pf-minimap__value">DrawCall ${format(point.draw)} · Prim ${point.prims.toFixed(1)}M</span></li>`,
        )
        .join('')}</ol>`;
  }

  function finish() {
    done = true;
    runButton.textContent = t('다시 순회', 'Run again');
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
    runButton.textContent = t('순회 중…', 'Touring…');
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
      : t(`${point.name} · 아직 측정 전`, `${point.name} · Not measured yet`);
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
          <span class="pf-switch__track" aria-hidden="true"><span class="pf-switch__thumb"></span></span>${t('NeverCook 만 보기', 'NeverCook only')}
        </button>
        <span class="pf-cb__count" data-count></span>
      </div>
      <ul class="pf-cb__grid" style="--pf-cb-columns: ${Math.min(items.length, 8)}">${items.map(tile).join('')}
      </ul>
      <p class="pf-cb__hint">${t(
        '폴더나 섬네일을 누르면 NeverCook 에 넣거나 뺍니다. 아이콘이 붙은 폴더와 에셋은 쿠킹(패키징)에서 빠집니다.',
        'Click a folder or thumbnail to add it to NeverCook or remove it. Marked folders and assets are left out of cooking (packaging).',
      )}</p>
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
    list.textContent = names.length
      ? t(`NeverCook 목록 (${names.length}): ${names.join(', ')}`, `NeverCook list (${names.length}): ${names.join(', ')}`)
      : t('NeverCook 목록이 비어 있습니다.', 'The NeverCook list is empty.');
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
  const app = String(config?.app ?? t('게임', 'Game')).trim();
  const balloon = String(config?.balloon ?? '').trim();
  const windowImage = String(config?.window ?? '').trim();
  const eventName = String(config?.event ?? t('알림', 'Alert')).trim();
  if (!balloon) return;

  container.innerHTML = `
    <div class="pf-tray__controls">
      <button type="button" class="pf-button pf-lab__reset" data-notify>${t(`${escapeHtml(eventName)} 알림 보내기`, `Send ${escapeHtml(eventName)} alert`)}</button>
      <button type="button" class="pf-button pf-lab__reset" data-menu-open aria-haspopup="menu" aria-expanded="false">${t('트레이 메뉴 열기', 'Open tray menu')}</button>
      <button type="button" class="pf-button pf-lab__reset" data-relaunch hidden>${t('게임 다시 실행', 'Relaunch game')}</button>
    </div>
    <div class="pf-win" data-desktop>
      <div class="pf-win__window" data-window title="${t('누르면 작업 표시줄로 최소화합니다', 'Click to minimize to the taskbar')}" hidden>
        <div class="pf-win__title"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}<span class="pf-win__title-buttons" aria-hidden="true">− □ ×</span></div>
        ${windowImage ? `<img src="${escapeHtml(windowImage)}" alt="${t(`${escapeHtml(app)} 게임 화면`, `${escapeHtml(app)} game screen`)}" loading="lazy" decoding="async">` : ''}
      </div>
      <button type="button" class="pf-button pf-win__balloon" data-balloon hidden>
        <img src="${escapeHtml(balloon)}" alt="${t(
          `${escapeHtml(app)} 풍선 메시지: 파티에 초대되었습니다. 누르면 게임 창이 앞으로 옵니다.`,
          `${escapeHtml(app)} balloon message: You've been invited to a party. Click to bring the game window to the front.`,
        )}" decoding="async">
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
          <button type="button" class="pf-button pf-win__tray-icon" data-tray aria-label="${t(`${escapeHtml(app)} 트레이 아이콘 메뉴`, `${escapeHtml(app)} tray icon menu`)}" aria-haspopup="menu" aria-expanded="false"><span class="pf-win__app-icon" aria-hidden="true"></span></button>
          <span class="pf-win__clock" aria-hidden="true">${t('오후 9:41', '9:41 PM')}</span>
        </span>
      </div>
    </div>
    <p class="pf-tray__status pf-tray__status--below" data-status aria-live="polite"></p>`;

  const pick = (selector) => container.querySelector(selector);
  const desktop = pick('[data-desktop]');
  const win = pick('[data-window]');
  const balloonButton = pick('[data-balloon]');
  const menu = pick('[data-menu]');
  const task = pick('[data-task]');
  const tray = pick('[data-tray]');
  const notify = pick('[data-notify]');
  const menuButton = pick('[data-menu-open]');
  const relaunch = pick('[data-relaunch]');
  const status = pick('[data-status]');
  let running = true;
  let shown = false; // 창이 떠 있음 (최소화 포함)
  let minimized = false; // 작업 표시줄에만 있음
  let front = false;
  let balloonTimer = 0;
  let minimizeTimer = 0;

  const say = (text) => {
    status.textContent = text;
  };
  function setFront(value) {
    front = value && shown;
    win.classList.toggle('is-front', front);
    task.classList.toggle('is-active', front);
  }
  function showWindow() {
    window.clearTimeout(minimizeTimer);
    win.classList.remove('is-minimizing');
    win.hidden = false;
    task.hidden = false;
    shown = true;
    minimized = false;
    setFront(true);
    win.classList.remove('is-restoring');
    void win.offsetWidth;
    win.classList.add('is-restoring');
  }
  function hideWindow() {
    window.clearTimeout(minimizeTimer);
    win.classList.remove('is-minimizing');
    win.hidden = true;
    task.hidden = true;
    shown = false;
    minimized = false;
    setFront(false);
  }
  // 창을 작업 표시줄로 내립니다. 작업 표시줄 버튼은 남습니다.
  function minimizeWindow() {
    if (!shown || minimized) return;
    minimized = true;
    setFront(false);
    win.classList.remove('is-restoring');
    if (reduceMotion.matches) {
      win.hidden = true;
      return;
    }
    win.classList.add('is-minimizing');
    minimizeTimer = window.setTimeout(() => {
      win.classList.remove('is-minimizing');
      win.hidden = true;
    }, MINIMIZE_MS);
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
    say(t(`${eventName} 풍선 메시지가 떴습니다. 눌러 보세요.`, `A ${eventName} balloon message popped up. Click it.`));
  }
  function setMenu(open) {
    menu.hidden = !open;
    tray.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? t('트레이 메뉴 닫기', 'Close tray menu') : t('트레이 메뉴 열기', 'Open tray menu');
  }
  const closeMenu = () => setMenu(false);
  // 트레이 아이콘이 작아 못 찾을 때 버튼으로 같은 메뉴를 열고 아이콘 자리를 잠깐 비춥니다.
  function pointTray() {
    tray.classList.remove('is-pointed');
    void tray.offsetWidth;
    tray.classList.add('is-pointed');
  }

  notify.addEventListener('click', showBalloon);
  balloonButton.addEventListener('click', (event) => {
    event.stopPropagation();
    hideBalloon();
    showWindow();
    say(t('풍선 메시지를 눌러 숨겨 둔 게임 창을 복원하고 포그라운드로 가져왔습니다.', 'Clicking the balloon restored the hidden game window and brought it to the foreground.'));
  });
  tray.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenu(menu.hidden);
  });
  menuButton.addEventListener('click', () => {
    if (!running) return;
    setMenu(menu.hidden);
    if (!menu.hidden) {
      pointTray();
      say(t(
        '작업 표시줄 오른쪽 아래 트레이 아이콘의 메뉴입니다. Show Game / Hide Game / Exit 를 눌러 보세요.',
        'This is the menu of the tray icon at the bottom right of the taskbar. Try Show Game, Hide Game or Exit.',
      ));
    }
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-menu-item]');
    if (!item) return;
    event.stopPropagation();
    closeMenu();
    if (item.dataset.menuItem === 'show') {
      showWindow();
      say(t('Show Game: 게임 창을 보이고 앞으로 가져왔습니다.', 'Show Game: the game window is visible and in front.'));
    } else if (item.dataset.menuItem === 'hide') {
      hideWindow();
      say(t(
        'Hide Game: 작업 표시줄에서 게임을 숨겼습니다. 이제 트레이 아이콘(트레이 메뉴 열기)으로만 제어하고 Show Game 으로 다시 띄웁니다.',
        'Hide Game: the game is hidden from the taskbar. Now it is controlled only from the tray icon (Open tray menu); use Show Game to bring it back.',
      ));
    } else {
      hideWindow();
      hideBalloon();
      running = false;
      tray.hidden = true;
      notify.disabled = true;
      menuButton.disabled = true;
      relaunch.hidden = false;
      say(t('Exit: 게임을 끝냈습니다.', 'Exit: the game has closed.'));
    }
  });
  // 작업 표시줄 버튼: 최소화돼 있으면 복원, 앞에 있으면 최소화, 뒤에 있으면 앞으로
  task.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMenu();
    if (minimized) {
      showWindow();
      say(t('작업 표시줄 버튼을 눌러 게임 창을 복원했습니다.', 'The taskbar button restored the game window.'));
    } else if (front) {
      minimizeWindow();
      say(t(
        '게임 창을 최소화했습니다. 작업 표시줄 버튼이나 트레이 메뉴의 Show Game 으로 다시 띄웁니다.',
        'Game window minimized. Bring it back with the taskbar button or Show Game in the tray menu.',
      ));
    } else {
      setFront(true);
      say(t('게임 창을 앞으로 가져왔습니다.', 'Game window brought to the front.'));
    }
  });
  win.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMenu();
    minimizeWindow();
    say(t(
      '게임 창을 눌러 최소화했습니다. 작업 표시줄 버튼이나 트레이 메뉴의 Show Game 으로 다시 띄웁니다.',
      'Clicking the game window minimized it. Bring it back with the taskbar button or Show Game in the tray menu.',
    ));
  });
  desktop.addEventListener('click', () => {
    closeMenu();
    if (front) {
      setFront(false);
      say(t('바탕화면을 눌렀습니다. 게임 창이 뒤로 갔습니다.', 'You clicked the desktop, so the game window moved to the back.'));
    }
  });
  relaunch.addEventListener('click', () => {
    running = true;
    tray.hidden = false;
    notify.disabled = false;
    menuButton.disabled = false;
    relaunch.hidden = true;
    hideWindow();
    say(t('게임을 다시 실행했습니다. 창은 트레이로 숨겨 둔 상태입니다.', 'Game relaunched. Its window is hidden in the tray.'));
  });
  say(t('게임은 켜져 있지만 창은 트레이로 숨겨 둔 상태입니다.', 'The game is running, but its window is hidden in the tray.'));
}

/* Slate 백그라운드 알림 ------------------------------------------------------ */

const BANNER_MS = 5000;
const MINIMIZE_MS = 240;
const PERSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="currentColor"/></svg>';

export function mountNotify(container, config) {
  const text = (value) => String(value ?? '').trim();
  const app = text(config?.app) || t('게임', 'Game');
  const editor = text(config?.editor) || 'Unreal Editor';
  const cover = text(config?.cover);
  const windowImage = text(config?.window);
  const thumb = text(config?.thumb);
  const thumbAlt = text(config?.thumb_alt) || t('플레이어가 커스터마이징한 캐릭터 캡처', "Capture of the player's customized character");
  const events = (Array.isArray(config?.events) ? config.events : [])
    .map((event) => (typeof event === 'string' ? { label: event } : event))
    .filter((event) => event && text(event.label))
    .map((event) => ({ label: text(event.label), always: Boolean(event.always), title: text(event.title) || text(event.label), body: text(event.body) }));
  if (!events.length) return;

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
      <div class="pf-win__window pf-win__window--game is-minimized" data-window="game">
        <div class="pf-win__title"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}<span class="pf-win__title-buttons" aria-hidden="true">− □ ×</span></div>
        ${windowImage ? `<img src="${escapeHtml(windowImage)}" alt="${t(`${escapeHtml(app)} 게임 화면`, `${escapeHtml(app)} game screen`)}" loading="lazy" decoding="async">` : `<div class="pf-win__blank">${t('게임 프로세스', 'Game process')}</div>`}
      </div>
      <button type="button" class="pf-button pf-win__balloon pf-win__banner" data-banner hidden>
        ${cover ? `<span class="pf-win__banner-cover"><img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async"></span>` : ''}
        <span class="pf-win__banner-row">
          <span class="pf-win__banner-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(thumbAlt)}" decoding="async">` : `${PERSON_ICON}<i>${t('캡처', 'Capture')}</i>`}</span>
          <span class="pf-win__banner-text"><em class="pf-win__banner-app">${escapeHtml(app)}</em><strong data-banner-title></strong><span data-banner-body></span></span>
        </span>
      </button>
      <div class="pf-win__taskbar">
        <span class="pf-win__start" aria-hidden="true"></span>
        <button type="button" class="pf-button pf-win__task" data-task="editor"><span class="pf-win__app-icon pf-win__app-icon--editor" aria-hidden="true"></span>${escapeHtml(editor)}</button>
        <button type="button" class="pf-button pf-win__task" data-task="game"><span class="pf-win__app-icon" aria-hidden="true"></span>${escapeHtml(app)}</button>
        <span class="pf-win__tray">
          <span class="pf-win__sys" aria-hidden="true">${SYS_ICONS}</span>
          <span class="pf-win__clock" aria-hidden="true">${t('오후 9:41', '9:41 PM')}</span>
        </span>
      </div>
    </div>`;

  const status = container.querySelector('[data-status]');
  const bannerButton = container.querySelector('[data-banner]');
  const bannerTitle = container.querySelector('[data-banner-title]');
  const bannerBody = container.querySelector('[data-banner-body]');
  const windows = Object.fromEntries([...container.querySelectorAll('[data-window]')].map((node) => [node.dataset.window, node]));
  const tasks = Object.fromEntries([...container.querySelectorAll('[data-task]')].map((node) => [node.dataset.task, node]));
  let front = 'editor';
  let bannerTimer = 0;
  let showTimer = 0;

  const say = (message) => {
    status.textContent = message;
  };
  const minimized = (which) => windows[which].classList.contains('is-minimized');
  function setFront(which) {
    front = which;
    for (const key of Object.keys(windows)) {
      windows[key].classList.toggle('is-front', key === which);
      tasks[key].classList.toggle('is-active', key === which);
    }
  }
  function restore(which) {
    const win = windows[which];
    if (win.classList.contains('is-minimized')) {
      win.classList.remove('is-minimized');
      win.classList.remove('is-restoring');
      void win.offsetWidth;
      win.classList.add('is-restoring');
    }
    setFront(which);
  }
  function minimize(which) {
    const win = windows[which];
    win.classList.remove('is-front');
    tasks[which].classList.remove('is-active');
    if (front === which) front = '';
    if (reduceMotion.matches) {
      win.classList.add('is-minimized');
      return;
    }
    win.classList.add('is-minimizing');
    window.setTimeout(() => {
      win.classList.remove('is-minimizing');
      win.classList.add('is-minimized');
    }, MINIMIZE_MS);
  }
  function hideBanner() {
    window.clearTimeout(bannerTimer);
    bannerButton.classList.remove('is-shown');
    bannerButton.hidden = true;
  }
  // 본문은 문장마다 줄을 바꿔 보여 줍니다. (문장 중간에서 끊기지 않게)
  function showBanner(event) {
    bannerTitle.textContent = event.title;
    bannerBody.innerHTML = event.body
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .map((sentence) => `<span>${escapeHtml(sentence)}</span>`)
      .join('');
    bannerBody.hidden = !event.body;
    bannerButton.hidden = false;
    void bannerButton.offsetWidth;
    bannerButton.classList.add('is-shown');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(hideBanner, BANNER_MS);
  }

  // 알림은 게임이 뒤에 있을 때 뜨는 것이라, 데모에서는 게임 창을 먼저 최소화한 뒤 띄웁니다.
  container.querySelectorAll('[data-event]').forEach((button) => {
    button.addEventListener('click', () => {
      const event = events[Number(button.dataset.event)];
      const wasOpen = !minimized('game');
      if (wasOpen) minimize('game');
      hideBanner();
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        showBanner(event);
        const how = wasOpen
          ? t('게임 창을 최소화한 뒤 알림을 띄웠습니다.', 'Minimized the game window, then showed the alert.')
          : t('게임이 최소화돼 있어 바로 알림을 띄웠습니다.', 'The game was already minimized, so the alert showed right away.');
        const always = event.always
          ? t(' 이 알림은 에디터가 앞에 있어도 뜹니다.', ' This one shows even when the editor is in front.')
          : '';
        say(t(
          `${event.label}: ${how}${always} 5초 뒤 저절로 닫힙니다.`,
          `${event.label}: ${how}${always} It closes by itself in 5 seconds.`,
        ));
      }, wasOpen && !reduceMotion.matches ? MINIMIZE_MS + 60 : 0);
    });
  });
  bannerButton.addEventListener('click', (event) => {
    event.stopPropagation();
    window.clearTimeout(showTimer);
    hideBanner();
    const wasMinimized = minimized('game');
    restore('game');
    say(t(
      `알림을 눌러 게임 창을 ${wasMinimized ? '복원해 ' : ''}앞으로 가져왔습니다. 알림 창은 포커스를 받지 않는 topmost 창이라 이 클릭이 창을 올릴 권한이 됩니다.`,
      `Clicking the alert ${wasMinimized ? 'restored the game window and brought it' : 'brought the game window'} to the front. The alert is a topmost window that never takes focus, so this click is what grants permission to raise the game.`,
    ));
  });
  for (const key of Object.keys(windows)) {
    windows[key].addEventListener('click', (event) => {
      event.stopPropagation();
      setFront(key);
    });
    tasks[key].addEventListener('click', (event) => {
      event.stopPropagation();
      if (minimized(key)) restore(key);
      else if (front === key) minimize(key);
      else setFront(key);
    });
  }
  setFront('editor');
  say(t('에디터가 앞에 있고 게임은 최소화돼 있습니다. 이벤트를 눌러 보세요.', 'The editor is in front and the game is minimized. Pick an event.'));
}
