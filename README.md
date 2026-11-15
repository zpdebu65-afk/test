# 경매 낙찰 후 대출 유튜브 대본

경매 낙찰 후 경락잔금대출을 받는 방법을 무주택자와 다주택자로 나눠 정리한 유튜브 대본 웹페이지입니다.
외부 패키지 없이 Node.js 기본 모듈만으로 정적 페이지를 서빙합니다.

## 구조

```
public/index.html   대본 페이지
server.js           정적 파일 서버 (PORT 환경변수 사용, /health 헬스체크)
package.json        npm start 스크립트
railway.json        Railway 배포 설정
```

## 로컬 실행

```bash
npm start
```

브라우저에서 http://localhost:3000 을 엽니다.

## Railway 배포

1. https://railway.com 에서 **New Project → Deploy from GitHub repo** 를 선택합니다.
2. 이 저장소와 브랜치를 고릅니다.
3. 배포가 끝나면 서비스의 **Settings → Networking → Generate Domain** 으로 공개 주소를 만듭니다.

Railway가 `PORT` 환경변수를 자동으로 넣어 주므로 따로 설정할 것은 없습니다.
