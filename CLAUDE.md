# CLAUDE.md — orkestrasyonum

Bu depo **orkestra**'yı geliştirir: bilgisayardaki AI CLI'larını (claude, codex, agy, copilot, kimi, opencode-go/zen/free, `opencode:<sağlayıcı>`) **işçi** olarak çalıştıran araç. Kullanıcıyla Türkçe konuş.

**Beyin ve el:** Planlayan, iş dağıtan, doğrulayan **beyin**, `orkestra/SKILL.md`'yi okuyan sohbet ajanıdır. orkestra **el**dir: işçileri tanır, çalıştırır, izler, planı saklar. Karar vermez. SKILL.md hiçbir skills klasörüne kurulmaz; kullanıcı herhangi bir projede ajana "SKILL.md yolunu oku ve uygula, proje: <yol>" der.

## Önce oku
- `ACIK-ISLER.md` — nerede kalındı, ertelenenler (B seçeneği: orkestranın kendi yönettiği beyin; plugin), geliştirme adayları.
- `orkestra/SKILL.md` — beynin talimatları (spec driven proje yürütme dahil). `orkestra/README.md` — kullanıcı belgesi.

## Komutlar
```sh
cd orkestra
npm test                                  # node:test, sahte CLI + mock anahtar; gerçek CLI çağrılmaz
ORKESTRA_INTEGRATION=1 npm test           # + gerçek opencode (yalnızca yerelde)
node bin/orkestra.mjs status | profile | runs | watch <kimlik> | plan show --dir P
```
Node ≥ 22, **bağımlılık yok**. CI: `.github/workflows/ci.yml` (Windows, Node 22, `npm test`; `master`'a push ve PR'da).

## Yapı (`orkestra/`)
- `bin/orkestra.mjs` — CLI: `status`, `models`, `run`, `plan init|add|set|show`, `profile`, `runs`, `watch`. Bayrak ayrıştırma: `BOOLEAN_FLAGS` (write, worktree, stream, json, probe) değer almaz; diğerleri sonraki argümanı `--` ile başlasa da değer alır.
- `src/workers.mjs` — işçi tanımları: her işçinin `access.read`/`access.write` bayrakları (write `null` = yazamaz; agy), `session` (preset ya da çıktıdan yakalama), `parse` (codex son mesajı stdout'tan; opencode/agy JSON).
- `src/runner.mjs` — süreci başlatır, zaman aşımı (varsayılan 180 sn) ve süreç ağacını öldürme, `runWorker`, `assertCanWrite`, model/efor seçimi.
- `src/classify.mjs` — çıktı → durum (`invalid_key`, `timeout`, …). **Kural:** çıkış 0 ise yalnızca işçinin cevabı taranır; cevap ≤ 200 karakterse tamamı, daha uzunsa yalnızca `Error:` satırları (runner.mjs `errorPart`). Aksi hâlde başarılı işi anlatan "401" gibi metinler işçiyi yanlışlıkla başarısız sayar.
- `src/worktree.mjs` — `--worktree`: `orkestra/<işçi>-<zaman>` dalı ve geçici kopya, bitince commit.
- `src/plan.mjs` — `<proje>/.orkestra/plan.json`, dosya kilidiyle güncelleme, görev durumları todo/doing/review/done/failed/blocked.
- `src/runlog.mjs` — çalışma kayıtları `~/.orkestra/runs/<kimlik>.json|.log` (`ORKESTRA_HOME`).
- `src/profile.mjs` — DOĞRULANAN (planlardaki done/failed, son çalışmanın işçisine) ve ÇIKIŞ istatistikleri.
- `src/status.mjs`, `credentials.mjs`, `catalog.mjs`, `effort.mjs`, `resolve.mjs`, `ids.mjs` — kimlik durumu, OpenCode sağlayıcı kataloğu, model katmanları (hizli/normal/derin) ve efor, komut çözümleme, kimlik üretimi.
- `orkestra.config.json` — makineye özel (git dışı, `ORKESTRA_CONFIG`): `models` ve `disabled` (kimi pasif).
- `skill-test/slugify.js` — ilk sürümün yazma modu deneme dosyası; kullanılmıyor (bkz. ACIK-ISLER.md).

## Değişmez kurallar
- **API anahtarlarını asla girme, okuma, yazdırma.** Kimlik eklemek kullanıcının işi. Testler yalnızca mock anahtar kullanır.
- **Tam yetki veren izin bayrakları eklenmez** (`--dangerously-skip-permissions` vb.). İşçiler varsayılan salt okunur; `--write` her CLI'ın en dar düzenleme modu ve yalnızca `--dir` ile. Tek istisna kimi: `--write` modu `--yolo`'dur ve rutin komutları da çalıştırır (README'de belgeli; kimi şu an pasif).
- Aynı CLI'dan iki süreç aynı anda çalıştırılmaz (eşzamanlı opencode zaman aşımına düşüyor); farklı CLI'lar paralel olabilir.
- Kullanıcı tercihleri: kimi pasif kalır; opencode-go'nun ayarına dokunulmaz; Çinli sağlayıcıların yalnızca global sürümleri listelenir (`-cn`, `.cn` elenir).
- Bir CLI bayrağı ya da davranışı değişince **SKILL.md ve README birlikte** güncellenir; ikisi kodla çelişmemeli.
- Komut satırı testleri Windows `.cmd` kabukları kullanır (`winOnly`); CI Windows'ta koşar.

## Çalışma biçimi
- Değişikliği netleştir (belirsizse sor), önce kırmızı test, sonra kod; davranış değişikliğini gerçek kullanımda da dene.
- SKILL.md değişikliği bir davranış değişikliğidir: mümkünse gerçek bir ajanla/projede dene, sonucu raporla.
- Commit ve push yalnızca kullanıcı isteyince; dal `master`. Commit mesajları Türkçe, `orkestra: …` önekiyle. Push'tan sonra CI'ı sonuç çıkana kadar izle ve sonucu bildir.
- Geri dönüşü zor adımları (birleştirme, dal/dosya silme, depo görünürlüğü) sormadan yapma.
