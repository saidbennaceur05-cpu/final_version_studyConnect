// src/auth.ts
import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from 'passport-google-oauth20';
import { PrismaClient, User } from '@prisma/client';

const prisma = new PrismaClient();

// (Optional) helpful log so you know this file got loaded
console.log('[auth] Google strategy loaded');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL!;

// Keep the session small: store only user.id
passport.serializeUser((user: any, done) => {
  done(null, (user as User).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    // if not found, pass false (passport expects false-y)
    done(null, user ?? false);
  } catch (err) {
    done(err as any, false);
  }
});

// Google OAuth 2.0 strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    // Typed verify callback to satisfy TS
    async (_accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value ?? '';
        const name = profile.displayName ?? '';
        const avatar = profile.photos?.[0]?.value ?? '';

        // 1) prefer googleId match (stable), 2) fallback to email (first login)
        let user =
          (await prisma.user.findUnique({ where: { googleId } })) ??
          (email ? await prisma.user.findUnique({ where: { email } }) : null);

        if (!user) {
          // first login → create
          user = await prisma.user.create({
            data: {
              googleId,
              email,
              name,
              avatar,
              ...(refreshToken ? { refreshToken } : {}),
            },
          });
        } else {
          // subsequent login → update changes and set googleId if missing
          const data: Partial<User> = {};
          if (!user.googleId) data.googleId = googleId;
          if (email && user.email !== email) data.email = email;
          if (name && user.name !== name) data.name = name;
          if (avatar && user.avatar !== avatar) data.avatar = avatar;
          // Google only returns refreshToken when you force consent:
          // /auth/google?access_type=offline&prompt=consent
          if (refreshToken) data.refreshToken = refreshToken;

          if (Object.keys(data).length) {
            user = await prisma.user.update({ where: { id: user.id }, data });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err as any);
      }
    }
  )
);
console.log('[auth] callbackURL =', GOOGLE_CALLBACK_URL);


// No export; importing this file in index.ts registers the strategy.
// You still need to set up the /auth/google routes in your Express app.