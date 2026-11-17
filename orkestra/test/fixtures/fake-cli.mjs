// Gerçek bir AI CLI'ı taklit eder. Davranış FAKE_MODE ortam değişkeniyle seçilir.
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';

if (mode === 'echo') {
  console.log(JSON.stringify(args));
} else if (mode === 'cwd') {
  console.log(process.cwd());
} else if (mode === 'pwd') {
  console.log(process.env.PWD ?? '');
} else if (mode === 'write') {
  // Bir dosya yazan işçiyi taklit eder; biraz bekler ki paralel çalışma gerçekten örtüşsün.
  const { writeFileSync } = await import('node:fs');
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(process.env.FAKE_FILE ?? 'isci.txt', process.env.FAKE_CONTENT ?? 'merhaba\n');
  console.log('yazdım');
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
