# Yayın promptu 3 (ryzevo.com, 10 Kasım 2026)

İkinci yayından sonra kalanlar. Bu metni ryzevo.com'u yayınlayan kişiye (veya kod ajanına) olduğu gibi iletin.
Önceki promptlar: `docs/YAYIN-PROMPTU.md`, `docs/YAYIN-PROMPTU-2.md`.

---

Sen ryzevo.com'u yayınlayan ve sunucusunu yöneten geliştiricisin. Depo: `creWinplatform/creWinMarketing`, dal `main`,
uygulama `crewinjob-web`. 10 Kasım 2026'daki yayından sonra canlı site yeniden kontrol edildi.

## Canlıda doğrulananlar (teşekkürler)

- **Hız (`ec77bc7`):** Analitik 10 sn → 3–4,6 sn, Takvim 0,5 sn, içerik geçmişi 0,6–1,7 sn.
- **Rehber penceresinin erişilebilirliği** (`099b9c1`).
- **Hata sınırı (`3179144`):** Canlıda kod dosyası indirmesi taklit edilerek denendi:
  - yalnızca çöken sekmede hata kartı çıkıyor;
  - "Tekrar dene" sekmeyi yüklüyor;
  - sayfa bir kez kendiliğinden yenileniyor.
- **`<html lang>`** sunucu tarafında doğru (`f0b3732`).

Kod tarafındaki istekler bitti. Kalanlar sunucu ayarları ve senden beklenen rapor.

## Kurallar

- **Sırlar:** Ayar değerlerini (şifre, anahtar, token) hiçbir çıktıya, commit'e veya rapora yazma. Yalnızca hangi
  kartın durumunun değiştiğini bildir.
- **Canlı veri:** Canlı Crewin çalışma alanında gerçek müşteri verisi var.
  - Yazma testlerini yalnızca "QA-TEST" test projesinde yap.
  - Gerçek gönderim (e-posta, WhatsApp, sosyal paylaşım, reklam) ve ödeme yapma.
- **Yedek:** Ayar veya veritabanı değişikliğinden önce yedek al.

## 1. Sunucu ayarları (iki yayındır değişmedi)

Proje ayarları → Operasyon → Kurulum rehberi hâlâ "16 kurulumdan 7'si hazır" diyor. Her kartta ne yazılacağı adım
adım anlatılıyor.

Öncelik sırası:
1. **Hesap e-postaları (doğrulama, şifre sıfırlama, uyarılar): Eksik.**
   - `/api/auth/identity` hâlâ `{"emailEnabled":false}` dönüyor. Şifresini unutan kullanıcı kendi başına giremiyor;
     "Şifremi unuttum" bağlantısı bu yüzden gizli.
   - Açıldıktan sonra doğrula: giriş sayfasında "Şifremi unuttum" görünmeli ve `/recover` form göstermeli.
2. **Yönetici şifresi: Hatalı.** Kartın istediği koşulu sağla ve kartın "Hazır" olduğunu doğrula.
3. **Geri dönen e-posta ve şikâyet bildirimi: Eksik.** Hesap e-postalarıyla aynı SES kurulumunun parçası.
4. **Google (Search Console, GA4): Eksik.**
5. **Meta (Facebook Sayfası, Instagram): Eksik.**
6. **WhatsApp gönderimi (Crewin): Eksik.**
7. **Telegram (kanal ve grup duyuruları): Eksik.**
8. **Tarayıcı ve telefon bildirimleri: Eksik.**

Bazı kartlar Google, Meta veya WhatsApp hesaplarına erişim gerektiriyor olabilir. Yapamadıklarını nedeniyle ve
kimden ne beklediğini yazarak bildir.

## 2. İlan botu kuyruğu

Canlıda hâlâ 0 toplam, 0 bekleyen, 0 yayında, 0 hata. Kontrol et:
- ajanın kuyruk ve ilan dosyaları (`crewinjob-agent`) sunucuda var mı;
- panel doğru yolu mu okuyor;
- ajan sunucuda çalışıyor mu.

Bilerek boşsa raporda öyle yaz.

## 3. Cevap beklenen sorular

1. **Veritabanı:** Canlı hangi veritabanını kullanıyor? SQLite mı, `PLATFORM_DATABASE_PROVIDER=mssql` ile RDS mi?
2. **RDS kullanılıyorsa:**
   - yedekleme: otomatik snapshot ve saklama süresi, en son başarılı geri yükleme denemesi;
   - `data/*.json` ve `crewinjob-agent` dosyalarının tablolara taşınma planı (`docs/SAAS-MSSQL.md`, Aşama 2–3);
   - panelin çalıştığı yer: RDS ile aynı bölgede mi (eu-west-1)?
3. **Node:** Geliştirme bilgisayarında `better-sqlite3` ^12, Node 20'de kurulamıyor ve panel bu yüzden kapalı.
   - Karar: Node 24'e mi geçilecek, yoksa `better-sqlite3` Node 20 ile çalışan bir sürüme mi sabitlenecek?
   - Sabitlenecekse değişikliği sen yap ve sürümü bildir.
4. **Canlı ödeme:** `PLATFORM_PAYTR_LIVE_ENABLED` şu an açık mı, kapalı mı? Satış sözleşmesi ve aydınlatma metni
   hukuken onaylanana kadar kapalı kalmalı. Değeri değil, yalnızca durumu yaz.

## 4. Test raporu (iki kez istendi, henüz gelmedi)

"QA-TEST" projesinde:
- **Mobil görünüm:** 390×844 ve 768×1024. Genel bakış, Sosyal medya, İçerik kütüphanesi, Kampanyalar, Takvim,
  Analitik ve Proje ayarları. Kontrol et: yatay kaydırma, taşan öğe, küçük dokunma hedefi, yan menü, açık ve koyu
  tema.
- **Çıkış:**
  - Çıkış yap. Geri tuşuyla ve doğrudan adresle `/?tab=project`'e git; giriş sayfasına yönlendirilmelisin.
  - `/api/workspace` 401 dönmeli.
  - Tekrar giriş yap; istenen sekmeye dönülmeli.
- **Yazma:**
  - "QA-TEST" adlı içerik taslağı oluştur, düzenle, kaydet, yenile.
  - Aynı taslağı iki sekmede açıp çakışma uyarısını dene.
  - Takvimde görev oluştur ve sil.
  - Kampanya taslağını "prova"ya kadar ilerlet; gerçek gönderim yapma.
  - Marka dilini değiştir ve geri al.
  - Sonunda bütün "QA-TEST" kayıtlarını sil.

## Rapor

1. Sunucu ayarları: Kurulum rehberindeki yeni "x/16 hazır" sayısı ve hangi kartların durumu değişti. Kalanlar ve
   nedenleri.
2. İlan kuyruğu: neden boştu ve şimdiki durumu.
3. 3. bölümdeki dört sorunun cevapları.
4. Test sonuçları: her bulgu için adımlar, beklenen, gerçekleşen ve ekran görüntüsü.
5. Varsa yeni commit'ler.
