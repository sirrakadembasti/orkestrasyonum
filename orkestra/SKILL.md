---
name: orkestra
description: Use only when the user explicitly asks to use orkestra (e.g. "orkestra ile", "orkestra SKILL.md'yi oku", "görevi orkestra ile Codex'e ver") to hand a task in a given project directory to another AI CLI on this computer - Codex, Antigravity (agy), GitHub Copilot CLI, Kimi Code, OpenCode, or OpenCode-connected providers like MiniMax, Kimi, MiMo, Qwen, GLM - or to check which of those providers are active.
disable-model-invocation: true
---

# orkestra

## Genel bakış
Bilgisayardaki AI CLI'larını **işçi** olarak yönetir: kimlik ve abonelik durumunu kontrol eder, model ve eforu seçer, görevi verilen proje klasöründe çalıştırır ve sonucu sınıflandırır.

Bu talimatlar hangi AI ajanında çalışıyorsan (Claude Code, Codex, Copilot, agy, OpenCode, Kimi…) aynen geçerlidir. Tek koşul komut çalıştırabilmen.

## Araç yolu
Araç, **bu SKILL.md dosyasının bulunduğu klasördeki** `bin/orkestra.mjs` dosyasıdır. Kullanıcının sana verdiği SKILL.md yolunu kullan; başka bir konum varsayma. Şu anki yer:

```bash
O='node F:/projeler/orkestrasyonum/orkestra/bin/orkestra.mjs'
```

SKILL.md başka bir yerden okunduysa yolu ona göre değiştir. Node ≥ 20 gerekir.

## Komutlar
```bash
$O status                    # ücretsiz: kurulu mu, kimlik girilmiş mi
$O status --probe            # her işçiye kısa test gönderir — KREDİ HARCAR
$O models <işçi>             # katmanlar ve kullanılabilir modeller
$O run <işçi> --dir "<proje yolu>" [--write [--worktree]] [--need hizli|normal|derin] [--model m] [--effort low|medium|high|xhigh|max] [--timeout sn] [--stream] [--json] -- "<prompt>"
$O run <işçi> --continue <çalışma kimliği> -- "<devam prompt'u>"   # aynı oturumda, aynı klasörde devam
$O runs                      # son çalışmalar: durum, başlayalı, son çıktıdan beri
$O watch <kimlik>            # bir çalışmanın durumu ve günlüğün son satırları
$O profile                   # işçi profili: durum, yazabilir mi, oturum, maliyet, geçmiş başarı (ücretsiz)
$O plan init --dir "<proje>" -- "<hedef>"
$O plan add  --dir "<proje>" [--worker w] [--depends t1,t2] [--note "bitti ölçütü"] -- "<görev>"
$O plan set <görev> --dir "<proje>" [--status todo|doing|review|done|failed|blocked] [--note "…"]
$O plan show --dir "<proje>" [--json]   # görevler, hazır olanlar, doğrulanacaklar
$O run <işçi> --dir "<proje>" --task <görev> … -- "<prompt>"   # çalışmayı plandaki göreve bağlar
```

## Proje yürütme (beyin sensin)
Kullanıcı bir uygulamanın orkestrasyonla oluşturulmasını ya da geliştirilmesini istediğinde **planlayan, iş dağıtan, izleyen ve doğrulayan sensin**; orkestra yalnızca kararlarını uygular. Hangi işin kime gideceğini projenin ihtiyacına göre sen belirlersin: hız, maliyet, kalite, işçinin yeteneği ve geçmiş başarısı.
1. **Hedef ve proje yolu:** Kullanıcıdan al; belirsizse sor. Maliyet/hız/kalite önceliği belirsizse sor.
2. **Ekibi tanı:** `$O profile`. Yalnızca hazır işçileri kullan; `canWrite: hayır` olanlara yazma işi verme. **DOĞRULANAN** işin kalitesidir (beynin plandaki "bitti" kararları); **ÇIKIŞ** işçinin nasıl bittiğidir (zaman aşımı, bağlantı kopması): düşük çıkış oranı işin kötü olduğunu değil, işçinin yavaş ya da kararsız olduğunu gösterir. Ona daha uzun `--timeout` ver.
3. **Planla:** Plan varsa `plan show` ile kaldığın yerden devam et; yoksa `plan init`. Hedefi küçük, doğrulanabilir görevlere böl (`plan add`); bağımlılıkları `--depends` ile, "bitti" ölçütünü `--note` ile yaz.
4. **Dağıt:** `plan show`'daki **hazır** görevleri başlat: `run <işçi> --dir P --task tN …`. Birbirinden bağımsız hazır görevleri farklı CLI'lara paralel ver; aynı projeye paralel yazanlara `--write --worktree` kullan. Uzun işleri arka planda başlatıp `watch` ile izle.
5. **Doğrula:** İşçi bitince görev **doğrulanacak** olur. Sonucu kendin kontrol et (dosyaları oku, testleri çalıştır, worktree dalının farkına bak). Uygunsa `plan set tN --status done --note "<kanıt>"`. Değilse aynı işçiye `--continue` ile düzeltme ver, başka işçiye ver ya da `failed`/`blocked` olarak notla. **Başarısız** görevin dalı varsa (`plan show`'da DAL sütunu) yeniden vermeden önce o dalı incele: işçi bağlantı kopması gibi bir nedenle düşmüş ama işi bitirmiş olabilir.
6. **Tekrarla:** Tüm görevler bitene kadar 4–5. Sonunda kullanıcıya ne yapıldığını, hangi işçinin yaptığını, doğrulama kanıtını ve açık kalanları raporla.
- Plan dosyası (`<proje>/.orkestra/plan.json`) tek doğruluk kaynağındır: bağlamın kaybolursa ya da yeni oturumda önce `plan show`.
- Dal birleştirme, push, silme gibi geri dönüşü zor adımları kullanıcıya sormadan yapma.

## Tek görev akışı
1. **Proje yolu:** Kullanıcı yolu verdiyse onu `--dir` ile ver. Vermediyse sor; tahmin etme. İşçi o klasörde çalışır ve dosyaları orada görür.
2. `status` çalıştır. `--probe`'u yalnızca etkinlik gerçekten belirsizse ya da kullanıcı isterse kullan.
3. Aşağıdaki tablodan işçiyi seç; yalnızca kimliği olan işçileri kullan. Kendi CLI'ına görev verme (Codex içindeysen `codex`, Claude Code içindeysen `claude` gibi); kullanıcı açıkça isterse istisna.
4. Varsayılan ihtiyaç `normal`, varsayılan efor `medium`. Basit işlerde `--need hizli`, zor işlerde `--need derin` ver. Açıkça verilen `--model` ya da `--effort` profilden önce gelir.
5. **Erişim:** İşçiler varsayılan olarak salt okunur modda başlatılır; inceleme, ikinci görüş ve plan için bu yeterli. İşçinin projede dosya yazması gerekiyorsa (`--write`) bunu yalnızca kullanıcı görevde açıkça değişiklik istediyse kullan. `--write` yalnızca `--dir` ile birlikte kabul edilir.
6. Prompt kendi başına anlaşılır olmalı: işçi bu konuşmayı görmez. Hedefi, ilgili dosyaları ve sınırı yaz ("yalnızca raporla" ya da "yalnızca şu dosyaları değiştir").
7. Sonuç bir rapordur, kanıt değil. Dosya değişikliklerini (`git diff` ya da dosyayı okuyarak) ve iddiaları kendin doğrula. Sonucu kullanıcıya hangi işçinin, hangi modelle, hangi klasörde ve hangi erişimle (okuma/yazma) çalıştığını belirterek aktar.

## İzleme
Her `run` başlarken stderr'e `[izleme] kimlik: <kimlik>` yazar; işçinin çıktısı geldikçe günlüğe eklenir.
- Uzun süren işçileri arka planda başlat, kimliği not et ve beklerken `$O watch <kimlik>` ile ilerlemeye bak. Birden fazla işçi varsa `$O runs` hepsini gösterir.
- **Son çıktıdan beri** süresi uzadıysa (agy için ~3 dk, diğerleri için ~2 dk) işçi takılmış olabilir: günlüğün son satırlarına bak, gerekirse kullanıcıya bildir.
- `kayıp (süreç yok)` durumu, orkestra süreci bitmeden öldü demektir; sonucu güvenilir değildir, gerekirse görevi yeniden ver.
- `--stream` çıktıyı geldikçe ekrana da basar; arka plan görevinin çıktısını canlı okumak için kullan.

## Oturum sürekliliği (`--continue`)
İşçi önceki görevini hatırlasın diye aynı oturumda devam ettir: `$O run <işçi> --continue <çalışma kimliği> -- "<prompt>"`.
- Çalışma kimliği `[izleme] kimlik: …` satırındadır; iş bitince `[izleme] oturum: … · devam için: --continue <kimlik>` yazar.
- Devam aynı işçiyle ve önceki çalışmanın proje klasöründe yapılır (`--dir` verilirse o kullanılır). Farklı bir işçiyle devam reddedilir.
- Devam prompt'unda bağlamı yeniden anlatma; yalnızca yeni isteği yaz ("az önce yazdığın fonksiyona test ekle").
- Okuma/yazma modu her çağrıda ayrıca verilir: önceki çalışma `--write` olsa bile devam varsayılan olarak salt okunurdur.
- Desteklenmeyenler: `kimi` (kimlikle devam yok) ve `--worktree` ile birlikte kullanım (önceki kopya silinmiştir).

## Paralel yazma (`--worktree`)
Birden fazla işçi aynı projede **aynı anda** dosya yazacaksa her birine `--write --worktree` ver. Proje bir git deposu olmalı ve en az bir commit içermeli.
1. Her işçi projenin son commit'inden açılan kendi dalında (`orkestra/<işçi>-<zaman>`) ve ayrı bir kopyada çalışır. Ana klasöre dokunulmaz.
2. Bitince işçinin değişiklikleri o dala commit edilir ve kopya silinir. Çıktıda dal adı, commit ve değişen dosyalar yazar. Değişiklik yoksa dal da silinir.
3. Dalları **otomatik birleştirme**. Her dalın farkını incele (`git diff <taban>..<dal>`), kullanıcıya hangisini almak istediğini sor ya da görev gereği açıksa sırayla birleştir: `git -C "<proje>" merge --no-ff <dal>`. Çakışma çıkarsa çözümü kullanıcıya göster.
4. Ana klasörde commit edilmemiş değişiklik varsa çıktı uyarır: işçinin kopyası bunları içermez. Gerekirse önce kullanıcıdan commit etmesini iste.
5. Aynı CLI'dan iki işçi aynı anda çalıştırma kuralı burada da geçerli (ör. iki `opencode` işçisi). Farklı CLI'lar paralel çalışabilir.

Tek bir işçi çalışacaksa `--worktree` gerekmez; `--write` doğrudan proje klasöründe çalışır.

## İşçi seçimi
| İhtiyaç | İşçi |
|---|---|
| Kod yazma, inceleme, ikinci görüş | `codex` |
| Claude modelleri | `claude` |
| Gemini ve Google modelleri | `agy` (**yalnızca okuma**: inceleme, analiz, plan; `--write` reddedilir; açılışı 50–170 sn, `--timeout 300`) |
| GitHub bağlamı | `copilot` (her çağrı AI kredisi harcar) |
| Kimi (kendi CLI'ı) | `kimi` (efor bayrağı yok; faturalama CLI ayarına bağlı, API ise kredi harcar) |
| Ücretsiz, basit işler | `opencode-free` (OpenCode Zen'in sınırlı ücretsiz modelleri) |
| MiniMax | `opencode:minimax` |
| Kimi, MiMo, Qwen, GLM, DeepSeek | `opencode-go` (abonelik) ya da `opencode:<sağlayıcı>` |
| Ücretli OpenCode modelleri | `opencode-zen` (Zen'in ücretli modelleri; kredi gerekir) |

`opencode:<sağlayıcı>` işçileri `opencode auth login` (ya da `/connect`) ile bağlanmış global sağlayıcılardır; Çinli sağlayıcıların `-cn` sürümleri bilerek listelenmez.

## Durumlar ve yapılacaklar
| Durum | Yapılacak |
|---|---|
| `aktif` | Kullan |
| `bağlı değil`, `anahtar süresi dolmuş`, `geçersiz anahtar` | Kullanıcıya `opencode auth login -p <sağlayıcı>` komutunu kendi terminalinde çalıştırmasını söyle |
| `bakiye/kredi yok`, `abonelik/lisans yok` | Kullanıcıya bildir, başka bir işçi seç |
| `zaman aşımı` | `--timeout` değerini artır ya da başka bir işçi seç |
| `kurulu değil` | O işçiyi atla |
| `pasif` | Kullanıcı bu işçiyi kapattı; kullanma, önerme. Kullanıcı açıkça isterse ayardan açmasını söyle |
| `izin reddedildi` | İşçi (özellikle agy) gereken bir izni etkileşimsiz modda alamadı ve boş döndü; görevi daraltıp yeniden ver ya da başka işçi seç |
| `Proje dizini bulunamadı` | Yolu kullanıcıya doğrulat |

## Kurallar
- API anahtarlarını kendin girme, okuma ya da yazdırma. Kimlik eklemek her zaman kullanıcının işidir.
- Aynı CLI'dan birden fazla süreci aynı anda çalıştırma: eşzamanlı `opencode` süreçleri zaman aşımına düşüyor. Farklı CLI'lar paralel çalışabilir.
- 2 dakikadan uzun sürebilecek çağrıları arka planda çalıştır.
- `--write` her CLI'da yalnızca dosya düzenlemeye izin veren en dar modu açar (Codex'te yalnızca proje klasörüne yazabilir). İstisna `kimi`: rutin komutları da çalıştırır. `agy` etkileşimsiz modda yazamaz; yazma işini başka işçiye ver. Tam yetki veren bayraklar hiçbir modda kullanılmaz.
- `--write` ile çalışan bir işçi sonrası yapılan değişiklikleri kullanıcıya göster; geri alınması gerekirse kullanıcıya sor.

## Ayar
Makineye özel ayar, araç klasöründeki (`bin/` dizininin bir üstü) `orkestra.config.json` dosyasıdır (git'e girmez):
```json
{ "models": { "codex": { "deep": "gpt-6-luna" } }, "disabled": ["kimi"] }
```
- `models`: işçinin hızlı/normal/derin model katmanları.
- `disabled`: pasif işçiler; durumda "pasif" görünür, test edilmez, `run` reddeder.
