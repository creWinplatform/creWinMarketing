// LinkedIn sayfasında çalışır — bekleyen post varsa otomatik doldurur
(async function() {
  'use strict';

  const log = (...args) => console.log('[CrewinJob LinkedIn]', ...args);

  // Storage'dan bekleyen post'u oku
  const data = await chrome.storage.local.get('pendingPost');
  const pending = data?.pendingPost;
  if (!pending) {
    log('Bekleyen post yok, hiçbir şey yapılmadı.');
    return;
  }

  // 60 saniyeden eski ise kaldır (eski veri sızıntısı önleme)
  if (Date.now() - pending.timestamp > 60000) {
    log('Eski post (60s+), iptal edildi.');
    await chrome.storage.local.remove('pendingPost');
    return;
  }

  // Hemen sil ki yeniden çalıştırılmasın
  await chrome.storage.local.remove('pendingPost');

  log('Bekleyen post bulundu. Otomatik doldurma başlıyor...');
  await sleep(2000); // Sayfa yüklenmesini bekle

  try {
    await runAutomation(pending);
    log('✅ Otomatik doldurma tamamlandı. Post butonuna basın.');
  } catch (err) {
    log('❌ Hata:', err.message);
    alert(`CrewinJob: LinkedIn otomatik doldurma başarısız.\n\n${err.message}\n\nMetin panonda, görsel İndirilenler klasöründe — manuel yapıştırabilirsin.`);
  }

  async function runAutomation(post) {
    // shareActive=true URL'i ile geldiğimiz için share modal'ı zaten açılıyor
    log('Share modal bekleniyor...');

    // 1. Editör textbox'ını bekle (modal otomatik açılır)
    const editor = await waitForElement([
      'div.ql-editor[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[data-placeholder][contenteditable="true"]',
    ], 15000);
    log('Editör bulundu.');
    await sleep(500);

    // 2. Actor selector'u "creWin" şirket sayfasına değiştir
    try {
      await switchActorToCompany();
      log('✅ Actor "creWin" olarak değiştirildi.');
    } catch (e) {
      log('⚠️ Actor değiştirilemedi: ' + e.message + ' — manuel olarak "Anyone" dropdown → creWin seç.');
    }
    await sleep(500);

    // 3. Metni yapıştır
    editor.focus();
    await sleep(300);
    insertTextIntoEditor(editor, post.text);
    log('Metin yapıştırıldı (' + post.text.length + ' karakter).');

    // 4. Görsel varsa yükle
    if (post.imageData) {
      await sleep(500);
      await uploadImage(post.imageData, post.imageMime);
      log('Görsel yüklendi.');
    }

    log('Tamamlandı. Şimdi "Post" butonuna basabilirsin.');
  }

  async function switchActorToCompany() {
    // 1. Actor selector butonunu bul (modal üstündeki "Post to Anyone" yazan buton)
    const actorBtn = await waitForElement([
      'button[aria-label*="Post to" i]',
      'button.share-actor-trigger',
      'button[id*="share-actor"]',
      '.share-box-modal button[aria-haspopup="true"]',
    ], 5000, (el) => {
      const text = (el.textContent || '').toLowerCase();
      return text.includes('post to') || text.includes('anyone') || el.querySelector('img');
    });
    actorBtn.click();
    log('Actor dropdown açıldı.');
    await sleep(800);

    // 2. "creWin" / company opsiyonunu bul ve tıkla
    const companyOption = await waitForElement([
      'button[role="menuitemradio"]',
      'div[role="dialog"] button',
      'li button',
      '.artdeco-modal__content button',
    ], 5000, (el) => {
      const text = (el.textContent || '').toLowerCase();
      // creWin veya Crewin içeren buton (case-insensitive)
      return text.includes('crewin') && !text.includes('anyone');
    });
    companyOption.click();
    await sleep(500);

    // 3. Done/Save butonuna tıkla (eğer ayrı bir done butonu varsa)
    try {
      const doneBtn = await waitForElement([
        'button.share-box-modal__done',
        'button[aria-label*="Done" i]',
        'button[data-test-modal-close-btn]',
      ], 2000, (el) => {
        const text = (el.textContent || '').toLowerCase();
        return text.includes('done') || text.includes('save');
      });
      doneBtn.click();
    } catch {
      // Done butonu yoksa otomatik kapanmıştır
    }
  }

  // --- Yardımcı fonksiyonlar ---

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function closeAnyOpenModal() {
    // Açık dialog/modal varsa X (dismiss) butonuna tıkla
    const dismissBtns = document.querySelectorAll(
      'button[aria-label*="Dismiss" i], button[aria-label*="Close" i], button.artdeco-modal__dismiss'
    );
    for (const btn of dismissBtns) {
      if (isVisible(btn)) {
        btn.click();
        log('Açık modal kapatıldı.');
        await sleep(300);
      }
    }
  }

  function waitForElement(selectors, timeout = 5000, predicate = null) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        for (const sel of list) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (!isVisible(el)) continue;
            if (predicate && !predicate(el)) continue;
            return resolve(el);
          }
        }
        if (Date.now() - start > timeout) {
          return reject(new Error('Eleman bulunamadı: ' + list.join(' | ')));
        }
        setTimeout(check, 250);
      };
      check();
    });
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function insertTextIntoEditor(editor, text) {
    // contenteditable div'lere metin eklemenin en güvenli yolu:
    // ClipboardEvent ile paste taklit et
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles:       true,
      cancelable:    true,
    });
    editor.dispatchEvent(pasteEvent);

    // Bazı durumlarda paste event çalışmaz, fallback: doğrudan innerHTML
    if (!editor.textContent || editor.textContent.length < 3) {
      // Quill editor için: paragraph yapısına sok
      const safe = text
        .split('\n')
        .map(line => `<p>${escapeHtml(line) || '<br>'}</p>`)
        .join('');
      editor.innerHTML = safe;
      // input event tetikle (LinkedIn'in state'i güncellensin)
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function uploadImage(base64Data, mime) {
    // 1. Image/photo butonunu tıkla
    const imgBtn = await waitForElement([
      'button[aria-label*="add a photo" i]',
      'button[aria-label*="photo" i]',
      'button[aria-label*="image" i]',
      'button.share-promoted-detour-button',
    ], 5000);
    imgBtn.click();
    log('Görsel butonu tıklandı.');

    // 2. File input'u bekle (LinkedIn modal açar)
    const fileInput = await waitForElement([
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ], 5000);

    // 3. Base64'ten File oluştur
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const ext  = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    const file = new File([new Blob([ab], { type: mime })], `crewin-post.${ext}`, { type: mime });

    // 4. File input'a inject et
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 5. LinkedIn'in "Next" butonunu otomatik tıklamasını bekle yok, kullanıcı yapsın
    log('Görsel inject edildi. LinkedIn işliyor...');
  }
})();
