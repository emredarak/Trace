import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// Inserts 82 fictional English cases directly (server-independent).
// Design: extend clusters A/B/C, add clusters D (construction-site cable
// theft, bolt cutter) + E (cafe distraction bag theft, no weapon), plus
// 32 unique distractors. Shared MO/weapon/type/person/coords/dates per
// cluster trigger the text/location/person/object/time candidate channels.
const db = new Database("trace.db");

const C = {
  A: { crimeType: "theft", locationType: "waterfront", weapon: "knife", mo: "approaching from behind at night, stealing fishing gear", cLat: 41.1, cLng: 29.02, witness: "Ron Turner" },
  B: { crimeType: "arson", locationType: "forest", weapon: "gasoline can", mo: "setting cabin on fire at night", cLat: 41.2, cLng: 29.1, witness: "Kara Lane" },
  D: { crimeType: "theft", locationType: "construction site", weapon: "bolt cutter", mo: "cutting site fence at night and stripping copper cable", cLat: 41.12, cLng: 28.85, witness: "Sam Reyes" },
  E: { crimeType: "theft", locationType: "cafe", weapon: "none", mo: "distracting victim at cafe table while accomplice takes bag", cLat: 40.99, cLng: 29.02, witness: "Lena Fischer" },
};

const now = new Date().toISOString();
let seq = db.prepare("SELECT MAX(CAST(SUBSTR(caseNo,4) AS INTEGER)) AS m FROM cases WHERE caseNo LIKE 'TR-%'").get().m;
console.log("starting after TR-" + String(seq).padStart(4, "0"));

const insCase = db.prepare(`INSERT INTO cases (id, caseNo, summary, crimeType, locationType, locationText, latitude, longitude, occurredAt, officer, victimAge, victimGender, suspects, witnesses, mo, weapon, status, needsRerank, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
const insLoc = db.prepare(`INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?,?,?, ?,?,?,?, ?,?,?)`);
const insPer = db.prepare(`INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, createdAt) VALUES (?,?,?,?,?,?,?,NULL,NULL,0,?,?)`);

let n = 0;
function add(o) {
  seq++; n++;
  const caseNo = "TR-" + String(seq).padStart(4, "0");
  const id = randomUUID();
  insCase.run(id, caseNo, o.summary, o.crimeType, o.locationType, o.locationText, o.lat ?? null, o.lng ?? null, o.date, o.officer, o.vAge, o.vGender, o.suspects, o.witnesses, o.mo, o.weapon, o.status ?? "open", now, now);
  if (o.lat !== undefined) insLoc.run(randomUUID(), id, o.spot, o.spot, o.spot, "crime-scene", null, o.lat, o.lng, now);
  for (const p of (o.persons ?? [])) insPer.run(randomUUID(), id, p.name, p.age ?? null, p.gender ?? null, p.note ?? null, p.type, p.contact ?? null, now);
  return caseNo;
}
const grid = (i, cLat, cLng) => [+(cLat + ((i * 37 % 11) - 5) * 0.0016).toFixed(5), +(cLng + ((i * 53 % 13) - 6) * 0.0016).toFixed(5)];

// ---------- Cluster A extension (+12): lakeside night knife theft ----------
const Aspots = ["Mirror Lake north pier", "Mirror Lake east camp shore", "Mirror Lake rocky west point", "Mirror Lake south picnic shore", "Mirror Lake watchtower bank", "Mirror Lake reed channel", "Mirror Lake boat rental dock", "Mirror Lake night fishing stand 6", "Mirror Lake gravel bay", "Mirror Lake willow inlet", "Mirror Lake old ferry steps", "Mirror Lake south breakwater"];
const Asums = [
  "[Fiction] At night on the north pier of Mirror Lake, a lone angler's rod case was seized; the victim said a man came from behind and showed a knife.",
  "[Fiction] At night campers on the east shore of Mirror Lake reported stolen coolers and rods; a knife-wielding man approached from behind and fled toward the water.",
  "[Fiction] At night on the rocky west point of Mirror Lake, a fisherman's backpack was taken; he described a knife held behind him before the suspect ran off.",
  "[Fiction] At night in the picnic area on the south shore of Mirror Lake, two friends lost their tackle boxes; a man with a knife came from behind and demanded the gear.",
  "[Fiction] At night below the watchtower on the east shore of Mirror Lake, night anglers were robbed of rods and reels by a suspect who approached from behind showing a knife.",
  "[Fiction] At night in the reed channel of Mirror Lake, a fisherman's landing net and bag were taken; the knife-carrying suspect came from behind and disappeared into the reeds.",
  "[Fiction] At night at the boat rental dock of Mirror Lake, moored anglers reported stolen equipment; a man approached from behind with a knife and took two rod cases.",
  "[Fiction] At night at fishing stand 6 of Mirror Lake, a teenager's tackle bag was grabbed; the victim said a knife was shown from behind before the man ran.",
  "[Fiction] At night in the gravel bay of Mirror Lake, a couple's fishing gear was stolen; a suspect with a knife approached from behind and ordered them to step back.",
  "[Fiction] At night at the willow inlet of Mirror Lake, an elderly angler's creel and rods were taken; a knife was pressed into view from behind, then the man fled.",
  "[Fiction] At night on the old ferry steps of Mirror Lake, bait boxes and a rod were seized; the victim reported a man coming from behind and showing a knife.",
  "[Fiction] At night on the south breakwater of Mirror Lake, night fishermen were robbed; a knife-wielding suspect approached from behind and took their landing nets.",
];
const Anames = [["Victor Hale", 49, "male"], ["Susan Park", 36, "female"], ["Tom Becker", 28, "male"], ["Nina Ross", 41, "female"], ["Peter Vance", 55, "male"], ["Julia Frost", 33, "female"], ["Omar Haddad", 45, "male"], ["Kevin Doyle", 19, "male"], ["Rachel Moss", 38, "female"], ["George Ives", 66, "male"], ["Paula Nasser", 52, "female"], ["Chris Bell", 30, "male"]];
Asums.forEach((s, i) => {
  const [lat, lng] = grid(i, C.A.cLat, C.A.cLng);
  const d = new Date(Date.UTC(2026, 2, 18 + i * 4, 22 + (i % 3), 10 + i)).toISOString().slice(0, 19);
  add({ summary: s, crimeType: C.A.crimeType, locationType: C.A.locationType, locationText: Aspots[i] + " (fictional address)", lat, lng, spot: Aspots[i], date: d, officer: "Officer E.K. (fictional)", vAge: Anames[i][1], vGender: Anames[i][2], suspects: "unidentified male (fictional)", witnesses: "Ron Turner (fictional)", mo: C.A.mo, weapon: C.A.weapon, persons: [{ name: "Ron Turner", type: "witness", note: "Lake keeper, saw knife suspect", contact: "reached" }, { name: Anames[i][0], type: "victim", age: Anames[i][1], gender: Anames[i][2] }] });
});

// ---------- Cluster B extension (+10): forest cabin arson ----------
const Bspots = ["West Pine ranger cabin", "North Pine depot cabin", "South Pine woodshed", "East Pine lookout cabin", "Pine Hill storage hut", "Deer Trail cabin", "Fox Hollow hut", "Ridge Road cabin", "Lakeview forest shelter", "Old Quarry cabin"];
const Bsums = [
  "[Fiction] At night a ranger cabin in West Pine Forest was set on fire; a gasoline can was found melted by the doorstep.",
  "[Fiction] At night a depot cabin in North Pine Forest burned down; witnesses smelled gasoline and saw a can near the entrance.",
  "[Fiction] At night the woodshed in South Pine Forest was torched; gasoline traces led from the door into the trees.",
  "[Fiction] At night the lookout cabin in East Pine Forest caught fire; an empty gasoline can lay beside the charred steps.",
  "[Fiction] At night a storage hut on Pine Hill was set ablaze; investigators found a gasoline can cap in the ashes.",
  "[Fiction] At night the Deer Trail cabin burned; a witness reported a man carrying a gasoline can minutes before the flames.",
  "[Fiction] At night the Fox Hollow hut was destroyed by fire; gasoline had been poured along the wooden porch.",
  "[Fiction] At night the Ridge Road cabin went up in flames; a red gasoline can was recovered from the bushes nearby.",
  "[Fiction] At night the Lakeview forest shelter burned; scorch patterns showed gasoline accelerant at the doorway.",
  "[Fiction] At night the Old Quarry cabin was set on fire; footprints and a gasoline can were found at the scene.",
];
const Bnames = [["Kara Lane", "witness"], ["Henry Fox", "victim"], ["Irene Cole", "victim"], ["Mark Stone", "victim"], ["Lisa Hart", "victim"], ["Alan Pierce", "victim"], ["Dora Reid", "victim"], ["Carl Benson", "victim"], ["Eva Marsh", "victim"], ["John Slater", "victim"]];
Bsums.forEach((s, i) => {
  const [lat, lng] = grid(i + 3, C.B.cLat, C.B.cLng);
  const d = new Date(Date.UTC(2026, 1, 14 + i * 6, 1 + (i % 3), 5 + i)).toISOString().slice(0, 19);
  const wAge = 30 + ((i * 7) % 35);
  add({ summary: s, crimeType: C.B.crimeType, locationType: C.B.locationType, locationText: Bspots[i] + " (fictional address)", lat, lng, spot: Bspots[i], date: d, officer: "Officer N.B. (fictional)", vAge: wAge, vGender: i % 2 ? "female" : "male", suspects: "unidentified (fictional)", witnesses: "Kara Lane (fictional)", mo: C.B.mo, weapon: C.B.weapon, status: i === 9 ? "closed" : "open", persons: [{ name: "Kara Lane", type: "witness", note: "Forest worker, smelled gasoline", contact: "reached" }] });
});

// ---------- Cluster C extension (+10): daytime impersonation burglary ----------
// (Cluster C base values predate the new C key; defined inline.)
const Cc = { crimeType: "burglary", locationType: "residence", weapon: "crowbar", mo: "tricking door open by impersonation", cLat: 41.05, cLng: 28.97 };
const Cspots = ["Elm Street building 5", "Oak Avenue building 21", "Maple Street building 9", "Cedar Road building 2", "Birch Lane building 14", "Willow Court building 3", "Ash Street building 27", "Poplar Row building 11", "Chestnut Way building 8", "Linden Place building 19"];
const Cdisg = ["water-utility", "electrician", "courier", "meter-reader", "gas inspector", "internet installer", "chimney sweep", "pest control", "delivery driver", "building surveyor"];
const Cstole = ["jewelry", "cash", "a laptop", "a wallet", "a camera", "savings", "a tablet", "watches", "documents", "coins"];
const Cnames = [["Daniel Cole", "suspect"], ["Owen Gray", "witness"], ["Mia Santos", "victim"], ["Leo Fischer", "victim"], ["Ada Novak", "victim"], ["Hugo Brandt", "victim"], ["Sara Lind", "victim"], ["Noah Weiss", "victim"], ["Emma Clark", "victim"], ["Liam Brooks", "victim"]];
Cspots.forEach((spot, i) => {
  const [lat, lng] = grid(i + 5, Cc.cLat, Cc.cLng);
  const d = new Date(Date.UTC(2026, 0, 12 + i * 8, 10 + (i % 5), 15 + i)).toISOString().slice(0, 19);
  add({ summary: `[Fiction] In daylight a suspect using ${Cdisg[i]} impersonation tricked the door open at ${spot} and stole ${Cstole[i]}; crowbar marks were found on the door frame (fictional address).`, crimeType: Cc.crimeType, locationType: Cc.locationType, locationText: spot + " (fictional address)", lat, lng, spot, date: d, officer: "Officer D.N. (fictional)", vAge: 40 + ((i * 9) % 30), vGender: i % 2 ? "male" : "female", suspects: "Daniel Cole (fictional suspect)", witnesses: "Owen Gray (fictional)", mo: Cc.mo, weapon: Cc.weapon, status: i === 9 ? "closed" : "open", persons: [{ name: "Daniel Cole", type: "suspect", note: "Impersonation burglar" }, { name: "Owen Gray", type: "witness", note: "Neighbor, saw uniformed man", contact: "reached" }] });
});

// ---------- Cluster D (new, +10): construction-site copper cable theft ----------
const Dspots = ["Harbor Yard site gate", "North Quay lot 4", "Crane Road depot", "Pier 9 works", "Drydock fence east", "Container row C", "Scaffold yard north", "Gravel pit cabins", "Service road trench", "Substation plot"];
const Dnames = [["Sam Reyes", "witness"], ["Kyle Porter", "victim"], ["Ben Marsh", "victim"], ["Tara Quinn", "victim"], ["Joe Riley", "victim"], ["Ann Wolfe", "victim"], ["Ray Dunn", "victim"], ["Kimura Sato", "victim"], ["Paul Grant", "victim"], ["Deb Cruz", "victim"]];
Dspots.forEach((spot, i) => {
  const [lat, lng] = grid(i + 2, C.D.cLat, C.D.cLng);
  const d = new Date(Date.UTC(2026, 3, 6 + i * 7, 1 + (i % 4), 20 + i)).toISOString().slice(0, 19);
  add({ summary: `[Fiction] At night thieves cut the fence at the ${spot} construction site and stripped copper cable from the drums; bolt cutter marks were found on the mesh (fictional address).`, crimeType: C.D.crimeType, locationType: C.D.locationType, locationText: spot + " (fictional address)", lat, lng, spot, date: d, officer: "Officer C.V. (fictional)", vAge: 35 + ((i * 5) % 20), vGender: "male", suspects: "two unidentified men (fictional)", witnesses: "Sam Reyes (fictional)", mo: C.D.mo, weapon: C.D.weapon, persons: [{ name: "Sam Reyes", type: "witness", note: "Night guard, heard fence cut", contact: "reached" }] });
});

// ---------- Cluster E (new, +8): cafe distraction bag theft ----------
const Espots = ["Central Square cafe", "Station Street bistro", "Market Hall coffee stand", "Riverside terrace cafe", "Old Town espresso bar", "Park Gate tea house", "Harbor View cafe", "Museum Quarter brasserie"];
const Enames = [["Lena Fischer", "witness"], ["Anna Berg", "victim"], ["Jonas Weber", "victim"], ["Maria Silva", "victim"], ["David Osei", "victim"], ["Clara Fontaine", "victim"], ["Yuki Tanaka", "victim"], ["Alex Petro", "victim"]];
Espots.forEach((spot, i) => {
  const [lat, lng] = grid(i + 7, C.E.cLat, C.E.cLng);
  const d = new Date(Date.UTC(2026, 4, 8 + i * 8, 13 + (i % 4), 30 + i)).toISOString().slice(0, 19);
  add({ summary: `[Fiction] In the afternoon at the ${spot}, a woman spilled coffee to distract the victim while her accomplice took the handbag from the chair; the pair left toward the square (fictional address).`, crimeType: C.E.crimeType, locationType: C.E.locationType, locationText: spot + " (fictional address)", lat, lng, spot, date: d, officer: "Officer G.M. (fictional)", vAge: 28 + ((i * 6) % 30), vGender: i % 3 === 0 ? "male" : "female", suspects: "coffee-spilling woman and accomplice (fictional)", witnesses: "Lena Fischer (fictional)", mo: C.E.mo, weapon: C.E.weapon, persons: [{ name: "Lena Fischer", type: "witness", note: "Barista, saw distraction", contact: "reached" }] });
});

// ---------- Distractors (+32): unique one-offs, far apart ----------
const DX = [
  ["pickpocketing", "market", "none", "crowded stall theft", 40.7, 29.5, "In the morning at the Grand Bazaar side street, a wallet was lifted from a coat pocket in the crowd (fictional address).", "2026-05-12T09:30:00"],
  ["vandalism", "parking lot", "spray paint", "overnight car graffiti", 40.75, 29.1, "Overnight in the stadium parking lot, three cars were sprayed with paint (fictional address).", "2026-06-03T04:10:00"],
  ["fraud", "office", "none", "fake invoice email", 41.3, 28.9, "A small office paid a fake supplier invoice received by email; the account was foreign (fictional address).", "2026-04-22T10:00:00"],
  ["assault", "park", "fists", "argument escalating to blows", 41.32, 29.05, "Two joggers argued over a dog in the city park and exchanged blows; one needed stitches (fictional address).", "2026-07-09T18:20:00"],
  ["theft", "bus stop", "none", "snatched phone through window", 40.95, 28.8, "At the central bus stop, a phone was snatched from a passenger's hand as doors closed (fictional address).", "2026-03-30T17:45:00"],
  ["burglary", "warehouse", "angle grinder", "roof hatch entry", 41.25, 28.7, "Thieves entered a warehouse through the roof hatch with an angle grinder and took power tools (fictional address).", "2026-02-18T02:50:00"],
  ["robbery", "kiosk", "toy gun", "night kiosk holdup", 41.02, 29.25, "At night a masked youth held up a newspaper kiosk with what looked like a toy gun and took the till (fictional address).", "2026-06-19T23:15:00"],
  ["arson", "car", "lighter fluid", "torched parked car", 40.88, 29.12, "A parked sedan was torched with lighter fluid in a back street; no witnesses came forward (fictional address).", "2026-05-02T03:30:00"],
  ["theft", "beach", "none", "unattended cooler taken", 40.72, 29.55, "A cooler and towels were taken from an unattended spot on the public beach (fictional address).", "2026-07-15T14:00:00"],
  ["fraud", "hotel", "none", "card skimmer at reception", 41.0, 28.95, "Guest cards were skimmed at a hotel reception terminal over one weekend (fictional address).", "2026-03-08T12:00:00"],
  ["vandalism", "school", "eggs and paint", "night prank on school wall", 41.18, 29.2, "Overnight the school gym wall was pelted with eggs and paint by unknown youths (fictional address).", "2026-06-28T01:00:00"],
  ["theft", "library", "none", "laptop from reading desk", 41.05, 29.1, "A laptop was taken from a reading desk while its owner fetched books (fictional address).", "2026-04-11T15:40:00"],
  ["assault", "bar", "bottle", "bar fight over tab", 40.98, 28.92, "A dispute over a bar tab ended with a bottle thrown; one patron was cut (fictional address).", "2026-05-23T00:30:00"],
  ["burglary", "pharmacy", "hammer", "smashed display case", 41.22, 29.0, "At dawn a pharmacy display case was smashed with a hammer and cosmetics taken (fictional address).", "2026-02-02T05:20:00"],
  ["theft", "train", "none", "luggage switched", 41.08, 28.82, "Identical suitcases were switched on the night train; the victim's bag held documents (fictional address).", "2026-06-11T21:10:00"],
  ["fraud", "market stall", "none", "counterfeit banknotes", 40.93, 29.32, "A market stall accepted two counterfeit banknotes on a busy Saturday (fictional address).", "2026-04-05T11:25:00"],
  ["vandalism", "cemetery", "none", "toppled headstones", 41.28, 29.15, "Three headstones were toppled overnight in the old cemetery (fictional address).", "2026-03-21T06:00:00"],
  ["robbery", "taxi", "knife", "fare dispute robbery", 41.01, 29.05, "A taxi driver was threatened with a knife by a passenger refusing the fare; cash taken (fictional address).", "2026-07-02T22:40:00"],
  ["theft", "gym", "none", "locker pried open", 41.15, 28.98, "A gym locker was pried open and a watch taken during evening hours (fictional address).", "2026-05-19T19:05:00"],
  ["arson", "dumpster", "lighter", "burning dumpster", 40.9, 28.78, "A dumpster was set alight behind restaurants; the fire spread to pallets (fictional address).", "2026-06-25T02:15:00"],
  ["burglary", "church", "none", "donation box forced", 41.19, 29.18, "A church donation box was forced open overnight; small cash taken (fictional address).", "2026-01-29T07:00:00"],
  ["fraud", "online", "none", "fake rental listing", 41.07, 29.07, "A victim paid a deposit for a fake rental listing and the advertiser vanished (fictional address).", "2026-05-30T16:00:00"],
  ["assault", "stadium", "none", "fan brawl after match", 40.98, 29.28, "Rival fans brawled after the match outside the stadium; two detained (fictional address).", "2026-04-27T21:50:00"],
  ["theft", "museum", "none", "gift shop shoplifting", 41.03, 29.0, "Souvenirs were shoplifted from the museum gift shop by a group of teens (fictional address).", "2026-06-07T13:15:00"],
  ["vandalism", "bridge", "spray paint", "tagged bridge pillar", 41.1, 29.3, "A bridge pillar was tagged with large spray-painted letters overnight (fictional address).", "2026-07-21T03:00:00"],
  ["robbery", "jewelry store", "hammer", "smash and grab daylight", 41.06, 28.9, "Two men smashed a jewelry store window with hammers in daylight and grabbed trays (fictional address).", "2026-03-14T11:05:00"],
  ["theft", "airport", "none", "bag taken from carousel", 41.26, 28.75, "A bag was taken from the arrivals carousel and never returned (fictional address).", "2026-05-08T20:30:00"],
  ["fraud", "phone", "none", "fake police call scam", 40.97, 29.08, "An elderly resident paid a fake police fine demanded over the phone (fictional address).", "2026-02-25T09:00:00"],
  ["assault", "metro", "none", "platform shove", 41.09, 28.87, "A commuter was shoved on the metro platform during rush hour; the shover fled (fictional address).", "2026-06-15T08:20:00"],
  ["burglary", "school lab", "screwdriver", "window pried, microscopes taken", 41.21, 29.12, "A school lab window was pried with a screwdriver and two microscopes taken (fictional address).", "2026-01-17T23:40:00"],
  ["theft", "marina", "none", "fuel siphoned", 40.78, 29.45, "Fuel was siphoned from moored boats at the marina overnight (fictional address).", "2026-07-28T04:30:00"],
  ["vandalism", "bus", "scratcher", "etched bus windows", 41.04, 29.14, "Bus windows were etched with a sharp tool along the night route (fictional address).", "2026-04-18T22:00:00"],
];
const Xnames = ["Efe Demir", "Zeynep Aydin", "Murat Celik", "Elif Yilmaz", "Hakan Ozturk", "Selin Kaya", "Burak Sahin", "Gizem Arslan", "Emre Koc", "Deniz Aksoy", "Ayla Turk", "Kaan Erdem", "Ipek Unal", "Serkan Duman", "Asli Gunes", "Tolga Ates", "Hande Kurt", "Volkan Yalcin", "Pinar Ozdemir", "Umut Tas", "Derya Kilic", "Ferit Acar", "Nazli Eren", "Koray Bilgin", "Seda Yavuz", "Tamer Uzun", "Ozlem Fidan", "Riza Cakir", "Meltem Sari", "Cem Dogan", "Aylin Keskin", "Baris Ozer"];
DX.forEach((d, i) => {
  const status = i % 9 === 8 ? "closed" : "open";
  add({ summary: "[Fiction] " + d[7], crimeType: d[0], locationType: d[1], locationText: d[7].split(";")[0].slice(0, 60) + " (fictional address)", lat: d[4], lng: d[5], spot: d[7].split(",")[0].slice(0, 50), date: d[6], officer: "Officer H.T. (fictional)", vAge: 25 + ((i * 11) % 45), vGender: i % 2 ? "female" : "male", suspects: "unidentified (fictional)", witnesses: "none", mo: d[3], weapon: d[2], status, persons: [{ name: Xnames[i], type: "victim", age: 25 + ((i * 11) % 45), gender: i % 2 ? "female" : "male" }] });
});

console.log(`inserted ${n} cases`);
console.log("total:", db.prepare("SELECT COUNT(*) AS n FROM cases").get());
console.log("locations:", db.prepare("SELECT COUNT(*) AS n FROM case_locations").get());
console.log("persons:", db.prepare("SELECT COUNT(*) AS n FROM case_persons").get());
