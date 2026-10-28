import sqlite3, json, time, sys
sys.path.insert(0, "D:\\Projects\\Trace\\demo-assets")
from media_lib import *

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
cases = con.execute("SELECT c.id, c.caseNo, l.title AS spot FROM cases c JOIN case_locations l ON l.caseId=c.id WHERE c.caseNo BETWEEN 'TR-0019' AND 'TR-0100' ORDER BY c.caseNo").fetchall()
print("target cases:", len(cases))
have = {r[0]: r[1] for r in con.execute("SELECT caseId, COUNT(*) FROM evidences GROUP BY caseId")}
todo = [c for c in cases if have.get(c["id"], 0) == 0]
print("without evidence:", len(todo))

HOOK = {
  "A": "He wore a gray hooded sweatshirt and limped on his left leg.",
  "B": "The gasoline can was left by the entrance.",
  "C": "A man in uniform tricked the door open and used a crowbar on the lock.",
  "D": "They cut the fence with large cutters and loaded copper coils into a white van.",
  "E": "She spilled the coffee while her friend took the bag from the chair.",
}
def cluster_of(no):
    n = int(no[3:])
    if 19 <= n <= 30: return "A"
    if 31 <= n <= 40: return "B"
    if 41 <= n <= 50: return "C"
    if 51 <= n <= 60: return "D"
    if 61 <= n <= 68: return "E"
    return "X"

LEADS = {
"A": ["I was fishing alone at the pier when a man came from behind and showed a knife.", "We were packing our rods when someone approached from behind with a knife.",
  "My tackle bag was grabbed at night by a man who came from behind holding a knife.", "A knife was shown from behind while I was fixing my line on the shore.",
  "Two rods were taken at night by a suspect who approached from behind with a knife.", "I heard steps behind me, then a man with a knife took my fishing bag.",
  "While baiting the hook a stranger came from behind and showed a knife.", "Our cooler and rods were stolen by a man who came from behind with a knife.",
  "A night angler reported a knife shown from behind before his gear was taken.", "The suspect came from behind and held a knife while taking the landing net.",
  "My creel was seized at night by a man approaching from behind with a knife.", "Fishing gear was robbed by a knife suspect who came from behind on the dock."],
"B": ["I smelled gasoline just before the cabin caught fire.", "A red can stood by the cabin door on the night it burned.",
  "Someone poured gasoline along the porch before the flames started.", "The storage hut burned after I saw a man with a gasoline can.",
  "Flames rose minutes after a gasoline smell spread through the trees.", "A can was found melted by the doorway of the burnt cabin.",
  "I woke to fire and remembered a gasoline can near the entrance.", "The lookout cabin burned the same night a can was seen outside.",
  "Gasoline traces led from the door into the forest after the fire.", "A stranger carried a red can toward the cabin before it ignited."],
"C": ["He said he was from the water company, then forced the door with a crowbar.", "A man in electrician clothes tricked the door open and used a crowbar.",
  "The courier pushed the door with a crowbar after I opened it.", "He claimed to read the meter, then pried the lock with a crowbar.",
  "A gas inspector showed a badge, then forced the door with a crowbar.", "The installer asked for water, then attacked the door with a crowbar.",
  "A chimney sweep talked his way in and pried the frame with a crowbar.", "Pest control knocked, then the man used a crowbar on the lock.",
  "The delivery driver wedged a crowbar into the door as it opened.", "A surveyor distracted me, then forced the door with a crowbar."],
"D": ["I heard metal clanging at the site fence after midnight.", "The copper drums were open and coils missing by morning.",
  "Two men cut the mesh and dragged cable toward a white van.", "The night guard found the fence flap cut near the container row.",
  "Fresh cutter marks covered the padlocked site gate.", "Spools were empty and copper strands lay across the gravel.",
  "A van idled outside while the fence was being cut.", "The depot lost three cable drums in a single night raid.",
  "Bolt cutter jaws marks were found on the chain links.", "Copper coils were stacked by the trench, ready to load."],
"E": ["A woman bumped our table and coffee went everywhere.", "My bag hung on the chair when a spill caused chaos.",
  "The couple next to us knocked over cups during the rush.", "Someone shouted about a spill as my handbag disappeared.",
  "Coffee splashed my coat while the bag left the chair.", "A staged argument covered the moment the bag was taken.",
  "The waiter slipped and cups crashed near our table.", "A tourist asked for directions as the bag vanished."],
}
IMG = {
"A": "steel knife lying on {spot} at night, fishing rods and tackle bag beside it, flashlight beam, photorealistic crime scene evidence photo, no people",
"B": "red gasoline can standing by the burnt wooden door of {spot} at night, charred walls, photorealistic crime scene evidence photo, no people",
"C": "steel crowbar leaning against a scratched apartment door with damaged lock at {spot}, daylight hallway, photorealistic crime scene evidence photo, no people",
"D": "red bolt cutter cutting through chain-link fence at {spot} construction site at night, copper cable drums nearby, photorealistic crime scene evidence photo, no people",
"E": "leather handbag on a chair next to a cafe table with spilled coffee cups at {spot}, daytime, photorealistic crime scene evidence photo, no people",
}
CONCEPTS = {"A": ["knife", "fishing rod"], "B": ["gasoline can", "cabin"], "C": ["crowbar", "door"], "D": ["bolt cutter", "fence"], "E": ["handbag", "coffee cup"]}

DX = [  # (concept, image prompt, audio quote) for TR-0069..TR-0100 in order
("wallet", "leather wallet lying open on a crowded market stall counter, daytime, photorealistic evidence photo, no people", "My wallet was gone after someone bumped me in the market crowd."),
("spray can", "red spray paint can on asphalt next to a freshly tagged car door at night, photorealistic evidence photo, no people", "Three cars were sprayed overnight and the cans were left behind."),
("invoice", "printed fake supplier invoice with wrong bank details on an office desk, photorealistic evidence photo, no people", "The email looked real but the account number belonged abroad."),
("dog", "large dog on a leash barking at a jogger on a park path, daytime, photorealistic photo, no people posing", "The dog lunged and the two owners started shouting at each other."),
("phone", "smartphone on the floor of a bus near the closing doors, daytime, photorealistic evidence photo, no people", "The phone was ripped from my hand as the bus doors closed."),
("grinder", "angle grinder with cut metal sparks on a warehouse roof hatch at night, photorealistic evidence photo, no people", "They came through the roof and the tool marks were everywhere."),
("kiosk", "small newspaper kiosk with open till drawer at night, street lamp light, photorealistic evidence photo, no people", "The masked youth emptied the till and ran down the alley."),
("sedan", "burnt black sedan with melted tires on a back street at night, photorealistic evidence photo, no people", "The car burned for twenty minutes before anyone called."),
("cooler", "blue cooler box and towels left alone on a sandy beach, daytime, photorealistic photo, no people", "We swam for ten minutes and the cooler was gone."),
("terminal", "card payment terminal on a hotel reception counter, close-up, photorealistic evidence photo, no people", "Every guest who paid that weekend had to block a card."),
("school wall", "school gym brick wall splashed with egg and paint stains, daytime, photorealistic evidence photo, no people", "The wall was a mess of eggshells and yellow paint."),
("laptop", "open laptop on an empty library reading desk, daytime, photorealistic evidence photo, no people", "I left it for two minutes to fetch a book."),
("bottle", "broken glass bottle on a bar floor at night, photorealistic evidence photo, no people", "The argument ended when the bottle hit the counter."),
("display case", "smashed glass pharmacy display case with scattered cosmetic boxes, photorealistic evidence photo, no people", "The case was smashed just before opening time."),
("suitcase", "two identical grey suitcases on a night train luggage rack, photorealistic photo, no people", "We both grabbed the wrong identical bag."),
("banknote", "two banknotes under a magnifier lamp on a market stall table, photorealistic evidence photo, no people", "The paper felt wrong and the watermark was missing."),
("headstone", "toppled old headstone lying on cemetery grass, morning light, photorealistic evidence photo, no people", "Three stones were pushed over during the night."),
("taxi", "yellow taxi with open rear door on a night street, interior light on, photorealistic evidence photo, no people", "The passenger threatened the driver over the fare."),
("watch", "open empty gym locker with a bench and towel, daytime, photorealistic evidence photo, no people", "The locker was pried and my watch was gone."),
("dumpster", "burning dumpster with flames behind a restaurant at night, photorealistic evidence photo, no people", "The fire spread from the dumpster to the pallets."),
("donation box", "wooden church donation box with forced lid, interior, daytime, photorealistic evidence photo, no people", "The box was jimmied open during the night."),
("laptop screen", "laptop showing a fake rental apartment listing in a browser, photorealistic evidence photo, no people", "The flat did not exist and the deposit was lost."),
("scarf", "team scarf dropped on stadium steps after a match at night, photorealistic evidence photo, no people", "The fans clashed right after the final whistle."),
("souvenir", "museum gift shop shelf with empty souvenir slots, daytime, photorealistic evidence photo, no people", "A group of teens emptied two shelves in minutes."),
("pillar", "concrete bridge pillar covered in fresh spray-painted letters, daytime, photorealistic evidence photo, no people", "The tag appeared overnight in huge letters."),
("hammer", "claw hammer on a sidewalk next to broken jewelry store glass, daytime, photorealistic evidence photo, no people", "The window shattered and trays were grabbed in seconds."),
("carousel", "airport luggage carousel with lone unclaimed suitcase, photorealistic photo, no people", "My bag circled twice, then a man took it."),
("telephone", "old telephone receiver off the hook on a hallway table, photorealistic evidence photo, no people", "The caller claimed to be police and demanded a fine."),
("platform", "empty metro platform edge with yellow line at rush hour, photorealistic photo, no people", "Someone shoved past and the commuter fell."),
("microscope", "school lab bench with one microscope missing and open window behind, daytime, photorealistic evidence photo, no people", "The window was pried and two microscopes were gone."),
("boat", "moored boats with open fuel caps at a quiet marina before dawn, photorealistic evidence photo, no people", "Three tanks were siphoned dry overnight."),
("bus window", "bus side window with scratched etched lines, daytime close-up, photorealistic evidence photo, no people", "Every window on the night bus was scratched."),
]
assert len(DX) == 32

def process(c):
    no = c["caseNo"]; cid = c["id"]; spot = c["spot"]
    g = cluster_of(no)
    if g == "X":
        concept, iprompt, quote = DX[int(no[3:]) - 69]
        concepts = [concept]
        voice = "en-US-AriaNeural" if int(no[3:]) % 2 else "en-US-GuyNeural"
    else:
        idx = {"A": range(19, 31), "B": range(31, 41), "C": range(41, 51), "D": range(51, 61), "E": range(61, 69)}[g].index(int(no[3:]))
        iprompt = IMG[g].format(spot=spot)
        concepts = CONCEPTS[g]
        quote = LEADS[g][idx] + " " + HOOK[g]
        voice = "en-US-AriaNeural" if (int(no[3:]) % 2) else "en-US-GuyNeural"
    # IMAGE + SAM verify (target concepts; accept if >=1 hits, else one regen)
    img = gen_image(iprompt)
    boxes = []
    for cp in concepts:
        try: boxes += sam_boxes(img, cp)
        except Exception as e: print(no, "sam err", cp, str(e)[:100])
    if not boxes:
        print(no, "ZERO matches, regenerating once...")
        img = gen_image(iprompt + ", object large and centered in frame")
        for cp in concepts:
            try: boxes += sam_boxes(img, cp)
            except Exception as e: print(no, "sam err2", cp, str(e)[:100])
    # AUDIO + real transcribe
    tag = no.lower()
    tts_wav(quote, voice, f"demo-assets/tmp_{tag}.mp3", f"demo-assets/tmp_{tag}.wav")
    wav = open(f"demo-assets/tmp_{tag}.wav", "rb").read()
    tr = transcribe_wav(wav, tag + ".wav")
    # STORE
    cur = con.cursor()
    import uuid, time
    ts = int(time.time() * 1000); now = time.strftime("%Y-%m-%dT%H:%M:%S")
    img_name = store_upload(cid, img, ".webp")
    wav_name = store_upload(cid, wav, ".wav")
    title = " ".join(iprompt.split()[:5]).capitalize()
    cur.execute("INSERT INTO evidences (id, caseId, type, title, note, imageFile, audioFile, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), cid, "evidence", title, "Photo evidence: " + concepts[0], img_name, None, None, json.dumps({"boxes": boxes}), now))
    cur.execute("INSERT INTO evidences (id, caseId, type, title, note, imageFile, audioFile, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), cid, "evidence", "Witness statement", quote, None, wav_name, json.dumps(tr), None, now))
    cur.execute("UPDATE cases SET needsRerank=1 WHERE id=?", (cid,))
    con.commit()
    os.remove(f"demo-assets/tmp_{tag}.mp3"); os.remove(f"demo-assets/tmp_{tag}.wav")
    print(f"OK {no}: img {len(img)}B boxes={len(boxes)} [{','.join(sorted(set(b['label'] for b in boxes)))}] tr={len(tr['text'])}ch", flush=True)

for c in todo:
    try: process(dict(c))
    except Exception as e:
        print("FAIL", c["caseNo"], str(e)[:300], flush=True)
        time.sleep(5)
con.execute("DELETE FROM case_dossiers"); con.execute("DELETE FROM similar_results")
con.commit()
print("caches cleared; counts:", con.execute("SELECT COUNT(*) FROM cases").fetchone(), con.execute("SELECT COUNT(*) FROM evidences").fetchone())
