'use strict'

// This should be called once per download
// Each event has a dataChannel that the data will be piped throught
self.onmessage = event => {
    // Create a uniq link for the download
    let uniqLink = 'intercept-me-nr' + Math.random()

    let p = new Promise((resolve, reject) => {
        let stream = createStream(resolve, reject, event.ports[0])
        hijacke(uniqLink, stream, event.data, event.ports[0])
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
    // ReadableStream is only supported by chrome 52, but can be enabled
    // with a flag chrome://flags/#enable-experimental-web-platform-features
    var bytesWritten = 0
    return new ReadableStream({
		start(controller) {
			port.postMessage({debug: 'ReadableStream has been created'})
			// When we recive data on the messageChannel, we write
			port.onmessage = event => {
				// We finaly have a abortable stream =D
				if(event.data === 'end'){
                    resolve()
                    return controller.close()
                }
                controller.enqueue(event.data)
                bytesWritten += event.data.byteLength
                port.postMessage({ bytesWritten })
			}
		},
		cancel() {
			console.log("user aborted")
		}
	})
}



function hijacke(uniqLink, stream, data, port){
	let listener, filename, headers

	if(typeof data === 'string')
		filename = data

	headers = {
		'Content-Type': 'application/octet-stream; charset=utf-8',
		'Content-Disposition': 'attachment; filename=' + (filename || data.filename)
	}

	if(data.size)
		headers['Content-Length'] = data.size

    self.addEventListener('fetch', listener = event => {

        if(!event.request.url.includes(uniqLink))
    		return

        port.postMessage({debug: 'Mocking a download request'})

        self.removeEventListener('fetch', listener)

    	let res = new Response(stream, { headers })

    	event.respondWith(res)
    })

	// Any better way to get the scope of the service worker???
	port.postMessage({download: location.href.replace('sw.js', uniqLink)})
}
