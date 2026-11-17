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
$O run <işçi> --dir "<proje yolu>" [--write] [--need hizli|normal|derin] [--model m] [--effort low|medium|high|xhigh|max] [--timeout sn] [--json] -- "<prompt>"
```

## Akış
1. **Proje yolu:** Kullanıcı yolu verdiyse onu `--dir` ile ver. Vermediyse sor; tahmin etme. İşçi o klasörde çalışır ve dosyaları orada görür.
2. `status` çalıştır. `--probe`'u yalnızca etkinlik gerçekten belirsizse ya da kullanıcı isterse kullan.
3. Aşağıdaki tablodan işçiyi seç; yalnızca kimliği olan işçileri kullan. Kendi CLI'ına görev verme (Codex içindeysen `codex`, Claude Code içindeysen `claude` gibi); kullanıcı açıkça isterse istisna.
4. Varsayılan ihtiyaç `normal`, varsayılan efor `medium`. Basit işlerde `--need hizli`, zor işlerde `--need derin` ver. Açıkça verilen `--model` ya da `--effort` profilden önce gelir.
5. **Erişim:** İşçiler varsayılan olarak salt okunur modda başlatılır; inceleme, ikinci görüş ve plan için bu yeterli. İşçinin projede dosya yazması gerekiyorsa (`--write`) bunu yalnızca kullanıcı görevde açıkça değişiklik istediyse kullan. `--write` yalnızca `--dir` ile birlikte kabul edilir.
6. Prompt kendi başına anlaşılır olmalı: işçi bu konuşmayı görmez. Hedefi, ilgili dosyaları ve sınırı yaz ("yalnızca raporla" ya da "yalnızca şu dosyaları değiştir").
7. Sonuç bir rapordur, kanıt değil. Dosya değişikliklerini (`git diff` ya da dosyayı okuyarak) ve iddiaları kendin doğrula. Sonucu kullanıcıya hangi işçinin, hangi modelle, hangi klasörde ve hangi erişimle (okuma/yazma) çalıştığını belirterek aktar.

## İşçi seçimi
| İhtiyaç | İşçi |
|---|---|
| Kod yazma, inceleme, ikinci görüş | `codex` |
| Claude modelleri | `claude` |
| Gemini ve Google modelleri | `agy` (açılışı 50–170 sn; `--timeout 300`) |
| GitHub bağlamı | `copilot` (her çağrı AI kredisi harcar) |
| Kimi (kendi CLI'ı) | `kimi` (efor bayrağı yok; faturalama CLI ayarına bağlı, API ise kredi harcar) |
| Ücretsiz, basit işler | `opencode-free` |
| MiniMax | `opencode:minimax` |
| Kimi, MiMo, Qwen, GLM, DeepSeek | `opencode-go` (abonelik) ya da `opencode:<sağlayıcı>` |
| Ücretli OpenCode modelleri | `opencode-zen` |

`opencode:<sağlayıcı>` işçileri `opencode auth login` (ya da `/connect`) ile bağlanmış global sağlayıcılardır; Çinli sağlayıcıların `-cn` sürümleri bilerek listelenmez.

## Durumlar ve yapılacaklar
| Durum | Yapılacak |
|---|---|
| `aktif` | Kullan |
| `bağlı değil`, `anahtar süresi dolmuş`, `geçersiz anahtar` | Kullanıcıya `opencode auth login -p <sağlayıcı>` komutunu kendi terminalinde çalıştırmasını söyle |
| `bakiye/kredi yok`, `abonelik/lisans yok` | Kullanıcıya bildir, başka bir işçi seç |
| `zaman aşımı` | `--timeout` değerini artır ya da başka bir işçi seç |
| `kurulu değil` | O işçiyi atla |
| `Proje dizini bulunamadı` | Yolu kullanıcıya doğrulat |

## Kurallar
- API anahtarlarını kendin girme, okuma ya da yazdırma. Kimlik eklemek her zaman kullanıcının işidir.
- Aynı CLI'dan birden fazla süreci aynı anda çalıştırma: eşzamanlı `opencode` süreçleri zaman aşımına düşüyor. Farklı CLI'lar paralel çalışabilir.
- 2 dakikadan uzun sürebilecek çağrıları arka planda çalıştır.
- `--write` her CLI'da yalnızca dosya düzenlemeye izin veren en dar modu açar (Codex'te yalnızca proje klasörüne yazabilir). İstisna `kimi`: rutin komutları da çalıştırır. Tam yetki veren bayraklar hiçbir modda kullanılmaz.
- `--write` ile çalışan bir işçi sonrası yapılan değişiklikleri kullanıcıya göster; geri alınması gerekirse kullanıcıya sor.

## Ayar
Model katmanlarını değiştirmek için araç klasörüne (`bin/` dizininin bir üstü) `orkestra.config.json` koy:
```json
{ "models": { "codex": { "deep": "gpt-6-luna" } } }
```
