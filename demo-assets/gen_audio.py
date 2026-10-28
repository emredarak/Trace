import asyncio, os
import edge_tts

QUOTES = {
  "clusterA_witness_female": ("He approached from behind at night and showed a knife. I was fishing at the pier.", "en-US-AriaNeural"),
  "clusterA_witness_male": ("The man came from behind, held a knife, and took the fishing gear.", "en-US-GuyNeural"),
  "clusterB_witness_male": ("I smelled gasoline and saw a red can near the cabin door before the fire.", "en-US-GuyNeural"),
  "clusterB_witness_female": ("The cabin burned at night. The gasoline can was left by the entrance.", "en-US-AriaNeural"),
  "clusterC_victim_female": ("He said he was from the water company, then forced the door with a crowbar.", "en-US-AriaNeural"),
  "clusterC_witness_male": ("A man in uniform tricked the door open and used a crowbar on the lock.", "en-US-GuyNeural"),
}

async def main():
    os.makedirs("demo-assets", exist_ok=True)
    for name, (text, voice) in QUOTES.items():
        out = f"demo-assets/{name}.mp3"
        if os.path.exists(out) and os.path.getsize(out) > 5000:
            print(f"skip {name} exists")
            continue
        print(f"generating {name} [{voice}]...")
        await edge_tts.Communicate(text, voice).save(out)
        print(f"saved {out} {os.path.getsize(out)} bytes")

asyncio.run(main())
print("done")
