// NDJSON reader for GET /api/cases/[id]/similar?stream=1.
// Lines may be split across network chunks; partial lines are buffered.
// Resolves only with the terminal `result` event payload — a stream that
// ends early, carries an `error` event, or contains malformed JSON rejects,
// so a half-finished timeline is never presented as a result.

import type { SearchProgressEvent } from "./search-estimate";
import type { ScoredCase } from "./similarity";

export interface SimilarResultPayload {
  results: ScoredCase[];
  fresh: boolean;
  limit?: number;
  pendingEnrichment?: boolean;
}

export async function readSearchEvents(
  response: Response,
  onEvent: (event: SearchProgressEvent) => void,
): Promise<SimilarResultPayload> {
  if (!response.body) throw new Error("progress stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SimilarResultPayload | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as SearchProgressEvent;
    onEvent(event);
    if (event.type === "error") throw new Error("similar_search_failed");
    if (event.type === "result") {
      result = {
        results: event.results as ScoredCase[],
        fresh: event.fresh,
        limit: event.limit,
        pendingEnrichment: event.pendingEnrichment,
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.trim()) handleLine(buffer);
  if (!result) throw new Error("progress stream ended without a result");
  return result;
}
