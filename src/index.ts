// src/index.ts
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import passport from 'passport';
import { PrismaClient } from '@prisma/client';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

import './auth.js';
import meetingsRouter from './routes/meetings.js';
import { getRecommendations } from './services/recommendations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT ?? 4000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me';
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) app.set('trust proxy', 1);

// middleware
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    name: 'connect.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000,
      dbRecordIdIsSessionId: true,
    }),
  })
);

app.use(passport.initialize());
app.use(passport.session());

// update lastSeen when a logged-in user hits the server
app.use(async (req: any, _res, next) => {
  try {
    const u = (req as any).user as { id?: string } | undefined;
    if (u?.id) {
      await prisma.user.update({
        where: { id: u.id },
        data: { lastSeen: new Date() },
      });
    }
  } catch { }
  next();
});

// optional session debug
if (process.env.DEBUG_SESS === '1') {
  app.use((req, _res, next) => {
    const u = (req as any).user as { id?: string } | undefined;
    console.log('SESS', req.method, req.path, 'sid=', (req as any).sessionID, 'user=', u?.id ?? null);
    next();
  });
}

// auth routes
app.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
    accessType: 'offline',
    prompt: 'consent',
    includeGrantedScopes: true,
  } as any)
);

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err: any, user: any) => {
    if (err) return next(err);
    if (!user) return res.redirect('/auth/failure');
    (req as any).logIn(user, (err2: any) => {
      if (err2) return next(err2);
      req.session.save(() => res.redirect('/'));
    });
  })(req, res, next);
});

app.get('/auth/success', (req, res) => {
  if (!(req as any).user) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ ok: false });
  res.json(user);
});

app.post('/auth/logout', (req, res) => {
  (req as any).logout((err: any) => {
    if (err) return res.status(500).json({ ok: false, error: String(err) });
    req.session.destroy(() => res.json({ ok: true }));
  });
});

// root -> demo page
app.get('/', (_req, res) => res.redirect('/demo.html'));

// api routes
app.use('/api/meetings', meetingsRouter);

// stats
app.get('/api/stats', async (_req, res) => {
  const now = new Date();
  const d24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const d7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, active24h, active7d, upcoming, week, subjects] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeen: { gte: d24h } } }),
    prisma.user.count({ where: { lastSeen: { gte: d7d } } }),
    prisma.meeting.count({ where: { startTime: { gte: now } } }),
    prisma.meeting.count({
      where: {
        startTime: {
          gte: now,
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.meeting.groupBy({ by: ['subject'], where: { subject: { not: null } } }),
  ]);

  res.json({
    totalUsers,
    activeUsers24h: active24h,
    activeUsers7d: active7d,
    upcomingMeetings: upcoming,
    weekMeetings: week,
    subjectsCount: subjects.length,
  });
});

// AI-powered recommendations
app.get('/api/recommendations', async (req: any, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    const recommendations = await getRecommendations(user.id);
    res.json(recommendations);
  } catch (error) {
    console.error('[recommendations] Error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get recommendations' });
  }
});
// ---------- Health ----------
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});


// error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('unhandled', err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
