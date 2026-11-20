// Gerçek bir AI CLI'ı taklit eder. Davranış FAKE_MODE ortam değişkeniyle seçilir.
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';

if (mode === 'echo') {
  console.log(JSON.stringify(args));
} else if (mode === 'cwd') {
  console.log(process.cwd());
} else if (mode === 'pwd') {
  console.log(process.env.PWD ?? '');
} else if (mode === 'session') {
  // Codex gibi oturum kimliğini başlıkta yazan işçi.
  console.log('workdir: x\nsession id: 11111111-2222-4333-8444-555555555555\n--------\nPONG');
} else if (mode === 'agy-denied') {
  // agy: izin reddedilince yanıt boş, JSON'da denied_actions dolu.
  console.log('jetski: no output produced — a tool required the "command" permission');
  console.log(JSON.stringify({ conversation_id: 'conv-1', status: 'SUCCESS', response: '', denied_actions: [{ action: 'command' }] }));
} else if (mode === 'echo-session') {
  // Argümanları yazar ve OpenCode gibi JSON olayıyla oturum kimliği verir.
  console.log(JSON.stringify({ type: 'text', sessionID: 'ses_test', part: { type: 'text', text: JSON.stringify(args) } }));
} else if (mode === 'chunks') {
  // Çıktıyı parça parça üreten, uzun süren bir işçiyi taklit eder.
  for (const line of ['adım 1: dosyalar okunuyor', 'adım 2: düzeltme yapılıyor', 'adım 3: bitti']) {
    console.log(line);
    await new Promise((r) => setTimeout(r, 400));
  }
} else if (mode === 'write') {
  // Bir dosya yazan işçiyi taklit eder; biraz bekler ki paralel çalışma gerçekten örtüşsün.
  const { writeFileSync } = await import('node:fs');
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(process.env.FAKE_FILE ?? 'isci.txt', process.env.FAKE_CONTENT ?? 'merhaba\n');
  console.log('yazdım');
} else if (mode === 'write-fail') {
  // Dosyayı yazıp sonra bağlantı hatasıyla düşen işçi (iş yarım ya da tamam olabilir).
  const { writeFileSync } = await import('node:fs');
  writeFileSync('yarim.txt', 'yarım iş\n');
  console.error('Error: Cannot connect to API: The socket connection was closed unexpectedly.');
  process.exitCode = 1;
} else if (mode === 'codex-tool-noise') {
  // Codex: ilerleme dökümü (işçinin çalıştırdığı komutların çıktısı dahil) stderr'e, son mesaj stdout'a.
  console.error(['session id: 11111111-2222-4333-8444-555555555555', 'exec', 'npm test', '+ FullyQualifiedErrorId : UnauthorizedAccess', 'HTTP 401', 'codex', 'bitti', 'tokens used', '12'].join('\n'));
  console.log('Testler geçti.');
} else if (mode === 'opencode-tool-noise') {
  // OpenCode: araç çıktısında kimlik hatasına benzeyen metin, işçinin cevabı ayrı.
  console.log(JSON.stringify({ type: 'tool_use', sessionID: 'ses_x', part: { state: { output: 'Error: 401 Unauthorized (projenin kendi API testi)' } } }));
  console.log(JSON.stringify({ type: 'text', sessionID: 'ses_x', part: { type: 'text', text: 'Testler geçti.' } }));
} else if (mode === 'codex-answer-401') {
  // Başarılı Codex cevabı, yazdığı kodun HTTP 401 davranışını anlatıyor (kimlik hatası değil).
  console.error('session id: 11111111-2222-4333-8444-555555555555');
  console.log([
    'Yedi düzeltmenin tamamını uyguladım; yalnızca izin verilen dosyaları değiştirdim.',
    'Oturum yoksa `/api/me` yanıtının 401 olmasını ve Unauthorized durumunda giriş ekranına dönülmesini testlerle doğruladım.',
    '`npm test` sonucu 22 test geçti, 0 başarısız.',
  ].join('\n'));
} else if (mode === 'opencode-text-then-error') {
  console.log(JSON.stringify({ type: 'text', sessionID: 'ses_x', part: { type: 'text', text: 'Başlıyorum' } }));
  console.log(JSON.stringify({ type: 'error', sessionID: 'ses_x', error: { data: { message: 'This API key has expired.' } } }));
} else if (mode === 'ok') {
  console.log('PONG');
} else if (mode === 'expired') {
  console.log('\x1b[91m\x1b[1mError: \x1b[0mThis API key has expired. Create a new API key in OpenCode Console.');
} else if (mode === 'invalid') {
  console.error('Error: login fail: Please carry the API secret key in the X-Api-Key field');
  process.exitCode = 1;
} else if (mode === 'sleep') {
  setTimeout(() => console.log('geç kaldım'), 30_000);
}
