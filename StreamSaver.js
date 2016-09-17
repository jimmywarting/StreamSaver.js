;((name, definition, global) => {
	typeof module != 'undefined' ? module.exports = definition() :
	typeof define == 'function' && 'object' == typeof define.amd
	? define(definition) : global[name] = definition()
})('streamSaver', () => {
	'use strict'

	let
	channel,
	streamSaver = {
		createWriteStream,
		setupChannel,
		supported: false,
		version: {
			full: '1.0.0',
			major: 1, minor: 0, dot: 0
		}
	}

	streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/'
		+ streamSaver.version.full + '/mitm.html'

	try {
		// Some browser has it but ain't allowed to construct a stream yet
		streamSaver.supported = !!new ReadableStream()
	} catch(err){}

	function setupChannel() {
		if(channel) return

		let iframe, popup,
			secure = location.protocol == 'https:' || location.hostname == 'localhost',
			msg = {action: 'StreamSaver::Establish Connection'}

		channel = new MessageChannel

		// channel have been establish
		channel.port1.onmessage = evt => secure
			? iframe.remove()
			: popup.close()

		if(secure) {
			iframe = document.createElement('iframe')
			iframe.src = streamSaver.mitm
			iframe.hidden = true
			iframe.onload = event => {
				iframe.contentWindow.postMessage(msg, '*', [channel.port2])
			}
			document.body.appendChild(iframe)
		} else {
			let popup = window.open(streamSaver.mitm, Math.random())

			// Another problem that cross origin don't allow is scripting
			// so popup.onload() don't work but postMessage still dose
			// work cross origin
			addEventListener('message', function onmessage(event) {
				if (evt.source === popup) {
					popup.postMessage(msg, '*', [channel.port2])
					removeEventListener('message', onmessage)
				}
			})
		}
	}

	function createWriteStream(filename, opts = {}) {
		let streamChannel = new MessageChannel
		let unload
		let writes = []
		let {
			size,
			// queuing = new ByteLengthQueuingStrategy({ highWaterMark: 32 * 1024 }),
			queuing = new CountQueuingStrategy({ highWaterMark: 10 }),
			href = 'dl/' + filename
		} = opts


		return new WritableStream({
			// is called immediately, and should perform any actions
			// necessary to acquire access to the underlying sink.
			// If this process is asynchronous, it can return a promise
			// to signal success or failure.
			start(controller) {

				// Can't continue the download if the page is closed
				// So we send a message to
				window.addEventListener('unload', unload = () =>
					streamChannel.port1.postMessage('abort')
				)

				setupChannel()

				channel.port1.postMessage(
					{href, size, filename, action: 'Add link'},
				 	[streamChannel.port2]
				)

				streamChannel.port1.onmessage = event => {
					// first event is going to be a empty pull, meaning that
					// it's ready to read, So it's time to open up the link
					let a = document.createElement('a')
					let click = new MouseEvent('click')
					a.href = href
					a.dispatchEvent(click)

					streamChannel.port1.onmessage = ({data}) => {
						// Only time we get a message from SW is
						// - on pull (message includes bytesWritten as Intenger)
						// - on error (message is a string, user abort the download)
						if(typeof data == 'string')
							controller.error(new Error(data))
						else {
							// bytesWritten = data
							writes.shift()()
						}
						// console.log(controller._queue)
						// console.log(controller._strategyHWM)
					}
				}
			},
			write(chunk) {
				// is called when a new chunk of data is ready to be written
				// to the underlying sink. It can return a promise to signal
				// success or failure of the write operation. The stream
				// implementation guarantees that this method will be called
				// only after previous writes have succeeded, and never after
				// close or abort is called.

				// TODO: Kind of important that service worker respond back when
				// it has been written. Otherwice we can't handle backpressure
				return new Promise(resolve => {
					writes.push(resolve)
					streamChannel.port1.postMessage(chunk)
				})
			},
			close() {
				streamChannel.port1.postMessage('end')
				window.removeEventListener('unload', unload)
			},
			abort(e) {
				streamChannel.port1.postMessage('abort')
			}
		}, queuing)
	}

	return streamSaver
}, this)
