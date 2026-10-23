import type { Metadata } from 'next';
import { Fragment } from 'react';
import DocShell from '@/components/marketing/DocShell';
import { requestLang } from '@/lib/i18n/server';
import type { Lang } from '@/lib/i18n/shared';
import { salesTermsReady } from '@/lib/platform/sales-terms';
import { salesTermsDocument, type TermsBlock, type TermsInline } from '@/lib/platform/sales-terms-document';

// Ön bilgilendirme formu + mesafeli satış sözleşmesi (6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği).
// Metin lib/platform/sales-terms-document.ts içindedir: ödeme onaylanınca aynı metin siparişle saklanır ve e-postayla gider.
// TASLAK: satıcı bilgileri, KDV, fatura süresi, yetkili mahkeme ve hukuki onay lib/platform/sales-terms.ts içinde
// tamamlanana kadar sayfa taslak etiketli ve noindex; canlı ödeme bu adresle açılmaz.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = await requestLang((await searchParams).lang);
  return {
    title: lang === 'en' ? 'Pre-contract information and terms of sale' : 'Ön bilgilendirme formu ve mesafeli satış sözleşmesi',
    description: lang === 'en'
      ? 'The pre-contract information and distance sales contract for prepaid Ryzevo plans.'
      : 'Ön ödemeli Ryzevo planları için ön bilgilendirme formu ve mesafeli satış sözleşmesi.',
    robots: salesTermsReady() ? undefined : { index: false, follow: false },
    alternates: { languages: { tr: '/legal/sales?lang=tr', en: '/legal/sales?lang=en' } },
  };
}

function Inline({ parts }: { parts: TermsInline[] }) {
  return <>{parts.map((part, index) => typeof part === 'string' ? <Fragment key={index}>{part}</Fragment>
    : 'b' in part ? <strong key={index}>{part.b}</strong>
    : 'ph' in part ? <mark key={index} className="rd-ph">[{part.ph}]</mark>
    : <a key={index} href={part.href}>{part.a}</a>)}</>;
}
function Block({ block }: { block: TermsBlock }) {
  if ('p' in block) return <p><Inline parts={block.p} /></p>;
  if ('h3' in block) return <h3>{block.h3}</h3>;
  if ('ul' in block) return <ul>{block.ul.map((item, index) => <li key={index}><Inline parts={item} /></li>)}</ul>;
  if ('dl' in block) return <dl className="rd-dl">{block.dl.map(([term, value]) => <Fragment key={term}><dt>{term}</dt><dd><Inline parts={value} /></dd></Fragment>)}</dl>;
  return <div className="rd-table"><table>
    <thead><tr>{block.table.head.map(cell => <th key={cell}>{cell}</th>)}</tr></thead>
    <tbody>{block.table.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <td key={index}><strong>{cell}</strong></td> : <td key={index} className="num">{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default async function SalesTermsPage({ searchParams }: Props) {
  const lang: Lang = await requestLang((await searchParams).lang);
  const en = lang === 'en', ts = (tr: string, eng: string) => (en ? eng : tr), doc = salesTermsDocument(lang);
  return (
    <DocShell
      lang={lang}
      kicker={ts('Yasal', 'Legal')}
      title={doc.title}
      lead={doc.lead}
      meta={<>{ts('Sürüm', 'Version')} {doc.version}{en && ' · The Turkish text prevails; this English version is a translation for information.'}</>}
      toc={doc.sections.map(section => ({ id: section.id, title: section.title }))}
      notice={!salesTermsReady() && <div className="rd-notice" role="note"><strong>{ts('Taslak metin', 'Draft text')}</strong>{ts(
        'Satıcı bilgileri ve hukuki inceleme tamamlanmadı. Sarı işaretli alanlar doldurulup metin onaylanana kadar bu sayfa üzerinden ödeme alınmaz.',
        'The seller details and the legal review are not complete. No payment is taken with this page until the highlighted fields are filled in and the text is approved.')}</div>}
    >
      {doc.sections.map(section => <section key={section.id} id={section.id}>
        <h2>{section.title}</h2>
        {section.blocks.map((block, index) => <Block key={index} block={block} />)}
        {section.id === 'contract' && <p className="rd-small">{ts('Sürüm', 'Version')} {doc.version}</p>}
      </section>)}
    </DocShell>
  );
}
