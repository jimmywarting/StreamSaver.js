/* global chrome location ReadableStream define MessageChannel TransformStream */

;((name, definition) => {
  typeof module !== 'undefined'
    ? module.exports = definition()
    : typeof define === 'function' && typeof define.amd === 'object'
      ? define(definition)
      : this[name] = definition()
})('streamSaver', () => {
  'use strict'

  let iframe, background
  const ponyfill = window.WebStreamsPolyfill || {}
  const once = { once: true }
  const isSecureContext = window.isSecureContext
  const firefox = 'MozAppearance' in document.documentElement.style
  const mozExtension = location.protocol === 'moz-extension:'
  const streamSaver = {
    createWriteStream,
    WritableStream: window.WritableStream || ponyfill.WritableStream,
    supported: false,
    version: { full: '1.2.0', major: 1, minor: 2, dot: 0 },
    mitm: 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=1.2.0',
    ping: 'https://jimmywarting.github.io/StreamSaver.js/ping.html?version=1.2.0'
  }

  function makeIframe (src) {
    const iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.src = src
    iframe.addEventListener('load', () => {
      iframe.loaded = true
    }, once)
    document.body.appendChild(iframe)
    return iframe
  }

  try {
    background = chrome.extension.getBackgroundPage() === window
  } catch (err) {}

  try {
    // Some browser has it but ain't allowed to construct a stream yet
    streamSaver.supported = 'serviceWorker' in navigator && !!new ReadableStream()
  } catch (err) {}

  try {
    // Transfariable stream was first enabled in chrome v73 behind a flag
    const { readable } = new TransformStream()
    const mc = new MessageChannel()
    mc.port1.postMessage(readable, [readable])
    mc.port1.close()
    mc.port2.close()
    // Freeze TransformStream object (can only work with native)
    Object.defineProperty(streamSaver, 'TransformStream', {
      configurable: false,
      writable: false,
      value: TransformStream
    })
  } catch (err) {}

  function iframePostMessage (url, args) {
    iframe = iframe || makeIframe(url)
    if (iframe.loaded) {
      iframe.contentWindow.postMessage(...args)
    } else {
      iframe.addEventListener('load', () => {
        iframe.contentWindow.postMessage(...args)
      }, once)
    }
  }

  function load (url, noTabs, popUp) {
    let popup = { close: () => (popup.closed = 1), fns: [], onLoad: fn => popup.fns.push(fn) }
    if (!noTabs && window.chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url, active: false }, popup2 => {
        popup.close = () => chrome.tabs.remove(popup2.id)

        if (popup.closed) {
          popup.close()
        } else {
          let fn
          chrome.tabs.onUpdated.addListener(fn = (tabId, _, tab) => {
            if (tabId === popup2.id && tab.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(fn)
              popup.onLoad = fn => fn()
              popup.fns.forEach(popup.onLoad)
            }
          })
        }
      })
    } else {
      if (popUp) {
        popup = window.open(url, Math.random())
      } else {
        if (mozExtension || background) {
          popup.close = (x => () => x.remove())(makeIframe(url))
        } else {
          if (iframe && !iframe.loaded) {
            iframe.addEventListener('load', makeIframe.bind(null, url), once)
          } else {
            makeIframe(url)
          }
        }
      }
    }
    return popup
  }

  function createWriteStream (filename, queuingStrategy, size) {
    // normalize arguments
    if (Number.isFinite(queuingStrategy)) {
      [size, queuingStrategy] = [queuingStrategy, size]
    }

    let channel = new MessageChannel()
    let popup
    let hash = ''
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
          if (popup) {
            if (!hash && !iframe && firefox) {
              iframePostMessage(streamSaver.ping, [evt.data, '*'])
            }
            popup.close() // don't need the popup any longer
          }
          popup = load(evt.data.download, isSecureContext)

          // Cleanup
          if (readableStream) {
            // We don't need postMessages now when stream are transferable
            channel.port1.close()
            channel.port2.close()
          }
        } else {
          if (popup) {
            if (firefox) popup.close()
            popup = null
          }

          channel.port1.onmessage = null
        }
      }

      if (isSecureContext) {
        return iframePostMessage(streamSaver.mitm, args)
      }
      if (!hash && mozExtension && !streamSaver.transformStream) {
        hash = '#' + Math.random()
      }
      popup = load(streamSaver.mitm + hash, !hash, true)
      if (popup.postMessage) {
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
      } else {
        popup.onLoad(() => {
          args[0].hash = hash
          iframePostMessage(streamSaver.ping, args)
        })
      }
    })

    if (streamSaver.TransformStream) {
      const ts = new streamSaver.TransformStream({
        start () {
          return new Promise(resolve =>
            setTimeout(() => setupChannel(ts.readable).then(resolve))
          )
        }
      }, queuingStrategy)

      return ts.writable
    }

    return new streamSaver.WritableStream({
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
