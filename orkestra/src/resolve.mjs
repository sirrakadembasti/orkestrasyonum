// CLI'ı kabuk kullanmadan çalıştırılabilir hale getirir.
// Windows'ta npm .cmd shim'leri çözülür: hedef .exe ise doğrudan, .js ise node ile çalıştırılır.
// Böylece prompt içindeki özel karakterler cmd.exe tarafından yorumlanmaz.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveCommand(name, {
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  read = (p) => readFileSync(p, 'utf8'),
  nodePath = process.execPath,
} = {}) {
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    if (platform !== 'win32') {
      const file = join(dir, name);
      if (exists(file)) return { file, prefixArgs: [] };
      continue;
    }
    const exe = join(dir, `${name}.exe`);
    if (exists(exe)) return { file: exe, prefixArgs: [] };
    const cmd = join(dir, `${name}.cmd`);
    if (exists(cmd)) {
      // Shim önce "%dp0%\node.exe" denetler; asıl hedef son eşleşmedir.
      const match = [...read(cmd).matchAll(/"%dp0%\\([^"]+\.(exe|js))"/gi)].pop();
      if (!match) continue;
      const target = join(dir, match[1]);
      return match[2].toLowerCase() === 'exe'
        ? { file: target, prefixArgs: [] }
        : { file: nodePath, prefixArgs: [target] };
    }
  }
  return null;
}
