import os, base64, json
from openai import OpenAI

API_KEY = os.environ.get("MODEL_API_KEY") or os.environ.get("META_API_KEY")
if not API_KEY:
    raise SystemExit("Set MODEL_API_KEY env first")
client = OpenAI(base_url="https://api.meta.ai/v1", api_key=API_KEY)

PROMPTS = {
  "clusterA_pier_knife": "Photorealistic crime scene evidence photo, night lakeside wooden pier, fishing rods and tackle bag on planks, a kitchen knife lying beside the bag, flashlight illumination, police evidence marker number 1, 3:2, no people, no text overlay",
  "clusterA_tackle_closeup": "Close-up evidence photo at night, open fishing tackle bag on wooden pier, steel knife with black handle next to lures, lakeside background blurred, flash photography, no people",
  "clusterA_shore_night": "Night lakeshore crime scene, wooden pier extending into calm lake, flashlight beam on ground, fishing gear scattered, evidence marker, photorealistic, no people",
  "clusterB_cabin_burn": "Burnt wooden cabin in pine forest at night, charred walls, smoke, red gasoline can standing near the door, police tape, photorealistic wide shot, no people",
  "clusterB_can_closeup": "Close-up of red gasoline can with soot marks on forest ground in front of burnt cabin door, night, flash photo, evidence marker, photorealistic, no people",
  "clusterC_door_crowbar": "Daylight apartment door with crowbar scratch marks around lock, door slightly open, hallway interior, photorealistic evidence photo, no people",
  "clusterC_crowbar_floor": "Close-up of metal crowbar lying on floor next to scratched white apartment door frame, daylight, evidence marker, photorealistic, no people",
}

os.makedirs("demo-assets", exist_ok=True)
for name, prompt in PROMPTS.items():
    out = f"demo-assets/{name}.webp"
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        print(f"skip {name} exists")
        continue
    print(f"generating {name}...")
    resp = client.responses.create(model="muse-image-1.0", input=prompt)
    d = resp.model_dump()
    # find image_generation output with base64 result
    b64 = None
    for item in d.get("output", []):
        if isinstance(item, dict) and item.get("result"):
            r = item["result"]
            if isinstance(r, str) and len(r) > 1000:
                b64 = r
                break
    if not b64:
        print(f"NO IMAGE for {name}: {json.dumps(d)[:1500]}")
        continue
    with open(out, "wb") as f:
        f.write(base64.b64decode(b64))
    print(f"saved {out} {os.path.getsize(out)} bytes")
print("done")
