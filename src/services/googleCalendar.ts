// calandrie.ts (unchanged, optional tiny improvement)
import { google } from 'googleapis';

export async function deleteGoogleEvent(refreshToken: string, eventId: string) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all', // or 'none' if you don't want emails
    });
  } catch (e: any) {
    // Treat "not found" as success; add 410 Gone as well
    if (e?.code !== 404 && e?.code !== 410) throw e;
  }
}
