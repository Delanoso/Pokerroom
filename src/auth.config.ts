import type { NextAuthConfig } from "next-auth";

/** Edge/proxy-safe Auth.js config (no Prisma). Used by middleware/proxy. */
export const authConfig = {
  trustHost: true,
  basePath: "/api/auth",
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.blocked = !!user.blockedAt;
        token.blockedCheckAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (!token.id) {
        return session;
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "USER" | "ADMIN";
        session.user.blocked = token.blocked === true;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
