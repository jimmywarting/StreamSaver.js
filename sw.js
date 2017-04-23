'use strict'
const map = new Map

// This should be called once per download
// Each event has a dataChannel that the data will be piped through
self.onmessage = event => {
    // Create a uniq link for the download
    let uniqLink = self.registration.scope + 'intercept-me-nr' + Math.random()
	let port = event.ports[0]

    let p = new Promise((resolve, reject) => {
        let stream = createStream(resolve, reject, port)
		map.set(uniqLink, [stream, event.data])
		port.postMessage({download: uniqLink})

		// Mistage adding this and have streamsaver.js rely on it
		// depricated as from 0.2.1
		port.postMessage({debug: 'Mocking a download request'})
    })

    // Beginning in Chrome 51, event is an ExtendableMessageEvent, which supports
    // the waitUntil() method for extending the lifetime of the event handler
    // until the promise is resolved.
    if ('waitUntil' in event) {
        event.waitUntil(p)
    }

    // Without support for waitUntil(), there's a chance that if the promise chain
    // takes "too long" to execute, the service worker might be automatically
    // stopped before it's complete.
}

function createStream(resolve, reject, port){
    // ReadableStream is only supported by chrome 52
    var bytesWritten = 0
    return new ReadableStream({
		start(controller) {
			// When we receive data on the messageChannel, we write
			port.onmessage = ({data}) => {
				if (data === 'end') {
                    resolve()
                    return controller.close()
                }

				if (data === 'abort') {
					resolve()
					controller.error('Aborted the download')
					return
                }

				controller.enqueue(data)
                bytesWritten += data.byteLength
                port.postMessage({ bytesWritten })
			}
		},
		cancel() {
			console.log("user aborted")
		}
	})
}


self.onfetch = event => {
	let url = event.request.url
	let hijacke = map.get(url)
	let listener, filename, headers

	console.log("Handleing ", url)

	if(!hijacke) return null

	let [stream, data] = hijacke

	map.delete(url)

	filename = typeof data === 'string' ? data : data.filename

	// Make filename RFC5987 compatible
	filename = encodeURIComponent(filename)
		.replace(/['()]/g, escape)
		.replace(/\*/g, '%2A')

	headers = {
		'Content-Type': 'application/octet-stream; charset=utf-8',
		'Content-Disposition': "attachment; filename*=UTF-8''" + filename
	}

	if(data.size) headers['Content-Length'] = data.size

	event.respondWith(new Response(stream, { headers }))
}
