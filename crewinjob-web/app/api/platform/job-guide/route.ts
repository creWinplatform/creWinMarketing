import { platformDatabase } from '@/lib/platform/database';
import { jobGuide } from '@/lib/platform/job-guide';
import { coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
// "What would you like to do?": jobs with their steps, each step read from the project's records for this member.
export const GET=coachRoute(async scope=>jobGuide(platformDatabase(),scope));
