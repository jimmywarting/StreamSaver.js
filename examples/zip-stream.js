class Crc32 {
    constructor() { this.crc = -1 }
    append(data) {
        var crc = this.crc | 0
        for (var offset = 0, len = data.length | 0, table = this.table; offset < len; offset++)
            crc = (crc >>> 8) ^ table[(crc ^ data[offset]) & 0xFF]
        this.crc = crc
    }
    get() { return ~this.crc }
}
Crc32.prototype.table = (() => {
    let table = []
    for (let i = 0; i < 256; i++) {
        let t = i
        for (let j = 0; j < 8; j++) t = t & 1 ? (t >>> 1) ^ 0xEDB88320 : t >>> 1
        table[i] = t
    }
    return table
})()

function getView(n) {
    const array = new Uint8Array(n)
    return { array, view: new DataView(array.buffer) }
}

const encoder = new TextEncoder()

function dosTime(d) {
    return (((d.getHours() << 6) | d.getMinutes()) << 5) | (d.getSeconds() / 2)
}
function dosDate(d) {
    return ((((d.getFullYear() - 1980) << 4) | (d.getMonth() + 1)) << 5) | d.getDate()
}

function createZipStream() {
    const files = []
    let offset = 0

    // Always write zip64 local headers. Setting compressed/uncompressed to 0xFFFFFFFF
    // (not 0) tells extractors to expect a zip64 data descriptor (8-byte sizes).
    // This sidesteps the race condition in the old code where writeFooter() tried to
    // patch an already-enqueued header buffer.
    function writeLocalHeader(file, ctrl) {
        // zip64 extra field: tag(2) + size(2) + uncompressedSize(8) + compressedSize(8)
        const extra = getView(20)
        extra.view.setUint16(0, 0x0001, true)  // zip64 tag
        extra.view.setUint16(2, 16, true)       // 16 bytes of payload follow

        const h = getView(30 + file.nameBuf.length + 20)
        h.view.setUint32(0, 0x04034b50)           // local file header sig
        h.view.setUint16(4, 45, true)             // version needed: 4.5 (zip64)
        h.view.setUint16(6, 0x0808, true)         // GP flags: data descriptor + UTF-8
        // compression method: 0 (stored)
        h.view.setUint16(10, dosTime(file.date), true)
        h.view.setUint16(12, dosDate(file.date), true)
        // CRC-32: 0 (deferred to data descriptor)
        h.view.setUint32(18, 0xffffffff, true)    // compressed size → zip64 marker
        h.view.setUint32(22, 0xffffffff, true)    // uncompressed size → zip64 marker
        h.view.setUint16(26, file.nameBuf.length, true)
        h.view.setUint16(28, 20, true)            // extra field length
        h.array.set(file.nameBuf, 30)
        h.array.set(extra.array, 30 + file.nameBuf.length)

        file.offset = offset
        offset += h.array.length
        ctrl.enqueue(h.array)
    }

    // Always zip64 data descriptor (24 bytes) to match the local header's extra field.
    function writeDataDescriptor(file, ctrl) {
        const dd = getView(24)
        dd.view.setUint32(0, 0x08074b50)  // data descriptor sig
        dd.view.setUint32(4, file.crc.get(), true)
        dd.view.setBigUint64(8, BigInt(file.compressedLength), true)
        dd.view.setBigUint64(16, BigInt(file.uncompressedLength), true)
        ctrl.enqueue(dd.array)
        offset += file.compressedLength + 24
    }

    async function processFile(fileLike, ctrl) {
        const raw = fileLike.name.trim()
        const name = fileLike.directory && !raw.endsWith('/') ? raw + '/' : raw
        const date = new Date(typeof fileLike.lastModified === 'undefined' ? Date.now() : fileLike.lastModified)

        const file = {
            nameBuf: encoder.encode(name),
            comment: encoder.encode(fileLike.comment || ''),
            date,
            directory: !!fileLike.directory,
            offset: 0,
            compressedLength: 0,
            uncompressedLength: 0,
            crc: new Crc32(),
        }
        files.push(file)

        writeLocalHeader(file, ctrl)

        if (!fileLike.directory && fileLike.stream) {
            const reader = fileLike.stream().getReader()
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                file.crc.append(value)
                file.uncompressedLength += value.length
                file.compressedLength += value.length
                ctrl.enqueue(value)
            }
        }

        writeDataDescriptor(file, ctrl)
    }

    function writeCentralDirectory(ctrl) {
        let cdLength = 0
        for (const file of files) {
            // A central directory entry needs a zip64 extra field when any value overflows 32 bits.
            file.needsZip64 = file.compressedLength >= 0xffffffff ||
                              file.uncompressedLength >= 0xffffffff ||
                              file.offset >= 0xffffffff
            cdLength += 46 + file.nameBuf.length + file.comment.length + (file.needsZip64 ? 28 : 0)
        }

        const cdOffset = offset
        const n = files.length
        const useZip64EOCD = cdOffset >= 0xffffffff || n >= 0xffff

        const data = getView(cdLength + (useZip64EOCD ? 76 : 0) + 22)
        let i = 0

        for (const file of files) {
            const extraLen = file.needsZip64 ? 28 : 0
            data.view.setUint32(i, 0x02014b50)                               // CD file header sig
            data.view.setUint16(i + 4, 0x1400)                               // version made by
            data.view.setUint16(i + 6, file.needsZip64 ? 45 : 20, true)     // version needed
            data.view.setUint16(i + 8, 0x0808, true)                         // GP flags
            // compression method: 0
            data.view.setUint16(i + 12, dosTime(file.date), true)
            data.view.setUint16(i + 14, dosDate(file.date), true)
            data.view.setUint32(i + 16, file.crc.get(), true)                // CRC-32
            data.view.setUint32(i + 20, file.needsZip64 ? 0xffffffff : file.compressedLength, true)
            data.view.setUint32(i + 24, file.needsZip64 ? 0xffffffff : file.uncompressedLength, true)
            data.view.setUint16(i + 28, file.nameBuf.length, true)
            data.view.setUint16(i + 30, extraLen, true)
            data.view.setUint16(i + 32, file.comment.length, true)
            // disk number start: 0 | internal file attributes: 0
            if (file.directory) data.view.setUint8(i + 38, 0x10)            // external file attrs
            data.view.setUint32(i + 42, file.offset >= 0xffffffff ? 0xffffffff : file.offset, true)
            data.array.set(file.nameBuf, i + 46)
            if (file.needsZip64) {
                const e = i + 46 + file.nameBuf.length
                data.view.setUint16(e, 0x0001, true)                         // zip64 tag
                data.view.setUint16(e + 2, 24, true)                         // 3 × 8-byte fields
                data.view.setBigUint64(e + 4, BigInt(file.uncompressedLength), true)
                data.view.setBigUint64(e + 12, BigInt(file.compressedLength), true)
                data.view.setBigUint64(e + 20, BigInt(file.offset), true)
            }
            data.array.set(file.comment, i + 46 + file.nameBuf.length + extraLen)
            i += 46 + file.nameBuf.length + extraLen + file.comment.length
        }

        if (useZip64EOCD) {
            // Zip64 EOCD record (56 bytes)
            data.view.setUint32(i, 0x06064b50)
            data.view.setBigUint64(i + 4, BigInt(44), true)          // size of remaining record
            data.view.setUint16(i + 12, 45, true)                    // version made by
            data.view.setUint16(i + 14, 45, true)                    // version needed
            // disk number (0) and disk with start of CD (0) already 0
            data.view.setBigUint64(i + 24, BigInt(n), true)          // entries on this disk
            data.view.setBigUint64(i + 32, BigInt(n), true)          // total entries
            data.view.setBigUint64(i + 40, BigInt(cdLength), true)   // size of CD
            data.view.setBigUint64(i + 48, BigInt(cdOffset), true)   // offset of CD
            i += 56

            // Zip64 EOCD locator (20 bytes)
            data.view.setUint32(i, 0x07064b50)
            // disk with zip64 EOCD: 0
            data.view.setBigUint64(i + 8, BigInt(cdOffset + cdLength), true)  // offset of zip64 EOCD
            data.view.setUint32(i + 16, 1, true)                     // total disks
            i += 20
        }

        // EOCD (22 bytes)
        data.view.setUint32(i, 0x06054b50)
        data.view.setUint16(i + 8, useZip64EOCD ? 0xffff : n, true)
        data.view.setUint16(i + 10, useZip64EOCD ? 0xffff : n, true)
        data.view.setUint32(i + 12, useZip64EOCD ? 0xffffffff : cdLength, true)
        data.view.setUint32(i + 16, useZip64EOCD ? 0xffffffff : cdOffset, true)

        ctrl.enqueue(data.array)
    }

    return new TransformStream({
        async transform(fileLike, ctrl) {
            await processFile(fileLike, ctrl)
        },
        flush(ctrl) {
            writeCentralDirectory(ctrl)
        }
    })
}

if (typeof window !== 'undefined') window.createZipStream = createZipStream
