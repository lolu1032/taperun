---
name: taperun
description: 웹 앱이나 데스크톱 앱(Tauri)의 한 기능을 E2E로 실제 브라우저 엔진에서 돌려보고, 영상으로 찍고, 성공/실패와 실패 원인을 HTML 리포트로 만든다. 레포에서 기능을 파악 → 시나리오(scenario.json) 작성 → 녹화하며 실행(가상 커서 포함, 사용자 마우스·키보드 포커스를 뺏지 않음) → report.html → 원하면 Playwright 테스트코드(*.spec.ts)로 변환. 통과 판정은 LLM이 아니라 시나리오의 expect 단계가 낸다. Triggers: "OO 기능 e2e 해줘", "로그인 흐름 돌려봐", "이 화면 실제로 되는지 확인해줘", "가입부터 끝까지 테스트해줘", "e2e 영상 찍어줘", "taperun", "데스크톱 앱 e2e", "타우리 앱 화면 확인해줘", "e2e test this feature", "run through the signup flow", "record an e2e run". 데스크톱은 앱의 dev 서버(웹뷰 화면)를 같은 계열 엔진으로 여는 것까지다 — 네이티브 셸 설치·딥링크·파일/DB 같은 실기기 동작, 단위 테스트, 부하 테스트, 모바일 네이티브 앱에는 쓰지 않는다.
---

# taperun

스킬 폴더(이 파일이 있는 곳)를 `<skill>`, 사용자의 앱 레포를 `<repo>`라고 부른다.
산출물은 전부 `<repo>/.taperun/` 아래에 둔다.

## 0. 준비 (처음 한 번)

- `<skill>/node_modules/playwright`가 없으면 `<skill>`에서 `npm install`
- 크롬이 설치돼 있어야 한다(`channel: "chrome"`). 브라우저를 따로 받지 않는다

## 1. 파악

`<repo>/.taperun/e2e-map.md`가 있으면 먼저 읽고, 요청한 기능과 관련된 부분만 `git diff`/코드로 다시 확인한다. 없으면 만든다:

- **실행**: dev 명령과 포트. 이미 떠 있으면 `curl`로 받은 HTML에 **소스 코드에 있는 문자열**이 들어있는지 확인한다. 그 포트에 다른 앱이 떠 있는 경우가 흔하다. 안 떠 있으면 비어 있는 포트로 백그라운드 실행한다
- **의존**: 필요한 env, DB, 시드. 첫 화면이 500이면 서버 로그부터 본다(env 빈 값, DB 권한 누락 등). 시나리오 전에 해결하거나, 못 하면 사용자에게 무엇이 필요한지 말하고 멈춘다
- **라우트·화면**: 요청한 기능이 지나가는 페이지, 폼 필드, 버튼, 성공 후 도착 화면
- **계정**: 로그인이 필요하면 어떤 방식인지(자체 폼 / 카카오·네이버·구글 OAuth / PASS)
- **함정**: 이번에 부딪힌 것을 한 줄씩 추가한다

## 2. 시나리오

`<repo>/.taperun/scenarios/<name>.json`:

```json
{
  "name": "signup",
  "baseURL": "http://localhost:3000",
  "steps": [
    { "goto": "/" },
    { "click": "text=시작하기" },
    { "expect": { "url": "/signup", "text": "회원가입" } },
    { "fill": ["[name=email]", "e2e@example.com"] },
    { "click": "button[type=submit]" },
    { "expect": { "url": "/", "text": "로그아웃" } }
  ]
}
```

| 단계 | 값 | 판정 |
|---|---|---|
| `goto` | 경로 또는 URL | |
| `click` | Playwright 셀렉터 | 10초 안에 클릭 가능해야 함 |
| `fill` | `[셀렉터, 값]` | |
| `select` | `[셀렉터, value]` | `<select>` 전용. `fill` 로는 안 바뀌고 option 클릭도 헤드리스에서 안 먹는다. 보이는 라벨이 아니라 **`value`** 를 준다 |
| `expect` | `{ url?, text?, visible? }` | `url`이 `/`로 시작하면 pathname 일치, 아니면 포함. 10초 대기 |

어느 단계든 `"timeout": <ms>` 를 같은 줄에 붙이면 그 단계만 더 기다린다(기본 10초).
AI 생성이나 렌더처럼 분 단위로 끝나는 것에만 쓴다 — 아무 데나 붙이면 실패가 늦게 드러난다.

```json
{ "expect": { "visible": "[aria-label='결과물'] video" }, "timeout": 900000 }
```

규칙:
- 셀렉터와 기대 문구는 **소스 코드에서 그대로** 가져온다. 추측하지 않는다
- 같은 텍스트가 두 곳 이상 있으면(헤더 버튼과 폼 버튼 등) `button[type=submit]`, `[name=...]`, `[placeholder='...']`처럼 구조로 잡는다
- 페이지 이동이나 제출 뒤에는 반드시 `expect`를 둔다. 마지막 단계는 항상 `expect`
- 다시 돌려도 통과하게 값을 정한다. 가입처럼 DB에 남는 흐름은 재실행 시 "이미 존재"가 되는지 코드로 확인한다
- 카카오·네이버 같은 외부 로그인이 필요하면 `"profile": "shared"`를 넣는다. 전용 프로필(`~/.taperun/chrome`)에 사용자가 한 번 로그인해 둬야 한다. 안 돼 있으면 `--headed`로 열어 사용자에게 직접 로그인해 달라고 한다. 비밀번호는 절대 시나리오에 쓰지 않는다

## 3. 실행

```bash
node <skill>/scripts/run.mjs <repo>/.taperun/scenarios/<name>.json --out <repo>/.taperun/out
```

- 기본은 헤드리스. 사용자가 보고 싶다고 하면 `--headed`
- 매번 새 프로필(쿠키 없음). `profile: shared`일 때만 전용 프로필
- 입력은 CDP로 페이지 안에 주입된다. OS 마우스·키보드를 쓰는 도구(AppleScript, cliclick, computer-use)는 쓰지 않는다
- exit 0 = PASS, 1 = FAIL. 결과는 `<out>/<name>-<time>/`에 `result.json`, `video.webm`, `report.html`, 실패 시 `fail-step-N.png`
- 실행이 끝나면 `report.html`과 `<out>/index.html`이 자동으로 갱신된다. 리포트 명령을 따로 돌릴 필요 없다

## 3-1. 데스크톱 앱(Tauri)

네이티브 셸은 열지 않는다. 앱이 띄우는 **웹뷰 화면**을 같은 계열 엔진으로 연다.

```json
{
  "engine": "webkit",
  "baseURL": "http://localhost:5174",
  "initScript": "../tauri-stub.js"
}
```

- `engine`: `chromium`(기본, 설치된 크롬) · `webkit` · `firefox`. **맥 Tauri = WKWebView 라서 `webkit`** 이 그 화면에 가장 가깝다. 윈도우(WebView2)는 `chromium`
- 처음 한 번 엔진을 받는다: `<skill>`에서 `npx playwright install webkit`. 안 받았으면 실행이 그 명령을 알려 주고 멈춘다
- **앱의 dev 서버를 띄워서 그 주소를 연다**(`apps/desktop` 의 vite 등). `tauri dev` 로 뜬 네이티브 창에는 붙지 않는다
- `initScript`: 페이지가 뜨기 전에 넣을 JS. 경로는 **시나리오 파일 기준**. Tauri 앱은 웹뷰가 심어 주는 전역(`__TAURI_INTERNALS__`)이 없으면 첫 줄에서 죽고 빈 화면만 나오므로 `<skill>/stubs/tauri.js` 를 레포로 복사해 쓴다
- **여기서 보이는 것은 화면과 흐름까지다.** invoke 는 전부 빈 값을 돌려준다 — 앱이 `plugin:http|fetch` 로 네트워크를 하면 서버 데이터가 안 온다. 파일·DB·창 제어·딥링크·다중창·자동업데이트처럼 네이티브가 답해야 하는 것은 **실기기 몫**이다. 그 명령이 필요하면 복사한 스텁에서 그 명령만 앱에 맞게 채운다

## 4. 보고

실행이 끝나면 리포트는 이미 만들어져 있다. 열기만 한다:

```bash
open <out>/<name>-<time>/report.html   # 이번 실행 상세 (macOS)
open <out>/index.html                  # 시나리오별 최신 상태 한 화면
```

시나리오가 여러 개면 `index.html`을 먼저 준다. 시나리오별 최신 실행이 한 줄씩, 실패한 줄은 실패 단계와 에러가 그 자리에 보이고, 같은 시나리오의 이전 실행은 접혀 있다.

예전 실행 폴더만 있고 리포트가 없을 때만 다시 만든다: `node <skill>/scripts/report.mjs <out>` (폴더를 주면 전부 다시 만들고 index도 갱신)

판정은 `result.json`의 `ok`다. 스크린샷이 괜찮아 보여도 `ok: false`면 FAIL이다.

FAIL이면 실패 단계의 `error`, 스크린샷(이미지로 열어서 본다), `console`(콘솔 에러, 4xx/5xx, 실패한 요청)을 보고 원인을 가른다:
- **시나리오 문제**(셀렉터가 틀림, 문구가 다름, 기다릴 게 더 있음): 시나리오를 고쳐 다시 돌린다. 최대 2번. 고친 사실을 보고에 적는다
- **앱 문제**(버튼이 안 눌림, 500, 이동 안 됨): 앱 코드는 고치지 않는다. 어느 단계에서, 무엇이 보였고, 무엇이 기대됐는지, 관련 소스 위치를 적는다. 고칠지는 사용자가 정한다

사용자에게는 PASS/FAIL, 실패 단계와 원인 한두 줄, `report.html` 경로를 준다. 영상은 리포트 안에 있다.

## 5. 테스트코드

마지막에 묻는다: **"이 시나리오를 테스트코드로 만들까요?"** 예라고 하면:

```bash
node <skill>/scripts/emit-test.mjs <repo>/.taperun/scenarios/<name>.json > <repo>/tests/e2e/<name>.spec.ts
```

- 레포에 이미 e2e 테스트 폴더가 있으면 그 위치와 관례를 따른다
- `@playwright/test`가 없으면 설치 명령(`npm i -D @playwright/test`)만 알려주고, 설치는 사용자가 허락하면 한다
- 생성된 테스트는 run.mjs와 같은 판정(10초 대기, 같은 url 규칙)을 쓴다

## 하지 않는 것

- 판정을 눈대중이나 LLM 판단으로 뒤집지 않는다
- 사용자 앱 코드를 묻지 않고 고치지 않는다
- `.taperun/out/`(영상·스크린샷)을 커밋하지 않는다. `.gitignore`에 없으면 추가하자고 제안한다
