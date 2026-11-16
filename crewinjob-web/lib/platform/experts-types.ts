// "Ask an expert": partner agencies list themselves, clients send them a brief, the partner delivers files into the
// request and the client approves or asks for changes. Pure data, shared by the server and the browser.
export const EXPERT_SERVICES = ['design', 'video', 'photo', 'ads', 'social', 'seo', 'copy'] as const;
export type ExpertService = typeof EXPERT_SERVICES[number];
export const EXPERT_SERVICE_LABELS: Record<ExpertService, [string, string]> = {
  design: ['Tasarım ve banner', 'Design and banners'], video: ['Video ve kurgu', 'Video and editing'], photo: ['Ürün fotoğrafı', 'Product photography'],
  ads: ['Reklam yönetimi', 'Ad management'], social: ['Sosyal medya yönetimi', 'Social media management'], seo: ['SEO ve içerik', 'SEO and content'], copy: ['Metin yazarlığı', 'Copywriting'],
};
export type ExpertState = 'sent' | 'accepted' | 'declined' | 'delivered' | 'revision' | 'approved' | 'cancelled';
export const EXPERT_MAX_REVISIONS = 3;
export const EXPERT_FILE_MAX_BYTES = 6 * 1024 * 1024;
export const EXPERT_FILES_PER_REQUEST = 24;
export type ExpertFileMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export const EXPERT_FILE_MIMES: readonly ExpertFileMime[] = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
// Upload part size, as for studio videos: below common proxy limits and quick on a slow mobile uplink.
export const EXPERT_PART_BYTES = 384 * 1024;
export type PartnerCard = { id: string; displayName: string; summary: string; services: ExpertService[]; languages: ('tr' | 'en')[]; website: string };
export type PartnerProfileView = PartnerCard & { contact: string; listed: boolean; updatedAt: string };
export type ExpertBrief = { title: string; details: string; deliverables: string; dueDate: string; budgetNote: string; brand: string; contact: string; website: string; language: 'tr' | 'en' };
export type ExpertNote = { by: 'client' | 'partner'; kind: 'decline' | 'revision' | 'delivery' | 'cancel'; text: string; at: string };
export type ExpertFileView = { id: string; name: string; mime: ExpertFileMime; bytes: number; round: number; submitted: boolean; createdAt: string };
export type ExpertRequestView = {
  id: string; service: ExpertService; state: ExpertState; revisions: number; brief: ExpertBrief; notes: ExpertNote[]; files: ExpertFileView[];
  requestedAt: string; decidedAt: string | null; deliveredAt: string | null; reviewedAt: string | null; updatedAt: string;
  // Client side: the partner's name, and its contact once it accepted. Partner side: the client's project and organization.
  partnerName: string; partnerContact: string | null; clientName: string | null;
};
export type ExpertsSnapshot = {
  client: { canRequest: boolean; canReview: boolean; requests: ExpertRequestView[] } | null;
  partner: { canEdit: boolean; canWork: boolean; canDecide: boolean; running: boolean; profile: PartnerProfileView | null; requests: ExpertRequestView[] } | null;
};
