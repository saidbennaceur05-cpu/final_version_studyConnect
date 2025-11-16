// src/routes/meetings.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  createCalendarEventForMeeting,
  deleteGoogleEventWithFallback,
  updateGoogleEvent,
} from '../calendar.ts';
import { validate } from '../middlewares/validate.ts';
import { CreateMeetingSchema, PatchMeetingSchema } from '../validation/meeting.ts';

const prisma = new PrismaClient();
const r = Router();

// Auth: cookie session OR dev bearer-admin
function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (process.env.ADMIN_TOKEN && auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    if (token === process.env.ADMIN_TOKEN) {
      req.user = { id: 'admin', role: 'admin' };
      return next();
    }
  }
  if (!req.user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  next();
}

// LIST with filters
// Important: only return meetings that did not end yet (endTime > now)
r.get('/', async (req, res) => {
  const { subject, level, specialization, q, from, to } = req.query as Record<
    string,
    string | undefined
  >;

  const where: any = {};
  const now = new Date();

  // hide past meetings: they will not be shown in the main list
  where.endTime = { gt: now };

  if (subject) where.subject = { contains: subject, mode: 'insensitive' };
  if (level) where.level = { equals: level };
  if (specialization) where.specialization = { equals: specialization };
  if (from || to) {
    where.startTime = {};
    if (from) where.startTime.gte = new Date(from);
    if (to) where.startTime.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
    ];
  }

  const items = await prisma.meeting.findMany({
    where,
    orderBy: { startTime: 'asc' },
    include: { attendees: true, createdBy: true },
  });
  res.json(items);
});

// CREATE
r.post('/', requireAuth, validate(CreateMeetingSchema), async (req: any, res) => {
  const {
    title,
    description,
    subject,
    level,
    specialization,
    startTime,
    endTime,
    location,
    onlineUrl,
  } = req.body;

  const meeting = await prisma.meeting.create({
    data: {
      title,
      description,
      subject,
      level,
      specialization,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      location,
      onlineUrl,
      createdById: req.user.id,
    },
  });

  // add creator as attendee
  await prisma.meetingAttendee.create({
    data: { meetingId: meeting.id, userId: req.user.id, status: 'going' },
  });

  // Try Google Calendar (best effort)
  try {
    const geid = await createCalendarEventForMeeting({
      creator: req.user,
      title,
      description,
      start: new Date(startTime),
      end: new Date(endTime),
      location,
      onlineUrl,
    });
    if (geid) {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { googleEventId: geid },
      });
    }
  } catch (e) {
    console.warn('[calendar] insert failed:', e);
  }

  const full = await prisma.meeting.findUnique({
    where: { id: meeting.id },
    include: { attendees: true, createdBy: true },
  });
  res.status(201).json(full);
});

// PATCH (edit + sync to Google)
r.patch('/:id', requireAuth, validate(PatchMeetingSchema), async (req: any, res) => {
  const id = req.params.id;
  const {
    title,
    description,
    subject,
    level,
    specialization,
    startTime,
    endTime,
    location,
    onlineUrl,
  } = req.body;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, refreshToken: true } } },
  });
  if (!meeting) return res.status(404).json({ ok: false, error: 'Not found' });

  const isOwner = meeting.createdById === req.user?.id;
  const isAdmin = req.user?.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(specialization !== undefined ? { specialization } : {}),
      ...(startTime ? { startTime: new Date(startTime) } : {}),
      ...(endTime ? { endTime: new Date(endTime) } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(onlineUrl !== undefined ? { onlineUrl } : {}),
    },
    include: { attendees: true, createdBy: true },
  });

  // Best effort Google sync if we have event id + refresh token
  if (meeting.googleEventId && meeting.createdBy?.refreshToken) {
    try {
      await updateGoogleEvent(meeting.createdBy.refreshToken, meeting.googleEventId, {
        summary: updated.title,
        description: updated.description ?? undefined,
        location: updated.location ?? undefined,
        start: updated.startTime,
        end: updated.endTime,
      });
    } catch (e) {
      console.warn('[calendar] update failed:', e);
    }
  }

  res.json(updated);
});

// JOIN
// Important: prevent joining meetings that already ended
r.post('/:id/join', requireAuth, async (req: any, res) => {
  const id = req.params.id;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
  });

  if (!meeting) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  const now = new Date();
  if (meeting.endTime <= now) {
    return res.status(400).json({ ok: false, error: 'Meeting already ended' });
  }

  try {
    const join = await prisma.meetingAttendee.create({
      data: { meetingId: id, userId: req.user.id, status: 'going' },
    });
    res.json(join);
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(200).json({ ok: true, note: 'Already joined' });
    res.status(400).json({ ok: false, error: 'Join failed' });
  }
});

// LEAVE
r.post('/:id/leave', requireAuth, async (req: any, res) => {
  const id = req.params.id;
  await prisma.meetingAttendee.deleteMany({
    where: { meetingId: id, userId: req.user.id },
  });
  res.json({ ok: true });
});

// DETAIL
r.get('/:id', async (req, res) => {
  const id = req.params.id;
  const item = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: true, createdBy: true },
  });
  if (!item) return res.status(404).json({ ok: false });
  res.json(item);
});

// DELETE (creator or admin)
r.delete('/:id', requireAuth, async (req: any, res) => {
  const id = req.params.id;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, refreshToken: true } } },
  });

  if (!meeting) return res.status(404).json({ ok: false, error: 'Not found' });

  const isOwner = meeting.createdById === req.user?.id;
  const isAdmin = req.user?.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });

  // Best effort Google cleanup (never blocks DB deletion)
  try {
    await deleteGoogleEventWithFallback({
      creator: meeting.createdBy as any,
      googleEventId: meeting.googleEventId ?? undefined,
      title: meeting.title,
      start: meeting.startTime,
      end: meeting.endTime,
    });
  } catch (e) {
    console.warn('[calendar] delete fallback failed:', e);
  }

  await prisma.$transaction([
    prisma.meetingAttendee.deleteMany({ where: { meetingId: id } }),
    prisma.meeting.delete({ where: { id } }),
  ]);

  res.json({ ok: true });
});

export default r;
