import { createCookieSessionStorage, json, redirect, createCookie } from "@remix-run/node";
import jwt from 'jsonwebtoken';

const redirectCookie = createCookie('redirect', {
  path: "/",
  secrets: [env("SESSION_SECRET")],
  sameSite: "lax",
  httpOnly: true,
})

function env(name: string,) {
  if (process.env[name]) return process.env[name]!
  throw new Error(`Missing environment variable: ${name}`)
}

function randomCode(digits: number) {
  let code = ''
  for (let i = 0; i < digits; i++) {
    code += Math.floor(Math.random() * 10)
  }
  return code
}

interface UserRequired {
  name: string
}

interface UserRow {
  id: number | string
  name: string
  role: string[]
}

export type Config<R extends UserRequired, T extends UserRow> = {
  site: string
  users: {
    findUnique: (args: { where: { name: string } | { id: number } }) => Promise<T | null>
    create: (args: { data: R }) => Promise<T>
  }
  inviteCode: {
    findUnique: (args: { where: { code: string } }) => Promise<{ role: string, remaining: number } | null>
  }
}

export function cowpatify<R extends UserRequired, T extends UserRow>(config: Config<R, T>) {
  const punk = {
    config,

    storage: createCookieSessionStorage({
      cookie: {
        name: "session",
        // normally you want this to be `secure: true`
        // but that doesn't work on localhost for Safari
        // https://web.dev/when-to-use-local-https/
        secure: process.env.NODE_ENV === "production",
        secrets: [env("SESSION_SECRET")],
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
      },
    }),

    signOauthToken(userId: number, clientId: string) {
      return jwt.sign({ userId, clientId }, env('JWT_SECRET'), { expiresIn: '1h' })
    },

    async getOauthToken(request: Request) {
      const authHeader = request.headers.get("Authorization")
      if (!authHeader) return null
      const token = authHeader.split(" ")[1]
      return jwt.verify(token, env('JWT_SECRET')) as { userId: number } | null
    },

    async getSession(request: Request) {
      return await this.storage.getSession(request.headers.get("Cookie"))
    },

    async getUserId(request: Request) {
      const oauthToken = await this.getOauthToken(request)
      if (oauthToken) return oauthToken.userId
      const session = await this.getSession(request)
      if (session.has('userId')) return session.get('userId') as number
      return null
    },

    async ensureAPIAuthorized(request: Request) {
      const oauthToken = await this.getOauthToken(request)
      if (!oauthToken) throw new Error("Invalid authorization token.")
      return oauthToken as { userId: number, clientId: string }
    },

    async ensureLoggedIn(request: Request, extraParams = {}) {
      const userId = await this.getUserId(request)
      if (userId) return userId
      const params = new URLSearchParams({ redirect: request.url, ...extraParams });
      throw redirect(`/auth/login?${params.toString()}`)
    },

    async getCurrentUser(request: Request) {
      const userId = await this.getUserId(request)
      if (!userId) return null
      return await config.users.findUnique({ where: { id: userId } })
    },

    async redirectCookieHeader(request: Request) {
      const url = new URL(request.url)
      const redirect = url.searchParams.get('redirect') || '/'
      return redirect ? { "Set-Cookie": await redirectCookie.serialize(redirect) } : undefined
    },

    async redirectAsLoggedOut(request: Request) {
      const params = new URL(request.url).searchParams
      const redirectTo = params.get('redirect') || '/'
      const session = await punk.storage.getSession(request.headers.get("Cookie"))
      session.unset('userId')
      session.unset('email')
      session.unset('roles')
      return redirect(redirectTo, {
        headers: {
          "Set-Cookie": await punk.storage.commitSession(session),
        },
      });
    },

    async checkCode(code: string | null) {
      if (code === null) return 'INVALID';
      const info = await config.inviteCode.findUnique({ where: { code } });
      if (!info) return 'INVALID';
      if (info.remaining <= 0) return 'EXPIRED';
      return info.role;
    },

    // called from auth.invite
    async registerUserFromInvitation({ name }: {name: string}) {
      if (!name) throw new Error("Name is required.");
      const user = await config.users.findUnique({ where: { name } });
      if (user) {
        throw new Error("User already exists.");
      }
      return await config.users.create({ data: { name } as R })
    },

    // called from auth.invite
    async redirectAsLoggedIn(request: Request, user: T) {
      const redirectTo = await redirectCookie.parse(request.headers.get("Cookie") || "") || "/"
      const session = await punk.storage.getSession()
      session.set('userId', user.id)
      session.set('name', user.name)
      session.set("roles", [...user.role || []])
      return redirect(redirectTo, {
        headers: {
          "Set-Cookie": await punk.storage.commitSession(session),
        },
      });
    }
  }
  return punk
}
