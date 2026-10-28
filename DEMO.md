# Trace MVP — 3-Minute Demo Script

Run with fictional data. All cases and people are fictitious (`seed/cases.json`,
`TR-SEED-*`, `[Fiction]` prefix in summaries). Do not use real cases or personal data.

## 0:00–0:30 — Setup

1. Install dependencies: `npm install`.
2. (For a live-model rehearsal) pass keys via env — keys live in env only, never in code:
   with `BASETEN_API_KEY` Spark is called via Baseten;
   otherwise via the Meta API with `META_API_KEY` (fallback `LLAMA_API_KEY`);
   for Glimmer `GLIMMER_API_URL`/`GLIMMER_MODEL` (optional
   `GLIMMER_API_KEY`), result count with `SIMILAR_RESULT_LIMIT` (default
   5). Full list: `README.md`. The demo also works without keys; similars come back
   unscored (below).
3. Start the dev server: `npm run dev` (`http://localhost:3000`).
4. Load the 18 fictional cases: `TRACE_BASE_URL=http://localhost:3000 node seed/seed.ts`
   (`seed/seed.ts` uses the real `POST /api/cases` chain; `TR-SEED-01…05`
   is the waterfront | knife | approaching-from-behind-at-night serial set).
   PowerShell: `$env:TRACE_BASE_URL="http://localhost:3000"; node seed/seed.ts`
   (or briefly `npm run seed` — loads to the same address; requires Node 22.6+).
5. Prepare the phone: mobile view, grant location permission if asked ("allow once").

## 0:30–1:10 — Phone case entry (`/new`)

1. Open "New Case". Write the summary (required): "At night fishing gear
   was stolen on the lake shore; the suspect approached from behind and showed a knife."
2. Crime type: `theft` (from the suggestion list).
3. The people section is a single section: it starts as "No person attached."
   Press "+ Add Person"; the ("Add Person") panel opens:
   - Type: `Victim`, Full name (required): "Fictional Victim"; press "Use This Person"
     → appears in the row with a red "Victim" badge. (If the name is unknown,
     check "Unidentified"; it confirms without a name and shows a yellow
     "Unidentified" badge.)
   - Press "+ Add Person" again: Type `Witness`, Full name: "Fictional Witness",
     pick the victim you added in the Related Victim list, Relationship:
     "sibling", Contact status: `Reached`; press "Use This Person" →
     the row shows a blue "Witness" badge, "Related Victim: Fictional Victim
     (sibling)" text and a green "Reached" badge. (Suspects show with a purple
     badge; if a victim is deleted or its type changes, the relationships
     of linked people are cleared.)
4. Locations are a single section: at first the map, the location list and a yellow warning banner
   ("No location in this case is marked as Crime Scene.") appear.
   Press "+ Add Location"; the ("Select Location") panel opens:
   - Type: `Crime Scene`, Title (required): "Pier 4"; type the lake name into "Search
     by address / place name" and press "Search" (Nominatim results arrive,
     pick one) or drop the pin by clicking the map. Press "Use This Location"
     → the warning banner goes away, a red Crime Scene pin appears on the map.
   - Press "+ Add Location" again: Type `Related Location`, Priority `Critical`,
     Title: "suspect escape direction"; this time go to the device
     location with "Go to My Location" (grant "allow once" if asked) or click on the map,
     press "Use This Location" → an orange Critical pin appears and
     a distance label between the two pins (e.g. "320 m") is drawn.
5. Press "Open Case" → "Case opened: TR-00XX" screen and an "add evidence"
   link. Added people are submitted together with the form as a single draft.
   (A location without coordinates can also be saved; no pin is drawn.)

## 1:10–2:00 — Similar case list (`/cases/[id]`)

1. Open the case detail: summary, crime type, method, weapon cards, a single
   "People" section and a single "Locations" section — on the unified map the red
   Crime Scene and orange Critical pins with the distance label between them; show that badges and text stay
   readable on every background.
2. Try editing a location: press "Edit" on a location and change the
   title in the panel; "Save / Cancel" appears under the section. First
   show "Cancel" reverting the draft, then show the same change permanent
   with "Save" (in a closed case the section is read-only).
3. Try editing a person: in the "People" section rows show type
   (Victim/Witness/Suspect), identity and contact badges plus the related
   victim text. Press "Edit" on a person and change the note in the panel;
   "Save / Cancel" appears under the section. First show
   the draft reverting with "Cancel", then the same change permanent with
   "Save" ("People saved."). New people are also staged in the same
   panel; nothing goes to the server until "Save" is pressed
   (in a closed case the section is read-only).
4. The "Similar cases" panel is the result of `GET /api/cases/[id]/similar`. Tell the flow
   through the roles of the four models:
   - **Glimmer** has compiled a versioned case file (dossier) per case:
     incident + locations + people (standouts from interview transcripts) + evidence
     (SAM labels, audio transcripts), each piece source-marked.
   - Candidates are generated multi-channel (text, location ≤5 km, person name+role, SAM
     object, time ±90 days; closed cases included, at most 20 candidates). Channels
     do not score.
   - **Spark Open** compares the candidate files in a single call: each similarity
     a separate item, strength 1–10 (no fixed score table), overall score holistic.
     A quote that cannot be verified in the source file cannot enter an item; at most
     3 evidence images with shared SAM labels are attached to the package for visual verification.
   - Results are stored with file hashes; they are not re-scored unless content changes.
   Panel: at least 2 cases from the 5-case serial set (first 5 by default;
   changes with `SIMILAR_RESULT_LIMIT`), case number instead of raw id on the card,
   overall score, short rationale and item-by-item similarities —
   each item shows type, description, strength (`n/10`) and an "evidence: …" quote.
   If an enrichment job is pending, a warning banner appears in the panel.
5. Press the "confirm" button on a match to confirm it → becomes "confirmed"
   (`POST /api/cases/[id]/links`).
6. Note: without keys / offline or on a Spark timeout
   (`SPARK_TIMEOUT_MS`, default 120000 ms) the score shows "0 (not scored)"
   — the list still arrives in candidate order, nothing is lost; unscored
   results are not cached, they are retried once a key is available.

## 2:00–2:40 — Audio and photo modules (`/cases/[id]/add`)

1. In "Add Evidence" press "Record Audio" and upload a short statement
    (WAV: mono 16-bit PCM at 16/24 kHz):
   `POST …/transcribe` returns text → "Audio resolved: …" status,
   shown in the detail as an "Utterance:" line. **Muse Voice Transcribe**
   (`POST https://api.meta.ai/v1/asr/transcribe`, `DIARIZATION` mode) turns audio
   into speaker-separated text (`turns[]` with speaker labels); the transcript is written to the record via an enrichment job
   and enters Glimmer's case file.
2. Upload a crime-scene photo with "Take Photo" (tip: name the object in the title/note, e.g. "Knife on night pier"):
   `POST …/mark-photo` returns boxes → "Photo saved (N boxes)." status,
   shown in the detail as "Photo: … (N boxes)" plus the label list. **SAM 3.1**
   (`POST https://api.meta.ai/v1/responses`, model `sam-3.1`, one short noun
   phrase per call) segments each named concept; labels feed the object-candidate channel and Spark's visual
   verification.
3. If an enrichment job (Transcribe/SAM) fails, the record is not lost;
   the job stays retryable and similarity is computed with the remaining data.
   The live service needs `MODEL_API_KEY` (fallbacks `META_API_KEY` /
   `LLAMA_API_KEY`); without a key these two endpoints
   return an error (so a demo rehearsal only mocks the Meta client).

## 2:40–3:00 — Offline note

1. Cut the connection (airplane mode) and save a note from "Add Evidence":
   the service worker queues the request → "Note queued, will be sent when
   the connection returns." (same queue messages for audio/photo; the
   case detail's location and person "Save" buttons also queue offline
   and show "Queued, will be sent when the connection returns.";
   person update/delete requests are sent from the queue too).
2. When the connection returns the queue sends itself; the new evidence
   clears the `needsRerank` flag and a "new similars" badge appears in the detail.
3. Privacy narrative (narrative only): "Spark Open can optionally also run on the unit's own
   powerful systems; in that setup case data never leaves
   the organization." Note: v1 actually runs in API mode (Baseten preferred,
   otherwise Meta API); self-host is not set up in v1, it is a roadmap narrative.
4. Closing line: "Record, similarity, evidence and offline queue — all
   with fictional data, in three minutes."
