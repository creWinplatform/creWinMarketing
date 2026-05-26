const TEMPLATES_KEY = 'crewinjob_prompt_templates';

export interface PromptTemplate {
  id: string;
  name: string;
  platform: string;
  prompt: string;
  language: 'tr' | 'en';
  createdAt: number;
}

export function getTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PromptTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplate(t: Omit<PromptTemplate, 'id' | 'createdAt'>): PromptTemplate[] {
  const existing = getTemplates();
  const newTemplate: PromptTemplate = {
    ...t,
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const updated = [newTemplate, ...existing];
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}

export function deleteTemplate(id: string): PromptTemplate[] {
  const updated = getTemplates().filter(t => t.id !== id);
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}
