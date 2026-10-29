# Trace MVP

A case-record and similar-case discovery demo running on fictional data. Similarity is
not measured by shared words in the summary text alone: location, people, interview
transcripts, evidence notes, objects in images, and event time are also taken into
account; every similarity found is shown with its strength and supporting evidence.

For the demo script see `DEMO.md`. Design document:
`docs/superpowers/specs/2026-10-28-similar-cases-meta-models-design.md`.

## Roles of the four Meta models

| Model | Task | Code |
|---|---|---|
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | Transcribes audio evidence and person-interview audio into speaker-separated text. File endpoint `POST https://api.meta.ai/v1/asr/transcribe` (multipart `request` JSON + `audio` WAV); `DIARIZATION` mode returns `turns[]` with speaker labels. WAV required: mono 16-bit PCM at 16/24 kHz | `lib/transcribe.ts`, enrichment jobs `lib/enrichment.ts` |
| SAM 3.1 (`sam-3.1`) | Labels/boxes objects in visual evidence. Responses endpoint `POST https://api.meta.ai/v1/responses` with one short noun phrase per call (`input_text`, e.g. `knife`) plus the photo (`input_image`, data URL); boxes parsed from output tokens and normalized to 0–1 | `lib/mark-photo.ts`, `lib/enrichment.ts` |
| Muse Glimmer | Compiles a versioned case file (dossier) per case; picks standout quotes from transcripts | `lib/glimmer-client.ts`, `lib/dossier.ts` |
| Muse Spark Open | Compares candidate case files; lists similarities item by item with strengths (1–10) and an overall score | `lib/spark-client.ts`, `lib/similarity.ts` |

## Similarity flow

1. **Enrichment** (`lib/enrichment.ts`): when audio/an image is uploaded, a job enters the queue;
   Transcribe produces transcripts, SAM produces object marks. If a job fails
   the record is not lost, the job stays retryable and scoring continues
   with the remaining data.
2. **Case file** (`lib/dossier.ts`): Glimmer compiles, per case, a build of the incident, location,
   people (standouts from interview transcripts) and evidence, with source
   marks and hashes.
3. **Candidate generation** (`lib/candidates.ts`): multi-channel and scoreless — the union of text
   (FTS), location (≤5 km), person (English-normalized name + role), object (SAM label)
   and time (±90 days) channels, at most 20 candidates. Closed cases
   are also in the candidate pool.
4. **Scoring** (`lib/similarity.ts`): Spark scores candidates in a single call.
   There is no fixed score table; the code only generates candidates, computes objective cues
   (e.g. distance) and validates the output: unknown/repeated `caseId`
   entries are dropped, scores and strengths are clamped to 1–10, a quote that cannot be verified in the source file
   cannot enter an item. At most 3 images from evidence with shared SAM labels are added to the package for
   visual verification. Results are stored with file hashes in the
   `similar_results` table; they are not re-scored unless content changes.
5. **Presentation** (`GET /api/cases/[id]/similar`): first 5 results by default
   (`SIMILAR_RESULT_LIMIT`), case number (`caseNo`) instead of raw id on the card,
   per item type + description + strength + evidence. With `?stream=1` the same
   endpoint streams NDJSON progress events (enrichment, dossiers, candidates,
   scoring, verification) before the result; the case page shows them as a live
   timeline with an elapsed clock. Remaining-time estimates are computed from
   recorded stage timings (`similar_search_runs`, counts only) and stay hidden
   until enough search history exists.

## Setup

```bash
npm install
npm run dev          # http://localhost:3000
npm run seed         # 18 fictional cases (separate terminal, with the server running)
npm test             # test suite
```

## Configuration (env)

Keys live only in environment variables; there are no hard-coded keys.
`MODEL_API_KEY` is the primary key (same Bearer key for Transcribe, SAM,
image generation and chat). `META_API_KEY` / `LLAMA_API_KEY` are accepted
as fallbacks. Without keys the system keeps working with a scoreless fallback (similar
list in prefilter/candidate order, score shown as "0 (not scored)").

| Variable | Meaning |
|---|---|
| `MODEL_API_KEY` | Primary Meta Model API key (Transcribe, SAM 3.1, chat, image generation) |
| `JUDGE_API_URL` / `JUDGE_MODEL` | Judge (similarity scoring) endpoint — full chat-completions URL — / model name. Legacy `META_API_URL` / `META_MODEL` still accepted as fallback |
| `PROSECUTOR_API_KEY` | Separate key for the prosecutor (falls back to `MODEL_API_KEY` and below) |
| `PROSECUTOR_API_URL` / `PROSECUTOR_MODEL` | Prosecutor (dossier building) endpoint / model name. Legacy `GLIMMER_API_URL` / `GLIMMER_MODEL` still accepted as fallback |
| `BASETEN_API_KEY` | When set, Spark is called via Baseten (preferred) |
| `BASETEN_API_URL` | Baseten endpoint (default: `https://inference.baseten.co/v1/chat/completions`) |
| `SPARK_MODEL` | Spark model name on the Baseten path (default: `muse-spark-open`) |
| `META_API_KEY` | Legacy key name for the judge path; accepted for Transcribe and SAM too |
| `LLAMA_API_KEY` | Fallback key when the above are absent |
| `META_API_URL` / `META_MODEL` | Meta API chat endpoint (default `https://api.meta.ai/v1/chat/completions`) / model name override (default `muse-spark-1.3`) |
| `GLIMMER_API_KEY` | Separate key for Glimmer (falls back to `META_API_KEY`/`LLAMA_API_KEY`) |
| `GLIMMER_API_URL` / `GLIMMER_MODEL` | Glimmer endpoint / model name (falls back to `META_API_URL`/`META_MODEL`) |
| `SIMILAR_RESULT_LIMIT` | Number of similar cases shown (default 5) |
| `SPARK_TIMEOUT_MS` | Spark call timeout, ms (default 120000) |
| `META_TIMEOUT_MS` / `GLIMMER_TIMEOUT_MS` / `META_TRANSCRIBE_TIMEOUT_MS` / `META_SAM_TIMEOUT_MS` | Chat/Glimmer, Transcribe and SAM call timeout, ms (default 120000) |
| `META_TRANSCRIBE_URL` / `META_TRANSCRIBE_MODEL` | Voice Transcribe endpoint (default `https://api.meta.ai/v1/asr/transcribe`) / model override (default `muse-voice-transcribe-1.0`). Audio must be WAV (mono 16-bit PCM 16/24 kHz); convert first, e.g. `ffmpeg -i in.m4a -ac 1 -ar 24000 -c:a pcm_s16le out.wav` |
| `META_SAM_URL` / `META_SAM_MODEL` | SAM 3.1 endpoint (default `https://api.meta.ai/v1/responses`) / model override (default `sam-3.1`) |
| `TRACE_DB_PATH` / `TRACE_UPLOAD_DIR` | SQLite file / upload directory (defaults `trace.db` / `uploads`) |
| `TRACE_BASE_URL` | Seed target (default `http://localhost:3000`) |
| `DEMO_PASSCODE` | Demo login passcode (optional) |

PowerShell example:

```powershell
$env:BASETEN_API_KEY="..."
$env:META_API_KEY="..."
$env:SIMILAR_RESULT_LIMIT="5"
npm run dev
```

## Deployment and privacy note

v1 works **API-mode only**: Spark via Baseten (preferred) or the Meta
API; person names and transcripts go to the model as-is in API mode.
Self-hosting (running Spark Open on the unit's own systems so case data
never leaves the organization) is **not** set up in v1; it is only a sales/demo narrative.
Since model access goes through a single chat layer routed by env, the interface and scoring behavior stay the same if
self-hosting is set up later.
