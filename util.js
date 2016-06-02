// Do you perfer to get a stream?
window.blob2Stream = blob =>
	fetch(URL.createObjectURL(blob))
	.then(res => pump(res.body.getReader()))

// Or do you want to read it yourself?
window.blob2reader = (blob, callback, chunkSize = 524288) => {
	let
	chunks = Math.ceil(blob.size / chunkSize),
	currentChunk = 0,
	fr = new FileReader()

	fr.onload = function(e) {
		currentChunk++
		callback({value: e.target.result, done: currentChunk == chunks})
		if(currentChunk == chunks) return

		let start = currentChunk * chunkSize
		let end = ((start + chunkSize) >= blob.size) ? blob.size : start + chunkSize
		fr.readAsArrayBuffer(blob.slice(start, end))
	}
	// kick off the reading of the file
	fr.readAsArrayBuffer(blob.slice(0, chunkSize))
}
