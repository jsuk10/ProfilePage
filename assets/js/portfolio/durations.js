// 경력 기간 자동 계산
//   내용 파일 글 안에 {total} 이나 {경력 섹션 id} 를 쓰면, 경력 섹션(type: career) 의 period 로
//   계산한 기간으로 바뀝니다. 오늘 날짜 기준이라 해가 바뀌어도 고칠 필요가 없습니다.
//     {total}        모든 경력 섹션 기간의 합   예) 4년 11개월
//     {like-or-die}  그 섹션 하나의 기간        예) 1년
//   .md 파일 본문은 코드 예시가 들어갈 수 있어 그대로 두고, 앞부분(--- 사이) 값만 바꿉니다.

// "2021.11 ~ 2025.09" 는 시작 달과 끝 달을 모두 세어 47개월,
// "2025.10 ~ 현재" 는 지난달까지 셉니다. (오늘이 2026.10 이면 12개월)
const PERIOD = /^(\d{4})\.(\d{1,2})\s*~\s*(?:(\d{4})\.(\d{1,2})|현재|재직\s*중)$/;
const SLOT = /\{([a-z0-9][a-z0-9-]*)\}/g;

export function periodMonths(period, today = new Date()) {
  const match = PERIOD.exec(String(period ?? '').trim());
  if (!match) return null;
  const start = Number(match[1]) * 12 + Number(match[2]) - 1;
  const end = match[3] ? Number(match[3]) * 12 + Number(match[4]) : today.getFullYear() * 12 + today.getMonth();
  return Math.max(0, end - start);
}

export function formatMonths(months) {
  if (months < 1) return '1개월 미만';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  // 줄이 바뀌어도 "4년 11개월" 이 둘로 갈리지 않게 붙는 공백(U+00A0)으로 잇습니다.
  return [years && `${years}년`, rest && `${rest}개월`].filter(Boolean).join(' ');
}

// sections: [{ id, type, source, data }] → Map(경력 섹션 id 와 'total' → 개월 수)
export function careerDurations(sections, today = new Date()) {
  const durations = new Map();
  let total = 0;
  for (const section of sections) {
    if (section.type !== 'career' || !section.data) continue;
    const months = periodMonths(section.data.period, today);
    if (months == null) {
      console.warn(
        `content/${section.source}: period "${section.data.period ?? ''}" 를 읽지 못해 기간 계산에서 뺐습니다. ` +
          '"2021.11 ~ 2025.09" 나 "2025.10 ~ 현재" 처럼 적어 주세요.',
      );
      continue;
    }
    durations.set(section.id, months);
    total += months;
  }
  if (durations.size) durations.set('total', total);
  return durations;
}

// 내용 안의 글에서 {자리} 를 기간으로 바꾼 사본을 돌려줍니다. (.md 본문 body 는 제외)
export function fillDurations(value, durations, file, key = '') {
  if (typeof value === 'string') {
    if (key === 'body' || !value.includes('{')) return value;
    return value.replace(SLOT, (slot, name) => {
      if (durations.has(name)) return formatMonths(durations.get(name));
      console.warn(`content/${file}: ${slot} 에 맞는 경력 섹션이 없습니다. {total} 이나 content/site.yml 에 적은 경력 섹션 id 를 써 주세요.`);
      return slot;
    });
  }
  if (Array.isArray(value)) return value.map((item) => fillDurations(item, durations, file));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fillDurations(item, durations, file, name)]));
  }
  return value;
}
