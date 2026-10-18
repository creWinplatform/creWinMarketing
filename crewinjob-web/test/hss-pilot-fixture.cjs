// Proposed pilot configuration, not live customer records or measured results.
const hssProfile = {
  name: 'HSS Digital (QA)', website: 'https://www.hssdigital.com',
  timezone: 'Europe/Istanbul', language: 'tr',
  brandVoice: 'Clear, technically accurate B2B communication. No invented customer references, ROI or traffic.',
  goals: [
    { id:'hss_leads',label:{tr:'Nitelikli proje talebi',en:'Qualified project demand'},audience:{tr:'Yazılım ve ERP entegrasyonu arayan işletmeler',en:'Businesses evaluating custom software and ERP integration'},stages:[{tr:'Talep',en:'Request'},{tr:'Keşif görüşmesi',en:'Discovery meeting'},{tr:'Teklif',en:'Proposal'},{tr:'Kazanılan proje',en:'Won project'}] },
    { id:'hss_partners',label:{tr:'İş ortaklığı kazanımı',en:'Partner acquisition'},audience:{tr:'ERP bayileri ve yazılım firmaları',en:'ERP resellers and software businesses'},stages:[{tr:'İş ortaklığı talebi',en:'Partner inquiry'},{tr:'Uygunluk görüşmesi',en:'Qualification meeting'},{tr:'Aktif iş ortaklığı',en:'Active partnership'}] },
  ],
};
module.exports = { hssProfile };
