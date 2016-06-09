;((name,definition) => {
	'undefined' != typeof module ? module.exports = definition() :
	'function' == typeof define && 'object' == typeof define.amd ? define(definition) :
	this[name] = definition()
})('streamSaver', () => {
	'use strict'

	const
	SECURE = location.protocol == 'https:' || location.hostname == 'localhost',
	MITM = `https://jimmywarting.github.io/StreamSaver.js/mitm.html`,
	PROXY = MITM + (SECURE ? '' : '?popup=1')

	let iframe, loaded

	function createWriteStream(filename, opts) {

		let
		channel = new MessageChannel,
		setupChannel = () => new Promise((resolve, reject) => {
			channel.port1.onmessage = evt => {
				evt.data.debug &&
				evt.data.debug === 'Mocking a download request' &&
				resolve()
			}

			if(SECURE && !iframe) {
				iframe = document.createElement('iframe')
				iframe.src = PROXY
				iframe.hidden = true
				document.body.appendChild(iframe)
			}

			if(SECURE && !loaded) {
				let fn;
				iframe.addEventListener('load', fn = evt => {
					loaded = true
					iframe.removeEventListener('load', fn)
					iframe.contentWindow.postMessage(filename, '*', [channel.port2])
				})
			}

			if(SECURE && loaded) {
				iframe.contentWindow.postMessage(filename, '*', [channel.port2])
			}

			if(!SECURE) {
				// iframe.contentWindow.postMessage(filename, '*', [channel.port2])
				let
				popup = window.open(PROXY, Math.random()),
				onready = evt => {
					if(evt.source === popup){
						popup.postMessage(filename, '*', [channel.port2])
						removeEventListener('message', onready)
					}
				}

				// Another problem that cross origin don't allow is scripting
				// so popup.onload() don't work but postMessage still dose
				// work cross origin
				addEventListener('message', onready)
			}
		})

		return new WritableStream({
			start(error) {
				// is called immediately, and should perform any actions
				// necessary to acquire access to the underlying sink.
				// If this process is asynchronous, it can return a promise
				// to signal success or failure.
				return setupChannel()
			},
			write(chunk) {
				// is called when a new chunk of data is ready to be written
				// to the underlying sink. It can return a promise to signal
				// success or failure of the write operation. The stream
				// implementation guarantees that this method will be called
				// only after previous writes have succeeded, and never after
				// close or abort is called.
				channel.port1.postMessage(chunk)
			},
			close() {
				channel.port1.postMessage('end')
				console.log('All data successfully read!')
			},
			abort(e) {
				console.error('Something went wrong!', e)
			}
		}, opts)
	}

	function createBlobReader(blob, opts){

		let
		highWaterMark = 524288,
		chunks = Math.ceil(blob.size / highWaterMark),
		currentChunk = 0

		return new ReadableStream({
			type: 'bytes',
			start() {

			},
			pull(controller) {
				if(currentChunk == chunks)
					return controller.close()

				return new Promise((resolve, reject) => {

					let
					fr = new FileReader(),
					start = currentChunk * highWaterMark,
					end = start + highWaterMark >= blob.size
						? blob.size
						: start + highWaterMark

					fr.onload = evt => {
						let uint8array = new Uint8Array(evt.target.result)
						controller.enqueue(uint8array)
						resolve()
					}
					fr.readAsArrayBuffer(blob.slice(start, end))
					currentChunk++
				})
			}
		})
	}

	return { createWriteStream, createBlobReader }

});
