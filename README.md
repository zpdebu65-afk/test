# 쿵쿵나리TV · 경매 낙찰 후 대출 유튜브 대본

경매 낙찰 후 경락잔금대출을 받는 방법을 무주택자와 다주택자로 나눠 정리한 유튜브 대본 웹페이지입니다.
외부 패키지 없이 Node.js 기본 모듈만으로 정적 페이지를 서빙합니다.

## 구조

```
public/index.html   대본 페이지 (/)
                    (특강 신청서는 대본 페이지 맨 아래 #apply, /apply는 그쪽으로 이동)
server.js           페이지 서버 + 신청 저장 API + 관리자 명단
package.json        npm start 스크립트
railway.json        Railway 배포 설정
```

## 로컬 실행

```bash
npm start
```

브라우저에서 http://localhost:3000 (대본), http://localhost:3000/#apply (맨 아래 신청서)를 엽니다.

## Railway 배포

1. https://railway.com 에서 **New Project → Deploy from GitHub repo** 를 선택합니다.
2. 이 저장소와 브랜치를 고릅니다.
3. 배포가 끝나면 서비스의 **Settings → Networking → Generate Domain** 으로 공개 주소를 만듭니다.

Railway가 `PORT` 환경변수를 자동으로 넣어 주므로 따로 설정할 것은 없습니다.

## 특강 신청서

- 신청 주소: `https://<배포 도메인>/#apply` (예전 주소 `/apply`도 자동으로 이동)
- 신청자 명단: `https://<배포 도메인>/admin` (아이디는 아무거나, 비밀번호는 `ADMIN_PASSWORD`)
- 엑셀 다운로드: 명단 화면의 **엑셀(CSV)로 받기** 버튼
- 같은 휴대폰 번호로는 한 번만 신청할 수 있습니다.
- 명단의 각 줄에서 **삭제 → 삭제 확인**으로 신청 1건을 지울 수 있습니다.
- 명단 맨 아래 **신청 내역 전부 삭제**에서 `전체 삭제`와 관리자 비밀번호를 다시 입력하면 전부 지워집니다.
  지운 내용은 `DATA_DIR` 안에 `applications.deleted-<시각>.json` 백업 파일로 남습니다.
- 비밀번호는 코드에 없고 `ADMIN_PASSWORD` 환경변수에서만 읽으며, 모든 확인은 서버에서 합니다.

### Railway 변수 설정 (서비스 → Variables)

| 변수 | 필수 | 설명 |
|---|---|---|
| `ADMIN_PASSWORD` | 예 | 신청자 명단 비밀번호. 없으면 명단 페이지가 꺼집니다. |
| `DATA_DIR` | 예 | 신청 데이터를 저장할 폴더. 볼륨 경로와 같게 `/data` 로 설정 |
| `CAPACITY` | 아니오 | 정원. 기본값 25명이며 정원이 차는 순간 마감됩니다. `0`이면 제한 없음. |

### 신청 데이터가 사라지지 않게 볼륨 연결

Railway는 재배포할 때 서버 파일을 새로 만듭니다. 볼륨을 붙이지 않으면 신청 내역이 지워집니다.

1. 서비스를 우클릭(또는 Command Palette)해서 **Attach Volume** 을 고릅니다.
2. Mount path 를 `/data` 로 정합니다.
3. Variables 에 `DATA_DIR=/data` 를 넣습니다.
