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

### 사용한 라이브러리

- [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), [marked](https://github.com/markedjs/marked) 17.0.6 (MIT): `assets/js/vendor/`
- [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1): jsDelivr CDN

- was modified by Lee Jeong Seok
- ref : https://html5up.net/hyperspace
- License : Ref/License.txt && Ref/ReadMe.txt
