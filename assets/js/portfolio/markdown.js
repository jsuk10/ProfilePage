// Markdown → HTML 변환.
// 콘텐츠 파일의 본문(.md)과 문장 안 표기(**굵게**, [링크](주소), `코드`)를 처리합니다.

import { Marked } from '../vendor/marked.esm.js';

// ~~두 개~~ 로 감쌀 때만 취소선입니다. "2021.11~현재" 같은 기간 표기의 ~ 는 글자 그대로 둡니다.
const STRIKETHROUGH = /^~~(?=\S)([\s\S]*?\S)~~(?!~)/;
const NEW_TAB = /^https?:\/\/|\.pdf(?:[?#]|$)/i;
// 이미지 주소 끝의 효과 표시 (움직임은 interactions.js)
//   #slide  화면에 들어올 때 왼쪽에서 오른쪽으로 미끄러져 들어옵니다.
//   #toast  모니터 모양 상자의 오른쪽 아래, 보이지 않는 곳에서 알림처럼 들어오고 다시 재생 버튼이 붙습니다.
const EFFECT = /#(slide|toast)$/i;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 링크 주소를 정리합니다. 스크립트 주소는 막고, 한글 경로는 인코딩합니다.
export function safeUrl(href) {
  const url = String(href ?? '').trim();
  if (!url || /^(?:javascript|vbscript|data):/i.test(url)) return null;
  try {
    return encodeURI(url).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// <a> 의 href / target / rel 속성. 외부 주소와 PDF 는 새 탭으로 엽니다.
export function linkAttrs(href) {
  const url = safeUrl(href);
  if (url === null) return '';
  const newTab = NEW_TAB.test(url) ? ' target="_blank" rel="noopener"' : '';
  return `href="${escapeAttr(url)}"${newTab}`;
}

// breaks: 글 안에서 엔터 한 번은 화면에서도 줄바꿈입니다. 빈 줄은 문단을 나눕니다.
const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  tokenizer: {
    del(src) {
      const match = STRIKETHROUGH.exec(src);
      // false 가 아니라 undefined 를 돌려줘야 기본 규칙(~ 한 개도 취소선)으로 넘어가지 않습니다.
      if (!match) return undefined;
      return { type: 'del', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    },
  },
  renderer: {
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const attrs = linkAttrs(href);
      if (!attrs) return label;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      return `<a ${attrs}${titleAttr}>${label}</a>`;
    },
    // ![대체 글](경로 "설명") 의 "설명" 은 이미지 아래 작은 글씨로 나옵니다.
    image({ href, title, text, tokens }) {
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      const effect = EFFECT.exec(String(href ?? ''))?.[1].toLowerCase() ?? '';
      const url = safeUrl(String(href ?? '').replace(EFFECT, ''));
      if (url === null) return escapeHtml(alt);
      const img = `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`;
      if (!effect && !title) return img;
      const caption = title ? `<span class="pf-media__caption">${escapeHtml(title)}</span>` : '';
      if (effect === 'toast') {
        const replay = '<button type="button" class="pf-button pf-media__replay" data-replay>다시 재생</button>';
        return `<span class="pf-media pf-media--toast"><span class="pf-screen">${img}</span><span class="pf-media__foot">${caption}${replay}</span></span>`;
      }
      const media = effect === 'slide' ? `<span class="pf-media__frame">${img}</span>` : img;
      return `<span class="pf-media${effect === 'slide' ? ' pf-media--slide' : ''}">${media}${caption}</span>`;
    },
    // `코드` 안의 긴 이름은 ::, ., ( 뒤에서 줄을 바꿀 수 있게 합니다. 좁은 화면에서 글자 중간이 잘리지 않습니다.
    codespan({ text }) {
      return `<code>${escapeHtml(text).replace(/(::|\.|\()/g, '$1<wbr>')}</code>`;
    },
    // 경력 상세 항목 제목(<h4>) 아래에서 쓰는 작은 제목입니다. ### 가 <h5> 가 되도록 두 단계 내립니다.
    heading({ tokens, depth }) {
      const level = Math.min(6, depth + 2);
      return `<h${level} class="pf-subhead">${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
  },
});

// 표는 좁은 화면에서 옆으로 밀어 볼 수 있게 감쌉니다.
const wrapTables = (html) => html.replace(/<table>/g, '<div class="pf-table"><table>').replace(/<\/table>/g, '</table></div>');

// 문단 단위 Markdown (본문, 여러 줄 설명)
export function markdown(source) {
  return wrapTables(marked.parse(String(source ?? '')));
}

// 한 줄 Markdown (제목, 표 칸, 짧은 설명). <p> 로 감싸지 않습니다.
export function inline(source) {
  return marked.parseInline(String(source ?? ''));
}
