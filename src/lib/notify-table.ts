const socketUrl = process.env.SOCKET_SERVER_URL ?? "http://127.0.0.1:3001";
const secret = process.env.SOCKET_INTERNAL_SECRET;

export async function notifyTableChanged(tableId: string): Promise<void> {
  if (!secret) return;
  try {
    await fetch(`${socketUrl}/internal/broadcast-table`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-socket-secret": secret,
      },
      body: JSON.stringify({ tableId }),
    });
  } catch {
    /* socket server optional during dev */
  }
}
