/** Replace "Seat N" with display names (safe for client + server). */
export function humanizeResultMessage(msg: string, seatLabel: (seat: number) => string): string {
  return msg.replace(/Seat (\d+)/g, (_, num) => {
    const seat = Number(num) - 1;
    return seatLabel(seat);
  });
}
