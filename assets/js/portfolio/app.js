// 페이지 조립
//   1. content/site.yml 에서 섹션 목록을 읽고
//   2. 섹션마다 내용 파일을 읽고, 글 안의 {total} 같은 경력 기간 자리를 채운 뒤(durations.js)
//      HTML 로 그려 #wrapper 에 넣고, 메뉴를 만듭니다.
//   3. 'portfolio:rendered' 이벤트를 보내면 assets/js/main.js 가 템플릿 인터랙션
//      (스크롤스파이, fade-up, spotlights, features, 부드러운 스크롤)을 붙입니다.
// 내용 파일 하나가 잘못돼도 그 섹션 자리에만 오류 상자가 나오고 나머지는 그대로 그려집니다.
//
// index.html?embed=데모id 로 열면 노션 같은 곳의 iframe 에 끼워 넣도록 그 데모 하나만 그립니다.
//   섹션 id            예) ?embed=spatial-audio
//   툴 데모 항목 id     예) ?embed=prasia-lab--nevercook  ("섹션id--kind")
// 메뉴, 명함, 꼬리말은 치우고 섹션 제목과 설명은 portfolio.css 의 Embed 규칙이 감춥니다.

import { loadContent, ContentError, isPlainObject } from './content.js';
import { renderers } from './sections.js';
import { careerDurations, fillDurations } from './durations.js';
import { enhance, openInitialHash } from './interactions.js';
import { escapeHtml } from './markdown.js';

const SECTION_ID = /^[a-z0-9][a-z0-9-]*$/;
const STYLES = new Set(['style1', 'style1-alt', 'style2', 'style2-alt', 'style3', 'style3-alt', 'style4', 'style4-alt', 'alt']);
const EMBED = (new URLSearchParams(location.search).get('embed') ?? '').trim();

function readSections(site) {
  if (!isPlainObject(site) || !Array.isArray(site.sections)) {
    throw new ContentError('site.yml', 'sections: 아래에 섹션 목록이 있어야 합니다.');
  }

  const seen = new Set();
  return site.sections.map((entry, index) => {
    const where = `sections 의 ${index + 1}번째 섹션`;
    const fail = (detail) => ({ id: '', style: 'style1', error: new ContentError('site.yml', `${where}: ${detail}`) });

    if (!isPlainObject(entry)) return fail('"id: 값" 처럼 이름과 값을 적어 주세요.');
    const id = String(entry.id ?? '').trim();
    const type = String(entry.type ?? '').trim();
    const source = String(entry.source ?? '').trim();
    const style = String(entry.style ?? '').trim();

    if (!SECTION_ID.test(id)) return fail(`id "${id}" 는 영문 소문자, 숫자, - 만 쓸 수 있습니다.`);
    if (seen.has(id)) return fail(`id "${id}" 가 이미 위에서 쓰였습니다.`);
    seen.add(id);
    if (!Object.hasOwn(renderers, type)) {
      return fail(`type "${type}" 는 없는 모양입니다. 쓸 수 있는 값: ${Object.keys(renderers).join(', ')}`);
    }
    if (!source) return fail('source 에 내용 파일 경로를 적어 주세요.');

    return {
      id,
      type,
      source,
      nav: String(entry.nav ?? '').trim(),
      style: STYLES.has(style) ? style : 'style1',
    };
  });
}

// ?embed= 의 섹션 하나만 남깁니다. "섹션id--kind" 면 그 섹션의 demos 에서도 그 kind 하나만 남깁니다.
function pickEmbed(sections) {
  const [id, kind = ''] = EMBED.split('--');
  const picked = sections.filter((section) => section.id === id);
  if (!picked.length) throw new ContentError('site.yml', `embed "${EMBED}" 에 맞는 섹션 id 가 없습니다.`);
  return { sections: picked, kind };
}

function pickDemo(data, kind, source) {
  const demos = (Array.isArray(data.demos) ? data.demos : [])
    .filter((demo) => isPlainObject(demo) && String(demo.kind ?? '').trim() === kind);
  if (!demos.length) throw new ContentError(source, `embed 의 데모 "${kind}" 가 demos 에 없습니다.`);
  return { ...data, demos };
}

// 불러오는 동안 보이던 명함(index.html 의 #pf-splash)을 치웁니다. 너무 빨리 지나가 깜빡이지 않게 1.2초는 보여 줍니다.
// 로딩 화면이 옅어지는 동안 첫 화면 맨 위의 명함이 로딩 명함 자리에서 제자리로 미끄러져 들어가고, 로딩 명함은 같은 길을
// 따라가며 배경과 함께 사라집니다. 두 명함이 늘 겹쳐 있어 크로스페이드로 이어지고 끝 상태는 실제 레이아웃 그대로입니다.
// 명함이 화면 밖이거나 움직임 줄이기 설정이면 그냥 사라집니다. 글꼴이 늦게 오면 자리가 바뀔 수 있어 (최대 1.5초) 기다렸다가 잽니다.
const SPLASH_HOLD_MS = 1200;
const SPLASH_FLIGHT_MS = 640;

function hideSplash() {
  const splash = document.getElementById('pf-splash');
  if (!splash) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wait = reduce ? 0 : Math.max(0, SPLASH_HOLD_MS - performance.now());
  const fontsReady = Promise.race([document.fonts?.ready, new Promise((resolve) => window.setTimeout(resolve, 1500))]);
  window.setTimeout(() => fontsReady.then(() => {
    const card = splash.querySelector('.pf-card');
    const target = document.querySelector('#wrapper .pf-card--intro');
    const from = card?.getBoundingClientRect();
    const to = target?.getBoundingClientRect();
    const onScreen = to && to.width > 0 && to.bottom > 0 && to.top < window.innerHeight;
    if (reduce || !from || !onScreen) {
      splash.classList.add('is-leaving');
      window.setTimeout(() => splash.remove(), 400);
      return;
    }
    // 템플릿이 로드 전에는 transition 을 !important 로 끄므로 인라인에도 !important 를 붙입니다.
    // 로딩 명함은 등장 애니메이션이 transform 을 쥐고 있는 동안 transition 이 걸리지 않으므로 애니메이션부터 뗍니다.
    // 배경 페이드와 두 명함의 이동은 같은 프레임에서 시작해야 어긋나지 않으므로 한 rAF 안에서 함께 켭니다.
    const set = (element, name, value) => element.style.setProperty(name, value, 'important');
    const shift = (a, b) => `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    const flight = `transform ${SPLASH_FLIGHT_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`;
    for (const element of [target, card]) {
      set(element, 'transform-origin', '0 0');
      set(element, 'transition', 'none');
    }
    set(card, 'animation', 'none');
    set(target, 'transform', shift(from, to));
    void target.offsetWidth;
    window.requestAnimationFrame(() => {
      splash.classList.add('is-leaving');
      for (const element of [target, card]) set(element, 'transition', flight);
      set(target, 'transform', 'none');
      set(card, 'transform', shift(to, from));
      window.setTimeout(() => {
        splash.remove();
        for (const name of ['transform-origin', 'transition', 'transform']) target.style.removeProperty(name);
      }, SPLASH_FLIGHT_MS + 60);
    });
  }), wait);
}

function createSection(section, output) {
  const element = document.createElement('section');
  element.id = section.id;
  element.className = ['wrapper', section.style, output.className].filter(Boolean).join(' ');
  element.innerHTML = output.html;
  return element;
}

function createErrorSection(section, error) {
  const element = document.createElement('section');
  if (section.id) element.id = section.id;
  element.className = `wrapper ${section.style || 'style1'} pf-error-section`;
  const detail = error instanceof ContentError ? error.message : `content/${section.source || 'site.yml'}: ${error.message}`;
  element.innerHTML = `
    <div class="inner">
      <div class="pf-error" role="alert">
        <p class="pf-error__title">이 섹션을 그리지 못했습니다.</p>
        <p class="pf-error__detail">${escapeHtml(detail)}</p>
      </div>
    </div>`;
  return element;
}

async function main() {
  const wrapper = document.getElementById('wrapper');
  const navList = document.querySelector('#sidebar nav ul');
  const fragment = document.createDocumentFragment();
  const navItems = [];
  const mounts = [];
  // 끼워 넣을 때는 메뉴, 명함, 꼬리말을 아예 빼서 템플릿의 사이드바 여백과 스크롤스파이가 붙지 않게 합니다.
  if (EMBED) {
    for (const selector of ['#sidebar', '#footer', '#pf-splash', '.pf-skip']) document.querySelector(selector)?.remove();
  }

  try {
    let sections = readSections(await loadContent('site.yml'));
    let embedKind = '';
    if (EMBED) ({ sections, kind: embedKind } = pickEmbed(sections));
    const results = await Promise.allSettled(
      sections.map((section) => (section.error ? Promise.reject(section.error) : loadContent(section.source))),
    );
    // 글 안의 {total}, {경력 섹션 id} 를 경력 섹션 period 로 계산한 기간으로 바꿉니다. (durations.js)
    const durations = careerDurations(
      sections.map((section, index) => ({
        ...section,
        data: results[index].status === 'fulfilled' && isPlainObject(results[index].value) ? results[index].value : null,
      })),
    );

    sections.forEach((section, index) => {
      const result = results[index];
      let element;
      try {
        if (result.status === 'rejected') throw result.reason;
        if (!isPlainObject(result.value)) throw new ContentError(section.source, '"이름: 값" 형식의 내용이 없습니다.');
        let data = fillDurations(result.value, durations, section.source);
        if (embedKind) data = pickDemo(data, embedKind, section.source);
        const output = renderers[section.type](data, section);
        element = createSection(section, output);
        // 끼워 넣은 데모는 스크롤로 나타나는 효과 없이 바로 보입니다.
        if (EMBED) element.classList.remove('fade-up');
        if (output.mount) mounts.push(() => output.mount(element, data));
      } catch (error) {
        console.error(error);
        element = createErrorSection(section, error);
      }
      fragment.append(element);
      if (section.nav && section.id) {
        navItems.push(`<li><a href="#${section.id}">${escapeHtml(section.nav)}</a></li>`);
      }
    });
  } catch (error) {
    console.error(error);
    fragment.append(createErrorSection({ style: 'style1' }, error));
  }

  wrapper.replaceChildren(fragment);
  if (navList) navList.innerHTML = navItems.join('');

  for (const mount of mounts) {
    try {
      mount();
    } catch (error) {
      console.error(error);
    }
  }

  enhance(wrapper);
  document.documentElement.classList.add('is-rendered');
  document.dispatchEvent(new CustomEvent('portfolio:rendered'));
  window.requestAnimationFrame(() => {
    if (!EMBED) openInitialHash();
    hideSplash();
  });
}

main();
