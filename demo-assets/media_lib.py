import sqlite3, os, re, json, time, base64, random, subprocess
import requests

KEY = os.environ.get("MODEL_API_KEY")
assert KEY, "set MODEL_API_KEY"
DB = "D:\\Projects\\Trace\\trace.db"
UP = "D:\\Projects\\Trace\\uploads"

H = {"Authorization": f"Bearer {KEY}"}

def sam_boxes(img_bytes, concept):
    b64 = base64.b64encode(img_bytes).decode()
    mime = "image/webp"
    r = requests.post("https://api.meta.ai/v1/responses", headers={**H, "Content-Type": "application/json"},
        json={"model": "sam-3.1", "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": concept},
            {"type": "input_image", "image_url": f"data:{mime};base64,{b64}"}]}]},
        timeout=180)
    r.raise_for_status()
    texts = []
    for item in r.json().get("output", []):
        for part in (item.get("content") or []):
            if isinstance(part.get("text"), str): texts.append(part["text"])
    t = " ".join(texts)
    boxes = []
    for m in re.finditer(r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)[^|]*\|>", t):
        x1, y1, x2, y2, w, h = map(int, m.groups())
        if not w or not h: continue
        x = min(max(x1 / w, 0), 1); y = min(max(y1 / h, 0), 1)
        bw = min(max((x2 - x1 + 1) / w, 0), 1 - x); bh = min(max((y2 - y1 + 1) / h, 0), 1 - y)
        if bw > 0 and bh > 0: boxes.append({"x": x, "y": y, "w": bw, "h": bh, "label": concept})
    return boxes

def gen_image(prompt):
    last = None
    for attempt in range(3):
        try:
            from openai import OpenAI
            client = OpenAI(base_url="https://api.meta.ai/v1", api_key=KEY)
            resp = client.responses.create(model="muse-image-1.0", input=prompt)
            for item in resp.model_dump().get("output", []):
                if isinstance(item, dict) and isinstance(item.get("result"), str) and len(item["result"]) > 1000:
                    return base64.b64decode(item["result"])
        except Exception as e:
            last = e; time.sleep(10)
    raise RuntimeError(f"image failed: {last}")

def tts_wav(text, voice, out_mp3, out_wav):
    import asyncio, edge_tts
    asyncio.run(edge_tts.Communicate(text, voice).save(out_mp3))
    ff = subprocess.check_output(["python", "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], text=True).strip().splitlines()[-1]
    subprocess.run([ff, "-y", "-i", out_mp3, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", out_wav],
                   check=True, capture_output=True)

def transcribe_wav(wav_bytes, tag):
    files = {"request": ("request", json.dumps({"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "DIARIZATION", "languageBias": ["English"]}), "application/json"),
             "audio": (tag, wav_bytes, "audio/wav")}
    r = requests.post("https://api.meta.ai/v1/asr/transcribe", headers={**H, "Accept": "application/json"}, files=files, timeout=120)
    r.raise_for_status()
    d = r.json()
    segs = [{"speaker": t.get("speaker", "A"), "text": t["transcript"], "start": t["startMs"] / 1000, "end": t["endMs"] / 1000} for t in d.get("turns", []) if t.get("transcript")]
    if not segs: segs = [{"text": d["transcript"]}]
    return {"text": d["transcript"], "segments": segs}

def store_upload(case_id, data, ext):
    import uuid
    name = f"{case_id}-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}{ext}"
    open(os.path.join(UP, name), "wb").write(data)
    return name
