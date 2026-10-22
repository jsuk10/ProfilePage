// 화면 언어 (ko / en)
// index.html 의 head 스크립트가 아래 순서로 언어를 정해 <html lang> 에 먼저 적어 두고, 여기서는 그 값을 읽습니다.
//   1. 주소의 ?lang=ko 또는 ?lang=en
//   2. 우상단 KO / EN 토글로 고른 값 (localStorage 'pf-lang')
//   3. 브라우저(시스템) 언어. 한국어면 ko, 아니면 en
// 영어일 때 내용 파일은 content/en/ 에서 읽고(content.js), JS 안의 글은 t('한국어', 'English') 로 고릅니다.

export const LANG = document.documentElement.lang === 'en' ? 'en' : 'ko';
export const EN = LANG === 'en';
export const t = (ko, en) => (EN ? en : ko);

const STORAGE_KEY = 'pf-lang';

// 토글을 누르면 고른 언어를 기억하고, 주소의 ?lang= 은 지운 채 같은 자리(#해시)로 다시 엽니다.
export function setLang(lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 저장소를 못 쓰는 창(시크릿 모드 등)에서는 주소에 ?lang= 을 남겨 고른 언어를 유지합니다.
    const url = new URL(window.location.href);
    url.searchParams.set('lang', lang);
    window.location.assign(url);
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('lang');
  // 주소가 그대로면 assign 은 해시 이동만 하고 끝나므로 새로 고칩니다.
  if (url.href === window.location.href) window.location.reload();
  else window.location.assign(url);
}

// index.html 의 #pf-lang 토글에 현재 언어를 표시하고 누르면 바꿉니다.
export function mountLangToggle() {
  const toggle = document.getElementById('pf-lang');
  if (!toggle) return;
  for (const link of toggle.querySelectorAll('a[data-lang]')) {
    const current = link.dataset.lang === LANG;
    if (current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (!current) setLang(link.dataset.lang);
    });
  }
}
