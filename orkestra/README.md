# orkestra

Bilgisayardaki AI CLI'larını işçi olarak yöneten orkestratör. Bağımlılık yok, Node ≥ 22.

**Beyin ve el:** Planlayan, iş dağıtan ve doğrulayan **beyin**, SKILL.md'yi okuyan AI ajanıdır (konuştuğun model). orkestra onun **eli**: işçileri tanıtır (`profile`), planı saklar (`plan`), görevleri işçilere verir (`run`), izler (`runs`, `watch`) ve oturumları sürdürür (`--continue`). Hangi işin kime gideceğine orkestra değil beyin karar verir.

Orkestranın kendisini geliştirenler için: kurallar ve yapı [../CLAUDE.md](../CLAUDE.md), nerede kalındığı ve açık işler [../ACIK-ISLER.md](../ACIK-ISLER.md).

## Nasıl çağrılır
Hiçbir skill klasörüne kurulmaz ve kendiliğinden devreye girmez. Herhangi bir projede, kullandığın AI ajanına (Claude Code, Codex, Copilot, agy, OpenCode…) şöyle yazman yeterli:

> `F:\projeler\orkestrasyonum\orkestra\SKILL.md` dosyasını oku ve uygula. Proje: `D:\kodlar\uygulamam`. Görev: giriş sayfasındaki form doğrulamasını Codex'e incelet, dosya değiştirmesin.

Ajan SKILL.md'yi okur, aracı aynı klasörde bulur ve işçiyi `--dir` ile verdiğin proje klasöründe çalıştırır.

Bir uygulamayı baştan sona orkestrasyonla geliştirmek için:

> `F:\projeler\orkestrasyonum\orkestra\SKILL.md` dosyasını oku ve uygula. Proje: `D:\kodlar\uygulamam`. Hedef: kullanıcı girişi olan bir not uygulaması. Önceliğim düşük maliyet.

Ajan beyin olarak **spec driven** ilerler; her aşamada senin onayını alır ve onaysız bir sonrakine geçmez:

1. **Gereksinim** (`docs/spec/requirements.md`): seninle görüşür; kullanıcı hikâyelerini ve numaralı kabul ölçütlerini yazar.
2. **Tasarım** (`docs/spec/design.md`): ekran taslaklarını sana gösterir; veri modeli, API ve hata mesajlarını yazar.
3. **Görevler** (`docs/spec/tasks.md`): işi uçtan uca özelliklere böler, her görevi kabul ölçütlerine bağlar ve işçilere dağıtır.
4. **Doğrulama ve kabul:** her kabul ölçütünü testle ve uygulamayı gerçekten çalıştırarak kanıtlar; sana ölçüt ölçüt rapor verir.

İşler `main`'de değil, bir çalışma dalında yürür. Proje git deposu değilse ajan sana sorup `git init` yapar, `.orkestra/`'yı `.gitignore`'a ekler ve ilk commit'i atar. `main` üzerindeyse `orkestra-hedef/<hedef>` dalını açar; işçilerin yazdıkları ve worktree dalları bu dala birleşir. Çalışma dalı `main`'e yalnızca senin onayınla birleşir.

Orkestra klasörü projenin dışında olduğu için ajan ilk seferde bu klasörü okumak ve `node` çalıştırmak için izin ister; onaylaman gerekir. Etkileşimsiz modda (`opencode run`, `claude -p` gibi) bu izin otomatik reddedilir; o modda ajanın ayarında `F:\projeler\orkestrasyonum\orkestra\*` için okuma izni tanımlı olmalı.

## İşçiler
| İşçi | Ne | Faturalama |
|---|---|---|
| `claude`, `codex`, `agy`, `copilot` | Kendi CLI'ları | CLI'ın kendi aboneliği |
| `kimi` | Kimi Code CLI | CLI ayarına bağlı (Moonshot API ya da abonelik) |
| `opencode-go` | OpenCode Go modelleri | abonelik |
| `opencode-zen` | OpenCode Zen'in ücretli modelleri | token (kredi) |
| `opencode-free` | OpenCode Zen'in sınırlı ücretsiz modelleri | ücretsiz |
| `opencode:<sağlayıcı>` | `/connect` ile bağlanan sağlayıcılar (MiniMax, Kimi, MiMo…) | abonelik veya token |

Çinli sağlayıcıların yalnızca global sürümleri listelenir (`-cn` ve `.cn` uç noktaları elenir).

## Komutlar
```bash
node bin/orkestra.mjs status            # kurulum + kimlik durumu (ücretsiz)
node bin/orkestra.mjs status --probe    # her bağlı işçiye kısa test gönderir (kredi harcar)
node bin/orkestra.mjs models opencode-go
node bin/orkestra.mjs run codex --dir "D:/kodlar/uygulamam" --need derin -- "görev"
node bin/orkestra.mjs run opencode:minimax --model MiniMax-M3 --effort high -- "görev"
```

## Model ve efor
- Efor: `low | medium | high | xhigh | max`; varsayılan **medium (normal)**.
- İhtiyaç: `hizli` (hızlı model + low), `normal` (normal model + medium), `derin` (derin model + high).
- Açıkça verilen `--model` / `--effort` ihtiyaç profilini geçersiz kılar.
- CLI'ı desteklemeyebilecek işçilere (Copilot, OpenCode) `medium` için bayrak gönderilmez; kendi varsayılanları kullanılır.

`--dir` verilmezse işçi komutun çalıştırıldığı klasörde çalışır.

## Okuma ve yazma
İşçiler varsayılan olarak **salt okunur** başlatılır. `--write` (yalnızca `--dir` ile) her CLI'da dosya düzenlemeye izin veren en dar modu açar:

| İşçi | Varsayılan (okuma) | `--write` |
|---|---|---|
| claude | `--permission-mode plan` | `--permission-mode acceptEdits` |
| codex | `-c sandbox_mode="read-only"` | `-c sandbox_mode="workspace-write"` (yalnızca proje klasörü) |
| copilot | `--deny-tool=write` | `--allow-tool=write` |
| agy | `--mode plan` | — desteklenmiyor (etkileşimsiz modda komut izni beklerken boş dönüyor; `--write` reddedilir) |
| kimi | `--plan` | `--yolo` (rutin komutları da çalıştırır) |
| opencode* | `--agent plan` | varsayılan `build` ajanı |

```bash
node bin/orkestra.mjs run codex --dir "D:/kodlar/uygulamam" --write -- "src/slugify.js'deki Türkçe karakter hatasını düzelt, başka dosyaya dokunma"
```

## İzleme
Her `run` bir kimlik alır (`[izleme] kimlik: …` stderr'e yazılır) ve işçinin çıktısı geldikçe `~/.orkestra/runs/<kimlik>.log` dosyasına eklenir (`ORKESTRA_HOME` ile değiştirilebilir).

```bash
node bin/orkestra.mjs runs            # son çalışmalar: durum, başlayalı, son çıktıdan beri
node bin/orkestra.mjs watch <kimlik>  # bir çalışmanın ayrıntısı ve günlüğün son satırları
node bin/orkestra.mjs run codex --dir "D:/kodlar/uygulamam" --stream -- "görev"   # çıktıyı canlı bas
```

"Son çıktıdan beri" süresi uzadıysa işçi takılmış olabilir. `kayıp (süreç yok)` ise orkestra süreci iş bitmeden öldü demektir.

## Oturum sürekliliği (`--continue`)
İşçi önceki görevini hatırlasın diye aynı oturumda devam ettirilebilir:

```bash
node bin/orkestra.mjs run codex --dir "D:/kodlar/uygulamam" -- "src/api.js'deki hataları bul"
# [izleme] oturum: … · devam için: --continue codex-20261118-101500-a1b2
node bin/orkestra.mjs run codex --continue codex-20261118-101500-a1b2 -- "en kritik olanı için düzeltme öner"
```

| İşçi | Yeni oturum | Devam |
|---|---|---|
| claude | `--session-id <uuid>` (kimliği orkestra üretir) | `--resume <uuid>` |
| copilot | `--session-id <uuid>` (kimliği orkestra üretir) | aynı |
| codex | çıktıdaki `session id:` satırı | `exec resume <kimlik>` |
| opencode* | `--format json` olaylarındaki `sessionID` | `--session <kimlik>` |
| agy | `--output-format json` sonucundaki `conversation_id` | `--conversation <kimlik>` |
| kimi | — desteklenmiyor | — |

Devam, önceki çalışmanın işçisiyle ve klasöründe yapılır; okuma/yazma modu her çağrıda ayrıca verilir. Önceki çalışma `--worktree` ile yapıldıysa ve devam da işçinin dalında olsun istiyorsan `--write --worktree` ekle (bkz. Paralel yazma). OpenCode ve agy JSON biçiminde çalıştırılır; orkestra metni ve hata mesajlarını JSON'dan çıkarır (`--stream` ham JSON olaylarını gösterir). agy bir izin reddi yüzünden boş dönerse durum `izin reddedildi` olur.

## Paralel yazma (`--worktree`)
Birden fazla işçi aynı projede aynı anda yazacaksa `--write --worktree` kullan (proje git deposu olmalı):

```bash
node bin/orkestra.mjs run codex          --dir "D:/kodlar/uygulamam" --write --worktree -- "API katmanını yaz" &
node bin/orkestra.mjs run opencode-free  --dir "D:/kodlar/uygulamam" --write --worktree -- "testleri yaz" &
wait
```

Her işçi kendi dalında (`orkestra/<işçi>-<zaman>`) ve ayrı bir kopyada çalışır; ana klasöre dokunulmaz. Bitince değişiklikler o dala commit edilir, kopya silinir ve çıktı dal adını verir. Birleştirme otomatik değildir:

```bash
git -C "D:/kodlar/uygulamam" merge --no-ff orkestra/codex-20261118-101500-a1b2
```

Worktree işçisine aynı oturumda düzeltme vermek için `--continue` ile `--worktree` birlikte kullanılır:

```bash
node bin/orkestra.mjs run codex --continue codex-20261118-101500-a1b2 --write --worktree -- "testteki hatayı düzelt"
```

İşçinin dalı önceki kopyanın **aynı yolunda** yeniden açılır (bazı CLI'ların oturumu klasöre bağlıdır), değişiklik o dala yeni commit olarak eklenir ve kopya yine silinir. Değişiklik yoksa dal korunur; önceki çalışma hiçbir şey değiştirmediği için dal silinmişse aynı adla güncel HEAD'den açılır. Dal başka bir yerde checkout edilmişse ya da önceki çalışma worktree'de değilse komut reddedilir.

Makineye özel ayar bu klasördeki `orkestra.config.json` dosyasıdır (git'e girmez):
```json
{
  "models": { "codex": { "deep": "gpt-6-luna" }, "opencode:minimax": { "normal": "MiniMax-M3" } },
  "disabled": ["kimi"]
}
```
- `models`: işçinin hızlı/normal/derin model katmanları.
- `disabled`: **pasif** işçiler. Durumda "pasif" görünür, `--probe` ile test edilmez, `run` reddeder. Açmak için listeden çıkar.

## İşçi profili (`profile`)
Beynin karar vermesi için her işçinin durumu, yazabilip yazamadığı, oturum desteği, faturalaması, kısa notu ve geçmişi. Canlı test yapmaz, kredi harcamaz. Geçmiş iki ayrı sütundur:
- **DOĞRULANAN (bitti/kapanan):** beynin kararı. Çalışmaların yapıldığı projelerdeki planlardan okunur; "bitti" ya da "başarısız" kapanmış görevler, görevin son çalışmasının işçisine sayılır.
- **ÇIKIŞ (başarılı/toplam · ort.):** işçinin nasıl bittiği. Zaman aşımına düşen ya da bağlantısı kopan işçinin işi yine de tamam olabilir; pilotta opencode-free'nin çıkışı 1/3, doğrulananı 3/3'tü.

```bash
node bin/orkestra.mjs profile          # tablo
node bin/orkestra.mjs profile --json   # beynin okuması için
```

## Plan (`plan`)
Beynin kalıcı planı projede tutulur: `<proje>/.orkestra/plan.json`. Bağlam kaybolsa ya da oturum değişse bile süreç buradan devam eder.

```bash
node bin/orkestra.mjs plan init --dir P -- "Not uygulaması"
node bin/orkestra.mjs plan add  --dir P --worker codex -- "API katmanını yaz"
node bin/orkestra.mjs plan add  --dir P --depends t1 --note "testler geçmeli" -- "API testlerini yaz"
node bin/orkestra.mjs plan show --dir P            # görevler, hazır olanlar, doğrulanacaklar
node bin/orkestra.mjs run codex --dir P --write --task t1 -- "API katmanını yaz"
node bin/orkestra.mjs plan set t1 --dir P --status done --note "testler geçti"
```

Görev durumları: `yapılacak` → `çalışıyor` → `doğrulanacak` → `bitti` (ya da `başarısız` / `engelli`). `run --task` görevi başlarken "çalışıyor", işçi başarıyla bitince **"doğrulanacak"** yapar; "bitti" kararı sonucu kontrol eden beyindedir. Paralel işçilerin plan güncellemeleri dosya kilidiyle sıraya girer. `.orkestra/` klasörünü projenin git'ine almak ya da `.gitignore`'a eklemek proje sahibinin tercihidir.

## Kimlik durumları
`aktif`, `bağlı değil`, `anahtar süresi dolmuş`, `geçersiz anahtar`, `bakiye/kredi yok`, `abonelik/lisans yok`, `giriş gerekli`, `model desteklenmiyor`, `zaman aşımı`, `kurulu değil`.
Kimlik bilgisi `~/.local/share/opencode/auth.json` ve sağlayıcı ortam değişkenlerinden okunur; anahtarlar asla çıktıya yazılmaz.

## Testler
```bash
npm test                                   # birim testleri (sahte CLI + mock anahtar)
ORKESTRA_INTEGRATION=1 npm test            # + gerçek opencode, geçici klasörde mock anahtarla
```
