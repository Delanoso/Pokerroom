import type { Prisma } from "@prisma/client";

export type PokerTableUncheckedCreate = Prisma.PokerTableUncheckedCreateInput;

function isStalePrismaEscalationBlindsError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (!e.message.includes("Unknown argument")) return false;
  return (
    e.message.includes("tournamentEscalatingBlinds") ||
    e.message.includes("tournamentBlindLevelMinutes") ||
    e.message.includes("tournamentBlindLevelMultiplierBps")
  );
}

/**
 * Creates a poker table row. If the running Prisma Client was generated before
 * escalating-blind columns existed (common while `next dev` holds the engine lock),
 * falls back to raw SQL for those fields.
 */
export async function createPokerTableRow(
  tx: Prisma.TransactionClient,
  data: PokerTableUncheckedCreate,
): Promise<{ id: string }> {
  try {
    return await tx.pokerTable.create({ data, select: { id: true } });
  } catch (e) {
    if (!isStalePrismaEscalationBlindsError(e)) throw e;

    const {
      tournamentEscalatingBlinds = false,
      tournamentBlindLevelMinutes = 10,
      tournamentBlindLevelMultiplierBps = 20_000,
      ...rest
    } = data;

    const row = await tx.pokerTable.create({ data: rest, select: { id: true } });

    await tx.$executeRaw`
      UPDATE "PokerTable" SET
        "tournamentEscalatingBlinds" = ${tournamentEscalatingBlinds},
        "tournamentBlindLevelMinutes" = ${tournamentBlindLevelMinutes},
        "tournamentBlindLevelMultiplierBps" = ${tournamentBlindLevelMultiplierBps}
      WHERE "id" = ${row.id}
    `;

    return row;
  }
}
