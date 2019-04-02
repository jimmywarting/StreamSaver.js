/* global self */
const map = new Map()

self.onconnect = function (evt) {
  let port = evt.ports[0]

  port.onmessage = function ({ data, ports }) {
    if (data.ping) {
      const keepAlive = () => self.fetch(data.ping)
      setInterval(keepAlive, 28E3)
      keepAlive()
    }

    if (data.hash) {
      const entry = map.get(data.hash)
      if (entry && entry[1].ping) {
        entry[0].postMessage(data, ports)
      } else {
        if (entry) {
          evt.ports[0].postMessage(entry[1], [ entry[0] ])
        }
        map.set(data.hash, [ ports[0], data ])
      }
    }
  }
}
