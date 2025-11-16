// src/calendar-fallback.ts
import { google } from 'googleapis';

export async function deleteGoogleEventByQuery(
  refreshToken: string,
  params: { summary: string; timeMin: string; timeMax: string }
) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  const { data } = await calendar.events.list({
    calendarId: 'primary',
    q: params.summary,
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 5,
  });

  for (const e of data.items ?? []) {
    try {
      if (e.id) {
        await calendar.events.delete({ calendarId: 'primary', eventId: e.id });
      }
    } catch (err: any) {
      // Treat not-found/410 as success
      if (err?.code !== 404 && err?.code !== 410) throw err;
    }
  }
}
