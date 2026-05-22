"use client";

import { io, type Socket } from "socket.io-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

type Listener = () => void;

type TableSocketContextValue = {
  watch: (tableId: string, listener: Listener) => void;
  unwatch: (tableId: string, listener: Listener) => void;
  connected: boolean;
};

const TableSocketContext = createContext<TableSocketContextValue | null>(null);

export function TableSocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const watchedRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const tokenRes = await fetch("/api/socket/token");
      if (!tokenRes.ok || cancelled) return;
      const { token } = (await tokenRes.json()) as { token?: string };
      if (!token || cancelled) return;

      const socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket", "polling"],
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (cancelled) return;
        setConnected(true);
        for (const tableId of watchedRef.current) {
          socket.emit("table:watch", tableId);
        }
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("table:changed", (payload?: { tableId?: string }) => {
        const id = payload?.tableId;
        if (id) {
          const set = listenersRef.current.get(id);
          set?.forEach((fn) => fn());
          return;
        }
        listenersRef.current.forEach((set) => set.forEach((fn) => fn()));
      });
    }

    void connect();

    return () => {
      cancelled = true;
      setConnected(false);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const watch = useCallback((tableId: string, listener: Listener) => {
    let set = listenersRef.current.get(tableId);
    if (!set) {
      set = new Set();
      listenersRef.current.set(tableId, set);
    }
    set.add(listener);

    if (!watchedRef.current.has(tableId)) {
      watchedRef.current.add(tableId);
      socketRef.current?.emit("table:watch", tableId);
    }
  }, []);

  const unwatch = useCallback((tableId: string, listener: Listener) => {
    const set = listenersRef.current.get(tableId);
    set?.delete(listener);
    if (set && set.size === 0) {
      listenersRef.current.delete(tableId);
      watchedRef.current.delete(tableId);
      socketRef.current?.emit("table:unwatch", tableId);
    }
  }, []);

  const value = useMemo(
    () => ({ watch, unwatch, connected }),
    [watch, unwatch, connected],
  );

  return <TableSocketContext.Provider value={value}>{children}</TableSocketContext.Provider>;
}

export function useTableSocket() {
  const ctx = useContext(TableSocketContext);
  if (!ctx) {
    throw new Error("useTableSocket requires TableSocketProvider");
  }
  return ctx;
}

export function useTableSocketOptional() {
  return useContext(TableSocketContext);
}
