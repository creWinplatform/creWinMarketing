'use client';
import AutomaticMeasurements from './AutomaticMeasurements';
import MonthlyReportPanel from './MonthlyReportPanel';
import BudgetPlanner from './BudgetPlanner';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';

// Ryzevo's measurement features under Crewin's Analytics: GA4 / Search Console measurements bound to the Crewin goals'
// stages, the monthly results report (approve, then share with an expiring link) and the budget planner.
export default function CrewinReportsPanel({ workspace, lang }: { workspace: WorkspaceContext; lang: Locale }) {
  const tr = lang === 'tr';
  return <section className="crewin-reports" aria-labelledby="crewin-reports-title">
    <div className="studio-section-title"><h2 id="crewin-reports-title">{tr ? 'Hedef ölçümleri ve raporlar' : 'Goal measurements and reports'}</h2></div>
    <p className="coach-muted">{tr ? 'Bu ölçümler Crewin hedeflerinin aşamalarına (kayıt → profil → başvuru, şirket kaydı → CV açma) bağlanır. Google bağlantısı Proje ayarları → Bağlantılar’dan yapılır.' : 'These measurements are bound to the stages of the Crewin goals (sign-up → profile → application, company sign-up → CV unlock). Google is connected in Project settings → Connections.'}</p>
    <AutomaticMeasurements workspace={workspace} lang={lang}/>
    <MonthlyReportPanel lang={lang}/>
    <BudgetPlanner lang={lang}/>
  </section>;
}
