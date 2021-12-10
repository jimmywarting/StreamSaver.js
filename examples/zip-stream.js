class Crc32 {
	constructor() {
		this.crc = -1
	}

	append(data) {
		let crc = this.crc | 0;
		const table = this.table;
		for (let offset = 0, len = data.length | 0; offset < len; offset++) {
			crc = (crc >>> 8) ^ table[(crc ^ data[offset]) & 0xFF]
		}
		this.crc = crc
	}

	get() {
		return ~this.crc
	}
}

Crc32.prototype.table = (() => {
	const table = [];
	for (let i = 0; i < 256; i++) {
		let t = i
		for (let j = 0; j < 8; j++) {
			t = (t & 1)
				? (t >>> 1) ^ 0xEDB88320
				: t >>> 1
		}
		table[i] = t
	}
	return table
})()

const getDataHelper = byteLength => {
	const uint8 = new Uint8Array(byteLength);
	return {
		array: uint8,
		view: new DataView(uint8.buffer)
	}
}

const pump = zipObj => zipObj.reader.read().then(chunk => {
	if (chunk.done) return zipObj.writeFooter()
	const outputData = chunk.value
	zipObj.crc.append(outputData)
	zipObj.uncompressedLength += outputData.length
	zipObj.compressedLength += outputData.length
	zipObj.ctrl.enqueue(outputData)
})

/**
 * [createWriter description]
 * @param  {Object} underlyingSource [description]
 * @return {Boolean}                  [description]
 */
function createWriter(underlyingSource) {
	const files = Object.create(null)
	const filenames = []
	const encoder = new TextEncoder()
	let offset = 0
	let activeZipIndex = 0
	let ctrl
	let activeZipObject, closed

	let overallSize = 0
	let zip64 = false

	function next() {
		activeZipIndex++
		activeZipObject = files[filenames[activeZipIndex]]
		if (activeZipObject) processNextChunk()
		else if (closed) closeZip()
	}

	const zipWriter = {
		enqueue(fileLike) {
			if (closed) throw new TypeError('Cannot enqueue a chunk into a readable stream that is closed or has been requested to be closed')

			let name = fileLike.name.trim()
			const date = new Date(typeof fileLike.lastModified === 'undefined' ? Date.now() : fileLike.lastModified)

			if (fileLike.directory && !name.endsWith('/')) name += '/'
			if (files[name]) throw new Error('File already exists.')
			overallSize += fileLike.size
			zip64 = (overallSize >= 0xffffffff);

			const nameBuf = encoder.encode(name)
			filenames.push(name)


			const zipObject = files[name] = {
				level: 0,
				ctrl,
				directory: !!fileLike.directory,
				nameBuf,
				comment: encoder.encode(fileLike.comment || ''),
				compressedLength: 0,
				uncompressedLength: 0,
				extraArray: null,
				writeHeader() {
					let header = getDataHelper(26);
					let data = getDataHelper(30 + nameBuf.length);

					zipObject.offset = offset
					zipObject.header = header
					if (zipObject.level !== 0 && !zipObject.directory) {
						header.view.setUint16(4, 0x0800)
					}
					header.view.setUint32(0, 0x14000808)

					if (zip64) //Zip64 Min ver.
						header.view.setUint16(0, 45, true)

					header.view.setUint16(6, (((date.getHours() << 6) | date.getMinutes()) << 5) | date.getSeconds() / 2, true)
					header.view.setUint16(8, ((((date.getFullYear() - 1980) << 4) | (date.getMonth() + 1)) << 5) | date.getDate(), true)
					header.view.setUint16(22, nameBuf.length, true)
					data.view.setUint32(0, 0x504b0304)
					data.array.set(header.array, 4)
					data.array.set(nameBuf, 30)
					offset += data.array.length
					ctrl.enqueue(data.array)
				},
				writeFooter() {
					// if (this.compressedLength && this.compressedLength >= 0xffffffff) {
					//   zipObject.header.view.setUint16(0, 45)
					//   zip64 = true
					// }
					let footer = getDataHelper(zip64 ? 24 : 16);
					footer.view.setUint32(0, 0x504b0708)

					if (zipObject.crc) {
						zipObject.header.view.setUint32(10, zipObject.crc.get(), true)
						footer.view.setUint32(4, zipObject.crc.get(), true)
					}

					if (zip64) {
						let zip64Extra = getDataHelper(28)
						zipObject.header.view.setUint32(14, 0xffffffff, true)
						zipObject.header.view.setUint32(18, 0xffffffff, true)
						footer.view.setBigUint64(8, BigInt(zipObject.compressedLength), true)
						footer.view.setBigInt64(16, BigInt(zipObject.uncompressedLength), true)
						zip64Extra.view.setUint16(0, 0x0001, true)
						zip64Extra.view.setUint16(2, 24, true)
						zip64Extra.view.setBigUint64(4, BigInt(zipObject.uncompressedLength), true)
						zip64Extra.view.setBigUint64(12, BigInt(zipObject.compressedLength), true)
						zip64Extra.view.setBigUint64(20, BigInt(files[name].offset), true)
						files[name].extraArray = zip64Extra.array
					} else {
						zipObject.header.view.setUint32(14, zipObject.compressedLength, true)
						zipObject.header.view.setUint32(18, zipObject.uncompressedLength, true)
						footer.view.setUint32(8, zipObject.compressedLength, true)
						footer.view.setUint32(12, zipObject.uncompressedLength, true)

					}

					ctrl.enqueue(footer.array)
					offset += zipObject.compressedLength + footer.array.length
					next()
				},
				fileLike
			}

			if (!activeZipObject) {
				activeZipObject = zipObject
				processNextChunk()
			}
		},
		close() {
			if (closed) throw new TypeError('Cannot close a readable stream that has already been requested to be closed')
			if (!activeZipObject) closeZip()
			closed = true
		}
	};

	function closeZip() {
		let length = 0;
		let index = 0;
		let indexFilename, file;
		// var zip64 = false
		let cdOffset = offset
		let totalEntries = filenames.length
		for (indexFilename = 0; indexFilename < filenames.length; indexFilename++) {
			file = files[filenames[indexFilename]]
			length += 46 + file.nameBuf.length + file.comment.length
			if (file.extraArray) {
				length += file.extraArray.length
				// zip64 = true
			}
		}

		// if (cdOffset + length >= 0xffffffff || filenames.length >= 0xffff)
		//   zip64 = true

		const data = getDataHelper(length + 22 + (zip64 ? 56 + 20 : 0))
		for (indexFilename = 0; indexFilename < filenames.length; indexFilename++) {
			file = files[filenames[indexFilename]]
			data.view.setUint32(index, 0x504b0102)
			data.view.setUint16(index + 4, 0x1400)
			data.array.set(file.header.array, index + 6)
			if (file.extraArray) {
				data.view.setUint16(index + 30, file.extraArray.length, true)
			}
			data.view.setUint16(index + 32, file.comment.length, true)
			if (file.directory) {
				data.view.setUint8(index + 38, 0x10)
			}
			if (file.offset >= 0xffffffff)
				data.view.setUint32(index + 42, 0xffffffff, true)
			else
				data.view.setUint32(index + 42, file.offset, true)

			data.array.set(file.nameBuf, index + 46)
			let extraLength = 0
			if (file.extraArray) {
				extraLength = file.extraArray.length
				data.array.set(file.extraArray, index + 46 + file.nameBuf.length)
			}
			data.array.set(file.comment, index + 46 + file.nameBuf.length + extraLength)
			index += 46 + file.nameBuf.length + file.comment.length + extraLength
		}
		if (zip64) {
			// Zip64 End of Central Directory record
			// 0: Signature
			data.view.setUint32(index, 0x504b0606);
			// 4: Size of zip64 EOCD
			data.view.setBigUint64(index + 4, BigInt(44), true);
			// 12: Version made By
			data.view.setUint16(index + 12, 45, true);
			// 14: version needed to extract
			data.view.setUint16(index + 14, 45, true);
			// 16: number of this disk
			// 20: number of the disk with the start of CD
			// 24: total number of entries in the central directory on this disk
			data.view.setBigUint64(index + 24, BigInt(totalEntries), true);
			// 32: total number of entries in the central directory
			data.view.setBigUint64(index + 32, BigInt(totalEntries), true);
			// 40: size of the central directory
			data.view.setBigUint64(index + 40, BigInt(length), true);
			// 48: Offset of start of central directory
			data.view.setBigUint64(index + 48, BigInt(cdOffset), true);
			index += 56

			// Zip64 End of Central Directory locator
			// 0: Signature
			data.view.setUint32(index, 0x504b0607);
			// 4: number of the disk with the zip64 EOCD
			// 8: Offset of the zip64 EOCD
			data.view.setBigUint64(index + 8, BigInt(cdOffset + length), true);
			// 16: total number of disks
			data.view.setUint32(index + 16, 1, true);
			index += 20

			// EOCD must set these values to 0xffff and 0xffffffff when using ZIP64 format
			totalEntries = 0xffff;
			cdOffset = 0xffffffff;
		}
		data.view.setUint32(index, 0x504b0506)
		data.view.setUint16(index + 8, totalEntries, true)
		data.view.setUint16(index + 10, totalEntries, true)
		data.view.setUint32(index + 12, length, true)
		data.view.setUint32(index + 16, cdOffset, true)
		ctrl.enqueue(data.array)
		ctrl.close()
	}

	function processNextChunk() {
		if (!activeZipObject) return
		if (activeZipObject.directory) {
			activeZipObject.writeHeader()
			activeZipObject.writeFooter()
			return
		}
		if (activeZipObject.reader) return pump(activeZipObject)
		if (activeZipObject.fileLike.stream) {
			activeZipObject.crc = new Crc32()
			activeZipObject.reader = activeZipObject.fileLike.stream().getReader()
			activeZipObject.writeHeader()
		} else next()
	}

	return new ReadableStream({
		start: c => {
			ctrl = c
			underlyingSource.start && Promise.resolve(underlyingSource.start(zipWriter))
		},
		pull() {
			return processNextChunk() || (
				underlyingSource.pull &&
				Promise.resolve(underlyingSource.pull(zipWriter))
			)
		}
	})
}

window.ZIP = createWriter
