import { NextResponse } from "next/server";
import { isRateLimited, recordFailure } from "@/lib/rate-limit";
import { signToken, setAuthCookie, verifyAuth } from "@/lib/upload-auth";

export async function GET(request: Request) {
  if (await verifyAuth(request)) {
    return NextResponse.json({ authenticated: true });
  }
  return NextResponse.json({ authenticated: false }, { status: 401 });
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { blocked, retryAfterSeconds } = isRateLimited(ip);
  if (blocked) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const { password } = await request.json();

  if (!process.env.UPLOAD_PASSWORD) {
    return NextResponse.json(
      { error: "Upload is not configured on this server" },
      { status: 500 },
    );
  }

  if (password !== process.env.UPLOAD_PASSWORD) {
    recordFailure(ip);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await signToken();
  const res = NextResponse.json({ success: true });
  setAuthCookie(res, token);
  return res;
}
