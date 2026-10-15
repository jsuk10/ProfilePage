// 페이지 조립
//   1. content/site.yml 에서 섹션 목록을 읽고
//   2. 섹션마다 내용 파일을 읽고, 글 안의 {total} 같은 경력 기간 자리를 채운 뒤(durations.js)
//      HTML 로 그려 #wrapper 에 넣고, 메뉴를 만듭니다.
//   3. 'portfolio:rendered' 이벤트를 보내면 assets/js/main.js 가 템플릿 인터랙션
//      (스크롤스파이, fade-up, spotlights, features, 부드러운 스크롤)을 붙입니다.
// 내용 파일 하나가 잘못돼도 그 섹션 자리에만 오류 상자가 나오고 나머지는 그대로 그려집니다.

import { loadContent, ContentError, isPlainObject } from './content.js';
import { renderers } from './sections.js';
import { careerDurations, fillDurations } from './durations.js';
import { enhance, openInitialHash } from './interactions.js';
import { escapeHtml } from './markdown.js';

const SECTION_ID = /^[a-z0-9][a-z0-9-]*$/;
const STYLES = new Set(['style1', 'style1-alt', 'style2', 'style2-alt', 'style3', 'style3-alt', 'style4', 'style4-alt', 'alt']);

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

// 불러오는 동안 보이던 명함(index.html 의 #pf-splash)을 치웁니다. 너무 빨리 사라져 깜빡이지 않게 1.2초는 보여 줍니다.
const SPLASH_HOLD_MS = 1200;

function hideSplash() {
  const splash = document.getElementById('pf-splash');
  if (!splash) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wait = reduce ? 0 : Math.max(0, SPLASH_HOLD_MS - performance.now());
  window.setTimeout(() => {
    splash.classList.add('is-leaving');
    window.setTimeout(() => splash.remove(), 400);
  }, wait);
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

  try {
    const sections = readSections(await loadContent('site.yml'));
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
        const data = fillDurations(result.value, durations, section.source);
        const output = renderers[section.type](data, section);
        element = createSection(section, output);
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
  hideSplash();
  document.dispatchEvent(new CustomEvent('portfolio:rendered'));
  window.requestAnimationFrame(openInitialHash);
}

main();
