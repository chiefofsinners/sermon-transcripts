import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { query, type, mode, provider } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const parts = [`[search] ${timestamp}`, `type=${type ?? "standard"}`, `q="${query}"`];
    if (mode) parts.push(`mode=${mode}`);
    if (provider) parts.push(`provider=${provider}`);

    console.log(parts.join(" | "));
  } catch {
    // Fire-and-forget — don't let logging errors affect the user
  }

  return NextResponse.json({ ok: true });
}
