StreamSaver.js (legacy-ish) - with ZIP64 support
===========================

... Don't worry it's not deprecated. It's still maintained and i still recommend 
using this when needed. Just want to let you know that there is this new native way
to save files to the HD: https://wicg.github.io/native-file-system which is more
or less going to make FileSaver, StreamSaver and similar packages a bit obsolete
in the future, it'still in a experimental stage and not implemented by all browser.
That is why I also built [native-file-system-adapter](https://github.com/jimmywarting/native-file-system-adapter)
so you can have it in all Browsers, Deno, and NodeJS with different storages

[![npm version][npm-image]][npm-url]

First I want to thank [Eli Grey][1] for a fantastic work implementing the
[FileSaver.js][2] to save files & blobs so easily!
But there is one obstacle - The RAM it can hold and the max blob size limitation

StreamSaver.js takes a different approach. Instead of saving data in client-side
storage or in memory you could now actually create a writable stream directly to
the file system (I'm not talking about chromes sandboxed file system or any other
web storage). This is accomplish by emulating how a server would instruct the
browser to save a file using some response header + service worker

StreamSaver.js is the solution to saving streams on the client-side.
It is perfect for webapps that need to save really large amounts of data created
on the client-side, where the RAM is really limited, like on mobile devices.

**If the file you are trying to save comes from the cloud/server** use the server instead
of emulating what the browser does to save files on the disk using StreamSaver.
Add those extra Response headers and **don't use AJAX** to get it. FileSaver has
a good [wiki](https://github.com/eligrey/FileSaver.js/wiki/Saving-a-remote-file)
about using headers. If you can't change the headers then you may use StreamSaver
as a last resort. FileSaver, streamsaver and others alike are mostly for client
generated content inside the browser.

Getting started
===============
StreamSaver in it's simplest form
```html
<script src="https://cdn.jsdelivr.net/npm/web-streams-polyfill@2.0.2/dist/ponyfill.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/streamsaver@2.0.3/StreamSaver.min.js"></script>
<script>
  import streamSaver from 'streamsaver'
  const streamSaver = require('streamsaver')
  const streamSaver = window.streamSaver
</script>
<script>
  const uInt8 = new TextEncoder().encode('StreamSaver is awesome')

  // streamSaver.createWriteStream() returns a writable byte stream
  // The WritableStream only accepts Uint8Array chunks
  // (no other typed arrays, arrayBuffers or strings are allowed)
  const fileStream = streamSaver.createWriteStream('filename.txt', {
    size: uInt8.byteLength, // (optional filesize) Will show progress
    writableStrategy: undefined, // (optional)
    readableStrategy: undefined  // (optional)
  })

  if (manual) {
    const writer = fileStream.getWriter()
    writer.write(uInt8)
    writer.close()
  } else {
    // using Response can be a great tool to convert
    // mostly anything (blob, string, buffers) into a byte stream
    // that can be piped to StreamSaver
    //
    // You could also use a transform stream that would sit
    // between and convert everything to Uint8Arrays
    new Response('StreamSaver is awesome').body
      .pipeTo(fileStream)
      .then(success, error)
  }
</script>
```

Some browser have ReadableStream but not WritableStream. [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill) can fix this gap. It's better to load the ponyfill instead of the polyfill and override the existing implementation because StreamSaver works better when a native ReadableStream is transferable to the service worker. hopefully [MattiasBuelens](https://github.com/MattiasBuelens) will fix the missing implementations instead of overriding the existing. If you think you can help out here is the [issue](https://github.com/MattiasBuelens/web-streams-polyfill/issues/20)

## Best practice

**Use https** if you can. That way you don't have to open the man in the middle
in a popup to install the service worker from another secure context. Popups are often blocked
but if you can't it's best that you **initiate the `createWriteStream`
on user interaction**. Even if you don't have any data ready - this is so that you can get around the popup blockers. (In secure context this don't matter)
Another benefit of using https is that the mitm-iframe can ping the service worker to prevent it from going idle. (worker goes idle after 30 sec in firefox, 5 minutes in blink) but also this won't mater if the browser supports [transferable streams](https://github.com/whatwg/streams/blob/master/transferable-streams-explainer.md) throught postMessage since service worker don't have to handle any logic. (the stream that you transfer to the service worker will be the stream we respond with)

**Handle unload event** when user leaves the page. The download gets broken when you leave the page.
Because it looks like a regular native download process some might think that it's okey to leave the page beforehand since it's is downloading in the background directly from some a server, but it isn't.

```js
// abort so it dose not look stuck
window.onunload = () => {
  writableStream.abort()
  // also possible to call abort on the writer you got from `getWriter()`
  writer.abort()
}

window.onbeforeunload = evt => {
  if (!done) {
    evt.returnValue = `Are you sure you want to leave?`;
  }
}
```
Note that when using insecure context StreamSaver will navigate to the download url instead of using an hidden iframe to initiate the download, this will trigger the `onbefureunload` event when the download starts, but it will not call the `onunload` event... In secure context you can add this handler immediately. Otherwise this has to be added sometime later.

# Configuration

There a some few settings you can apply to StreamSaver to configure what it should use

```js
// StreamSaver can detect and use the Ponyfill that is loaded from the cdn.
streamSaver.WritableStream = streamSaver.WritableStream
streamSaver.TransformStream = streamSaver.TransformStream
// if you decide to host mitm + sw yourself
streamSaver.mitm = 'https://example.com/custom_mitm.html'
```

Examples
========

There are a few examples in the [examples] directory

- [Saving audio or video stream using mediaRecorder](https://jimmywarting.github.io/StreamSaver.js/examples/media-stream.html)
- [Piping a fetch response to StreamSaver](https://jimmywarting.github.io/StreamSaver.js/examples/fetch.html)
- [Write as you type](https://jimmywarting.github.io/StreamSaver.js/examples/plain-text.html)
- [Saving a blob/file](https://jimmywarting.github.io/StreamSaver.js/examples/saving-a-blob.html)
- [Saving a file using webtorrent](https://jimmywarting.github.io/StreamSaver.js/examples/torrent.html)
- [Saving multiple files as a zip](https://jimmywarting.github.io/StreamSaver.js/examples/saving-multiple-files.html)
- [slowly write 1 byte / sec](https://jimmywarting.github.io/StreamSaver.js/examples/write-slowly.html)

In the wild
- [Adding ID3 tag to mp3 file on the fly](https://egoroof.ru/browser-id3-writer/stream) - by [Artyom Egorov](https://github.com/egoroof)


How does it work?
=====================
There is no magical `saveAs()` function that saves a stream, file or blob. (at least not if/when native-filesystem api becomes avalible)
The way we mostly save Blobs/Files today is with the help of [Object URLs](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL) and  [`a[download]`][5] attribute
[FileSaver.js][2] takes advantage of this and create a convenient `saveAs(blob, filename)`. fantastic! But you can't create a objectUrl from a stream and attach
it to a link...
```javascript
link = document.createElement('a')
link.href = URL.createObjectURL(stream) // DOES NOT WORK
link.download = 'filename'
link.click() // Save
```
So the one and only other solution is to do what the server does: Send a stream
with `Content-Disposition` header to tell the browser to save the file.
But we don't have a server or the content isn't on a server! So the solution is to create a service worker
that can intercept request and use [respondWith()][4] and act as a server.<br>
But a service workers are only allowed in secure contexts and it requires some effort to put up. Most of the time you are working in the main thread and the service worker are only alive for < 5 minutes before it goes idle.<br>

 1. So StreamSaver creates a own man in the middle that installs the service worker in a secure context hosted on github static pages. either from a iframe (in secure context) or a new popup if your page is insecure.
 2. Transfer the stream (or DataChannel) over to the service worker using postMessage.
 3. And then the worker creates a download link that we then open.

if a "transferable" readable stream was not passed to the service worker then the mitm will also try to keep the service worker alive by pinging it every x second to prevent it from going idle.

To test this locally, spin up a local server<br>
(we don't use any pre compiler or such)
```bash
# A simple php or python server is enough
php -S localhost:3001
python -m SimpleHTTPServer 3001
# then open localhost:3001/example.html
```


[1]: https://github.com/eligrey
[2]: https://github.com/eligrey/FileSaver.js
[3]: https://github.com/jimmywarting/StreamSaver.js/blob/master/example.html
[4]: https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
[5]: https://developer.mozilla.org/en/docs/Web/HTML/Element/a#attr-download
[6]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
[7]: https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel
[8]: https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage
[9]: https://developer.mozilla.org/en/docs/Web/API/Fetch_API
[10]: https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
[11]: https://developer.mozilla.org/en/docs/Web/HTML/Element/iframe
[12]: https://developer.mozilla.org/en-US/docs/Web/API/Window/open
[13]: https://developer.mozilla.org/en-US/docs/Web/API/Response
[14]: https://streams.spec.whatwg.org/#rs-class
[ReadableStream]: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
[WritableStream]: https://developer.mozilla.org/en-US/docs/Web/API/WritableStream
[15]: https://www.npmjs.com/package/@mattiasbuelens/web-streams-polyfill
[16]: https://developer.microsoft.com/en-us/microsoft-edge/platform/status/fetchapi
[19]: https://webtorrent.io
[examples]: https://github.com/jimmywarting/StreamSaver.js/blob/master/examples
[npm-image]: https://img.shields.io/npm/v/streamsaver.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/streamsaver
