import { describe, expect, it } from 'vitest';

import { DocumentLoader } from '@/libs/document';

const createCaseMismatchEpub = async () => {
  const { ZipWriter, BlobWriter, TextReader } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'));

  await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  );
  await writer.add(
    'OPS/content.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">case-mismatch</dc:identifier>
    <dc:title>Case mismatch</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="Text/Chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`),
  );
  await writer.add(
    'OPS/text/chapter1.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Case mismatch</title>
  </head>
  <body>
    <p>Hello from the lowercase chapter entry.</p>
  </body>
</html>`),
  );

  const blob = await writer.close();
  const arrayBuffer = await blob.arrayBuffer();
  return new File([arrayBuffer], 'case-mismatch.epub', { type: 'application/epub+zip' });
};

describe('DocumentLoader EPUB zip lookup', () => {
  it('loads EPUB resources when manifest href casing differs from the zip entry', async () => {
    const file = await createCaseMismatchEpub();
    const loader = new DocumentLoader(file);

    const { book, format } = await loader.open();
    expect(format).toBe('EPUB');

    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).toContain('Hello from the lowercase chapter entry.');
  });

  it('opens real EPUB (zip) bytes as EPUB even when the file carries a misleading .txt name', async () => {
    // Regression test: a cloud download (or a renamed file) can end up with a
    // .txt extension while its content is actually a real EPUB zip archive.
    // DocumentLoader must sniff the magic bytes and parse it as EPUB rather
    // than matching the .txt extension and feeding real zip bytes through the
    // TXT->EPUB converter's text-encoding heuristics, which would corrupt it.
    const epubFile = await createCaseMismatchEpub();
    const arrayBuffer = await epubFile.arrayBuffer();
    const misnamedFile = new File([arrayBuffer], 'book.txt', { type: 'text/plain' });
    const loader = new DocumentLoader(misnamedFile);

    const { book, format } = await loader.open();
    expect(format).toBe('EPUB');

    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).toContain('Hello from the lowercase chapter entry.');
  });
});
