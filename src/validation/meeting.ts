import { z } from 'zod';

const iso = z.string().datetime({ offset: true });

export const CreateMeetingSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  level: z.string().optional().nullable(),
  specialization: z.string().optional().nullable(),
  startTime: iso,
  endTime: iso,
  location: z.string().optional().nullable(),
  onlineUrl: z.string().optional().nullable(),
}).refine(v => new Date(v.endTime).getTime() > new Date(v.startTime).getTime(), {
  message: 'endTime must be after startTime',
  path: ['endTime'],
});

export const PatchMeetingSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  level: z.string().optional().nullable(),
  specialization: z.string().optional().nullable(),
  startTime: iso.optional(),
  endTime: iso.optional(),
  location: z.string().optional().nullable(),
  onlineUrl: z.string().optional().nullable(),
}).refine(v => {
  if (v.startTime && v.endTime) {
    return new Date(v.endTime).getTime() > new Date(v.startTime).getTime();
  }
  return true;
}, {
  message: 'endTime must be after startTime',
  path: ['endTime'],
});
