import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: "USER" | "ADMIN";
      blocked?: boolean;
    };
  }

  interface User {
    id: string;
    role: "USER" | "ADMIN";
    blockedAt?: Date | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "USER" | "ADMIN";
    blocked?: boolean;
    blockedCheckAt?: number;
  }
}
