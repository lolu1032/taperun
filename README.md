# taperun

**"OO 기능 e2e 해줘" → 크롬이 돌리고, 영상으로 찍고, 리포트를 준다.** run it, tape it.

Claude Code 스킬. 앱 레포에서 기능을 파악해 시나리오를 쓰고, 설치된 크롬으로 녹화하며 실행하고, 성공/실패와 실패 원인을 `report.html`로 남긴다. 원하면 그 시나리오를 Playwright 테스트코드로 뽑는다.

- 통과 판정은 LLM이 아니라 시나리오의 `expect` 단계가 낸다
- 마우스·키보드 포커스를 뺏지 않는다(CDP 주입). 헤드리스로 돌려도 영상에 가상 커서가 남는다
- 브라우저를 따로 받지 않는다. 설치된 크롬을 쓴다

## 설치

```bash
git clone https://github.com/lolu1032/taperun.git ~/.claude/skills/taperun
cd ~/.claude/skills/taperun && npm install
```

Claude Code에서: `로그인 기능 e2e 해줘`

## 흐름

1. **파악** — 기능이 지나가는 라우트·폼·버튼, 필요한 env/DB/계정을 읽어 `.taperun/e2e-map.md`에 남긴다
2. **시나리오** — `.taperun/scenarios/<name>.json` (goto / click / fill / expect)
3. **실행** — 크롬에서 녹화하며 실행. 첫 실패 단계에서 멈춘다
4. **보고** — `report.html`: 영상, 단계별 결과, 실패 스크린샷, 콘솔·네트워크 에러
5. **테스트코드** — 원하면 `*.spec.ts`로 변환

## 스크립트만 쓰기

```bash
node scripts/run.mjs examples/example-com.json            # 헤드리스
node scripts/run.mjs examples/example-com.json --headed   # 창 띄워서
node scripts/report.mjs .taperun/out/example-com-*/result.json
node scripts/emit-test.mjs examples/example-com.json > example.spec.ts
```

### scenario.json

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

| 단계 | 값 | 설명 |
|---|---|---|
| `goto` | 경로 또는 URL | `baseURL` 기준 |
| `click` | 셀렉터 | Playwright 셀렉터 |
| `fill` | `[셀렉터, 값]` | |
| `expect` | `{ url?, text?, visible? }` | `url`이 `/`로 시작하면 pathname 일치, 아니면 포함. 10초 대기 |

기본은 매번 새 프로필이다. 외부 로그인(카카오·네이버 등) 세션이 필요하면 `"profile": "shared"`를 넣는다. 전용 프로필 `~/.taperun/chrome`에 한 번 로그인해 두면 이후 재사용된다.

## 테스트

```bash
npm test   # 실제 크롬으로 실행·실패·커서, 리포트, 테스트코드 변환
```

## 라이선스

MIT
