# SaaS Katman 2 - Backend ekibine gelistirme promptu

> HISTORICAL / SUPERSEDED: Platform identity is now implemented locally inside the
> Next.js monolith with SQLite. Do not send this as a request to create a second
> identity backend. Remaining connector/storage migration follows SAAS-MIGRATION.md.

Mevcut Crewin Marketing servislerini SaaS organizasyon/proje yapisina uyarlayin.
Once ABP identity, tenant, roller, organizasyonlar ve mevcut Marketing entity/API
yapilarini inceleyip yeniden kullanim/eksik matrisi cikarin. Mevcut gelistirmeleri
tekrar etmeyin; ayni isi yapan hesap, kampanya servisi veya tablo olusturmayin.

Gerekenler:
1. Kalici organizasyon, proje ve uyelik. Active/revoked durumu ve mevcut permission
   sistemine eslenen owner/admin/editor/analyst/viewer rolleri.
2. Oturumdaki gercek kullanicinin uyelikleri ve erisebildigi projeler. Yetkiyi her
   istekte sunucuda dogrulayin; client org/proje/rol bilgisi yetki kaniti degildir.
3. Marketing kayitlarinda org/proje sahipligi. ID ile okuma/guncelleme/silme,
   foreign reference, uniqueness ve sayfalama dahil kapsam kontrolu.
4. Asset, credential, cache, OAuth state, job/retry/idempotency, tracking ve
   unsubscribe verilerinin proje kapsaminda ayrilmasi.
5. SaaS org/proje kimligi ile harici Abp.TenantId ayrimi. Crewin baglantisinin
   tenant 1 ayari diger musterilere aktarilmamali; credential server-side kalmali.
6. Mevcut Crewin verisini tek uyumlu kapsama tasiyan geri uyumlu migration,
   yedekleme, kayit sayisi kontrolu ve rollback. Kayitlari tekrar olusturmayin.

Endpoint isimlerini panelin tahminlerine gore uydurmayin. Mevcut servisleri
genisletip kesin Swagger route/metot, request/ABP response ornekleri, permission,
sayfalama ve hata sozlesmelerini teslim edin. Yeni API ancak mevcut olanlar
yetersizse gerekcesiyle eklenebilir.

Kabul: Iki organizasyon birbirinin entity, dosya, credential veya job'una
erisememeli. Iptal edilen uyelik erisimi durdurmali. Worker, OAuth ve public
tracking dogru kayitli kapsami bulmali; tekrar istekler kapsam bazinda idempotent
olmali. Crewinjob.com kayit, basvuru, odeme, ilan, CV unlock ve mevcut marketing
servisleri etkilenmemeli. Canliya deploy etmeyin; test/staging raporu teslim edin.

Panelde bugun yalniz mevcut yonetici hesabi ve Crewin kapsami aktif. Imzali scope
oturumu ve rol kontrol temeli eklendi; kalici uyelik/veritabani izolasyonu tamam
degil. Musteri kaydi bu sozlesme ve izolasyon testleri tamamlanana kadar kapali.

Asagidaki teknik notlar ayni gereksinimlerin ayrintisini aciklar.

Inspect the existing ABP identity, tenants, organizations, permissions and marketing
entities first. Return a reuse/gap matrix. Reuse matching facilities and existing
Marketing services; do not create duplicate accounts, campaign services or tables.

Required contract:
- Persistent platform organizations, projects and memberships, with active/revoked
  state and owner/admin/editor/analyst/viewer roles or mappings to existing roles.
- Verified current-user memberships and authorized project capabilities. Resolve
  access server-side on every request; never trust UI IDs or role claims alone.
- Explicit organization/project ownership for marketing entities and relationships.
  Reads, writes, lookups by ID, uniqueness and foreign references must check scope.
- Scope all assets, caches, API credentials, OAuth state, jobs, retries, idempotency,
  tracking and unsubscribe links. Do not reuse Crewin credentials for another account.
- External connection tenant (for example Crewin's ABP tenant 1) is separate from
  SaaS organization/project identity. Service credentials remain server-side.
- Backwards-compatible migration of current Crewin data. Back up and verify row
  counts/ownership; provide migration and rollback, never recreate existing records.

Use existing endpoint conventions and ABP wrappers. Provide exact Swagger paths,
methods, DTO examples, pagination, errors and permissions before panel integration.
Do not assume new endpoint names requested by frontend.

Acceptance tests: two organizations with similarly named projects cannot read or
modify each other's entities or files; revoked membership stops access; workers,
OAuth callbacks and public tracking resolve the correct persisted scope; repeated
jobs are idempotent per scope; old Crewin auth, campaign, SEO, credit, application,
payment and CV unlock flows retain their behavior.

The panel currently supports only the deployment administrator and Crewin scope.
It has a signed scoped session compatibility layer and role policy helper,
not persisted multi-user memberships. Customer signup remains closed pending this
backend contract and full isolation validation.

No production deploy. Deliver code/test results, reuse matrix, contract, migration,
rollback and staging validation. Never expose credentials or personal data in
platform capability responses.
