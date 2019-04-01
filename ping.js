
const map = new Map()

onconnect = function(e) {
  let port = e.ports[0]

  port.onmessage = function(e) {
    if (e.data.ping) {
      let keepAlive = () => fetch(e.data.ping)
      setInterval(keepAlive, 29E3)
      keepAlive()
    }
    if (e.data.hash) {
      let entry = map.get(e.data.hash)
      if (entry && entry[1].ping) {
        entry[0].postMessage(e.data, e.ports)
      } else {
        if (entry) {
          e.ports[0].postMessage(entry[1], [ entry[0] ])
        }
        map.set(e.data.hash, [ e.ports[0], e.data ])
      }
    }
  }

}
