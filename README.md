# Nail Art Stüdyo — Randevu Takvimi

Müşterilerin uygun gün/saatleri görüp doğrudan randevu aldığı, stüdyo sahibinin de
çalışma saatlerini ve randevuları yönettiği basit bir web sitesi.

- `index.html` — müşteri randevu sayfası (paylaşacağınız link)
- `admin.html` — stüdyo sahibi yönetim paneli (sadece siz kullanırsınız)
- Veriler [Supabase](https://supabase.com) üzerinde tutulur (ücretsiz plan yeterli)

## 1) Supabase projesi oluşturun

1. [supabase.com](https://supabase.com) adresinde ücretsiz hesap açın, "New Project" ile yeni proje oluşturun.
2. Proje açıldıktan sonra sol menüden **SQL Editor**'e girin, `sql/schema.sql` dosyasının
   tüm içeriğini yapıştırıp **Run** deyin. Bu, gerekli tabloları, hizmet listesini ve
   izinleri kurar. (Bu projeyi daha önce `sql/schema.sql` olmadan, hizmet eklenmeden önce
   kurduysanız, bunun yerine sadece `sql/02_add_services.sql` dosyasını çalıştırmanız yeterli.)
3. Sol menüden **Authentication → Users** kısmına girip **Add user** ile kendinize
   (stüdyo sahibi) bir e-posta + şifre hesabı oluşturun. Bu hesap `admin.html`
   sayfasına giriş için kullanılacak. (Herkese açık kayıt yoktur, sadece sizin
   oluşturduğunuz hesap giriş yapabilir.)
4. Sol menüden **Project Settings → API** kısmına girin, `Project URL` ve
   `anon public` anahtarını kopyalayın.

## 2) Ayarları girin

`js/config.js` dosyasını açın ve şu satırları kendi bilgilerinizle değiştirin:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "xxxxxxx...";
export const STUDIO_NAME = "Stüdyonuzun Adı";
export const STUDIO_ADDRESS = "Adresiniz";
export const STUDIO_PHONE = "0555 555 55 55";
```

## 3) Yerelde test edin

Tarayıcılar `file://` üzerinden ES module yüklemeyi engellediği için basit bir
yerel sunucu ile açmanız gerekir. Proje klasöründe:

```bash
npx serve .
```

veya Python varsa:

```bash
python -m http.server 5500
```

sonra tarayıcıda `http://localhost:5500` (veya ilgili port) adresini açın.
`/admin.html` ile yönetim paneline, `/` ile müşteri sayfasına ulaşırsınız.

## 4) Yayına alın (deploy)

En kolay yol [Netlify Drop](https://app.netlify.com/drop): proje klasörünü
tarayıcıya sürükleyip bırakmanız yeterli, size bir link verir. Alternatif olarak
Vercel veya GitHub Pages ile de yayınlayabilirsiniz — hepsi ücretsizdir ve bu
proje herhangi bir build adımı gerektirmez (düz HTML/CSS/JS).

Müşteri linkini (`.../index.html` veya kök adres) sosyal medya/Instagram
bio'nuza, WhatsApp durumunuza vb. ekleyin. Yönetim linkini (`.../admin.html`)
sadece kendiniz kullanın, paylaşmayın.

## Nasıl çalışır

- **Müşteri tarafı:** Önce bir hizmet seçer (örn. Manikür, Protez Tırnak),
  sonra takvimden bir gün seçer, o gün için o hizmete uygun saatleri görür
  (dolu saatler ve hizmetin süresine sığmayan saatler otomatik listeden çıkar),
  ad-soyad ve telefon bırakarak randevu talebini oluşturur. Randevu alındıktan
  sonra tek tıkla telefon takvimine ekleyebileceği bir hatırlatma (.ics dosyası)
  indirebilir.
- **Stüdyo sahibi tarafı:** `admin.html`'de giriş yaptıktan sonra:
  - **Randevular** sekmesinde gelen talepleri onaylayabilir/iptal edebilir.
  - **Hizmetler** sekmesinde hizmet ekleyebilir/silebilir, isim/süre/fiyat
    değiştirebilir, bir hizmeti geçici olarak müşteriden gizleyebilir (Aktif
    kutusunu kaldırarak).
  - **Çalışma Saatleri** sekmesinde haftanın hangi günleri açık olduğunuzu ve
    saat aralığını ayarlayabilir. Buradaki "dakika" değeri, saat seçeneklerinin
    kaçar dakikada bir gösterileceğini belirler (örn. 30 dk seçilirse 10:00,
    10:30, 11:00… gibi saatler sunulur); her hizmetin süresi kendi ayarından gelir.
  - **Özel Kapatmalar** sekmesinde tatil günü veya belirli saat aralığını
    (örn. öğle molası) kapatabilir.
- İki müşteri aynı anda çakışan bir saat almaya çalışırsa (örn. biri 2 saatlik
  protez tırnak randevusu almışken başka biri o aralığa denk gelen bir saat
  seçerse), veritabanı seviyesinde çakışma engellenir — ikinci müşteriye
  "bu saat az önce doldu" mesajı gösterilir ve saat listesi güncellenir.

## Notlar

- Müşteri bilgileri (ad, telefon, not) sadece giriş yapmış stüdyo sahibi
  tarafından görülebilir; herkese açık sayfa sadece dolu/boş saatleri görür.
- E-posta/SMS hatırlatma servisi bağlı değildir; hatırlatma müşterinin kendi
  telefon takvimi üzerinden çalışır (.ics dosyası ile eklenir).
