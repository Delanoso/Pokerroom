import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function clientHasExpectedDelegates(p: PrismaClient): boolean {
  const x = p as unknown as {
    pokerTable?: { findMany?: unknown };
    tableHand?: { findFirst?: unknown };
    tournamentGroupRegistration?: { groupBy?: unknown };
  };
  return (
    typeof x.pokerTable?.findMany === "function" &&
    typeof x.tableHand?.findFirst === "function" &&
    typeof x.tournamentGroupRegistration?.groupBy === "function"
  );
}

function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing && !clientHasExpectedDelegates(existing)) {
    void existing.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Resolves the client on each access so a replaced global singleton is not stuck forever
 * after `prisma generate` (combined with delegate checks above).
 * Avoids top-level Node-only APIs here so this module stays safe if Edge bundles trace it.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver) as unknown;
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
