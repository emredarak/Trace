import sqlite3, urllib.request, json, time
con = sqlite3.connect(r"D:\Projects\Trace\trace.db")
cid = con.execute("SELECT id FROM cases WHERE caseNo='TR-0061'").fetchone()[0]
con.execute("DELETE FROM similar_results WHERE queryId=?", (cid,))
con.execute("UPDATE cases SET needsRerank=1 WHERE id=?", (cid,))
con.commit()
print("cache cleared for TR-0061", flush=True)
req = urllib.request.Request(f"http://localhost:3000/api/cases/{cid}/similar", headers={"Cookie": "trace_demo=1"})
s = time.time()
sim = json.load(urllib.request.urlopen(req, timeout=1200))
print(f"took {round(time.time()-s,1)}s fresh={sim.get('fresh')}", flush=True)
for r in sim.get("results", [])[:4]:
    kinds = ",".join(m.get("kind","?") for m in r.get("similarities", []))
    print(f"--- {r.get('caseNo')} score={r.get('score')} [{kinds}]", flush=True)
    print("    reason:", (r.get("reason") or "")[:120], flush=True)
print("DB model values:", con.execute("SELECT DISTINCT model FROM similar_results WHERE queryId=?", (cid,)).fetchall(), flush=True)
