/* global self ReadableStream Response */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

const map = new Map()

// This should be called once per download
// Each event has a dataChannel that the data will be piped through
self.onmessage = event => {
  // We send a heartbeat every x secound to keep the
  // service worker alive
  if (event.data === 'ping') {
    return
  }

  // Create a uniq link for the download
  const uniqLink = self.registration.scope + 'intercept-me-nr' + Math.random()
  const port = event.ports[0]

  const stream = event.data.readableStream || createStream(port)
  stream.port = port
  map.set(uniqLink, [stream, event.data])
  port.postMessage({ download: uniqLink, ping: self.registration.scope + 'ping' })
}

function createStream (port) {
  // ReadableStream is only supported by chrome 52
  return new ReadableStream({
    start (controller) {
      // When we receive data on the messageChannel, we write
      port.onmessage = ({ data }) => {
        if (data === 'end') {
          return controller.close()
        }

        if (data === 'abort') {
          controller.error('Aborted the download')
          return
        }

        controller.enqueue(data)
      }
    },
    cancel () {
      console.log('user aborted')
    }
  })
}

self.onfetch = event => {
  const url = event.request.url

  if (url.endsWith('/ping')) {
    return event.respondWith(new Response('pong', {
      headers: { 'Access-Control-Allow-Origin': '*' }
    }))
  }

  const hijacke = map.get(url)

  if (!hijacke) return null

  const [stream, data] = hijacke

  map.delete(url)

  // Make filename RFC5987 compatible
  const filename = encodeURIComponent(typeof data === 'string' ? data : data.filename)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')

  const headers = {
    'Content-Type': 'application/octet-stream; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + filename
  }

  if (data.size) headers['Content-Length'] = data.size

  event.respondWith(new Response(stream, { headers }))

  stream.port.postMessage({ debug: 'Download started' })
}
