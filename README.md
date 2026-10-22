## 이정석의 포토폴리오 사이트
https://jsuk10.github.io/ProfilePage/


- 본 페이지는 notion을 기반으로 제작되었기 때문에 본 페이지 보다 notion으로 보는게 더 깔끔합니다.
- 본 페이지는 회사의 보안 문제 때문에 notion이 열리지 않을 경우 대용으로 사용할때 쓰기 위해 제작 했습니다.

- 본 페이지는 해당 사이트에서 템플릿을 활용하여 제작 했습니다 (https://html5up.net/hyperspace)

### 내용 고치기

화면에 나오는 글은 모두 `content/` 폴더의 `.yml`, `.md` 파일에 있습니다. `index.html` 은 뼈대라서 불러오는 동안 보이는 명함(`pf-splash` 블록) 말고는 고칠 일이 없습니다.
고치는 방법은 [content/README.md](content/README.md) 에 정리했습니다.

- 미리 보기: VS Code 의 Live Server 로 `index.html` 을 엽니다. (파일을 더블클릭해서 열면 내용을 읽지 못합니다)
- 올리기: 빌드 과정 없이 push 하면 GitHub Pages 에 그대로 반영됩니다.

### 데모 하나만 끼워 넣기

`index.html?embed=데모id` 로 열면 메뉴, 명함, 섹션 설명 없이 그 데모 하나만 보입니다. 노션의 임베드 블록에 이 주소를 넣으면 됩니다.

- 공간음향: `?embed=spatial-audio`
- 툴 데모: `?embed=섹션id--kind` 예) `prasia-lab--nevercook`, `prasia-lab--tray`, `prasia-lab--minimap`, `like-or-die-lab--notify`

### 한국어 / 영어

오른쪽 위 KO / EN 토글로 언어를 바꿉니다. 처음 열면 시스템(브라우저) 언어가 한국어일 때 한국어, 아니면 영어로 보입니다.
주소에 `?lang=ko` 나 `?lang=en` 을 붙이면 그 언어로 고정됩니다. (끼워 넣는 데모도 `?embed=spatial-audio&lang=en`)

- 영어 글은 `content/en/` 에 한국어판과 같은 파일 이름, 같은 키 구조로 둡니다.
- JS 안에 적힌 버튼·제목 글은 `t('한국어', 'English')` 로 함께 적습니다. (`assets/js/portfolio/i18n.js`)

### 사용한 라이브러리

- [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), [marked](https://github.com/markedjs/marked) 17.0.6 (MIT): `assets/js/vendor/`
- [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1): jsDelivr CDN

- was modified by Lee Jeong Seok
- ref : https://html5up.net/hyperspace
- License : Ref/License.txt && Ref/ReadMe.txt
