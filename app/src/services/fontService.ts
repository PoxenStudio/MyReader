import { AppService, FileSystem } from '@/types/system';
import { getFilename } from '@/utils/path';
import { md5, partialMD5 } from '@/utils/md5';
import { uniqueId } from '@/utils/misc';
import { CustomFont, CustomFontInfo } from '@/styles/fonts';
import { parseFontInfo } from '@/utils/font';
import { downloadFile } from '@/libs/storage';

/**
 * Build the cross-device content id for a font:
 * `md5(partialMD5 ‖ byteSize ‖ filename)`. Same recipe shape as
 * dictionary.computeReplicaId — keeps the kinds aligned.
 */
export const computeFontContentId = (
  partialMd5: string,
  byteSize: number,
  filename: string,
): string => md5(`${partialMd5}|${byteSize}|${filename}`);

/**
 * Import a font into the user's `Fonts` base under a per-font bundle dir
 * (`<bundleDir>/<filename>`). The bundle dir is a fresh `uniqueId()` —
 * matches the dictionary import pattern. Returns a CustomFontInfo with
 * the relative path, contentId, bundleDir, and byteSize populated so
 * the store can publish the replica row immediately.
 */
export async function importFont(
  fs: FileSystem,
  file?: string | File,
): Promise<CustomFontInfo | null> {
  const bundleDir = uniqueId();
  let filename: string;
  let bytes: ArrayBuffer;

  if (typeof file === 'string') {
    const filePath = file;
    const fileobj = await fs.openFile(filePath, 'None');
    filename = fileobj.name || getFilename(filePath);
    bytes = await fileobj.arrayBuffer();
  } else if (file) {
    filename = getFilename(file.name);
    bytes = await file.arrayBuffer();
  } else {
    return null;
  }

  const fontPath = `${bundleDir}/${filename}`;
  await fs.createDir(bundleDir, 'Fonts', true);
  await fs.writeFile(fontPath, 'Fonts', bytes);

  const fontFile = await fs.openFile(fontPath, 'Fonts');
  const partialMd5 = await partialMD5(fontFile);
  const byteSize = bytes.byteLength;
  const contentId = computeFontContentId(partialMd5, byteSize, filename);

  return {
    path: fontPath,
    bundleDir,
    contentId,
    byteSize,
    ...parseFontInfo(bytes, filename),
  };
}

/**
 * Download a font from a remote URL into a fresh bundle dir under `Fonts`
 * (`<bundleDir>/<filename>`), then compute its contentId and parse its
 * metadata exactly like a local import. Used for preset fonts hosted on
 * MyBooks (see `PRESET_CJK_FONTS` in `services/constants`).
 */
export async function importFontFromUrl(
  fs: FileSystem,
  appService: AppService,
  url: string,
  filename: string,
): Promise<CustomFontInfo | null> {
  const bundleDir = uniqueId();
  const fontPath = `${bundleDir}/${filename}`;

  await fs.createDir(bundleDir, 'Fonts', true);
  const dst = await appService.resolveFilePath(fontPath, 'Fonts');
  await downloadFile({ appService, dst, url });

  const fontFile = await fs.openFile(fontPath, 'Fonts');
  const bytes = await fontFile.arrayBuffer();
  const partialMd5 = await partialMD5(fontFile);
  const byteSize = bytes.byteLength;
  const contentId = computeFontContentId(partialMd5, byteSize, filename);

  return {
    path: fontPath,
    bundleDir,
    contentId,
    byteSize,
    ...parseFontInfo(bytes, filename),
  };
}

export async function deleteFont(fs: FileSystem, font: CustomFont): Promise<void> {
  await fs.removeFile(font.path, 'Fonts');
  // Also remove the per-font bundle dir if it's now empty. Legacy fonts
  // without bundleDir live at the flat `Fonts/<filename>` path; nothing
  // extra to clean up there.
  if (font.bundleDir) {
    try {
      await fs.removeDir(font.bundleDir, 'Fonts', true);
    } catch (err) {
      console.warn('Failed to remove font bundleDir', font.bundleDir, err);
    }
  }
}
