import { requireAdminOperator } from "@/lib/admin-operator";
import { generateTenDigitPassword } from "@/lib/generate-player-password";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

const createPlayerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, and at most: _ . - (no spaces)"),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPlayerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const usernameNorm = parsed.data.username.toLowerCase();
  const emailNorm = `${usernameNorm}@players.local`;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: usernameNorm }, { email: emailNorm }] },
  });
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const plainPassword = generateTenDigitPassword();
  const passwordHash = await bcrypt.hash(plainPassword, 12);
  const firstName = parsed.data.firstName?.trim() || "Player";
  const lastName = parsed.data.lastName?.trim() || usernameNorm;

  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      username: usernameNorm,
      displayUsername: parsed.data.username.trim(),
      email: emailNorm,
      passwordHash,
      isBot: false,
    },
    select: {
      id: true,
      username: true,
      displayUsername: true,
      firstName: true,
      lastName: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      player: {
        id: user.id,
        username: user.username,
        displayUsername: user.displayUsername,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt.toISOString(),
      },
      /** Shown once — send to the player out of band. */
      password: plainPassword,
    },
    { status: 201 },
  );
}
