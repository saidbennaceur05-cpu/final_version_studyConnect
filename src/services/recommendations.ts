// src/services/recommendations.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface UserProfile {
  userId: string;
  name: string | null;
  joinedMeetings: {
    subjects: string[];
    levels: string[];
    specializations: string[];
  };
  totalMeetingsJoined: number;
}

interface Meeting {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  level: string | null;
  specialization: string | null;
  startTime: Date;
  attendeesCount: number;
}

interface Recommendation {
  meeting: Meeting;
  score: number;
  reason: string;
}

/**
 * Build a profile of the user based on their activity
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });

  if (!user) return null;

  // Get meetings the user has attended
  const attendedMeetings = await prisma.meetingAttendee.findMany({
    where: { userId },
    include: {
      meeting: {
        select: {
          subject: true,
          level: true,
          specialization: true,
        },
      },
    },
  });

  const subjects = new Set<string>();
  const levels = new Set<string>();
  const specializations = new Set<string>();

  for (const attendance of attendedMeetings) {
    if (attendance.meeting.subject) subjects.add(attendance.meeting.subject);
    if (attendance.meeting.level) levels.add(attendance.meeting.level);
    if (attendance.meeting.specialization) specializations.add(attendance.meeting.specialization);
  }

  return {
    userId: user.id,
    name: user.name,
    joinedMeetings: {
      subjects: Array.from(subjects),
      levels: Array.from(levels),
      specializations: Array.from(specializations),
    },
    totalMeetingsJoined: attendedMeetings.length,
  };
}

/**
 * Get available meetings user hasn't joined yet
 */
async function getAvailableMeetings(userId: string): Promise<Meeting[]> {
  const now = new Date();

  // Get IDs of meetings user already joined
  const joinedMeetingIds = await prisma.meetingAttendee.findMany({
    where: { userId },
    select: { meetingId: true },
  });
  const joinedIds = new Set(joinedMeetingIds.map((m) => m.meetingId));

  // Get upcoming meetings
  const meetings = await prisma.meeting.findMany({
    where: {
      endTime: { gt: now },
    },
    orderBy: { startTime: 'asc' },
    include: {
      attendees: true,
    },
    take: 20, // Limit to 20 for AI processing
  });

  // Filter out joined meetings
  return meetings
    .filter((m) => !joinedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      subject: m.subject,
      level: m.level,
      specialization: m.specialization,
      startTime: m.startTime,
      attendeesCount: m.attendees.length,
    }));
}

/**
 * Use Gemini to rank meetings by relevance
 */
export async function getRecommendations(userId: string): Promise<Recommendation[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.warn('[recommendations] GEMINI_API_KEY not set, returning empty recommendations');
    return [];
  }

  const profile = await getUserProfile(userId);
  if (!profile) return [];

  const availableMeetings = await getAvailableMeetings(userId);
  if (availableMeetings.length === 0) return [];

  // If user has no history, return meetings sorted by popularity
  if (profile.totalMeetingsJoined === 0) {
    return availableMeetings
      .sort((a, b) => b.attendeesCount - a.attendeesCount)
      .slice(0, 5)
      .map((meeting) => ({
        meeting,
        score: 50,
        reason: 'Popular session you might like',
      }));
  }

  // Build prompt for Gemini
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are a study session recommendation engine. Analyze the user profile and available sessions, then return a JSON array of the top 5 most relevant recommendations.

USER PROFILE:
- Subjects studied: ${profile.joinedMeetings.subjects.join(', ') || 'None yet'}
- Academic levels: ${profile.joinedMeetings.levels.join(', ') || 'Not specified'}
- Specializations: ${profile.joinedMeetings.specializations.join(', ') || 'Not specified'}
- Total sessions joined: ${profile.totalMeetingsJoined}

AVAILABLE SESSIONS:
${availableMeetings.map((m, i) => `${i + 1}. ID: "${m.id}" | Title: "${m.title}" | Subject: ${m.subject || 'General'} | Level: ${m.level || 'All'} | Specialization: ${m.specialization || 'None'} | Attendees: ${m.attendeesCount}`).join('\n')}

Return ONLY a valid JSON array with this exact format (no markdown, no explanation):
[
  {"id": "meeting_id", "score": 85, "reason": "Short explanation why this matches the user"},
  ...
]

Rules:
- Score from 0-100 based on relevance
- Include exactly 5 sessions (or fewer if less available)
- Prioritize matching subjects, then levels, then specializations
- Keep reasons under 50 characters
- Return valid JSON only`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[recommendations] Failed to parse AI response:', response);
      return [];
    }

    const rankings = JSON.parse(jsonMatch[0]) as Array<{
      id: string;
      score: number;
      reason: string;
    }>;

    // Map rankings to full meeting objects
    const meetingMap = new Map(availableMeetings.map((m) => [m.id, m]));
    
    return rankings
      .filter((r) => meetingMap.has(r.id))
      .map((r) => ({
        meeting: meetingMap.get(r.id)!,
        score: r.score,
        reason: r.reason,
      }));
  } catch (error) {
    console.error('[recommendations] Gemini API error:', error);
    // Fallback: return popular sessions
    return availableMeetings
      .sort((a, b) => b.attendeesCount - a.attendeesCount)
      .slice(0, 5)
      .map((meeting) => ({
        meeting,
        score: 50,
        reason: 'Popular session',
      }));
  }
}
