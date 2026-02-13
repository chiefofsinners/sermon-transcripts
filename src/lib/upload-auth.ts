import { NextResponse } from "next/server";

const COOKIE_NAME = "upload-auth";
const MESSAGE = "upload-authenticated";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.UPLOAD_PASSWORD;
  if (!secret) throw new Error("UPLOAD_PASSWORD not configured");
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signToken(): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(MESSAGE),
  );
  return toHex(sig);
}

async function verifyToken(token: string): Promise<boolean> {
  try {
    const expected = await signToken();
    return token === expected;
  } catch {
    return false;
  }
}

export async function verifyAuth(request: Request): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`),
  );
  if (!match) return false;
  return verifyToken(match[1]);
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearAuthCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
}
