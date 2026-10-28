import sqlite3
con = sqlite3.connect(r"D:\Projects\Trace\trace.db")
con.execute("DELETE FROM case_dossiers")
con.execute("DELETE FROM similar_results")
con.execute("UPDATE cases SET needsRerank=1")
con.commit()
print("wiped dossiers+similar, all needsRerank=1")
