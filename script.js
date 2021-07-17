onload = () =>
  (document.querySelector('button').onclick = async (e) => {
    let manual = false;
    const uInt8 = new TextEncoder().encode('StreamSaver is awesome');
    streamSaver.mitm = chrome.runtime.getURL('mitm.html');
    // streamSaver.createWriteStream() returns a writable byte stream
    // The WritableStream only accepts Uint8Array chunks
    // (no other typed arrays, arrayBuffers or strings are allowed)
    const fileStream = streamSaver.createWriteStream('filename.txt', {
      size: uInt8.byteLength, // (optional filesize) Will show progress
      writableStrategy: undefined, // (optional)
      readableStrategy: undefined, // (optional)
    });

    if (manual) {
      const writer = fileStream.getWriter();
      writer.write(uInt8);
      writer.close();
    } else {
      // using Response can be a great tool to convert
      // mostly anything (blob, string, buffers) into a byte stream
      // that can be piped to StreamSaver
      //
      // You could also use a transform stream that would sit
      // between and convert everything to Uint8Arrays
      new Response('StreamSaver is awesome').body
        .pipeTo(fileStream)
        .then(console.log)
        .catch(console.error);
    }
  });
