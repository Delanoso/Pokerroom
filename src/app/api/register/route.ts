import { NextResponse } from "next/server";

/** Public registration is disabled — operators create accounts from Admin → Players. */
export async function POST() {
  return NextResponse.json(
    { error: "Public registration is disabled. Contact the operator for an account." },
    { status: 403 },
  );
}
