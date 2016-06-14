StreamSaver.js
==============

First I want to thank [Eli Grey][1] for a fantastic work implementing the
[FileSaver.js][2] to save files & blob's so easily!
But there is one obstacle - The RAM it can hold and the max blob size limitation

StreamSaver.js takes a different approach. Instead of saving data in client-side
storage or in memory you could now actually create a writable stream directly to
the file system (I'm not talking about chromes sandboxed file system)

StreamSaver.js is the solution to saving streams on the client-side.
It is perfect for webapps that need to save really large amount of data created
on the client-side where the RAM is really low like on mobile devices


Getting started
===============
**It's important to test browser support before you include the [web stream polyfill][15]**<br>
cuz the serverWroker need to respondWith a native version of the ReadableStream
```html
<script src="StreamSaver.js"></script> <!-- load before streams polyfill to detect support -->
<script src="https://wzrd.in/standalone/web-streams-polyfill@latest"></script>
<script>
	// it also support commonJs and amd
	import { createWriteStream, supported, version } from 'StreamSaver'
	const { createWriteStream, supported, version } = require('StreamSaver')
	const { createWriteStream, supported, version } = window.streamSaver
	alert( supported )
</script>
```

Syntax
======

```javascript
// If you know what the size is going to be then you can specify
// that as 2nd arguments and it will use that as Content-Length header
const writeStream = streamSaver.createWriteStream('filename.txt', size)
```

### Writing some plain text

```javascript
const writeStream = streamSaver.createWriteStream('filename.txt')
const encoder = new TextEncoder
let data = 'a'.repeat(1024)
let uint8array = encoder.encode(data + "\n\n")

writeStream.write(uint8array)
writeStream.close()
```

### Read blob as a stream and pipe it

```javascript
const writeStream = streamSaver.createWriteStream('filename.txt')
const blob = new Blob([ 'a'.repeat(1E9*5) ]) // 1*5 MB
const blobStream = streamSaver.createBlobReader(blob)

blobStream.pipeTo(writeStream)
```

### Save a media stream


```javascript
get_user_media_stream_somehow().then(mediaStream => {
	let fr = new FileReader
	let mediaRecorder = new MediaRecorder(mediaStream)
	let chunks = Promise.resolve()
	let writeStream = streamSaver.createWriteStream('filename.mp4')
	// use .mp4 for video(camera & screen) and .wav for audio(microphone)

	// Start recording
	mediaRecorder.start()

	closeBtn.onclick = event => {
		mediaRecorder.stop()
		setTimeout(() =>
			chunks.then(evt => writeStream.close())
		, 1000)
	}

	mediaRecorder.ondataavailable = evt => {
		let blob = evt.data

		chunks = chunks.then(() => new Promise(resolve => {
			fr.onload = () => {
				writeStream.write(new Uint8Array(fr.result))
				resolve()
			}
			fr.readAsArrayBuffer(blob)
		}))
	}

})
```

### Get a "stream" from ajax
res.body is a readableByteStream, but don't have pipeTo yet<br>
So we have to use the reader instead which is the underlying method in streams

```javascript
fetch(url).then(res => {
	const writeStream = streamSaver.createWriteStream('filename.txt')
	// Later you will be able to just simply do
	// res.body.pipeTo(writeStream)

	const reader = res.body.getReader()
	const pump = () => reader.read()
		.then(({ value, done }) => done
			// close the stream so we stop writing
			? writeStream.close()
			// Write one chunk, then get the next one
			: writeStream.write(value).then(pump)
		)

	// Start the reader
	pump().then(() =>
		console.log('Closed the stream, Done writing')
	)
})
```

### Get a node-stream from [webtorrent][19]
**Note** it still keeps the data in memory, A more correct way to do this would be
to use some kind of [Custom chunk store](https://webtorrent.io/docs#-client-add-torrentid-opts-function-ontorrent-torrent-) (must follow [abstract-chunk-store](https://www.npmjs.com/package/abstract-chunk-store) API)

```javascript
const client = new WebTorrent()
const torrentId = 'magnet:?xt=urn:btih:6a9759bffd5c0af65319979fb7832189f4f3c35d&dn=sintel.mp4&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.webtorrent.io&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel-1024-surround.mp4'
// Sintel, a free, Creative Commons movie

client.add(torrentId, torrent => {
	// Download the first file

	const file = torrent.files[0]
	const writeStream = streamSaver.createWriteStream(file.name, file.size)

	// Unfortunately we have two different stream protocol so we can't pipe.
	file.createReadStream()
		.on('data', data => writeStream.write(data))
		.on('end', () => writeStream.close())
})
```

How is this possible?
=====================
There is not any magical saveAs() function that saves a stream, file or blob
The way we mostly save Blobs/Files today is with the help of [a[download]][5] attribute
[FileSaver.js][2] takes advantage of this and create a convenient saveAs(blob, filename)
function, very fantastic, but you can't create a objectUrl from a stream and attach
it to a link...
```javascript
link = document.createElement('a')
link.href = URL.createObjectURL(stream) // DOSE NOT WORK
link.download = 'filename'
link.click() // Save
```
So the one and only other solution is to do what the server dose: Send a stream
with Content-Disposition header to tell the browser to save the file.
But we don't have a server! So the only solution is to create a service worker
that can intercept links and use [respondWith()][4]
This will scream high restriction just by mentioning service worker. It's such a
powerful tool that it need to run on https but there is a workaround for http
sites: popups + 3th party https site. Who would have guess that?
But i won't go into details on how that works. (The idea is to use a middle man
to send a dataChannel from http to a serviceWorker that runs on https)

So it all boils down to using
[serviceWorker][6], [MessageChannel][7], [postMessage][8], [fetch][9],
[respondWith][10], [iframes][11], [popups][12] (for http -> https -> serviceWorker),
[Response][13] and last but not least: a flag that enables you to construct [ReadableStream][14]
`chrome://flags/#enable-experimental-web-platform-features`
and also WritableStream for convenience and backpressure


Test localy
```bash
# A simple php or python server is enough
php -S localhost:3001
python -m SimpleHTTPServer 3001
# then open localhost:3001
```

Consensus
=========
Go ahead and vote for how important this feature is

- [Fetch][16] MS Edge status: Preview
- [serviceWorker][17] MS Edge status: In Development
- [streams][18] Firefox Status: ASSIGNED

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
[15]: https://www.npmjs.com/package/web-streams-polyfill
[16]: https://developer.microsoft.com/en-us/microsoft-edge/platform/status/fetchapi
[17]: https://developer.microsoft.com/en-us/microsoft-edge/platform/status/serviceworker
[18]: https://bugzilla.mozilla.org/show_bug.cgi?id=1128959
[19]: https://webtorrent.io
