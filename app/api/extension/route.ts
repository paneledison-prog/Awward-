import JSZip from 'jszip';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';

/**
 * The extension, as a download.
 *
 * Installing it otherwise means cloning the repository, which is a lot to ask
 * of someone who just wants to measure a page — and the extension is the only
 * path that needs no DevTools, no "allow pasting", and works on sites whose
 * CSP would block an injected script.
 */
const DIR = 'extension';

export async function GET() {
  try {
    const zip = new JSZip();
    const names = await readdir(DIR);

    for (const name of names) {
      // Flat directory by design; nothing here is nested.
      zip.file(name, await readFile(join(DIR, name)));
    }

    zip.file(
      'INSTALL.txt',
      [
        'DesignDNA browser extension',
        '',
        '1. Unzip this folder somewhere permanent — Chrome loads it from disk,',
        '   so deleting the folder uninstalls the extension.',
        '2. Open chrome://extensions',
        '3. Turn on "Developer mode" (top right)',
        '4. Click "Load unpacked" and select the unzipped folder',
        '5. Click the DesignDNA icon, set your instance URL, and extract a page',
        '',
        'Updating: Chrome keeps running the copy already on disk, so a new',
        'download does nothing until you replace it. Unzip over the same folder,',
        'then press the reload arrow on the DesignDNA card in chrome://extensions.',
        'The version at the bottom of the popup tells you which build is loaded.',
        '',
        'It asks for permission only for the instance URL you enter, and reads',
        'a page only when you click the button on it.',
      ].join('\n'),
    );

    const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="designdna-extension.zip"',
        'Content-Length': String(body.length),
      },
    });
  } catch (error) {
    return new Response(
      `Extension bundle unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }
}
