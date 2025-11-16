// src/calandrie.ts
import { google } from 'googleapis';
import type { User } from '@prisma/client';
import { deleteGoogleEventByQuery } from './calendar-fallback.ts'; // <- TS/ESM import

/** Build an OAuth2 client from a user's refresh token */
function makeOAuth2Client(refreshToken: string) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/**
 * Create a Google Calendar event for a meeting.
 * Returns the Google event id (string) or null if no refresh token / failure.
 */
export async function createCalendarEventForMeeting(params: {
  creator: User;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  location?: string | null;
  onlineUrl?: string | null; // (not used here; add Meet links yourself if needed)
}): Promise<string | null> {
  if (!params.creator?.refreshToken) return null;

  const calendar = google.calendar({
    version: 'v3',
    auth: makeOAuth2Client(params.creator.refreshToken),
  });

  const event = {
    summary: params.title,
    description: params.description || undefined,
    location: params.location || undefined,
    start: { dateTime: params.start.toISOString() },
    end: { dateTime: params.end.toISOString() },
    // If you want Google Meet links later: set conferenceData + supportsConferenceData
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });

  return res.data.id || null;
}

/**
 * Update a Google Calendar event (title/desc/location/time).
 * No-op if token/eventId invalid; throws only on unexpected errors.
 */
export async function updateGoogleEvent(
  refreshToken: string,
  eventId: string,
  fields: {
    summary?: string;
    description?: string | null;
    location?: string | null;
    start?: Date;
    end?: Date;
  }
): Promise<void> {
  const calendar = google.calendar({
    version: 'v3',
    auth: makeOAuth2Client(refreshToken),
  });

  const body: any = {};
  if (fields.summary) body.summary = fields.summary;
  if (fields.description !== undefined) body.description = fields.description || undefined;
  if (fields.location !== undefined) body.location = fields.location || undefined;
  if (fields.start) body.start = { dateTime: fields.start.toISOString() };
  if (fields.end) body.end = { dateTime: fields.end.toISOString() };

  try {
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: body,
      sendUpdates: 'all',
    });
  } catch (e: any) {
    // Treat not found/gone as ignorable
    if (e?.code !== 404 && e?.code !== 410) throw e;
  }
}

/**
 * Delete a Google Calendar event by exact eventId.
 * Ignores 404/410 (already gone).
 */
export async function deleteGoogleEvent(
  refreshToken: string,
  eventId: string,
  options?: { sendUpdates?: 'all' | 'none' }
): Promise<void> {
  const calendar = google.calendar({
    version: 'v3',
    auth: makeOAuth2Client(refreshToken),
  });

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: options?.sendUpdates ?? 'all',
    });
  } catch (e: any) {
    // treat not found/gone as success
    if (e?.code !== 404 && e?.code !== 410) throw e;
  }
}

/**
 * Best-effort cleanup helper:
 * - If googleEventId exists → delete by id.
 * - Else → delete by query (title within ±windowMinutes around start/end).
 * Never throws (errors are swallowed).
 */
export async function deleteGoogleEventWithFallback(params: {
  creator: User;
  googleEventId?: string | null;
  title: string;
  start: Date;
  end: Date;
  windowMinutes?: number; // default 60
}): Promise<void> {
  if (!params.creator?.refreshToken) return;

  try {
    if (params.googleEventId) {
      await deleteGoogleEvent(params.creator.refreshToken, params.googleEventId);
      return;
    }

    const window = params.windowMinutes ?? 60;
    const timeMin = new Date(params.start.getTime() - window * 60_000).toISOString();
    const timeMax = new Date(params.end.getTime() + window * 60_000).toISOString();

    await deleteGoogleEventByQuery(params.creator.refreshToken, {
      summary: params.title,
      timeMin,
      timeMax,
    });
  } catch {
    // swallow on purpose; calendar cleanup must not block DB deletion
  }
}
