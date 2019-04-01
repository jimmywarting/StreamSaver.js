/* global location WritableStream ReadableStream define MouseEvent MessageChannel TransformStream */
;((name, definition) => {
  typeof module !== 'undefined'
    ? module.exports = definition()
    : typeof define === 'function' && typeof define.amd === 'object'
      ? define(definition)
      : this[name] = definition()
})('streamSaver', () => {
  'use strict'

  const firefox = navigator.userAgent.indexOf('Firefox') !== -1
  const mozExtension = location.protocol === 'moz-extension:'
  const background = window.chrome && chrome.extension &&
                     chrome.extension.getBackgroundPage &&
                     chrome.extension.getBackgroundPage() === window
  const secure = location.protocol === 'https:' ||
                 location.protocol === 'chrome-extension:' ||
                 mozExtension && !background ||
                 location.hostname === 'localhost'
  let iframe
  let loaded
  let transferableTransformStream
  let streamSaver = {
    createWriteStream,
    supported: false,
    version: {
      full: '1.2.0',
      major: 1,
      minor: 2,
      dot: 0
    }
  }

  streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=' +
    streamSaver.version.full
  streamSaver.ping = 'https://jimmywarting.github.io/StreamSaver.js/ping.html?version=' +
    streamSaver.version.full

  try {
    // Some browser has it but ain't allowed to construct a stream yet
    streamSaver.supported = 'serviceWorker' in navigator && !!new ReadableStream()
  } catch (err) {}

  try {
    const { readable } = new TransformStream()
    const mc = new MessageChannel()
    mc.port1.postMessage(readable, [readable])
    mc.port1.close()
    mc.port2.close()
    transferableTransformStream = readable.locked === true ? TransformStream : 0
  } catch (err) {
    // Was first enabled in chrome v73 behind a flag
  }

  function iframePostMessage(url, args) {
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.hidden = true
      document.body.appendChild(iframe)
      iframe.src = url
    }
    if (!loaded) {
      let fn2
      iframe.addEventListener('load', fn2 = () => {
        loaded = true
        iframe.removeEventListener('load', fn2)
        iframe.contentWindow.postMessage(...args)
      })
    } else {
      iframe.contentWindow.postMessage(...args)
    }
  }

  function load(url, noTabs, popUp) {
    let popup = { close: () => popup.closed = 1, fns: [], onLoad: fn => popup.fns.push(fn) }
    if (!noTabs && window.chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url, active: false }, popup2 => {
        popup.close = () => chrome.tabs.remove(popup2.id)
        if (popup.closed) {
          popup.close()
        } else {
          let fn
          chrome.tabs.onUpdated.addListener(fn = (tabId, changeInfo, tab) => {
            if (tabId == popup2.id && tab.status == "complete") {
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
          let iframe2 = document.createElement('iframe')
          iframe2.hidden = true
          document.body.appendChild(iframe2)
          iframe2.src = url
          popup.close = () => document.body.removeChild(iframe2)
        } else {
          if (iframe && !loaded) {
            let fn2
            iframe.addEventListener('load', fn2 = () => {
              iframe.removeEventListener('load', fn2)
              window.location = url
            })
          } else {
            window.location = url
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
          popup = load(evt.data.download, secure)

          // Cleanup
          if (readableStream) {
            // We don't need postMessages now when stream are transferable
            channel.port1.close()
            channel.port2.close()
          }
        } else {
          if (popup) {
            if (firefox) popup.close()
            popup = 0
          }

          channel.port1.onmessage = null
        }
      }

      if (secure) {
        return iframePostMessage(streamSaver.mitm, args)
      }
      if (!hash && mozExtension && !transferableTransformStream) {
        hash = '#' + Math.random()
      }
      popup = load(streamSaver.mitm + hash, !hash, 1)
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

    if (transferableTransformStream) {
      const ts = new transferableTransformStream({
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
