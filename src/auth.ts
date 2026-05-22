import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        login: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = z
          .object({
            login: z.string().min(1),
            password: z.string().min(1),
          })
          .safeParse(credentials);
        if (!parsed.success) {
          return null;
        }
        const [{ prisma }, bcrypt] = await Promise.all([
          import("@/lib/prisma"),
          import("bcryptjs"),
        ]);
        const login = parsed.data.login.trim();
        const password = parsed.data.password;
        const user = await prisma.user.findFirst({
          where: {
            OR: [{ username: login.toLowerCase() }, { email: login.toLowerCase() }],
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            passwordHash: true,
            role: true,
            blockedAt: true,
          },
        });
        if (!user) {
          return null;
        }
        if (user.blockedAt) {
          return null;
        }
        const ok = await bcrypt.default.compare(password, user.passwordHash);
        if (!ok) {
          return null;
        }
        return {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          role: user.role,
          blockedAt: user.blockedAt,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.blocked = !!user.blockedAt;
        token.blockedCheckAt = Date.now();
        return token;
      }
      if (token?.id) {
        const refresh =
          trigger === "update" ||
          typeof token.blockedCheckAt !== "number" ||
          Date.now() - (token.blockedCheckAt as number) > 15_000;
        if (refresh) {
          try {
            const { prisma } = await import("@/lib/prisma");
            const u = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { blockedAt: true, role: true },
            });
            if (!u) {
              // Stale JWT after DB reset / deleted user — expire session instead of "blocked" loop.
              delete token.id;
              delete token.role;
              delete token.blocked;
              token.exp = 0;
            } else {
              token.blocked = !!u.blockedAt;
              token.role = u.role;
              token.blockedCheckAt = Date.now();
            }
          } catch {
            /* keep previous token flags */
          }
        }
      }
      return token;
    },
  },
});
