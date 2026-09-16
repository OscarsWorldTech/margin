import {BlobWriter,TextReader,ZipWriter} from '@zip.js/zip.js';

// Synthetic public test content only. No copyrighted ebook or personal audio.
export async function storytellerFixture(changes={}){
  const files={
    'mimetype':'application/epub+zip',
    'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
    'EPUB/package.opf':`<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A synthetic readaloud</dc:title></metadata><manifest><item id="ch1" href="text/ch1.xhtml" media-overlay="mo1"/><item id="ch2" href="text/ch2.xhtml" media-overlay="mo2"/><item id="mo1" href="overlays/one.smil"/><item id="mo2" href="overlays/two.smil"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`,
    'EPUB/text/ch1.xhtml':'<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p><span id="s1">A <em>sentence</em> &amp; a thought.</span> <span id="s2">Keep the next idea.</span></p></body></html>',
    'EPUB/text/ch2.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="s3">Another chapter begins.</p></body></html>',
    'EPUB/overlays/one.smil':'<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="../text/ch1.xhtml#s1"/><audio src="../audio/one.mp3" clipBegin="0s" clipEnd="2.5s"/></par><par><text src="../text/ch1.xhtml#s2"/><audio src="../audio/one.mp3" clipBegin="00:00:03" clipEnd="00:00:05"/></par></seq></body></smil>',
    'EPUB/overlays/two.smil':'<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="../text/ch2.xhtml#s3"/><audio src="../audio/two.mp3" clipBegin="1s" clipEnd="4s"/></par></seq></body></smil>',
    'EPUB/audio/one.mp3':'Not decoded by importer',
    'EPUB/audio/two.mp3':'Not decoded by importer',
    ...changes,
  };
  const writer=new ZipWriter(new BlobWriter('application/epub+zip'),{useWebWorkers:false});
  for(const [name,text] of Object.entries(files))if(text!==null)await writer.add(name,new TextReader(text));
  return writer.close();
}
