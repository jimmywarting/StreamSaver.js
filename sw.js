/* global self ReadableStream Response CountQueuingStrategy */

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
  // We send a heartbeat every x second to keep the
  // service worker alive if a transferable stream is not sent
  if (event.data === 'ping') {
    return
  }

  const data = event.data
  const downloadUrl = data.url || self.registration.scope + Math.random() + '/' + (typeof data === 'string' ? data : data.filename)
  const port = event.ports[0]
  const metadata = new Array(3) // [stream, data, port]
  const backpressure = data.backpressure === true

  metadata[1] = data
  metadata[2] = port

  // Note to self:
  // old streamsaver v1.2.0 might still use `readableStream`...
  // but v2.0.0 will always transfer the stream through MessageChannel #94
  if (event.data.readableStream) {
    metadata[0] = event.data.readableStream
  } else if (event.data.transferringReadable) {
    port.onmessage = evt => {
      port.onmessage = null
      metadata[0] = evt.data.readableStream
    }
  } else {
    metadata[0] = createStream(port, backpressure)
  }

  map.set(downloadUrl, metadata)
  port.postMessage({ download: downloadUrl, backpressure })
}

// How many chunks the page may have in flight before the browser has read them
const BACKPRESSURE_HIGH_WATER_MARK = 4

function createStream (port, backpressure) {
  let controller
  let outstanding = 0 // credits granted to the page but not consumed yet
  let resolvePull = null

  // ReadableStream is only supported by chrome 52
  return new ReadableStream({
    start (c) {
      controller = c
      // When we receive data on the messageChannel, we write
      port.onmessage = ({ data }) => {
        if (data === 'end') {
          if (resolvePull) resolvePull()
          return controller.close()
        }

        if (data === 'abort') {
          controller.error('Aborted the download')
          return
        }

        controller.enqueue(data)
        if (backpressure) {
          outstanding--
          if (resolvePull) {
            resolvePull()
            resolvePull = null
          }
        }
      }
    },
    pull () {
      if (!backpressure) return
      // Hand out credits up to desiredSize, then wait for the next chunk so the
      // stream calls pull() again while it still has room.
      const n = controller.desiredSize - outstanding
      if (n > 0) {
        outstanding += n
        port.postMessage({ pull: n })
      }
      return new Promise(resolve => { resolvePull = resolve })
    },
    cancel (reason) {
      console.log('user aborted', reason)
      port.postMessage({ abort: true })
    }
  }, backpressure ? new CountQueuingStrategy({ highWaterMark: BACKPRESSURE_HIGH_WATER_MARK }) : undefined)
}

self.onfetch = event => {
  const url = event.request.url

  // this only works for Firefox
  if (url.endsWith('/ping')) {
    return event.respondWith(new Response('pong'))
  }

  const hijacke = map.get(url)

  if (!hijacke) return null

  const [ stream, data, port ] = hijacke

  map.delete(url)

  // Not comfortable letting any user control all headers
  // so we only copy over the length & disposition
  const responseHeaders = new Headers({
    'Content-Type': 'application/octet-stream; charset=utf-8',

    // To be on the safe side, The link can be opened in a iframe.
    // but octet-stream should stop it.
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  })

  let headers = new Headers(data.headers || {})

  if (headers.has('Content-Length')) {
    responseHeaders.set('Content-Length', headers.get('Content-Length'))
  }

  if (headers.has('Content-Disposition')) {
    responseHeaders.set('Content-Disposition', headers.get('Content-Disposition'))
  }

  // data, data.filename and size should not be used anymore
  if (data.size) {
    console.warn('Depricated')
    responseHeaders.set('Content-Length', data.size)
  }

  let fileName = typeof data === 'string' ? data : data.filename
  if (fileName) {
    console.warn('Depricated')
    // Make filename RFC5987 compatible
    fileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A')
    responseHeaders.set('Content-Disposition', "attachment; filename*=UTF-8''" + fileName)
  }

  event.respondWith(new Response(stream, { headers: responseHeaders }))

  port.postMessage({ debug: 'Download started' })
}
