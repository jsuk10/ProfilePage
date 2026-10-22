---
# 경력 섹션 하나 = 이 파일 하나입니다.
# --- 사이(앞부분)는 요약 정보, 아래 본문은 '경력 상세' 펼침 목록이 됩니다.

company: Nexon Korea (클라이언트 기술 파트)
title: 프라시아 전기
title_url: https://wp.nexon.com/main
period: 2021.11 ~ 2025.09
duration: 출시 전 1년 + 라이브 3년 (2023.03.30 출시)
engine: Unreal Engine 4.27 (Windows / iOS / Android)
role: >-
  Unreal Engine 엔진·툴 개발, 퍼포먼스 최적화, 플러그인/빌드 시스템 운영, 자동화 (P2)

image: images/warofprasia.jpg
image_alt: 프라시아 전기 대표 이미지

summary: >-
  '프라시아 전기' **출시 전(`2021.11`)부터 출시(`2023.03`) 후 `2025.09`까지** 라이브 서비스 전 주기 담당.
  **퍼포먼스, 품질 관측, CI/CD, 개발 편의성 툴 제작** 등 수행

highlights:
  - title: 퍼포먼스
    text: |-
      심리스 구간 히치 감소·프레임 안정화
      - UE 4.27 **셰이더 캐시 자동 수집 / 배포**
      - **Animation Budget Allocator** 기준 수립과 튜닝
  - title: 품질 관측 / 플러그인 관리
    text: |-
      **Backtrace** 도입·전 플랫폼 표준화
      - 심볼 태깅, 일간 리포트, ANR / OOM 지표로 원인 파악 시간 단축
      - **SDK 소스(GitHub) 분석으로 네이티브 에러 핸들링 보강**
      - Wwise, Vivox 유지보수
  - title: CI/CD / 정책 대응
    text: |-
      빌드 검증·스토어 정책 대응 자동화
      - **Jenkins / Perforce 검증 자동화**
      - **빌드 실패 알림**: 담당자 알림, 바이너리 변경은 최근 수정자 멘션
      - **iOS / Android 스토어 정책 대응**
  - title: 개발 편의성 개선
    text: |-
      비개발 직군의 자체 문제 파악·해결 지원
      - 에디터 툴 제작·지원
      - **NeverCook 시각화**와 에디터 확장

stack:
  - group: Engine / Editor
    items:
      - Unreal Engine 4.27
      - Slate
      - Asset Registry
      - Localization
      - FExtender
      - ABA
      - Unreal Session Frontend
  - group: 언어 / 스크립트
    items:
      - C++
      - Python
  - group: 플러그인 / 솔루션
    items:
      - Backtrace
      - Wwise
      - Vivox
  - group: 빌드 / 플랫폼
    items:
      - Jenkins
      - Perforce
      - Android Studio
      - Xcode / 앱스토어 정책
  - group: 운영 / 협업
    items:
      - Confluence
      - Git
      - Teams 자동화 (Power Automate)

rnd_note: R&D 는 이슈 대응이 아닌, 자체 R&D 후 기획에 역제안해 개발한 항목

links:
  - label: 게임 사이트
    url: https://wp.nexon.com/main
  - label: Notion 상세
    url: https://app.notion.com/p/Nexon-255bed59c3638157bbc4cdf8cd119e1d
---

## 엔진·퍼포먼스 최적화 {#performance}

- Unreal Session Frontend 기반 **히치 구간 계측·원인 분석 문서화**, 모바일 **PSO 캐시** 테스트·도입으로 심리스 구간 끊김 완화
- [**Animation Budget Allocator**](https://dev.epicgames.com/documentation/ko-kr/unreal-engine/animation-budget-allocator-in-unreal-engine) **기준 수립·튜닝**으로 화면 기여도 기반 계산 최적화
- **투구 On/Off 메시 단일화**: 투구 쓴 버전·벗은 버전 SkeletalMesh 두 벌 관리 → **Vertex Color 에 썼을 때 / 벗었을 때 정보를 담아 메시 하나**로 두 상태 표현
  - 몸체 메시 2벌 → 1벌, 얼굴(수염)·머리카락 메시도 2벌 → 1벌로 관리
  - 에셋 수 감소로 **런타임 메모리 절감**, 중복 관리 제거로 **에셋 관리 비용 절감**
  - 이어서 **투구 시스템 폴리싱**(후드 On/Off, 파츠 관통 방지)
- **Shader Cache**: 패치 타입별 정책 수립·문서화, 패키지 타임 생성 캐시 파일 **자동 배포 파이프라인**으로 배포 일관성·리드타임 개선
- **렌더링 지표 자동 측정 툴**: 웨이포인트 순회, 노드별 DP(DrawCall, Primitive)를 미니맵에 색으로 시각화, 프로파일 데이터·최적화 가이드라인 주기적 제공

## 품질/크래시 관측 플러그인 (Backtrace) {#backtrace}

기존 **Firebase Crashlytics → Backtrace 이전**부터 유지보수까지 담당. 크래시 추적 간소화, 자동화로 대응 속도 향상

- **SDK 소스 분석과 네이티브 에러 핸들링**
  문제 발생 시 Backtrace GitHub 저장소 소스를 직접 읽고 문제 지점·수정 방법 분석, **네이티브 환경에서도 잘 동작하도록 에러 핸들링** 보강
- **수집 자동화**
  AOS / iOS / Windows 전반에 **심볼 자동 업로드와 태깅**, **일간 리포트** 적용, 플랫폼별 크래시를 한곳에서 확인
- **ANR / OOM**
  ANR, OOM 수집 이슈 추적, **Attribute 누락과 끊김 보정** 체계화. iOS OOM 지표·리포트 자동화
- **운영**
  Jira 연동 검토, 용량 관리 담당. 플랫폼별 Backtrace 이슈 모니터링·버전별 대응

## 플러그인 (오디오/음성) {#audio-plugins}

- 초기 도입을 제외한 **유지보수 전담**
- **Vivox**: 블루투스 권한 팝업·권한 요청 플로우 정비, 세션/크래시 대응
- **Wwise**: 미재생 이슈 대응, **재생 상태 가시화 로그 체계** 구축, AudioUnit 초기화/Starvation 로그 분석

## 에디터/툴링·데이터 파이프라인 (R&D) {#editor-tooling}

- **NeverCook 비주얼 툴** 고도화(아이콘·필터·Dev 예외/경고), **블랙리스트 수기 업데이트 자동화 툴** 제작. [데모 보기](#prasia-lab--nevercook)
- **Excel Import/Export 단독 실행 스크립트**, 에러 핸들링·메시지 보강, **중복 메시지/정렬/예외 처리 개선**, DataValidate 강화
- **Unreal Slate·Python 확장 유틸**: Config Sheet Import All, CuidForClient.csv 뷰어, Text CUID 추적, 파티클 레퍼런싱 검증, Missing Bone 검사, Sector 문자열 일괄 수정 등
- **보안/암호화**: UAsset/Text 이중 암호화와 개별·전량 해제 기능, DataDecrypt 개선, 텍스트 암호화 키 정기 갱신 알림 운영

## 시네마틱/시퀀서·UI/UX {#cinematic}

- **시네마 레벨 활성화 시스템(고정시간 이벤트)**, **시퀀스 스킵 정책(최초 1회/지연/스킵 버튼 활성화)**, **연출 중 UI 자연 종료**, AspectRatioAxisConstraint(화면비율) 옵션화
- CinematicActor/TriggerVolume/Skip 위젯/PlayLevelSequence **리팩토링 및 관련 크래시 해결**
- **시퀀스 재생 중 Entity 가림 로직**, 로그인 시퀀스 카메라·월드 로딩 이슈 폴리싱

## CI/CD·빌드 자동화 (R&D) {#ci-cd}

- **Jenkins**: 스트림별 **교차 빌드**, **빌드 번호/패키지 타입 검증 유틸**, 권한 부재 시 대응용 Jenkins Job, 스크립트 기반 **심볼 자동 백업**
- **Iterative 쿠킹 검증**, 검증 로그 표준화
- **알림 자동화 (Power Automate)**: 빌드 실패 / 서버 검증 오류 / 용량 부족 Teams 알림. 빌드 실패는 담당자에게 전달, 코드가 아닌 바이너리(에셋) 변경이 원인이면 Perforce 수정 내역으로 **최근 수정자 멘션** → 이터레이션 감소
- **Python EXE 유틸**: 엑셀 기반 데이터 탐색 자동화, 실행 경로 기반 **Perforce Workspace 자동 세팅**, 에셋 경로 기반 **최근 히스토리/CL 추적**
- **Windows**: WinDist/Windows Binary Only 배포, PC 디버깅 환경 구축·문서화, Dev 로그 개선

## 모바일 플랫폼 대응 {#mobile}

- **iOS**: Privacy Manifest 적용, **프로비저닝 자동 갱신/만료 알림**, Device Profile, **Memory Budget** 측정 및 관리
- **Android**: exitinfo 를 활용한 **OOM 사후 관리**와 버짓 조절로 OOM 크래시 완화, Backtrace 전용 코드 개발·적용
- 모바일 **텍스처 해상도 품질 저하** 원인 분석, **TextureGroup MaxLODSize 반영 문제** 수정
- **모바일 디버깅 환경 구축**: Android Studio 디버깅 문서화

## 윈도우 트레이 알림 + 풍선 메시지 (R&D) {#tray-notify}

게임 창을 숨겨도 중요한 이벤트를 놓치지 않도록 Win API `Shell_NotifyIcon` 으로 **트레이 아이콘**과 **풍선 메시지** 구현

- 트레이 아이콘 메뉴 **Show Game / Hide Game / Exit** 로 게임 창 표시·숨김·종료
- 풍선 메시지는 Windows 기본 알림 → OS 알림과 같은 모양으로 화면 오른쪽 아래에 표시. 예: 파티 초대
- 풍선 메시지 클릭 시(`NIN_BALLOONUSERCLICK`) 숨긴 게임 창 복원·**포그라운드 전환**
- 이 경험을 Like Or Die 의 [게임 전용 Slate 배너](#like-or-die--background-notify)로 발전
- 데모: [Prasia Lab 의 트레이 알림](#prasia-lab--tray)에서 풍선 메시지·트레이 메뉴 직접 눌러 보기
