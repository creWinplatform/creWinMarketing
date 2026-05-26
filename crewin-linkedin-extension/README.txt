CrewinJob LinkedIn Auto-Post Uzantısı — Kurulum
=================================================

1. Chrome'da chrome://extensions adresine git
2. Sağ üstte "Geliştirici modu"nu (Developer mode) aç
3. "Paketlenmemiş öğe yükle" (Load unpacked) butonuna tıkla
4. Bu klasörü seç: crewin-linkedin-extension
5. Uzantı yüklenir. ID'sini (uzun harf-rakam dizisi) kopyala.
   Örnek: abcdefghijklmnopqrstuvwxyz123456

6. .env.local dosyasına ekle:
   NEXT_PUBLIC_LINKEDIN_EXTENSION_ID=KOPYALADIGIN_ID

7. Sunucuyu yeniden başlat (npm run dev)

KULLANIM
========
1. CrewinJob uygulamasında içerik oluştur
2. "Paylaş" → LinkedIn → "Şirket Sayfasında Paylaş"
3. Uzantı LinkedIn'i otomatik açar, "Start a post"a tıklar, metni yapıştırır,
   görseli yükler.
4. Sen sadece "Post" butonuna basarsın.

HATA AYIKLAMA
=============
- Chrome'da F12 → Console sekmesinde "[CrewinJob LinkedIn]" loglarına bak
- LinkedIn'de oturum açık olmalı
- LinkedIn UI değişirse selector'ları content.js'de güncellemek gerekebilir
