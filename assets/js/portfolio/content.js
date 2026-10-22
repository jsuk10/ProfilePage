// content/ 폴더의 파일을 읽어 JS 객체로 바꿉니다.
//   .yml  → 객체
//   .md   → 앞부분(--- 사이 YAML)의 값 + body(본문 Markdown)
// 영어 화면이면 같은 이름의 파일을 content/en/ 에서 읽습니다. (i18n.js)

import { load, FAILSAFE_SCHEMA, YAMLException } from '../vendor/js-yaml.esm.min.js';
import { EN } from './i18n.js';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export class ContentError extends Error {
  constructor(file, detail) {
    super(`content/${file}: ${detail}`);
    this.name = 'ContentError';
    this.file = file;
    this.detail = detail;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 모든 값을 글자 그대로 읽습니다. (FAILSAFE 스키마)
// 그래서 19.0 은 "19.0", 2020.10 은 "2020.10" 으로 남고, 숫자로 바뀌며 0 이 사라지지 않습니다.
function parseYaml(file, source, lineOffset = 0) {
  try {
    return load(source, { schema: FAILSAFE_SCHEMA, filename: file }) ?? {};
  } catch (error) {
    if (error instanceof YAMLException && error.mark) {
      throw new ContentError(file, `${error.mark.line + 1 + lineOffset}번째 줄, ${error.reason}`);
    }
    throw new ContentError(file, error.message);
  }
}

function parseMarkdown(file, source) {
  const match = FRONT_MATTER.exec(source);
  if (!match) return { body: source };

  // 앞부분 YAML 은 파일 2번째 줄부터 시작하므로 오류 줄 번호에 1을 더합니다.
  const data = parseYaml(file, match[1], 1);
  if (!isPlainObject(data)) {
    throw new ContentError(file, '--- 사이에는 "이름: 값" 형식의 줄만 쓸 수 있습니다.');
  }
  return { ...data, body: source.slice(match[0].length) };
}

export async function loadContent(file) {
  let response;
  try {
    response = await fetch(`content/${EN ? 'en/' : ''}${file}`, { cache: 'no-cache' });
  } catch {
    throw new ContentError(
      file,
      '파일을 불러오지 못했습니다. 컴퓨터에서 볼 때는 index.html 을 직접 열지 말고 VS Code Live Server 같은 로컬 서버로 열어 주세요.',
    );
  }
  if (!response.ok) {
    throw new ContentError(file, `파일을 찾을 수 없습니다. 경로를 확인해 주세요. (HTTP ${response.status})`);
  }

  const source = (await response.text()).replace(/^﻿/, '');
  return /\.md$/i.test(file) ? parseMarkdown(file, source) : parseYaml(file, source);
}
