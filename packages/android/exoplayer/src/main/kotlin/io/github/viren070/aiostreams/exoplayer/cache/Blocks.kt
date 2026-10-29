package io.github.viren070.aiostreams.exoplayer.cache

import java.nio.ByteBuffer
import java.util.TreeMap
import kotlin.math.max
import kotlin.math.min

internal const val BLOCK = 1 shl 20

/**
 * The held bytes, in native blocks that each hold one unbroken stretch. Its
 * owner's lock guards it, and it frees its memory itself, as the garbage
 * collector would only free it with the buffers.
 */
internal class Blocks {
    private class Block(val data: ByteBuffer) {
        var start = 0
        var end = 0
    }

    private val blocks = TreeMap<Long, Block>()
    private val spare = ArrayDeque<ByteBuffer>()

    val count get() = blocks.size
    val first: Long? get() = blocks.firstEntry()?.key

    fun lastAfter(index: Long, pick: (Long) -> Boolean): Long? = blocks.tailMap(index, false).descendingKeySet().firstOrNull(pick)

    /** Copies what's held from [position] in its block, 0 when nothing is. */
    fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
        val block = blocks[position / BLOCK] ?: return 0
        val inner = (position % BLOCK).toInt()
        if (inner < block.start || inner >= block.end) return 0
        val n = min(count, block.end - inner)
        block.data.position(inner)
        block.data.get(target, offset, n)
        return n
    }

    /** Where the bytes held from [position] stop, jumping the stretches [skip] gives. */
    fun end(position: Long, skip: (Long) -> LongRange? = { null }): Long {
        var p = position
        while (true) {
            skip(p)?.let {
                p = it.last + 1
                continue
            }
            val block = blocks[p / BLOCK] ?: return p
            val inner = (p % BLOCK).toInt()
            if (inner < block.start || inner >= block.end) return p
            p += block.end - inner
            if (block.end < BLOCK) return p
        }
    }

    fun runs(): List<LongRange> {
        val runs = mutableListOf<LongRange>()
        for ((index, block) in blocks) {
            if (block.end <= block.start) continue
            val start = index * BLOCK + block.start
            val end = index * BLOCK + block.end - 1
            val last = runs.lastOrNull()
            if (last != null && start == last.last + 1) runs[runs.lastIndex] = last.first..end else runs += start..end
        }
        return runs
    }

    /**
     * Stores bytes, taking a new block once [room] makes space for it; true
     * when a block's earlier stretch was dropped for them.
     */
    fun write(position: Long, source: ByteArray, count: Int, room: (Long) -> Boolean): Boolean {
        var dropped = false
        var p = position
        var offset = 0
        while (offset < count) {
            val index = p / BLOCK
            val inner = (p % BLOCK).toInt()
            val block = blocks[index] ?: take(index, room) ?: return dropped
            if (inner < block.start || inner > block.end) {
                dropped = dropped || block.end > block.start
                block.start = inner
                block.end = inner
            }
            val n = min(count - offset, BLOCK - inner)
            block.data.position(inner)
            block.data.put(source, offset, n)
            block.end = max(block.end, inner + n)
            p += n
            offset += n
        }
        return dropped
    }

    fun drop(index: Long) {
        val block = blocks.remove(index) ?: return
        if (spare.size < SPARE_BLOCKS) spare.addLast(block.data) else BlockMemory.free(block.data)
    }

    fun free() {
        for (block in blocks.values) BlockMemory.free(block.data)
        for (data in spare) BlockMemory.free(data)
        blocks.clear()
        spare.clear()
    }

    private fun take(index: Long, room: (Long) -> Boolean): Block? {
        if (!room(index)) return null
        val data = spare.removeFirstOrNull() ?: BlockMemory.allocate(BLOCK) ?: return null
        return Block(data).also { blocks[index] = it }
    }

    private companion object {
        const val SPARE_BLOCKS = 4
    }
}

private object BlockMemory {
    init {
        System.loadLibrary("aiostreams_stream_cache")
    }

    @JvmStatic
    external fun allocate(size: Int): ByteBuffer?

    @JvmStatic
    external fun free(buffer: ByteBuffer)
}
