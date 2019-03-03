
onconnect = function(e) {
  let port = e.ports[0]

  port.onmessage = function(e) {
    if (e.data.ping) {
      port.onmessage = null
      let keepAlive = () => fetch(e.data.ping)
      setInterval(keepAlive, 29E3)
      keepAlive()
    }
  }

}