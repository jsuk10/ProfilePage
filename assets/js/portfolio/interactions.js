// 렌더 뒤에 붙는 인터랙션
//   - 경력 상세 펼치기 / 접기, 모두 펼치기
//   - 근거 링크(#섹션--항목) 이동: 닫힌 항목을 열고, 그 자리로 스크롤한 뒤 잠깐 강조
//   - 주소 끝 #항목 으로 들어오거나 뒤로 가기 했을 때 같은 이동 처리
//   - #slide 이미지가 화면에 들어올 때 미끄러져 들어오는 효과
//   - 연락처 '복사' 버튼
// 왼쪽(위쪽) 메뉴의 스크롤 이동은 템플릿(main.js 의 scrolly)이 맡습니다.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const FLASH_MS = 1600;

function parts(detail) {
  return {
    toggle: detail.querySelector(':scope > .pf-detail__heading > .pf-detail__toggle'),
    body: detail.querySelector(':scope > .pf-detail__body'),
  };
}

function setExpanded(detail, expanded) {
  const { toggle, body } = parts(detail);
  if (!toggle || !body) return;
  toggle.setAttribute('aria-expanded', String(expanded));
  detail.classList.toggle('is-open', expanded);
  // until-found: 접혀 있어도 브라우저 찾기(Ctrl+F)가 안쪽 글자를 찾아 펼칠 수 있습니다.
  if (expanded) body.removeAttribute('hidden');
  else body.setAttribute('hidden', 'until-found');
}

function syncToggleAll(list) {
  if (!list || !list.id) return;
  const button = document.querySelector(`[data-toggle-all][aria-controls="${CSS.escape(list.id)}"]`);
  if (!button) return;
  const toggles = [...list.querySelectorAll('.pf-detail__toggle')];
  const allOpen = toggles.length > 0 && toggles.every((toggle) => toggle.getAttribute('aria-expanded') === 'true');
  button.textContent = allOpen ? '모두 접기' : '모두 펼치기';
  button.dataset.state = allOpen ? 'open' : 'closed';
}

// 마우스 / 터치로 펼쳤을 때만 짧게 나타나게 합니다. 키보드로 펼친 경우는 바로 보여 줍니다.
function revealContent(detail) {
  if (reduceMotion.matches) return;
  const content = detail.querySelector(':scope > .pf-detail__body > .pf-detail__content');
  content?.animate(
    [
      { opacity: 0, transform: 'translateY(-0.35em)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 240, easing: EASE_OUT },
  );
}

function flash(target) {
  target.classList.remove('is-flash');
  void target.offsetWidth; // 같은 항목을 연달아 눌러도 강조가 다시 시작되게 합니다.
  target.classList.add('is-flash');
  window.clearTimeout(target._pfFlashTimer);
  target._pfFlashTimer = window.setTimeout(() => target.classList.remove('is-flash'), FLASH_MS);
}

function openAncestors(target) {
  const detail = target.closest('.pf-detail');
  if (detail && !detail.classList.contains('is-open')) {
    setExpanded(detail, true);
    syncToggleAll(detail.parentElement);
  }
  for (let node = target.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
  }
}

function goTo(target, { smooth, moveFocus }) {
  openAncestors(target);
  target.scrollIntoView({ behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto', block: 'start' });
  if (moveFocus) {
    if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  flash(target);
}

function targetFromHash(hash) {
  let id = String(hash || '').replace(/^#/, '');
  if (!id) return null;
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  return document.getElementById(id);
}

// 근거 링크에 목적지 이름을 붙입니다. 화면에는 "NC" 처럼 짧게, 읽기 도구에는 항목 제목까지 읽힙니다.
function labelRefs(root) {
  root.querySelectorAll('a.pf-ref[data-ref]').forEach((link) => {
    const target = document.getElementById(link.dataset.ref);
    if (!target) {
      console.warn(
        `근거 링크의 목적지 #${link.dataset.ref} 가 없습니다. skills.yml 의 ref 와 career/*.md 의 "## 제목 {#항목-id}" 를 맞춰 주세요.`,
      );
      link.removeAttribute('href');
      link.classList.add('pf-ref--static');
      return;
    }
    const title = target.querySelector('.pf-detail__title')?.textContent.trim();
    const career = target.closest('section.wrapper')?.querySelector('h2')?.textContent.trim();
    if (!title) return;
    link.title = title;
    link.setAttribute('aria-label', `${link.textContent.trim()}, ${career ? `${career} ` : ''}경력 상세: ${title}`);
  });
}

// 연락처 '복사' 버튼: 주소를 클립보드에 넣고 잠깐 '복사됨' 으로 바꿉니다.
// 클립보드를 쓸 수 없는 환경(파일로 연 페이지 등)에서는 주소 글자를 선택해 두어 Ctrl+C 로 복사하게 합니다.
async function copyContact(button) {
  const item = button.closest('li');
  const status = item?.querySelector('[role="status"]');
  let label = '복사됨';
  let message = '주소를 복사했습니다.';
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
  } catch {
    const value = item?.querySelector('.pf-contact__value');
    if (!value) return;
    const range = document.createRange();
    range.selectNodeContents(value);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    label = '선택됨';
    message = '주소를 선택했습니다. Ctrl+C 로 복사하세요.';
  }
  button.textContent = label;
  button.classList.add('is-done');
  if (status) status.textContent = message;
  window.clearTimeout(button._pfCopyTimer);
  button._pfCopyTimer = window.setTimeout(() => {
    button.textContent = '복사';
    button.classList.remove('is-done');
    if (status) status.textContent = '';
  }, FLASH_MS);
}

function onClick(event) {
  const copy = event.target.closest('.pf-contact__copy');
  if (copy) {
    copyContact(copy);
    return;
  }

  const toggle = event.target.closest('.pf-detail__toggle');
  if (toggle) {
    const detail = toggle.closest('.pf-detail');
    const expand = toggle.getAttribute('aria-expanded') !== 'true';
    setExpanded(detail, expand);
    if (expand && event.detail > 0) revealContent(detail);
    syncToggleAll(detail.parentElement);
    return;
  }

  const toggleAll = event.target.closest('[data-toggle-all]');
  if (toggleAll) {
    const list = document.getElementById(toggleAll.getAttribute('aria-controls'));
    if (!list) return;
    const expand = toggleAll.dataset.state !== 'open';
    list.querySelectorAll(':scope > .pf-detail').forEach((detail) => setExpanded(detail, expand));
    syncToggleAll(list);
    return;
  }

  const link = event.target.closest('a[href^="#"]');
  if (!link || link.classList.contains('scrolly') || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = targetFromHash(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  goTo(target, { smooth: true, moveFocus: true });
  if (location.hash !== link.getAttribute('href')) history.pushState(null, '', link.getAttribute('href'));
}

// Ctrl+F 로 접힌 항목 안의 글자를 찾으면 브라우저가 hidden 을 풀어 줍니다. 버튼 상태만 맞춥니다.
function onBeforeMatch(event) {
  const detail = event.target.closest?.('.pf-detail');
  if (!detail) return;
  const { toggle } = parts(detail);
  toggle?.setAttribute('aria-expanded', 'true');
  detail.classList.add('is-open');
  syncToggleAll(detail.parentElement);
}

// 주소 끝에 #slide 를 붙인 이미지(markdown.js)는 화면에 들어올 때 왼쪽에서 오른쪽으로 미끄러져 들어옵니다.
// 접히거나 화면 밖으로 완전히 나가면 처음 자리로 돌아가서, 다시 볼 때 한 번 더 움직입니다.
let slideObserver = null;

function watchSlides(root) {
  const items = [...root.querySelectorAll('.pf-media--slide')];
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-shown'));
    return;
  }
  slideObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.6) entry.target.classList.add('is-shown');
        else if (!entry.isIntersecting) entry.target.classList.remove('is-shown');
      }
    },
    { threshold: [0, 0.6] },
  );
  // 이미지가 늦게 불러와지면(loading="lazy") 크기가 0 인 채로 먼저 '보임' 판정이 나므로, 불러온 뒤에 지켜봅니다.
  items.forEach((item) => {
    const image = item.querySelector('img');
    if (!image || image.complete) slideObserver.observe(item);
    else {
      image.addEventListener('load', () => slideObserver.observe(item), { once: true });
      image.addEventListener('error', () => item.classList.add('is-shown'), { once: true });
    }
  });
}

let bound = false;

export function enhance(root) {
  labelRefs(root);
  watchSlides(root);
  root.querySelectorAll('.pf-details__list').forEach(syncToggleAll);

  if (bound) return;
  bound = true;
  document.addEventListener('click', onClick);
  document.addEventListener('beforematch', onBeforeMatch, true);
  window.addEventListener('popstate', () => {
    const target = targetFromHash(location.hash);
    if (target) goTo(target, { smooth: true, moveFocus: false });
  });
}

// 주소에 #항목 이 붙은 채로 들어온 경우. 템플릿 인터랙션이 붙은 뒤(portfolio:rendered 다음)에 부릅니다.
export function openInitialHash() {
  const target = targetFromHash(location.hash);
  if (target) goTo(target, { smooth: false, moveFocus: false });
}
