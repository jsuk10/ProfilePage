// 섹션 모양(type)별 HTML 을 만듭니다. site.yml 의 type 값이 아래 renderers 의 이름과 같아야 합니다.
// 각 함수는 (내용, 섹션 설정) 을 받아 { className, html, mount } 를 돌려줍니다.
//   className  섹션에 더 붙는 클래스 (템플릿 효과: fullscreen, fade-up, spotlights)
//   html       섹션 안쪽 HTML
//   mount      (선택) 섹션이 페이지에 붙은 뒤 실행할 함수

import { markdown, inline, escapeHtml as esc, escapeAttr as attr, linkAttrs } from './markdown.js';
import { mountSpatialAudioDemo } from './spatial-audio-demo.js';
import { mountSpatialAudio3D, supportsWebGL2 } from './spatial-audio-3d.js';
import { parseVoxelPreset, sliceAtListener } from './spatial-audio-voxel.js';
import { mountMinimap, mountNeverCook, mountNotify, mountTray } from './lab.js';
import { t } from './i18n.js';

const CHEVRON =
  '<svg class="pf-detail__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const toList = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);
const isTrue = (value) => String(value).trim().toLowerCase() === 'true';
const has = (value) => value != null && String(value).trim() !== '';

export const slug = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

// "4.27 / 5", "2021.11 ~ 2025.09" 처럼 짧은 구분 기호 양옆에서는 줄을 바꾸지 않습니다.
const glue = (value) => String(value ?? '').replace(/ ([/~]) /g, '\u00A0$1\u00A0');

// "(Unreal Engine 4.27)" \uCC98\uB7FC \uC9E7\uC740 \uAD04\uD638 \uBB36\uC74C(30\uC790 \uC774\uD558)\uB3C4 \uC911\uAC04\uC5D0\uC11C \uC904\uC744 \uBC14\uAFB8\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
const keepParens = (value) => String(value ?? '').replace(/\(([^()\n]{1,30})\)/g, (match) => match.replace(/ /g, '\u00A0'));

// 버튼 안에 링크가 들어가면 안 되므로, 제목에서는 링크 태그만 벗겨 냅니다.
const inlineText = (value) => inline(value).replace(/<\/?a\b[^>]*>/gi, '');

function actions(links, { primaryFirst = false } = {}) {
  const items = toList(links).filter((link) => link && has(link.url) && linkAttrs(link.url));
  if (!items.length) return '';
  const buttons = items.map((link, index) => {
    const primary = primaryFirst ? index === 0 : isTrue(link.primary);
    return `<li><a class="button${primary ? ' primary' : ''}" ${linkAttrs(link.url)}>${esc(has(link.label) ? link.label : link.url)}</a></li>`;
  });
  return `<ul class="actions pf-actions">${buttons.join('')}</ul>`;
}

const lead = (value) => (has(value) ? `<div class="pf-lead">${markdown(value)}</div>` : '');

/* Intro ------------------------------------------------------------------ */

// 명함: 첫 화면 맨 위에 그리고, 불러오는 동안 먼저 보이는 index.html 의 #pf-splash 도 같은 모양입니다. (그쪽은 손으로 맞춥니다)
function profileCard(data) {
  const nameEn = has(data.name_en) ? ` <span class="pf-card__name-en" lang="en">${esc(data.name_en)}</span>` : '';
  const career = toList(data.card)
    .filter((item) => item && has(item.value))
    .map(
      (item) =>
        `<li>${has(item.logo) ? `<img src="${attr(item.logo)}" alt="" decoding="async">` : ''}<span>${inline(glue(item.value))}</span>${has(item.meta) ? `<span class="pf-card__meta">${inline(glue(item.meta))}</span>` : ''}</li>`,
    )
    .join('');
  return `
        <div class="pf-card pf-card--intro">
          ${has(data.photo) ? `<img class="pf-card__photo" src="${attr(data.photo)}" alt="${attr(data.photo_alt)}" width="509" height="634" decoding="async">` : ''}
          <div class="pf-card__body">
            <h1 class="pf-card__name">${esc(data.name)}${nameEn}</h1>
            ${has(data.role) ? `<p class="pf-card__role">${inline(data.role)}</p>` : ''}
            ${career ? `<ul class="pf-card__career">${career}</ul>` : ''}
          </div>
        </div>`;
}

function intro(data) {

  // logo 를 적으면 값 왼쪽에 작은 로고를 붙입니다. 바로 옆 글자가 이름을 말해 주니 대체 텍스트는 비웁니다.
  const facts = toList(data.facts)
    .map(
      (fact) => `
          <div class="pf-facts__item">
            <dt>${esc(fact.label)}</dt>
            <dd${has(fact.logo) ? ' class="has-logo"' : ''}>
              ${has(fact.logo) ? `<img class="pf-facts__logo" src="${attr(fact.logo)}" alt="" decoding="async">` : ''}
              <span class="pf-facts__value">${inline(glue(fact.value))}</span>
              ${has(fact.meta) ? `<span class="pf-facts__meta">${inline(glue(fact.meta))}</span>` : ''}
            </dd>
          </div>`,
    )
    .join('');

  // 연락처: 주소를 글자 그대로 보여 주고(드래그로도 복사), 누르면 메일 앱이 열립니다. 옆 버튼은 주소를 복사합니다.
  const contact = toList(data.contact)
    .filter((item) => item && has(item.value))
    .map((item) => {
      const value = String(item.value).trim();
      const url = has(item.url) ? item.url : value.includes('@') ? `mailto:${value}` : '';
      const text = url && linkAttrs(url)
        ? `<a class="pf-contact__value" ${linkAttrs(url)}>${esc(value)}</a>`
        : `<span class="pf-contact__value">${esc(value)}</span>`;
      return `
              <li>
                <span class="pf-contact__label">${esc(item.label)}</span>${text}
                <button type="button" class="pf-button pf-contact__copy" data-copy="${attr(value)}" aria-label="${attr(t(`${item.label ?? ''} 주소 복사`, `Copy ${item.label ?? ''}`).trim())}">${t('복사', 'Copy')}</button>
                <span class="pf-visually-hidden" role="status"></span>
              </li>`;
    })
    .join('');

  const motto = data.motto && has(data.motto.text)
    ? `<p class="pf-motto">${has(data.motto.avatar) ? `<img class="pf-motto__avatar" src="${attr(data.motto.avatar)}" alt="" decoding="async">` : ''}<span>${inline(data.motto.text)}</span></p>`
    : '';

  // 경력 요약: 목록이면 로고 + 회사 줄 + 역할 줄, 글이면 Markdown 그대로입니다.
  const summary = Array.isArray(data.summary)
    ? `<ul class="pf-intro__summary pf-intro__summary--list">${toList(data.summary)
        .filter((item) => item && has(item.value))
        .map(
          (item) => `
            <li>
              ${has(item.logo) ? `<img class="pf-intro__logo" src="${attr(item.logo)}" alt="" decoding="async">` : ''}
              <div>
                <p class="pf-intro__company">${inline(keepParens(glue(item.value)))}</p>
                ${has(item.text) ? `<p class="pf-intro__work">${inline(glue(item.text))}</p>` : ''}
              </div>
            </li>`,
        )
        .join('')}</ul>`
    : has(data.summary)
      ? `<div class="pf-intro__summary">${markdown(keepParens(data.summary))}</div>`
      : '';

  // 명함이 로딩 화면에서 그대로 이어지도록 첫 섹션은 템플릿의 fade-up 을 쓰지 않습니다. 역할은 명함 안에 있습니다.
  return {
    className: 'fullscreen',
    html: `
      <div class="inner">
        ${profileCard(data)}
        <div class="pf-intro">
          ${has(data.brief) ? `<p class="pf-intro__brief">${inline(data.brief)}</p>` : ''}
          ${summary}
          ${facts ? `<dl class="pf-facts">${facts}</dl>` : ''}
          ${actions(data.links)}
          ${contact ? `<ul class="pf-contact" aria-label="${t('연락처', 'Contact')}">${contact}</ul>` : ''}
        </div>
        ${motto}
      </div>`,
  };
}

/* Skills ----------------------------------------------------------------- */

// "like-or-die#sound" → 경력 상세 항목 id "like-or-die--sound"
export const refTarget = (ref) => {
  const [section, item] = String(ref ?? '').split('#');
  return slug(section) && slug(item) ? `${slug(section)}--${slug(item)}` : '';
};

function refLink(project) {
  const name = esc(project?.name);
  const target = refTarget(project?.ref);
  if (!target) return `<span class="pf-ref pf-ref--static">${name}</span>`;
  return `<a class="pf-ref" href="#${attr(target)}" data-ref="${attr(target)}">${name}</a>`;
}

function tools(block) {
  const groups = toList(block.groups)
    .map(
      (group) => `
          <div class="pf-tools__group">
            <h4>${inline(group.name)}</h4>
            ${has(group.meta) ? `<p class="pf-tools__meta">${inline(group.meta)}</p>` : ''}
            <ul>${toList(group.items).map((item) => `<li>${inline(item)}</li>`).join('')}</ul>
          </div>`,
    )
    .join('');
  return `
        <div class="pf-tools">
          <h3>${esc(has(block.title) ? block.title : t('사용 도구', 'Tools'))}</h3>
          <div class="pf-tools__grid">${groups}</div>
        </div>`;
}

function skills(data) {
  const rows = toList(data.rows)
    .map((row) => {
      const refs = toList(row.projects);
      const summary = has(row.summary) ? `<p class="pf-skills__summary">${inline(row.summary)}</p>` : '';
      const detail = has(row.detail) ? `<p class="pf-skills__detail">${inline(row.detail)}</p>` : '';
      return `
            <tr>
              <th scope="row">${inline(row.area)}</th>
              <td>${summary}${detail}</td>
              <td>${refs.length ? `<ul class="pf-refs">${refs.map((project) => `<li>${refLink(project)}</li>`).join('')}</ul>` : ''}</td>
            </tr>`;
    })
    .join('');

  return {
    className: 'fade-up',
    html: `
      <div class="inner">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        <table class="pf-skills">
          <thead>
            <tr><th scope="col">${t('영역', 'Area')}</th><th scope="col">${t('숙련 내용', 'Proficiency')}</th><th scope="col">${t('근거 경력', 'Evidence')}</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${data.tools ? tools(data.tools) : ''}
      </div>`,
  };
}

/* Career ----------------------------------------------------------------- */

const HEADING = /^##[ \t]+(.+?)[ \t]*$/m;
const HEADING_ID = /[ \t]*\{#([a-z0-9][a-z0-9-]*)\}[ \t]*$/i;
const RND_SUFFIX = /[ \t]*\(R&D\)[ \t]*$/i;
// 첫 문단을 미리보기로 쓰지 않는 시작: 목록, HTML, 이미지, 제목, 인용, 표, 코드
const NOT_A_PARAGRAPH = /^(?:[-*+][ \t]|\d+[.)][ \t]|<|!\[|#|>|\||```|~~~)/;

function takeLead(content) {
  if (!content || NOT_A_PARAGRAPH.test(content)) return { lead: '', rest: content };
  const end = content.search(/\n[ \t]*\n/);
  if (end === -1) return { lead: content, rest: '' };
  return { lead: content.slice(0, end).trim(), rest: content.slice(end).trim() };
}

// 본문을 "## 제목" 단위로 나눕니다. "## 제목 {#항목-id}" 의 항목 id 는 근거 링크의 목적지가 됩니다.
export function splitDetails(body, sectionId) {
  const parts = String(body ?? '').replace(/\r\n?/g, '\n').split(new RegExp(HEADING.source, 'm'));
  const items = [];
  for (let index = 1; index < parts.length; index += 2) {
    let title = parts[index];
    let itemId = '';
    const idMatch = HEADING_ID.exec(title);
    if (idMatch) {
      itemId = slug(idMatch[1]);
      title = title.slice(0, idMatch.index);
    }
    const rnd = RND_SUFFIX.test(title);
    title = title.replace(RND_SUFFIX, '').trim();
    const { lead: leadText, rest } = takeLead((parts[index + 1] || '').trim());
    items.push({ id: `${sectionId}--${itemId || items.length + 1}`, title, rnd, lead: leadText, rest });
  }
  return { preamble: parts[0].trim(), items };
}

const BADGE = '<span class="pf-badge">R&amp;D</span>';

function detailItem(item) {
  const label = `<span class="pf-detail__label"><span class="pf-detail__title">${inlineText(item.title)}</span>${item.rnd ? ` ${BADGE}` : ''}</span>`;
  const leadHtml = item.lead ? `<div class="pf-detail__lead">${markdown(item.lead)}</div>` : '';

  if (!item.rest) {
    return `
          <article class="pf-detail pf-detail--static" id="${attr(item.id)}">
            <h4 class="pf-detail__heading">${label}</h4>
            ${leadHtml}
          </article>`;
  }

  const bodyId = `${item.id}__body`;
  return `
          <article class="pf-detail" id="${attr(item.id)}">
            <h4 class="pf-detail__heading">
              <button type="button" class="pf-button pf-detail__toggle" aria-expanded="false" aria-controls="${attr(bodyId)}">${label}${CHEVRON}</button>
            </h4>
            ${leadHtml}
            <div class="pf-detail__body" id="${attr(bodyId)}" hidden="until-found">
              <div class="pf-detail__content">${markdown(item.rest)}</div>
            </div>
          </article>`;
}

function career(data, section) {
  const { id } = section;
  const { preamble, items } = splitDetails(data.body, id);

  const title = has(data.title_url) ? `<a ${linkAttrs(data.title_url)}>${esc(data.title)}</a>` : esc(data.title);
  const period = has(data.period)
    ? `${inline(glue(data.period))}${has(data.duration) ? `<span class="pf-meta__sub">${inline(data.duration)}</span>` : ''}`
    : '';
  const meta = [
    [t('회사', 'Company'), has(data.company) && inline(data.company)],
    [t('기간', 'Period'), period],
    [t('엔진', 'Engine'), has(data.engine) && inline(data.engine)],
    [t('역할', 'Role'), has(data.role) && inline(data.role)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');

  const visual = has(data.image)
    ? `<figure class="pf-career__visual"><img src="${attr(data.image)}" alt="${attr(data.image_alt)}" loading="lazy" decoding="async"></figure>`
    : '';

  const highlights = toList(data.highlights)
    .map((item) => `<li><h3>${inline(item.title)}</h3><div class="pf-highlights__body">${markdown(item.text)}</div></li>`)
    .join('');

  const stack = toList(data.stack)
    .map(
      (group) => `
              <div class="pf-stack__group">
                <dt>${inline(group.group)}</dt>
                <dd><ul class="pf-chips">${toList(group.items).map((item) => `<li>${inline(item)}</li>`).join('')}</ul></dd>
              </div>`,
    )
    .join('');

  const strengths = toList(data.strengths)
    .map((item) => `<div><dt>${inline(item.title)}</dt><dd>${inline(item.text)}</dd></div>`)
    .join('');

  const hasToggles = items.some((item) => item.rest);
  const rndNote = items.some((item) => item.rnd) && has(data.rnd_note)
    ? `<p class="pf-rnd-note">${BADGE}<span>${inline(data.rnd_note)}</span></p>`
    : '';

  const details = items.length
    ? `
        <section class="pf-details" aria-labelledby="${attr(id)}-details-title">
          <div class="pf-details__head">
            <h3 id="${attr(id)}-details-title">${t('경력 상세', 'Career details')}</h3>
            ${hasToggles ? `<button type="button" class="pf-button pf-details__toggle-all" data-toggle-all aria-controls="${attr(id)}-details">${t('모두 펼치기', 'Expand all')}</button>` : ''}
          </div>
          ${rndNote}
          ${preamble ? `<div class="pf-details__preamble">${markdown(preamble)}</div>` : ''}
          <div class="pf-details__list" id="${attr(id)}-details">${items.map(detailItem).join('')}
          </div>
        </section>`
    : '';

  return {
    className: 'fade-up pf-career',
    html: `
      <div class="inner">
        <header class="pf-career__head${visual ? ' pf-career__head--visual' : ''}">
          <div class="pf-career__intro">
            <h2 class="pf-career__title">${title}</h2>
            ${has(data.summary) ? `<div class="pf-career__summary">${markdown(data.summary)}</div>` : ''}
            ${meta ? `<dl class="pf-meta">${meta}</dl>` : ''}
            ${actions(data.links)}
          </div>
          ${visual}
        </header>
        ${highlights ? `<ul class="pf-highlights">${highlights}</ul>` : ''}
        ${stack || strengths ? `
        <div class="pf-career__columns">
          ${stack ? `
          <section class="pf-stack" aria-labelledby="${attr(id)}-stack-title">
            <h3 id="${attr(id)}-stack-title">${t('기술 스택', 'Tech stack')}</h3>
            <dl class="pf-stack__groups">${stack}
            </dl>
          </section>` : ''}
          ${strengths ? `
          <section class="pf-strengths" aria-labelledby="${attr(id)}-strengths-title">
            <h3 id="${attr(id)}-strengths-title">${t('강점', 'Strengths')}</h3>
            <dl class="pf-strengths__list">${strengths}</dl>
          </section>` : ''}
        </div>` : ''}
        ${details}
      </div>`,
  };
}

/* Impact ----------------------------------------------------------------- */

const NUMBER = /^(\d+)(\.\d+)?$/;

// 적은 그대로 보여 주되 천 단위 쉼표만 넣습니다. 2640 → 2,640 / 19.0 → 19.0
function formatNumber(raw) {
  const value = String(raw ?? '').trim();
  const match = NUMBER.exec(value);
  if (!match) return esc(value);
  return `${Number(match[1]).toLocaleString('ko-KR')}${match[2] || ''}`;
}

// 하이픈(-)은 수학 기호 빼기(−)로 바꿉니다.
const minus = (value) => String(value).trim().replace(/^-/, '−');

function changeLabel(metric, before, after) {
  if (has(metric.change)) return esc(minus(metric.change));
  const percent = Math.round((after / before - 1) * 100);
  return `${percent < 0 ? '−' : percent > 0 ? '+' : ''}${Math.abs(percent)}%`;
}

function metricRow(metric, index, caseTitle) {
  const before = Number(metric.before);
  const after = Number(metric.after);
  const unit = has(metric.unit) ? esc(metric.unit) : '';
  const valid = Number.isFinite(before) && Number.isFinite(after) && before > 0 && after >= 0;
  if (!valid) {
    console.warn(`impact.yml: "${caseTitle}" 의 "${metric.label}" before / after 는 0 보다 큰 숫자여야 합니다.`);
  }
  const ratio = valid ? Math.min(1, after / before) : 1;
  const plain = (value) => `${String(value ?? '').trim()}${has(metric.unit) ? String(metric.unit).trim() : ''}`;
  const description = t(
    `개선 전 ${plain(metric.before)}, 개선 후 ${plain(metric.after)}. 개선 전의 ${Math.round(ratio * 100)}%`,
    `Before ${plain(metric.before)}, after ${plain(metric.after)}. ${Math.round(ratio * 100)}% of before`,
  );

  // 빨간 막대(개선 전)를 다 깔고 그 위에 초록 막대(개선 후)를 겹칩니다. 남은 빨간 부분이 줄어든 만큼입니다.
  return `
            <tr class="pf-bars__row" style="--ratio:${ratio.toFixed(4)};--i:${index}">
              <th scope="row" class="pf-bars__metric">
                ${inline(metric.label)}
                ${has(metric.note) ? `<span class="pf-bars__note">${inline(metric.note)}</span>` : ''}
              </th>
              <td class="pf-bars__plot">
                <span class="pf-bar" role="img" aria-label="${attr(description)}"><span class="pf-bar__after"></span></span>
              </td>
              <td class="pf-bars__values">${formatNumber(metric.before)}${unit} → <strong>${formatNumber(metric.after)}${unit}</strong></td>
              <td class="pf-bars__change">${valid ? changeLabel(metric, before, after) : ''}</td>
            </tr>`;
}

function impact(data, section) {
  const cases = toList(data.cases)
    .map((item, caseIndex) => {
      const headingId = `${section.id}-case-${caseIndex + 1}`;
      const title = String(item.title ?? '');
      return `
          <article class="pf-case" aria-labelledby="${attr(headingId)}">
            <div class="pf-case__head">
              <h3 id="${attr(headingId)}">${inline(title)}</h3>
              ${has(item.subtitle) ? `<p class="pf-case__subtitle">${inline(item.subtitle)}</p>` : ''}
              ${has(item.text) ? `<p class="pf-case__text">${inline(item.text)}</p>` : ''}
            </div>
            <table class="pf-bars">
              <caption class="pf-visually-hidden">${esc(title)}: ${t('지표별 개선 전 / 후 값', 'before / after by metric')}</caption>
              <colgroup><col class="pf-col-metric"><col><col class="pf-col-values"><col class="pf-col-change"></colgroup>
              <thead>
                <tr>
                  <th scope="col" class="pf-bars__metric">${t('지표', 'Metric')}</th>
                  <th scope="col" class="pf-bars__plot"><span class="pf-visually-hidden">${t('개선 전 길이 위에 겹친 개선 후 길이', 'After bar drawn over before bar')}</span></th>
                  <th scope="col" class="pf-bars__values">${t('전 → 후', 'Before → After')}</th>
                  <th scope="col" class="pf-bars__change">${t('변화', 'Change')}</th>
                </tr>
              </thead>
              <tbody>${toList(item.metrics).map((metric, index) => metricRow(metric, index, title)).join('')}
              </tbody>
            </table>
          </article>`;
    })
    .join('');

  return {
    className: 'pf-impact',
    html: `
      <div class="inner">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        <p class="pf-legend" aria-hidden="true">
          <span class="pf-legend__item"><span class="pf-legend__swatch pf-legend__swatch--before"></span>${t('개선 전', 'Before')}</span>
          <span class="pf-legend__item"><span class="pf-legend__swatch pf-legend__swatch--after"></span>${t('개선 후', 'After')}</span>
        </p>
        <div class="pf-cases">${cases}
        </div>
      </div>`,
  };
}

/* Spatial audio ----------------------------------------------------------- */

function spatialAudio(data) {
  const presets = toList(data.presets).filter((preset) => preset && toList(preset.layers).some((layer) => has(layer?.map)));
  const steps = toList(data.steps)
    .map((step) => `<li><h3>${inline(step.title)}</h3><p>${inline(step.text)}</p></li>`)
    .join('');

  // 데모 아래 '실제 게임에서는' 묶음: 와이즈 공간음향 대신 직접 계산한 이유(realtime) + 부하를 줄인 방법(optimizations)
  const realtime = data.realtime && has(data.realtime.text)
    ? `
          <section class="pf-spatial__why">
            ${has(data.realtime.title) ? `<h3>${inline(data.realtime.title)}</h3>` : ''}
            ${markdown(data.realtime.text)}
          </section>`
    : '';
  const tuning = toList(data.optimizations?.items)
    .map((item) => `<li><h4>${inline(item.title)}</h4>${has(item.text) ? `<p>${inline(item.text)}</p>` : ''}</li>`)
    .join('');
  const optimizations = tuning
    ? `
          <section class="pf-spatial__tuning">
            ${has(data.optimizations.title) ? `<h3>${inline(data.optimizations.title)}</h3>` : ''}
            <ol class="pf-tuning">${tuning}</ol>
          </section>`
    : '';

  return {
    className: 'fade-up pf-spatial',
    html: `
      <div class="inner">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        ${presets.length ? '<div class="pf-lab" data-lab></div>' : ''}
        ${steps ? `<ol class="pf-steps">${steps}</ol>` : ''}
        ${realtime || optimizations ? `<div class="pf-spatial__context">${realtime}${optimizations}</div>` : ''}
        ${has(data.note) ? `<p class="pf-note">${inline(data.note)}</p>` : ''}
      </div>`,
    mount(element) {
      const container = element.querySelector('[data-lab]');
      if (!container) return;
      if (supportsWebGL2()) {
        try {
          mountSpatialAudio3D(container, { presets, idPrefix: element.id });
          return;
        } catch (error) {
          console.warn('3D 데모를 그리지 못해 2D 단면으로 보여 줍니다.', error);
        }
      }
      // WebGL2 를 쓸 수 없으면 청취자 높이에서 자른 2D 단면으로 같은 계산을 보여 줍니다.
      // 청취자와 음원 높이가 다른 배치(2층)는 단면으로는 뜻이 없어 뺍니다.
      const scenes = presets.map(parseVoxelPreset);
      const flat = scenes.filter((scene) => scene.listener.y === scene.source.y);
      mountSpatialAudioDemo(container, { presets: (flat.length ? flat : scenes).map(sliceAtListener), idPrefix: element.id });
      container.querySelector('.pf-lab__stage')?.insertAdjacentHTML(
        'afterbegin',
        `<p class="pf-lab__fallback">${t('이 브라우저에서는 3D 를 그릴 수 없어 청취자 높이에서 자른 2D 단면으로 보여 줍니다.', 'This browser cannot draw 3D, so a 2D slice at listener height is shown instead.')}</p>`,
      );
    },
  };
}

/* Prasia lab (프라시아 전기 툴 데모) ------------------------------------------ */

// 툴 데모 묶음. demos 목록의 kind 마다 lab.js 의 mount 함수가 하나씩 있고, 항목 id 는 "섹션id--kind" 라 글에서 링크할 수 있습니다.
const labDemos = { nevercook: mountNeverCook, tray: mountTray, notify: mountNotify, minimap: mountMinimap };

function lab(data, section) {
  const demos = toList(data.demos).filter((demo) => demo && has(demo.kind) && Object.hasOwn(labDemos, String(demo.kind).trim()));
  const kind = (demo) => String(demo.kind).trim();
  const block = (demo) => `
          <article class="pf-toollab__item${demo.wide ? ' pf-toollab__item--wide' : ''}" id="${attr(`${section?.id ?? 'lab'}--${kind(demo)}`)}">
            ${has(demo.title) ? `<h3>${inline(demo.title)}</h3>` : ''}
            ${has(demo.text) ? `<p>${inline(demo.text)}</p>` : ''}
            <div class="pf-toollab__demo" data-demo="${attr(kind(demo))}"></div>
          </article>`;
  return {
    className: 'fade-up',
    html: `
      <div class="inner">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        <div class="pf-toollab${demos.length === 1 ? ' pf-toollab--single' : ''}">${demos.map(block).join('')}</div>
      </div>`,
    mount(element) {
      element.querySelectorAll('[data-demo]').forEach((target, index) => {
        labDemos[target.dataset.demo](target, demos[index]);
      });
    },
  };
}

/* Projects (spotlights) --------------------------------------------------- */

function projects(data, section) {
  const items = toList(data.items)
    .map((item, index) => {
      const itemId = `${section.id}--${slug(item.id) || index + 1}`;
      const title = String(item.title ?? '');
      const points = toList(item.points);
      const video = has(item.video)
        ? `
              <div class="pf-video">
                <iframe src="https://drive.google.com/file/d/${encodeURIComponent(String(item.video).trim())}/preview" title="${attr(t(`${title} 플레이 영상`, `${title} gameplay video`))}" loading="lazy" allow="autoplay; fullscreen" allowfullscreen></iframe>
              </div>`
        : '';

      return `
        <section class="pf-work" id="${attr(itemId)}">
          <div class="image" role="img" aria-label="${attr(has(item.image_alt) ? item.image_alt : t(`${title} 대표 이미지`, `${title} key art`))}">
            <img src="${attr(item.image)}" alt="" data-position="${attr(has(item.image_position) ? item.image_position : 'center center')}">
          </div>
          <div class="content">
            <div class="inner">
              <h3 class="pf-work__title">${esc(title)}</h3>
              ${has(item.award) ? `<p class="pf-work__award">${inline(item.award)}</p>` : ''}
              ${has(item.period) ? `<p class="pf-work__period">${esc(item.period)}</p>` : ''}
              ${points.length ? `<ul class="pf-work__points">${points.map((point) => `<li>${inline(point)}</li>`).join('')}</ul>` : ''}
              ${actions(item.links, { primaryFirst: true })}${video}
            </div>
          </div>
        </section>`;
    })
    .join('');

  return {
    className: 'spotlights pf-works',
    html: `
      <div class="inner pf-works__intro">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        ${has(data.stack) ? `<p class="pf-works__stack"><span class="pf-works__stack-label">${t('써 본 스택', 'Stack')}</span>${inline(data.stack)}</p>` : ''}
        ${actions(data.links)}
      </div>
      ${items}`,
  };
}

/* Activities (features) ---------------------------------------------------- */

function activities(data) {
  const groups = toList(data.groups)
    .map((group) => {
      const icon = slug(group.icon) || 'circle';
      const items = toList(group.items)
        .map((item) => (typeof item === 'string' ? { text: item } : item || {}))
        .map((item) => {
          // highlight: 게임 → 글자를 굵게 하고 옆에 '게임' 표시를 붙입니다. (true 면 표시 없이 굵게만)
          const mark = has(item.highlight) ? String(item.highlight).trim() : '';
          const badge = mark && mark.toLowerCase() !== 'true' ? ` <span class="pf-badge">${esc(mark)}</span>` : '';
          return `
              <li${mark ? ' class="is-highlight"' : ''}>
                <span class="pf-timeline__text">${inline(item.text)}${badge}</span>
                ${has(item.date) ? `<span class="pf-timeline__date">${esc(item.date)}</span>` : ''}
              </li>`;
        })
        .join('');
      return `
          <section>
            <span class="icon solid major fa-${attr(icon)}" aria-hidden="true"></span>
            <h3>${inline(group.title)}</h3>
            <ul class="pf-timeline">${items}
            </ul>
          </section>`;
    })
    .join('');

  return {
    className: 'fade-up',
    html: `
      <div class="inner">
        <h2>${esc(data.title)}</h2>
        ${lead(data.lead)}
        <div class="features pf-features">${groups}
        </div>
        ${actions(data.links)}
      </div>`,
  };
}

export const renderers = {
  intro,
  skills,
  career,
  impact,
  'spatial-audio': spatialAudio,
  lab,
  projects,
  activities,
};
