# orkestra

Bilgisayardaki AI CLI'larını işçi olarak yöneten orkestratör. Bağımlılık yok, Node ≥ 20.

## Nasıl çağrılır
Hiçbir skill klasörüne kurulmaz ve kendiliğinden devreye girmez. Herhangi bir projede, kullandığın AI ajanına (Claude Code, Codex, Copilot, agy, OpenCode…) şöyle yazman yeterli:

> `F:\projeler\orkestrasyonum\orkestra\SKILL.md` dosyasını oku ve uygula. Proje: `D:\kodlar\uygulamam`. Görev: giriş sayfasındaki form doğrulamasını Codex'e incelet, dosya değiştirmesin.

Ajan SKILL.md'yi okur, aracı aynı klasörde bulur ve işçiyi `--dir` ile verdiğin proje klasöründe çalıştırır.

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
| codex | `-s read-only` | `-s workspace-write` (yalnızca proje klasörü) |
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

Makineye özel ayar bu klasördeki `orkestra.config.json` dosyasıdır (git'e girmez):
```json
{
  "models": { "codex": { "deep": "gpt-6-luna" }, "opencode:minimax": { "normal": "MiniMax-M3" } },
  "disabled": ["kimi"]
}
```
- `models`: işçinin hızlı/normal/derin model katmanları.
- `disabled`: **pasif** işçiler. Durumda "pasif" görünür, `--probe` ile test edilmez, `run` reddeder. Açmak için listeden çıkar.

## Kimlik durumları
`aktif`, `bağlı değil`, `anahtar süresi dolmuş`, `geçersiz anahtar`, `bakiye/kredi yok`, `abonelik/lisans yok`, `giriş gerekli`, `model desteklenmiyor`, `zaman aşımı`, `kurulu değil`.
Kimlik bilgisi `~/.local/share/opencode/auth.json` ve sağlayıcı ortam değişkenlerinden okunur; anahtarlar asla çıktıya yazılmaz.

## Testler
```bash
npm test                                   # birim testleri (sahte CLI + mock anahtar)
ORKESTRA_INTEGRATION=1 npm test            # + gerçek opencode, geçici klasörde mock anahtarla
```
