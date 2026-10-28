import urllib.request, json, time
def get(path, timeout=1200):
    req = urllib.request.Request(f"http://localhost:3000{path}", headers={"Cookie": "trace_demo=1"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))

cases = get("/api/cases", timeout=60)
byNo = {c["caseNo"]: c for c in cases}
for q in ["TR-0019", "TR-0022", "TR-0006", "TR-0010", "TR-0051", "TR-0061"]:
    c = byNo[q]
    print(f"=== query {q} ===", flush=True)
    s = time.time()
    try:
        sim = get(f"/api/cases/{c['id']}/similar", timeout=1200)
    except Exception as e:
        print("FAILED:", str(e)[:200], flush=True)
        continue
    print(f"took {round(time.time()-s,1)}s fresh={sim.get('fresh')} pending={sim.get('pendingEnrichment')}", flush=True)
    for r in sim.get("results", [])[:3]:
        kinds = ",".join(m.get("kind","?") for m in r.get("similarities", []))
        print(f"--- {r.get('caseNo')} score={r.get('score')} [{kinds}]", flush=True)
        print("    reason:", (r.get("reason") or "")[:110], flush=True)
print("WARMUP DONE", flush=True)
