# Similar Search Live Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the similar-cases panel's bare `Loading…` with an interactive, honest live timeline driven by real server progress events, with elapsed time and a history-based remaining-time range.

**Architecture:** The existing synchronous similar-case pipeline stays in place and gains progress callbacks (enrichment jobs, dossier loop, candidate channels, Spark scoring/validation). `GET /api/cases/[id]/similar?stream=1` emits those events as NDJSON ending in the current result payload; without `stream=1` it returns today's JSON. Stage timings are persisted (counts only, no case content) to a new `similar_search_runs` table and feed a pure estimator that returns a median–p90 remaining range only when enough clean samples exist.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, better-sqlite3, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-similar-search-progress-design.md`

## Global Constraints

- No simulated progress: a stage may only appear completed after a real server event; no percentage bar anywhere.
- Estimates are ranges, never a single exact number; hidden until at least 20 completed runs and at least 5 clean samples per remaining stage exist; never count down to a stuck `0` — past the high bound the UI shows the taking-longer warning.
- Progress events and persisted runs carry counts and fixed labels only: no person names, transcripts, summaries, quotes, case numbers, or case content.
- Existing behavior is preserved without `stream=1`: same JSON shape, same caching, same degraded fallbacks (enrichment/dossier/Spark failures never lose records or block results), same 5-result default limit.
- New UI copy is English, matching the existing UI; elapsed clock is large, top-right, `tabular-nums`, `mm:ss` (`h:mm:ss` past one hour).
- Only `done` stages enter estimate distributions; `skipped`/`degraded` durations never pollute medians/p90s. Cache-only scoring never enters the Spark-call distribution.
- No cancel button, no gamification, pulse animation only on the active stage marker and disabled under `prefers-reduced-motion`.

## Review Focus

- An NDJSON line split across network chunks, or two lines in one chunk, must not corrupt or drop events — pinned by a chunk-boundary test in Task 4.
- A stream that closes without a `result` event (or errors mid-stream) must show the existing error copy, never a half-finished timeline presented as a result — pinned in Task 4.
- Degraded runs (Spark timeout, failed enrichment jobs) must still return results but must not enter estimate samples — pinned in Tasks 1 and 3.
- A search finishing under 600 ms must never flash the timeline — pinned in Task 4.
- Elapsed past the estimate high bound, and past one hour, must render the warning state and `h:mm:ss` correctly — pinned in Task 4.

---

### Task 1: Run history storage and the estimator

**Files:**
- Modify: `lib/db.ts:29-142` (add `similar_search_runs` table in `initDb`)
- Create: `lib/search-estimate.ts`
- Modify: `tests/db.test.ts` (table shape test, following the existing `similar_results` column test)
- Create: `tests/search-estimate.test.ts`

**Interfaces:**
- Produces: `StageKey = "enrichment" | "dossiers" | "candidates" | "scoring" | "verification"`, `StageStatus = "pending" | "active" | "done" | "skipped" | "degraded"` (exported from `lib/search-estimate.ts`; later tasks import these).
- Produces: `interface SearchRunRecord { enrichmentMs: number | null; dossiersMs: number | null; candidatesMs: number | null; scoringMs: number | null; verificationMs: number | null; enrichmentJobs: number; transcribeJobs: number; samJobs: number; dossierTotal: number; candidateCount: number; cachedCount: number; sparkPendingCount: number; imageCount: number; outcome: "result" }` — a `null` duration means the stage did not finish `done` and is excluded from that stage's samples.
- Produces: `recordSearchRun(db: Database.Database, run: SearchRunRecord): void` in `lib/search-estimate.ts` (insert + prune to newest 500 rows; never throws — a failed write must not break a search, mirroring `persistResult` in `lib/similarity.ts:340`).
- Produces: `loadSearchRuns(db: Database.Database, limit?: number): SearchRunRecord[]` (newest first; corrupt/absent table → `[]`).
- Produces: `estimateRemaining(runs: SearchRunRecord[], state: EstimateState): { lowMs: number; highMs: number; sampleCount: number } | null` where `EstimateState = { stage: StageKey; stageElapsedMs: number; remainingStages: StageKey[]; workloads: { enrichmentJobs?: number; dossierTotal?: number; sparkPendingCount?: number } }` and `remainingStages` lists only the stages after `stage` (the running stage itself is accounted for via the residual rule below). Conditioning: enrichment by attempted job count, dossiers by total files, scoring by `sparkPendingCount` bucket (0 / 1–3 / 4–7 / 8+), others unconditional; a bucket with <5 samples falls back to the stage's unconditional samples; any remaining stage with <5 usable samples or fewer than 20 runs total → `null`. Running stage contributes `max(0, median − stageElapsedMs)` / `max(0, p90 − stageElapsedMs)`.

- [ ] **Step 1: Write the failing tests**

In `tests/search-estimate.test.ts`, cover: fewer than 20 runs → `null`; a remaining stage with <5 `done` samples → `null`; `null` (skipped/degraded) durations are excluded from samples; scoring bucket selection (runs with `sparkPendingCount` 2 do not set the range for a state asking for 6 when the 4–7 bucket has ≥5 samples); running-stage residual is floored at 0. In `tests/db.test.ts`, assert the `similar_search_runs` columns exist, following the existing table-column test pattern.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/search-estimate.test.ts tests/db.test.ts`
Expected: FAIL — `lib/search-estimate.ts` does not exist; table missing.

- [ ] **Step 3: Implement**

Add the table to `initDb` (durations `INTEGER`, counts `INTEGER NOT NULL DEFAULT 0`, `createdAt TEXT NOT NULL`). Implement `search-estimate.ts` with a nearest-rank percentile helper (median = p50). `recordSearchRun` wraps its insert/prune in try/catch and swallows errors.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/search-estimate.test.ts tests/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/search-estimate.ts tests/db.test.ts tests/search-estimate.test.ts
git commit -m "feat(similar): store search run timings and estimate remaining time"
```

### Task 2: Progress callbacks in enrichment and scoring

**Files:**
- Modify: `lib/enrichment.ts:189-247` (`processPendingJobs`)
- Modify: `lib/similarity.ts:566-724` (`scoreCandidates`)
- Modify: `tests/enrichment.test.ts`, `tests/similarity.test.ts` (add callback tests beside existing fake-client tests)

**Interfaces:**
- Consumes: `StageKey`/`StageStatus` from Task 1 (types only).
- Produces: `EnrichmentProgress = { onJobsSelected?: (info: { total: number; transcribeCount: number; samCount: number }) => void; onJobFinished?: (info: { completed: number; total: number; done: number; failed: number; kind: string }) => void }`, accepted as an optional 4th parameter `progress?: EnrichmentProgress` on `processPendingJobs(db, limit?, clients?, progress?)`. `onJobsSelected` fires once with the actually-selected (≤ limit) transcribe/sam jobs; existing callers and return value `{ done, failed }` are unchanged.
- Produces: `ScoreProgressEvent = { type: "cache_checked"; cachedCount: number; pendingCount: number } | { type: "spark_started"; pendingCount: number; imageCount: number } | { type: "spark_returned" } | { type: "validation_started"; pendingCount: number } | { type: "scoring_finished"; scoredCount: number; unscoredCount: number; sparkCalled: boolean; degraded: boolean }`, delivered via an optional 5th parameter `onProgress?: (event: ScoreProgressEvent) => void` on `scoreCandidates(db, queryId, candidates, spark?, onProgress?)`. In `scoring_finished`, `scoredCount` counts candidates ending with score > 0 and `unscoredCount` counts the rest (cache-only path included). Emission points: after the cache loop (`cache_checked`); before the Spark call with selected images counted (`spark_started`); immediately after the Spark promise resolves (`spark_returned`); before parsing/validation (`validation_started`); exactly once at the end on every path (`scoring_finished` — cache-only: `sparkCalled: false`; model error/timeout/malformed: `degraded: true` after the unscored fallback is applied). No event ever carries case content.

- [ ] **Step 1: Write the failing tests**

Enrichment: with fake transcribe/mark clients and 2 pending jobs (limit 10), assert `onJobsSelected` fired once with `{ total: 2, ... }` and `onJobFinished` fired twice with increasing `completed`. Similarity (using the existing fake Spark pattern in `tests/similarity.test.ts`): uncached candidates produce the event type sequence `cache_checked → spark_started → spark_returned → validation_started → scoring_finished` with `sparkCalled: true`; a second identical call (cache hit) produces `cache_checked → scoring_finished` with `sparkCalled: false`; a failing Spark produces a final `scoring_finished` with `degraded: true` and unscored results, matching today's fallback assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/enrichment.test.ts tests/similarity.test.ts`
Expected: FAIL — callbacks never fire.

- [ ] **Step 3: Implement**

Enrichment: after the job-selection query, invoke `onJobsSelected`; inside the per-job loop after each job settles, invoke `onJobFinished`. Similarity: invoke the events at the points listed above; keep all existing validation, persistence, sorting, and fallback behavior byte-for-byte in outcome.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/enrichment.test.ts tests/similarity.test.ts tests/similar-timeout.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/enrichment.ts lib/similarity.ts tests/enrichment.test.ts tests/similarity.test.ts
git commit -m "feat(similar): report enrichment and scoring progress"
```

### Task 3: Orchestrated pipeline and NDJSON streaming route

**Files:**
- Modify: `app/api/cases/[id]/similar/route.ts` (whole file; currently 74 lines)
- Modify: `tests/similar-api.test.ts` (add streaming describe block)
- Create: `tests/search-progress-api.test.ts` only if the streaming tests outgrow `similar-api.test.ts` — implementer's call, not required

**Interfaces:**
- Consumes: Task 1 (`recordSearchRun`, `loadSearchRuns`, `estimateRemaining`, `StageKey`) and Task 2 callbacks.
- Produces: `SearchProgressEvent = { seq: number; elapsedMs: number; type: "started" } | { seq: number; elapsedMs: number; type: "stage_started"; stage: StageKey; details?: Record<string, number | string | boolean> } | { ...; type: "stage_progress"; stage: StageKey; completed: number; total: number } | { ...; type: "stage_completed"; stage: StageKey; status: "done" | "skipped" | "degraded"; durationMs: number; details?: Record<string, number | string | boolean> } | { ...; type: "estimate"; estimate: { lowMs: number; highMs: number; sampleCount: number } | null } | { ...; type: "result"; results: unknown[]; fresh: boolean; limit: number; pendingEnrichment: boolean } | { ...; type: "error"; error: string }`. Define and export this type from `lib/search-estimate.ts` alongside the stage types (route files export only route handlers), and import it in both the route and the client (Task 4).
- Behavior: an internal `runSimilarSearch(db, id, emit?: (e: SearchProgressEvent) => void)` executes today's pipeline in today's order, timing each stage, emitting through `emit` when provided, recording one `SearchRunRecord` when (and only when) a result is produced, and returning `{ results, fresh, limit, pendingEnrichment }`. Stage rulings from the spec: enrichment denominator is the selected ≤5 jobs; dossier updated-vs-cached is decided by comparing the stored `case_dossiers.hash` before/after each `buildDossier`; dossier `degraded` only when `buildDossier` throws; candidate details are per-channel candidate counts from `CandidateMatch.channels`; scoring/verification boundaries follow the spec's table (all-cached → scoring `done` with `sparkCalled: false`, verification `done` at sort; model failure → scoring `degraded`, verification `skipped`; zero candidates → both `skipped`). An `estimate` event follows every stage event, computed from up to 500 loaded runs and current known workloads. Unexpected throws after streaming starts emit `error`, skip the run record, and do not clear `needsRerank`; on success `needsRerank` is cleared exactly as today.
- Route: `?stream=1` → `Response` over a `ReadableStream` (`application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`), each event one `JSON.stringify(event) + "\n"` enqueue; missing case still returns the plain 404 JSON before any streaming. Without `stream=1`, today's `NextResponse.json` behavior is unchanged (but now also records the run via the shared pipeline).

- [ ] **Step 1: Write the failing tests**

In `tests/similar-api.test.ts` add: (a) streaming a seeded search yields lines whose types are ordered `started → stage_started(enrichment) → … → stage_completed(verification) → result`, stage keys in pipeline order, every `stage_completed.durationMs ≥ 0`, and the `result` payload deep-equals the non-streamed response for the same seed; (b) with no API keys and at least one uncached candidate, the scoring stage completes `degraded`, verification completes `skipped`, and a `result` event with unscored results still arrives (today's no-key fallback); (c) a run row exists in `similar_search_runs` after both a streamed and a non-streamed call; (d) streamed 404 for a missing case is still JSON 404, not NDJSON; (e) no event line contains a seeded summary string or person name (content-leak guard).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/similar-api.test.ts`
Expected: FAIL — `?stream=1` is ignored today (single JSON body, no event lines).

- [ ] **Step 3: Implement**

Move the existing body of `GET` into `runSimilarSearch` with a stage tracker (start time per stage via `performance.now()`, monotonically increasing `seq`, `elapsedMs` from request start). Wire Task 2 callbacks into stage events. Keep `ENRICHMENT_JOB_LIMIT`, `similarResultLimit`, and `hasPendingEnrichment` semantics. Stream via `new ReadableStream({ async start(controller) { … } })`; do not await client consumption — if enqueue throws because the client disconnected, keep running the pipeline to completion (spec: server work is not cancelled) and swallow further enqueue errors.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/similar-api.test.ts tests/demo.test.ts tests/db.test.ts`
Expected: PASS, including every pre-existing similar-api test unchanged.

- [ ] **Step 5: Commit**

```bash
git add "app/api/cases/[id]/similar/route.ts" lib/search-estimate.ts tests/similar-api.test.ts
git commit -m "feat(similar): stream search progress as NDJSON"
```

### Task 4: Progress timeline UI and streamed fetching

**Files:**
- Create: `app/components/similar-search-progress.tsx`
- Create: `lib/search-stream.ts` (NDJSON reader)
- Modify: `app/cases/[id]/case-detail.tsx:248-341` (fetch + state) and `:1005-1015` (loading render)
- Modify: `tests/case-page.test.tsx` (similar fetch stub becomes a streamed result) and create `tests/similar-progress.test.tsx`

**Interfaces:**
- Consumes: `SearchProgressEvent`, `StageKey`, `StageStatus` from `lib/search-estimate.ts` (Task 3 places the event type there).
- Produces: `readSearchEvents(response: Response, onEvent: (e: SearchProgressEvent) => void): Promise<{ results: ScoredCase[]; fresh: boolean; limit?: number; pendingEnrichment?: boolean }>` in `lib/search-stream.ts` (`ScoredCase` imported from `lib/similarity.ts`, as `case-detail.tsx` already does) — reads `response.body` via `getReader()` + `TextDecoder`, buffers partial lines across chunks, parses each complete line as JSON, ignores blank lines, forwards every event to `onEvent`, and resolves with the `result` event's payload. It rejects on network error, a malformed JSON line, an `error` event, or end-of-stream without a `result` event.
- Produces: `SimilarSearchProgress({ stages, elapsedMs, estimate, estimateOverrun }: { stages: StageView[]; elapsedMs: number; estimate: { lowMs: number; highMs: number } | null; estimateOverrun: boolean })` where `StageView = { key: StageKey; label: string; owner: string; why: string; status: StageStatus; durationMs?: number; activeElapsedMs?: number; details: string[] }`. Rendering contract: header row with a polite `aria-live` status sentence (stage changes only) and the big elapsed clock top-right (`tabular-nums`, clock itself not in the live region); estimate badge under the clock — `Estimated remaining ~{low}–{high}s` with both bounds rounded up to whole seconds (the `estimate` prop arrives already aged and clamped by the caller), or the taking-longer warning when `estimateOverrun`; five stage rows with ✓ / pulsing dot / number / – markers, owner + why line, right-aligned duration; each row a `<button aria-expanded>` toggling a details region (active stage starts expanded, user may close; multiple may stay open); `degraded` rows use the gold warning styling already in the palette (`var(--gold)`); a CSS pulse keyframe scoped in the component, disabled inside `@media (prefers-reduced-motion: reduce)`.
- Fixed stage copy (label / owner / why): Enrichment — "Muse Voice Transcribe · SAM 3.1" — "Audio becomes searchable text and images gain object labels; both feed the similarity check." · Dossiers — "Muse Glimmer" — "Each case is compiled into one comparable file; unchanged files are reused." · Candidates — "Local code" — "Text, location (≤5 km), person, object and time (±90 days) channels nominate up to 20 candidates." · Scoring — "Muse Spark Open" — "Candidate files are compared in a single call; every similarity is listed with a strength (1–10)." · Verification — "Local code" — "Quoted evidence must exist in the source records; unverifiable items are dropped before ranking." Details lines are built from event `details` counts only (e.g. `2 of 18 files updated · 16 reused`, `7 candidates · text 4 · location 2 · person 1 · object 1 · time 3`, `3 scored by Spark · 2 from cache · 3 images attached`); when a count is absent the line is omitted, never estimated.
- `case-detail.tsx`: replace the similar-cases `fetch` with `readSearchEvents` against `/api/cases/${id}/similar?stream=1`; keep the case-detail fetch and all other behavior untouched. New state: per-stage `StageView` map updated only from events, `startedAt` timestamp, 1 s interval tick while loading, and the latest `estimate` plus its server `elapsedMs` anchor — the displayed range is aged by `(clientElapsed − eventElapsedMs)` and `estimateOverrun` becomes true once the aged high bound passes. The timeline renders only if loading has lasted ≥600 ms (a timer flips `showProgress`; a result before that never mounts it). On result, existing rendering (list, `pendingEnrichment` badge, fresh badge) is unchanged; on rejection, the existing error strings are used ("Could not load similar cases." for non-OK, "Connection error, please try again." for thrown errors).

- [ ] **Step 1: Write the failing tests**

`tests/similar-progress.test.tsx`: render the component with a mid-scoring `StageView[]` — assert the clock shows `00:42`, estimate badge `Estimated remaining ~20–40s`, active row expanded with its details, completed rows show real durations, a `skipped` row is labelled, `estimateOverrun` swaps the badge to the taking-longer text, and `elapsedMs = 3_661_000` renders `1:01:01`. `tests/case-page.test.tsx`: rework the similar stub to return a `Response` whose body streams a scripted event sequence ending in `result` with the existing `RESULTS` fixture — all existing similar-list tests must still pass; add: a fetch whose stream delivers events but closes without `result` shows "Connection error, please try again." (the thrown-error path; a non-OK response before streaming keeps "Could not load similar cases."); a result delivered immediately never shows the timeline (fake timers at 0 ms / advance 600 ms after result). Add a `search-stream` unit test feeding chunks that split a JSON line mid-token and assert both events arrive intact.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/similar-progress.test.tsx tests/case-page.test.tsx`
Expected: FAIL — component and reader do not exist; case page still fetches non-streamed JSON.

- [ ] **Step 3: Implement**

Create `lib/search-stream.ts`, `app/components/similar-search-progress.tsx`, then wire `case-detail.tsx` (stage state reducer keyed by `StageKey`, details-string builders per stage from `details` records, 600 ms gate, 1 s tick, estimate aging). Follow existing styling conventions: inline styles + the `layoutCss` string pattern already used in `case-detail.tsx:43-52`, palette variables from `app/globals.css`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/similar-progress.test.tsx tests/case-page.test.tsx tests/search-estimate.test.ts`
Expected: PASS, including all pre-existing case-page tests.

- [ ] **Step 5: Commit**

```bash
git add app/components/similar-search-progress.tsx lib/search-stream.ts "app/cases/[id]/case-detail.tsx" tests/similar-progress.test.tsx tests/case-page.test.tsx
git commit -m "feat(similar): live progress timeline while searching"
```

### Task 5: Whole-suite verification and docs touch-up

**Files:**
- Modify: `README.md:40-42` (presentation step of the similarity flow: mention streamed progress + estimate source)
- No new code unless verification exposes a defect (then fix under the owning task's tests)

- [ ] **Step 1: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: all suites PASS; production build succeeds.

- [ ] **Step 2: Manual smoke check**

Run: `npm run dev`, open a case detail, and confirm: the timeline appears only after ~0.6 s on a slow (cold-cache) search, stages advance in order, the elapsed clock runs, expandable rows open, and on a warm-cache reload results appear without the timeline flashing. Confirm the non-streamed endpoint still answers plain JSON via `curl http://localhost:3000/api/cases/<id>/similar`.

- [ ] **Step 3: Update README and commit**

One or two sentences in the Presentation step of the Similarity flow describing the streamed progress timeline and that remaining-time estimates come from recorded stage timings (hidden until enough history exists).

```bash
git add README.md
git commit -m "docs: describe similar-search progress in README"
```
