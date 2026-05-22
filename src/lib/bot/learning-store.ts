import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Per-opponent stats the bot updates from observed table play. */
export type OpponentProfile = {
  opponentUserId: string;
  handsObserved: number;
  /** Saw them put extra chips in preflop (beyond blind). */
  vpipCount: number;
  /** Raised or re-raised preflop (inferred). */
  pfrCount: number;
  /** Times we saw them act when facing a bet (not check option only). */
  facedBet: number;
  foldToBet: number;
  callCount: number;
  raiseCount: number;
};

export type LearningStore = {
  version: 1;
  botUserId: string;
  updatedAt: string;
  opponents: Record<string, OpponentProfile>;
};

function storePath(botUserId: string): string {
  const safe = botUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(process.cwd(), ".data", "bot-learning", `${safe}.json`);
}

function emptyProfile(opponentUserId: string): OpponentProfile {
  return {
    opponentUserId,
    handsObserved: 0,
    vpipCount: 0,
    pfrCount: 0,
    facedBet: 0,
    foldToBet: 0,
    callCount: 0,
    raiseCount: 0,
  };
}

export async function loadLearningStore(botUserId: string): Promise<LearningStore> {
  const file = storePath(botUserId);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as LearningStore;
    if (parsed.version === 1 && parsed.botUserId === botUserId && parsed.opponents) {
      return parsed;
    }
  } catch {
    /* new store */
  }
  return {
    version: 1,
    botUserId,
    updatedAt: new Date().toISOString(),
    opponents: {},
  };
}

export async function saveLearningStore(store: LearningStore): Promise<void> {
  const file = storePath(store.botUserId);
  await mkdir(path.dirname(file), { recursive: true });
  store.updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

export function getOpponentProfile(store: LearningStore, opponentUserId: string): OpponentProfile {
  return store.opponents[opponentUserId] ?? emptyProfile(opponentUserId);
}

export function upsertOpponentProfile(store: LearningStore, patch: OpponentProfile): void {
  store.opponents[patch.opponentUserId] = patch;
}
