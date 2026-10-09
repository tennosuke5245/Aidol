import { cp, mkdir, readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function skillSource() {
  return process.env.AIDOL_SKILL_SOURCE || fileURLToPath(new URL('../.agents/skills/aidol/', import.meta.url));
}

export function skillDestination(codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex')) {
  return path.resolve(codexHome, 'skills', 'aidol');
}

export async function skillStatus(destination = skillDestination()) {
  try {
    const content = await readFile(path.join(destination, 'SKILL.md'), 'utf8');
    return { installed: /^name:\s*aidol\s*$/m.test(content), path: destination };
  } catch { return { installed: false, path: destination }; }
}

export async function installSkill({ source = skillSource(), destination = skillDestination() } = {}) {
  await access(path.join(source, 'SKILL.md'));
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  if (resolvedSource === resolvedDestination) return { installed: true, path: resolvedDestination };
  const destinationExists = await access(resolvedDestination).then(() => true, () => false);
  if (destinationExists) {
    const backup = `${resolvedDestination}.backup-${Date.now()}`;
    await cp(resolvedDestination, backup, { recursive: true });
  }
  await mkdir(resolvedDestination, { recursive: true });
  await cp(resolvedSource, resolvedDestination, { recursive: true, force: true });
  return { installed: true, path: resolvedDestination, discoverOnNextSession: true };
}

if (!process.env.AIDOL_SKIP_SKILL_AUTOINSTALL && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installSkill().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`AIDOL skill 安裝失敗：${error.message}\n`); process.exitCode = 1;
  });
}
