# Orkestra — açık işler ve devir notu

Son güncelleme: 2026-11-21. Yeni bir oturumun (ya da yeni bir ajanın) orkestrasyonum'da nerede kalındığını bilmesi içindir. Kurallar ve yapı için [CLAUDE.md](CLAUDE.md).

## Durum
- Araç: `orkestra/` (Node ≥ 22, bağımlılıksız). `npm test` (orkestra klasöründe): 68 geçer, 1 atlanır (`ORKESTRA_INTEGRATION=1` ister).
- GitHub: `sirrakadembasti/orkestrasyonum`, **herkese açık** (gizli depoda Actions faturalama engeline takıldığı için açıldı), dal `master`. CI: Windows + Node 22, `npm test` — son çalışma yeşil.
- Yetenekler: `status` (+ `--probe`), `models`, `run` (`--write`, `--worktree`, `--continue`, `--task`, `--need/--model/--effort`, `--timeout`, `--stream`), `plan` (init/add/set/show), `profile` (DOĞRULANAN + ÇIKIŞ), `runs`, `watch`.
- SKILL.md: beyin için **spec driven proje yürütme** (gereksinim → tasarım/taslak → görevler → uygula → ölçüt ölçüt doğrula → kullanıcı kabulü) ve not uygulaması v2'den çıkan dersler.
- Gerçek kullanımla doğrulandı: `F:\projeler\not-uygulamasi` (v2, 10 görev, 46 kabul ölçütü, kabul edildi). Pilot depo `F:\projeler\orkestra-pilot` artık yok.

## Kullanıcının sonraya bıraktıkları
1. **B seçeneği — orkestranın kendi yönettiği beyin:** Şu an beyin, SKILL.md'yi okuyan sohbet ajanıdır. B seçeneği, planlama/dağıtma/doğrulama döngüsünü orkestranın kendisinin yürütmesi. Henüz tasarlanmadı; spec driven başlanmalı (gereksinim görüşmesi).
2. **Plugin'e dönüştürme:** İşçi kaydı, kimlik/durum kontrolü, model katmanları ve eforla birlikte bir Claude Code eklentisi seçeneği konuşulmuştu; kullanıcı şimdilik SKILL.md'yi açık yolla çağırmayı tercih ediyor (hiçbir skills klasörüne kurulmaz).
3. **Kimlikler (kullanıcının işi, anahtarlara dokunma):** OpenCode Go anahtarı; `kimi` girişi (`orkestra.config.json`'da pasif). opencode-go'ya dokunulmaması istendi.

## Not uygulaması v2'den çıkan geliştirme adayları (henüz yapılmadı)
- **`--continue` + `--worktree`:** Birlikte kullanılamıyor (önceki kopya silinmiş oluyor). Paralel görevlerde devam oturumu ana klasörde yazmak zorunda kaldı. Seçenek: işçi dalında yeni worktree açıp oturumu orada sürdürmek.
- **Birleşmiş işçi dallarının temizliği:** `orkestra/<işçi>-<zaman>` dalları birikiyor (not uygulamasında 7 tane). Seçenek: birleşmiş dalları listeleyen/silen bir komut (silme her zaman kullanıcı onayıyla).
- **Plan ↔ spec bağı:** Kabul ölçütleri plana yalnızca `--note` metni olarak giriyor. Seçenek: `plan add --criteria G-1.1,G-1.2` alanı ve `plan show`'da ölçüt kapsaması.
- **Salt okunur işçi prompt'u:** agy, prompt'ta "komut çalıştırma" denmezse komut deneyip izin reddiyle boş dönüyor. Seçenek: `run` salt okunur agy çağrısına bu uyarıyı kendisi eklesin.
- **Sınıflandırma sezgisi:** Başarılı çıkışta ≤ 200 karakterlik cevap tamamen, uzun cevapta yalnızca `Error:` satırları taranıyor. Kısa bir başarılı cevapta "401" geçerse yine yanlış sınıflanabilir.
- **İşçi raporundaki bağlantılar:** codex cevabı worktree yollarına bağlantı veriyor; worktree silindiği için bu yollar geçersiz kalıyor.
- **Tarayıcı doğrulaması:** İşçiler tarayıcı açamıyor; arayüz ölçütlerini beyin doğruluyor. Orkestrada bunu kolaylaştıran bir şey yok.

## Küçük açık noktalar
- `skill-test/slugify.js`: ilk sürümde yazma modunu denemek için kullanılan örnek dosya; hiçbir test kullanmıyor. Silinip silinmeyeceği kullanıcıya sorulmalı.
- SKILL.md'deki spec driven bölüm gerçek bir projede uygulanarak doğrulandı; ayrıca alt ajanlarla baskı testi (writing-skills yöntemi) yapılmadı.
- Entegrasyon testi CI'da çalışmıyor (gerçek opencode ister).

## Gelecekte çalışırken
- Değişiklikleri spec driven yürüt: önce ne istendiğini netleştir, kullanıcı onayı, sonra test (kırmızı), sonra kod.
- Commit ve push yalnızca kullanıcı isteyince; push sonrası CI'ı sonuç çıkana kadar izle.
