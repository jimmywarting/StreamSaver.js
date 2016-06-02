// Do you perfer to get a stream?
window.blob2Stream = blob =>
	fetch(URL.createObjectURL(blob))
	.then(res => pump(res.body.getReader()))

// Or do you want to read it yourself?
// This is not nearly as good as stream as it can not handle backpressure
window.blob2reader = (blob, callback, highWaterMark = 524288) => {
	let
	chunks = Math.ceil(blob.size / highWaterMark),
	currentChunk = 0,
	fr = new FileReader()

	fr.onload = function(e) {
		currentChunk++
		callback({
			value: e.target.result,
			done: currentChunk >= chunks,
			next(){
				let start = currentChunk * highWaterMark
				let end = ((start + highWaterMark) >= blob.size) ? blob.size : start + highWaterMark
				fr.readAsArrayBuffer(blob.slice(start, end))
			}
		})
	}
	// kick off the reading of the file
	fr.readAsArrayBuffer(blob.slice(0, highWaterMark))
}

// // This is a bit more unfinish advance handle backpressure
// window.blob2StreamX = (blob, highWaterMark)
//
// new ReadableStream({
// 	start(controller) {
// 		blob2reader
// 	},
// 	pull(controller) {
//
// 	},
// 	cancel() {
// 		console.log("user aborted")
// 	}
// })
