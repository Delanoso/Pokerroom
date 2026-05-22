import type { PrismaClient } from "@prisma/client";

export async function findActiveTableHand(prisma: PrismaClient, tableId: string) {
  return prisma.tableHand.findFirst({
    where: { tableId, complete: false },
    orderBy: { createdAt: "desc" },
  });
}
