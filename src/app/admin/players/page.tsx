import { AdminDepositQueue } from "@/components/admin-deposit-queue";
import { AdminWithdrawalQueue } from "@/components/admin-withdrawal-queue";
import { listPendingDepositsForAdmin } from "@/lib/deposit-sql";
import {
  groupLedgerByUserSql,
  LEDGER_DEALER_TIP_RECEIVED,
  LEDGER_HOUSE_RAKE_CASH_POT,
  LEDGER_TOURNAMENT_FEE_RECEIVED,
} from "@/lib/house-fees-sql";
import { prisma } from "@/lib/prisma";
import { listPendingWithdrawalsForAdmin } from "@/lib/withdrawal-sql";
import { getChipBalance } from "@/lib/wallet";
import { auth } from "@/auth";
import { AdminCreatePlayerForm } from "@/components/admin-create-player-form";
import Link from "next/link";
import { AdminAdjustForm } from "../admin-adjust-form";
import { AdminUserActions } from "../admin-user-actions";

export default async function AdminPlayersPage() {
  const session = await auth();
  const operatorId = session!.user!.id!;

  const users = await prisma.user.findMany({
    where: { isBot: false },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      blockedAt: true,
    },
  });

  const balances = await Promise.all(
    users.map(async (u) => ({ id: u.id, chips: await getChipBalance(u.id) })),
  );
  const chipById = Object.fromEntries(balances.map((b) => [b.id, b.chips]));

  const [pendingWithdrawalsRaw, pendingDepositsRaw] = await Promise.all([
    listPendingWithdrawalsForAdmin(),
    listPendingDepositsForAdmin(),
  ]);
  const pendingWithdrawals = pendingWithdrawalsRaw.map((w) => ({
    id: w.id,
    amountChips: w.amountChips,
    createdAt: w.createdAt.toISOString(),
    username: w.username,
    email: w.email,
  }));
  const pendingDeposits = pendingDepositsRaw.map((d) => ({
    id: d.id,
    amountChips: d.amountChips,
    createdAt: d.createdAt.toISOString(),
    username: d.username,
    email: d.email,
  }));

  const [rakeByUser, tournamentFeeByUser, dealerTipsByUser] = await Promise.all([
    groupLedgerByUserSql(prisma, LEDGER_HOUSE_RAKE_CASH_POT),
    groupLedgerByUserSql(prisma, LEDGER_TOURNAMENT_FEE_RECEIVED),
    groupLedgerByUserSql(prisma, LEDGER_DEALER_TIP_RECEIVED),
  ]);

  const rakeByUserId = Object.fromEntries(
    rakeByUser.map((r) => [r.userId, { chips: r.sumChips, events: r.count }]),
  );
  const tournamentFeeByUserId = Object.fromEntries(
    tournamentFeeByUser.map((r) => [r.userId, { chips: r.sumChips, events: r.count }]),
  );
  const tipsByUserId = Object.fromEntries(
    dealerTipsByUser.map((r) => [r.userId, { chips: r.sumChips, tips: r.count }]),
  );

  return (
    <div className="flex flex-col gap-8">
      <AdminCreatePlayerForm />
      <AdminDepositQueue initial={pendingDeposits} />
      <AdminWithdrawalQueue initial={pendingWithdrawals} />

      <section className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-950/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium text-right">Chips</th>
              <th className="px-4 py-3 font-medium text-right">Rake received</th>
              <th className="px-4 py-3 font-medium text-right">Tourn. fees</th>
              <th className="px-4 py-3 font-medium text-right">Tips</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
            {users.map((u) => (
              <tr key={u.id} className="text-zinc-200">
                <td className="px-4 py-3">
                  <span className="font-medium text-zinc-100">@{u.username}</span>
                  <span className="block text-xs text-zinc-500">
                    {u.firstName} {u.lastName}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                <td className="px-4 py-3 text-zinc-400">{u.role}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-400">
                  {(chipById[u.id] ?? 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-200/90">
                  {(rakeByUserId[u.id]?.chips ?? 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-200/95">
                  {(tournamentFeeByUserId[u.id]?.chips ?? 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-violet-200/90">
                  {(tipsByUserId[u.id]?.chips ?? 0).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {u.blockedAt ? (
                    <span className="text-xs font-medium text-amber-400">Blocked</span>
                  ) : (
                    <span className="text-xs font-medium text-emerald-500/90">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Link
                      href={`/admin/records?user=${encodeURIComponent(u.id)}`}
                      className="text-xs font-medium text-emerald-400/90 hover:text-emerald-300"
                    >
                      History
                    </Link>
                    <AdminUserActions
                      userId={u.id}
                      username={u.username}
                      isBlocked={!!u.blockedAt}
                      isSelf={u.id === operatorId}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AdminAdjustForm users={users.map((u) => ({ id: u.id, username: u.username }))} />
    </div>
  );
}
