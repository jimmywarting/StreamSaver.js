/* global location WritableStream ReadableStream define MouseEvent MessageChannel TransformStream */
;((name, definition) => {
  typeof module !== 'undefined'
    ? module.exports = definition()
    : typeof define === 'function' && typeof define.amd === 'object'
      ? define(definition)
      : this[name] = definition()
})('streamSaver', () => {
  'use strict'

  const secure = location.protocol === 'https:' ||
                 location.protocol === 'chrome-extension:' ||
                 location.hostname === 'localhost'
  let iframe
  let loaded
  let transfarableSupport = false
  let streamSaver = {
    createWriteStream,
    supported: false,
    version: {
      full: '1.1.0',
      major: 1,
      minor: 1,
      dot: 0
    }
  }

  streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=' +
    streamSaver.version.full

  try {
    // Some browser has it but ain't allowed to construct a stream yet
    streamSaver.supported = 'serviceWorker' in navigator && !!new ReadableStream() && !!new WritableStream()
  } catch (err) {}

  try {
    const { readable } = new TransformStream()
    const mc = new MessageChannel()
    mc.port1.postMessage(readable, [readable])
    mc.port1.close()
    mc.port2.close()
    transfarableSupport = readable.locked === true
  } catch (err) {
    // Was first enabled in chrome v73
  }

  function createWriteStream (filename, queuingStrategy, size) {
    // normalize arguments
    if (Number.isFinite(queuingStrategy)) {
      [size, queuingStrategy] = [queuingStrategy, size]
    }

    let channel = new MessageChannel()
    let popup
    let setupChannel = readableStream => new Promise(resolve => {
      const args = [ { filename, size }, '*', [ channel.port2 ] ]

      // Pass along transfarable stream
      if (readableStream) {
        args[0].readableStream = readableStream
        args[2].push(readableStream)
      }

      channel.port1.onmessage = evt => {
        // Service worker sent us a link from where
        // we recive the readable link (stream)
        if (evt.data.download) {
          resolve() // Signal that the writestream are ready to recive data
          if (!secure) popup.close() // don't need the popup any longer
          if (window.chrome && chrome.extension &&
              chrome.extension.getBackgroundPage &&
              chrome.extension.getBackgroundPage() === window) {
            chrome.tabs.create({ url: evt.data.download, active: false })
          } else {
            window.location = evt.data.download
          }

          // Cleanup
          if (readableStream) {
            // We don't need postMessages now when stream are transferable
            channel.port1.close()
            channel.port2.close()
          }

          channel.port1.onmessage = null
        }
      }

      if (secure && !iframe) {
        iframe = document.createElement('iframe')
        iframe.src = streamSaver.mitm
        iframe.hidden = true
        document.body.appendChild(iframe)
      }

      if (secure && !loaded) {
        let fn
        iframe.addEventListener('load', fn = () => {
          loaded = true
          iframe.removeEventListener('load', fn)
          iframe.contentWindow.postMessage(...args)
        })
      }

      if (secure && loaded) {
        iframe.contentWindow.postMessage(...args)
      }

      if (!secure) {
        popup = window.open(streamSaver.mitm, Math.random())
        let onready = evt => {
          if (evt.source === popup) {
            popup.postMessage(...args)
            window.removeEventListener('message', onready)
          }
        }

        // Another problem that cross origin don't allow is scripting
        // so popup.onload() don't work but postMessage still dose
        // work cross origin
        window.addEventListener('message', onready)
      }
    })

    if (transfarableSupport) {
      const ts = new TransformStream({
        start () {
          return new Promise(resolve =>
            setTimeout(() => setupChannel(ts.readable).then(resolve))
          )
        }
      }, queuingStrategy)

      return ts.writable
    }

    return new WritableStream({
      start () {
        // is called immediately, and should perform any actions
        // necessary to acquire access to the underlying sink.
        // If this process is asynchronous, it can return a promise
        // to signal success or failure.
        return setupChannel()
      },
      write (chunk) {
        // is called when a new chunk of data is ready to be written
        // to the underlying sink. It can return a promise to signal
        // success or failure of the write operation. The stream
        // implementation guarantees that this method will be called
        // only after previous writes have succeeded, and never after
        // close or abort is called.

        // TODO: Kind of important that service worker respond back when
        // it has been written. Otherwise we can't handle backpressure
        // EDIT: Transfarable streams solvs this...
        channel.port1.postMessage(chunk)
      },
      close () {
        channel.port1.postMessage('end')
      },
      abort () {
        channel.port1.postMessage('abort')
      }
    }, queuingStrategy)
  }

  return streamSaver
})
