import { NextResponse } from "next/server";
import { contentTypeFor, readUpload, safeUploadName } from "../../../../lib/uploads";

type Params = { params: Promise<{ name: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  const safe = safeUploadName(name);
  if (!safe) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
  const buffer = readUpload(safe);
  if (!buffer) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(safe),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
