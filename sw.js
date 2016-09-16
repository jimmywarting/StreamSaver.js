;(()=>{
	'use strict'

	const map = new Map

	const scope = self.registration.scope

	const interceptLinks = event => {
		const {url} = event.request
		const hijacke = map.get(url)
		let listener, filename, headers, data

		if(!hijacke) {
			let fallback = new URL(url).searchParams.get('fallback')
			if (fallback)
				return event.respondWith(new Response('', {
					status: 307,
					headers: {
						Location: fallback
					}
				}))

			return null
		}

		data = hijacke

		// Url is a onetime download
		map.delete(url)

		// Make filename RFC5987 compatible
		filename = encodeURIComponent(data.filename)
			.replace(/['()]/g, escape)
			.replace(/\*/g, '%2A')

		headers = {
			'Content-Type': 'application/octet-stream; charset=utf-8',
			'Content-Disposition': "attachment; filename*=UTF-8''" + filename
		}

		if(data.size) headers['Content-Length'] = data.size

		// This would be the ideal thing!
		// event.respondWith(event.request.stream(), { headers })

		event.respondWith(new Response(data.stream, { headers }))
	}

	const onMessage = event => {
		if (event.data.action == 'Add link') {
			event.data.stream = createStream(event.ports[0])
			map.set(scope + event.data.href, event.data)
		}
	}

	const establishConnection = event => {
		var wanted = 'StreamSaver::Establish Connection'

		if (event.data && event.data.action !== wanted) return

		const channel = event.ports[0]
		channel.onmessage = onMessage
		channel.postMessage('StreamSaver::Connection Establish')
	}

	// ReadableStream is only supported by chrome 52 atm
	const createStream = port => {
		let pulls = []
		let bytesWritten = 0

		return new ReadableStream({
			start(controller) {
				// When we recive data on the messageChannel, we write
				port.onmessage = ({data}) => {
					if (data === 'close') {
						resolve()
						return controller.close()
					}

					if (data === 'abort') {
						controller.error('Aborted the download')
						return
					}

					let resolve = pulls.shift()
					resolve()
					controller.enqueue(data)
					bytesWritten += data.byteLength
				}
			},
			pull(controller) {
				return new Promise(resolve => {
					pulls.push(resolve)
					port.postMessage(bytesWritten)
				})
			},
			cancel(reason) {
				console.warn(reason)
				port.postMessage('abort')
			}
		}, new CountQueuingStrategy({ highWaterMark: 10 }))
	}

	self.addEventListener('fetch', interceptLinks)
	self.addEventListener('message', establishConnection)
})()
