import { recordTournamentEntryFee, refundTournamentEntryFee } from "@/lib/house-fees";

import { notifyTableChanged } from "@/lib/notify-table";

import { prisma } from "@/lib/prisma";

import { requireActiveSession } from "@/lib/require-active-session";

import {

  countGroupRegistrations,

  groupRegistrationCapacity,

  listGroupTableIds,

  syncTournamentGroupTables,

  userSeatedInGroup,

} from "@/lib/tournament-group";

import {

  registrationWindowOpen,

  unregisterWindowOpen,

  userMayViewPrivateTournament,

} from "@/lib/tournament-policy";

import { getAvailableChipBalance, getAvailableChipBalanceTx } from "@/lib/wallet";

import { PokerTableKind } from "@prisma/client";

import { NextResponse } from "next/server";



type Params = { params: Promise<{ id: string }> };



async function notifyTournamentTables(tableId: string, groupId: string | null) {

  if (groupId) {

    const ids = await listGroupTableIds(prisma, groupId);

    for (const tid of ids) void notifyTableChanged(tid);

  } else {

    void notifyTableChanged(tableId);

  }

}



export async function POST(_request: Request, { params }: Params) {

  const gate = await requireActiveSession();

  if (!gate.ok) return gate.response;



  const { id: tableId } = await params;

  const table = await prisma.pokerTable.findUnique({

    where: { id: tableId },

    select: {

      id: true,

      name: true,

      closedAt: true,

      kind: true,

      startsAt: true,

      createdAt: true,

      createdById: true,

      maxSeats: true,

      tournamentListingVisibility: true,

      tournamentGroupId: true,

      tournamentEntryFeeChips: true,

    },

  });



  if (!table || table.closedAt) {

    return NextResponse.json({ error: "Table not found" }, { status: 404 });

  }

  if (table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) {

    return NextResponse.json({ error: "Registration is only for scheduled tournaments" }, { status: 400 });

  }



  const mayView = await userMayViewPrivateTournament(

    prisma,

    table.id,

    table.kind,

    table.tournamentListingVisibility,

    gate.userId,

    table.createdById,

    gate.role,

  );

  if (!mayView) {

    return NextResponse.json({ error: "Table not found" }, { status: 404 });

  }



  const now = new Date();

  if (!registrationWindowOpen(now, table.createdAt, table.startsAt)) {

    return NextResponse.json(

      { error: "Registration is not open for this tournament right now" },

      { status: 400 },

    );

  }



  const entryFee = table.tournamentEntryFeeChips ?? 0;



  if (table.tournamentGroupId) {

    const existing = await prisma.tournamentGroupRegistration.findUnique({

      where: { groupId_userId: { groupId: table.tournamentGroupId, userId: gate.userId } },

      select: { id: true },

    });

    if (existing) {

      return NextResponse.json({ ok: true, already: true });

    }



    const count = await countGroupRegistrations(prisma, table.tournamentGroupId);

    const cap = await groupRegistrationCapacity(prisma, table.tournamentGroupId);

    if (count >= cap) {

      return NextResponse.json(

        { error: "This tournament is full — registration matches total seats across all tables in the flight" },

        { status: 400 },

      );

    }



    try {

      await prisma.$transaction(async (tx) => {

        if (entryFee > 0) {

          const available = await getAvailableChipBalanceTx(tx, gate.userId);

          if (available < entryFee) {

            throw new Error("INSUFFICIENT");

          }

          await recordTournamentEntryFee(tx, gate.userId, table.createdById, entryFee, table.name);

        }

        await tx.tournamentGroupRegistration.create({

          data: { groupId: table.tournamentGroupId!, userId: gate.userId },

        });

      });

    } catch (e) {

      if (e instanceof Error && e.message === "INSUFFICIENT") {

        return NextResponse.json(

          { error: `Not enough Zar in your account (registration fee is ${entryFee.toLocaleString()} Zar)` },

          { status: 400 },

        );

      }

      throw e;

    }



    await syncTournamentGroupTables(prisma, table.tournamentGroupId);

    await notifyTournamentTables(tableId, table.tournamentGroupId);

    const viewerBalance = await getAvailableChipBalance(gate.userId);

    return NextResponse.json({ ok: true, viewerBalance });

  }



  const regCount = await prisma.tournamentRegistration.count({ where: { tableId } });

  if (regCount >= table.maxSeats) {

    return NextResponse.json(

      { error: "This tournament is full — registration matches available seats" },

      { status: 400 },

    );

  }



  const existing = await prisma.tournamentRegistration.findUnique({

    where: { tableId_userId: { tableId, userId: gate.userId } },

    select: { id: true },

  });

  if (existing) {

    return NextResponse.json({ ok: true, already: true });

  }



  try {

    await prisma.$transaction(async (tx) => {

      if (entryFee > 0) {

        const available = await getAvailableChipBalanceTx(tx, gate.userId);

        if (available < entryFee) {

          throw new Error("INSUFFICIENT");

        }

        await recordTournamentEntryFee(tx, gate.userId, table.createdById, entryFee, table.name);

      }

      await tx.tournamentRegistration.create({

        data: { tableId, userId: gate.userId },

      });

    });

  } catch (e) {

    if (e instanceof Error && e.message === "INSUFFICIENT") {

      return NextResponse.json(

        { error: `Not enough Zar in your account (registration fee is ${entryFee.toLocaleString()} Zar)` },

        { status: 400 },

      );

    }

    throw e;

  }



  await notifyTournamentTables(tableId, null);

  const viewerBalance = await getAvailableChipBalance(gate.userId);

  return NextResponse.json({ ok: true, viewerBalance });

}



export async function DELETE(_request: Request, { params }: Params) {

  const gate = await requireActiveSession();

  if (!gate.ok) return gate.response;



  const { id: tableId } = await params;

  const table = await prisma.pokerTable.findUnique({

    where: { id: tableId },

    select: {

      id: true,

      name: true,

      closedAt: true,

      kind: true,

      startsAt: true,

      createdAt: true,

      createdById: true,

      tournamentListingVisibility: true,

      tournamentGroupId: true,

      tournamentEntryFeeChips: true,

    },

  });



  if (!table || table.closedAt) {

    return NextResponse.json({ error: "Table not found" }, { status: 404 });

  }

  if (table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) {

    return NextResponse.json({ error: "Not a tournament" }, { status: 400 });

  }



  const mayView = await userMayViewPrivateTournament(

    prisma,

    table.id,

    table.kind,

    table.tournamentListingVisibility,

    gate.userId,

    table.createdById,

    gate.role,

  );

  if (!mayView) {

    return NextResponse.json({ error: "Table not found" }, { status: 404 });

  }



  const now = new Date();

  if (!unregisterWindowOpen(now, table.startsAt)) {

    return NextResponse.json(

      { error: "Unregister closes 30 seconds before the tournament starts" },

      { status: 400 },

    );

  }



  const entryFee = table.tournamentEntryFeeChips ?? 0;



  if (table.tournamentGroupId) {

    const seated = await userSeatedInGroup(prisma, table.tournamentGroupId, gate.userId);

    if (seated) {

      return NextResponse.json({ error: "Leave your seat before unregistering" }, { status: 400 });

    }

    try {

      await prisma.$transaction(async (tx) => {

        await tx.tournamentGroupRegistration.delete({

          where: { groupId_userId: { groupId: table.tournamentGroupId!, userId: gate.userId } },

        });

        if (entryFee > 0) {

          await refundTournamentEntryFee(tx, gate.userId, table.createdById, entryFee, table.name);

        }

      });

    } catch {

      return NextResponse.json({ error: "You are not registered" }, { status: 400 });

    }

    await syncTournamentGroupTables(prisma, table.tournamentGroupId);

    await notifyTournamentTables(tableId, table.tournamentGroupId);

    const viewerBalance = await getAvailableChipBalance(gate.userId);

    return NextResponse.json({ ok: true, viewerBalance });

  }



  const seated = await prisma.tableSeat.findFirst({

    where: { tableId, userId: gate.userId },

    select: { id: true },

  });

  if (seated) {

    return NextResponse.json({ error: "Leave your seat before unregistering" }, { status: 400 });

  }



  try {

    await prisma.$transaction(async (tx) => {

      await tx.tournamentRegistration.delete({

        where: { tableId_userId: { tableId, userId: gate.userId } },

      });

      if (entryFee > 0) {

        await refundTournamentEntryFee(tx, gate.userId, table.createdById, entryFee, table.name);

      }

    });

  } catch {

    return NextResponse.json({ error: "You are not registered" }, { status: 400 });

  }



  await notifyTournamentTables(tableId, null);

  const viewerBalance = await getAvailableChipBalance(gate.userId);

  return NextResponse.json({ ok: true, viewerBalance });

}


