import { requireActiveSession } from "@/lib/require-active-session";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(gate.userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);

  return NextResponse.json({ token });
}
