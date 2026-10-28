import sqlite3
con = sqlite3.connect(r"D:\Projects\Trace\trace.db")
ids = [r[0] for r in con.execute("SELECT id FROM cases WHERE caseNo IN ('TR-0019','TR-0022','TR-0006','TR-0010','TR-0051','TR-0061')")]
q = ",".join("?" * len(ids))
con.execute(f"DELETE FROM similar_results WHERE queryId IN ({q}) OR candidateId IN ({q})", ids * 2)
con.execute(f"UPDATE cases SET needsRerank=1 WHERE id IN ({q})", ids)
con.commit()
print("invalidated", len(ids), "heroes")
