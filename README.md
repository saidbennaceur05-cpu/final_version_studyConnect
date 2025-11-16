# StudyConnect Server

Quick start backend for StudyConnect.

## Stack
- Node.js + TypeScript
- Express
- Passport Google OAuth
- Prisma + SQLite
- Google Calendar API

## Setup
1) Create a Google OAuth credential
   - App type: Web
   - Authorized redirect URI: `http://localhost:4000/auth/google/callback`
   - Get Client ID and Client Secret

2) Copy `.env.example` to `.env` and fill values

3) Install and run
```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## Auth
- Sign in: http://localhost:4000/auth/google
- Check session: GET /auth/me

## Meetings API
- List: GET /api/meetings
- Create: POST /api/meetings
```json
{
  "title": "Math Exam Prep",
  "subject": "Math",
  "level": "1ere",
  "specialization": "ISI",
  "startTime": "2025-09-24T17:00:00.000Z",
  "endTime": "2025-09-24T18:00:00.000Z",
  "description": "Ch3 review",
  "location": "Library room A",
  "onlineUrl": "https://meet.google.com/xyz"
}
```
- Join: POST /api/meetings/:id/join
- Leave: POST /api/meetings/:id/leave
- Detail: GET /api/meetings/:id
- Delete: DELETE /api/meetings/:id (creator only)

## Notes
- Google Calendar event is created for the creator if a refresh token is available.
- For production switch to Postgres, add CORS origin, https, secure cookies.
