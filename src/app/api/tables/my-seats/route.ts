import { listMyTableSeats } from "@/lib/my-table-seats";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const seats = await listMyTableSeats(prisma, gate.userId);
  return NextResponse.json({ seats });
}
