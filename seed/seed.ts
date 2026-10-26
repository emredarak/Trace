// seed/seed.ts — KURGU örnek vaka setini gerçek API (POST /api/cases) üzerinden yükler.
// Tüm kayıtlar kurgudur: caseNo TR-SEED-*, özetler "[Kurgu]" öneklidir.
// Kullanım:  TRACE_BASE_URL=http://localhost:3000 node seed/seed.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.TRACE_BASE_URL ?? "http://localhost:3000";

interface SeedCase {
  caseNo?: string;
  [key: string]: unknown;
}

const dir = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(dir, "cases.json"), "utf-8")) as SeedCase[];

let ok = 0;
for (const record of seed) {
  const { caseNo: _seedNo, ...input } = record;
  const res = await fetch(`${BASE}/api/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status !== 201) {
    const text = await res.text();
    console.error(`FAIL ${record.caseNo}: ${res.status} ${text}`);
    process.exitCode = 1;
  } else {
    const body = (await res.json()) as { caseNo: string };
    console.log(`ok ${record.caseNo} -> ${body.caseNo}`);
    ok++;
  }
}
console.log(`${ok}/${seed.length} kurgu vaka yüklendi.`);
