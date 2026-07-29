// Builds a locally-signed release APK, for testing a release build without
// going through CI. Mirrors the signing setup in
// .github/workflows/release.yml: `tauri android init` regenerates
// src-tauri/gen/android/app/build.gradle.kts from a vanilla template with no
// signingConfigs block (gen/android is gitignored, never committed), so
// without this patch every release build is silently *unsigned* and fails
// to install with INSTALL_PARSE_FAILED_NO_CERTIFICATES.
//
// Usage:
//   ANDROID_KEY_PASSWORD=<password> pnpm build-android-signed
//   ANDROID_KEY_PASSWORD=<password> pnpm build-android-signed -t aarch64
//   ANDROID_KEY_PASSWORD=<password> ANDROID_KEY_FILE=/path/to/other.jks pnpm build-android-signed
//
// ANDROID_KEY_FILE is optional and defaults to the repo-root
// myreader-release-key.jks. The keystore alias is auto-detected from the
// keystore (assumes a single signing entry, the normal case for a release
// key) — no need to pass it in.
//
// Plain TypeScript (not bash) specifically so this doesn't depend on which
// `bash` a Windows PATH happens to resolve first — `C:\Windows\System32\bash.exe`
// (the WSL launcher) shadowing Git Bash's bash.exe is a common footgun there.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const password = process.env['ANDROID_KEY_PASSWORD'];
if (!password) {
  console.error('ANDROID_KEY_PASSWORD is not set');
  process.exit(1);
}

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const appDir = path.join(repoRoot, 'app');
const keystorePath =
  process.env['ANDROID_KEY_FILE'] || path.join(repoRoot, 'myreader-release-key.jks');

if (!fs.existsSync(keystorePath)) {
  console.error(`Keystore not found at ${keystorePath}`);
  process.exit(1);
}

const androidDir = path.join(appDir, 'src-tauri', 'gen', 'android');
if (!fs.existsSync(androidDir)) {
  console.error(`${androidDir} not found — run \`pnpm tauri android init\` first (see README.md).`);
  process.exit(1);
}

// keytool is a real .exe (Java-provided), so it resolves via PATH without a
// shell — using execFileSync (argument array, not a shell string) also
// keeps the password out of any shell-quoting/injection concerns.
let keyAlias: string | undefined;
try {
  const output = execFileSync(
    'keytool',
    ['-list', '-storepass', password, '-keystore', keystorePath],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const line = output.split('\n').find((l) => l.includes('PrivateKeyEntry'));
  keyAlias = line?.split(',')[0]?.trim();
} catch {
  // keytool exits non-zero on a wrong password — fall through to the check below.
}
if (!keyAlias) {
  console.error(
    'Failed to open the keystore or find a private key entry — check ANDROID_KEY_PASSWORD',
  );
  process.exit(1);
}
console.error(`Using key alias: ${keyAlias}`);

// keystore.properties is read by the JVM (Gradle) as plain file content, so
// a raw Windows backslash path would get corrupted: Java's Properties
// parser treats "\p", "\m", etc. as escape sequences and silently drops the
// backslash. Forward slashes are accepted by Gradle's file() on every OS,
// so normalize to those instead of trying to escape backslashes.
const storeFileForGradle = keystorePath.split(path.sep).join('/');
const propertiesPath = path.join(androidDir, 'keystore.properties');
fs.writeFileSync(
  propertiesPath,
  [`keyAlias=${keyAlias}`, `password=${password}`, `storeFile=${storeFileForGradle}`, ''].join(
    '\n',
  ),
);

const gradleFilePath = path.join(androidDir, 'app', 'build.gradle.kts');
let gradleContent = fs.readFileSync(gradleFilePath, 'utf8');

if (!gradleContent.includes('signingConfigs')) {
  console.error(`Wiring release signingConfig into ${gradleFilePath}`);
  gradleContent = gradleContent.replace(
    /android \{\r?\n/,
    `android {
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) {
                val keystoreProperties = Properties()
                keystoreProperties.load(keystorePropertiesFile.inputStream())
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("password")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("password")
            }
        }
    }
`,
  );
  gradleContent = gradleContent.replace(
    /(getByName\("release"\) \{\r?\n)/,
    '$1            signingConfig = signingConfigs.getByName("release")\n',
  );
}

if (!gradleContent.includes('missingDimensionStrategy')) {
  console.error(`Wiring foss/googleplay store dimension strategy into ${gradleFilePath}`);
  gradleContent = gradleContent.replace(
    /(defaultConfig \{\r?\n)/,
    '$1        missingDimensionStrategy("store", "foss", "googleplay")\n',
  );
}

fs.writeFileSync(gradleFilePath, gradleContent);

const extraArgs = process.argv.slice(2);
console.error(`Running: pnpm tauri android build ${extraArgs.join(' ')}`.trimEnd());
execSync(`pnpm tauri android build ${extraArgs.join(' ')}`.trimEnd(), {
  stdio: 'inherit',
  cwd: appDir,
});

const apkDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'universal', 'release');
const apkFiles = fs.existsSync(apkDir)
  ? fs
      .readdirSync(apkDir)
      .filter((f) => f.startsWith('app-universal-release') && f.endsWith('.apk'))
  : [];
if (apkFiles.length === 0) {
  console.error(`Build finished but no APK found in ${apkDir}`);
  process.exit(1);
}
const latest = apkFiles
  .map((f) => ({ f, mtime: fs.statSync(path.join(apkDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]!.f;
const latestPath = path.join(apkDir, latest);

if (latest.includes('unsigned')) {
  console.error(`Produced an UNSIGNED apk — signing did not take effect: ${latestPath}`);
  process.exit(1);
}

console.error(`Signed APK: ${latestPath}`);
