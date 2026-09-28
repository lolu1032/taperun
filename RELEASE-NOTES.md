# Release Notes

## 2026-09-28: Reports you can read at a glance, one browser for many scenarios

Changes that came out of running a real web app's issue QA (13 items) through taperun.

### Run
- **Several scenarios in one browser.** `run.mjs a.json b.json c.json [--headed]` launches Chrome once and runs the scenarios one after another **in a single page**.
  - It opens no new tab either. In headed Chrome a new tab opens as a new window, and macOS brings Chrome to the front every time, taking focus.
  - Video is recorded per scenario with `page.screencast`.
  - Between scenarios the page goes to a blank page, then cookies and the storage of every origin visited (localStorage, IndexedDB, sessionStorage) are cleared. Each scenario starts as if on a new profile.
  - webkit, firefox and `profile: shared` scenarios still get their own browser, even when mixed into the batch.
- **`expect.hidden`.** The step passes when the selector is not visible, for checking that something should be absent. A `visible` check must come first to confirm the screen has loaded, otherwise the step passes without testing anything.
- **Diagnosis of failed steps.** When a step fails, `result.json` gets `diag`:
  - The state of the target element: missing, hidden, disabled, or visible but covered.
  - Warning text on screen: `role=alert` or red text.
  - Example: `대상 요소가 비활성(disabled)` + «만들 수 있는 워크스페이스를 모두 사용했어요 (3/3)».
- **Symlink paths now run.** When the skill folder was a symlink (`~/.claude/skills/taperun`), `run.mjs` exited silently without running. It now compares real paths.

### Scenario fields (optional)
- `title`: shown as one line under the scenario name in the list and in the report.
- `issue: { id, url, title, check, criteria, note }`: the «이슈» card in the detail report.
  - It records what the run checks and what counts as a pass.
  - `note` records what this scenario does **not** cover.

### Report
- **The list (index.html) is one table.** One row per scenario, failures on top, the rest sorted by name.
  - Each row has the failure reason and diagnosis on one line.
  - History is up to 8 dots, and clicking a dot opens that run's report.
- **Videos open in an overlay.** Clicking «영상» opens a player on the same page. Esc, clicking outside or ✕ closes it. ⌘-click opens a new tab as before.
- The detail report shows `title` next to the heading, the «이슈» card under the summary, and the failure diagnosis on the failure card.

### Tests
- 18 pass.
- New: the session test. One page is reused, cookies, localStorage and sessionStorage don't leak into the next scenario, and each scenario gets its own video.
- Updated: two index tests changed to the table layout, where history is shown as dots.
