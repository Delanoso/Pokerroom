import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CfrPolicy } from "./types";
import type { PushFoldPolicy } from "./push-fold-game";

const HU_POLICY_PATH = path.join(process.cwd(), "data", "cfr", "hu-abstract-policy.json");
const PUSH_FOLD_PATH = path.join(process.cwd(), "data", "cfr", "push-fold-policy.json");

export function huPolicyPath(): string {
  return process.env.BOT_CFR_HU_POLICY_PATH?.trim() || HU_POLICY_PATH;
}

export function pushFoldPolicyPath(): string {
  return process.env.BOT_CFR_POLICY_PATH?.trim() || PUSH_FOLD_PATH;
}

export async function loadCfrPolicy(filePath?: string): Promise<CfrPolicy | null> {
  const target = filePath ?? huPolicyPath();
  try {
    const raw = await readFile(target, "utf8");
    const p = JSON.parse(raw) as CfrPolicy;
    if (p.version === 2 && p.nodes) return p;
  } catch {
    /* missing */
  }
  return null;
}

export async function saveCfrPolicy(policy: CfrPolicy, filePath?: string): Promise<string> {
  const target = filePath ?? huPolicyPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(policy, null, 2), "utf8");
  return target;
}

export async function loadPushFoldPolicy(): Promise<PushFoldPolicy | null> {
  try {
    const raw = await readFile(pushFoldPolicyPath(), "utf8");
    const p = JSON.parse(raw) as PushFoldPolicy;
    if (p.version === 1 && p.nodes) return p;
  } catch {
    /* missing */
  }
  return null;
}

export async function savePushFoldPolicy(policy: PushFoldPolicy, filePath?: string): Promise<string> {
  const target = filePath ?? pushFoldPolicyPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(policy, null, 2), "utf8");
  return target;
}

/** Sample action index from policy probabilities. */
export function samplePolicyAction(probs: number[]): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i] ?? 0;
    if (r <= acc) return i;
  }
  return probs.length - 1;
}

export function lookupPolicy(policy: CfrPolicy, infoSet: string): number[] | null {
  return policy.nodes[infoSet] ?? null;
}
