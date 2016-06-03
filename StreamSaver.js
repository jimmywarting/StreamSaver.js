/*
something like this???

module.exports {
	createWriteStream
}

import fs from StreamSaver
fs.createWriteStream()
*/

window.saveStream = (stream, filename) => {

	let
	mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html',
	chunks = Promise.resolve(),
	usePopup = location.protocol != 'https:' && location.hostname != 'localhost',
	tab,
	fr = new FileReader,
	channel = new MessageChannel,
	pump,
	popup

	if(stream instanceof ReadableStream || stream instanceof ReadableByteStream ) {
		let reader = stream.getReader()

		pump = () => {
			return reader.read().then(({ value, done }) => {
				if (done) {
					channel.port1.postMessage('end')
					return
				}
				channel.port1.postMessage(value)
				return pump();
			})
		}

	} else if(stream) {
		let mediaRecorder = new MediaRecorder(stream)
		stream.addEventListener('ended', evt =>
			channel.port1.postMessage('end')
		)
		mediaRecorder.start()
		mediaRecorder.ondataavailable = evt => {
			let
			blob = evt.data

			chunks = chunks.then(() => new Promise(resolve => {
				fr.onload = () => {
					// Should we let the serviceWorker be able to accept
					// anything other then uint8array? ReadableStream don't seems
					// so happy with anything else... but could load of some work
					// of the main thread +1
					let uint8array = new Uint8Array(fr.result)
					channel.port1.postMessage(uint8array)
					resolve()
				}
				fr.readAsArrayBuffer(blob)
			}))
		}
	}

	// Http sites can still take advantage of what serviceWorker
	// can do but there is only one problem register a worker only
	// works if top window is is using https so we need a popup :(
	if(usePopup){
		// We will try our best to hide the popup...
		let
		url = mitm + '?popup=1'
		h = 1,
		w = 1,
		left = screen.width/2 - w/2,
		top = screen.height/2 - h/2,
		// pref = `toolbar=no, location=no, directories=no, status=no, menubar=no,`+
		//        `scrollbars=no, resizable=no, copyhistory=no, width=1, height=1,`+
		// 	   `top=${top}, left=${left}`
		popup = window.open(url, Math.random()/*, pref*/),
		onready = evt => {
			if(evt.source === popup){
				popup.postMessage(filename, '*', [channel.port2])
				removeEventListener('message', onready)
			}
		}

		channel.port1.onmessage = evt => {
			if(pump && evt.data.debug && evt.data.debug === "Mocking a download request")
				pump()

			// Don't need the mitm any longer
			// dataChannel has been sent to the serviceWorker
			// and the download has begun :)
			// Good for you damm http only websites :P
			if(evt.data.bytesWritten && evt.data.bytesWritten > 1024)
				popup.close()
		}

		// Another problem that cross origin don't allow is scripting
		// so popup.onload() don't work but postMessage still dose
		// work cross origin
		addEventListener('message', onready)
	} else {
		let iframe = document.createElement('iframe')

		iframe.src = mitm
		iframe.hidden = true
		iframe.onload = () => {
			iframe.contentWindow.postMessage(filename, '*', [channel.port2])
			channel.port1.onmessage = evt =>
				pump &&
				evt.data.debug &&
				evt.data.debug === "Mocking a download request"
				&& pump()
		}
		document.body.appendChild(iframe)
	}
}
