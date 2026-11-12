package io.github.viren070.aiostreams.playback

import io.github.viren070.aiostreams.natives.Upscaling
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The weights of the anime upscaling network, for shaders built on the device. It reads luma
 * and writes four values per pixel, for the pixels at twice the size, around 0.5 and [span] wide. Its
 * features fit 8-bit textures, and clamping them at 0 is its activation. [steepen], when there,
 * then sharpens those pixels' edges.
 */
class UpscaleNetwork(val span: Float, val layers: List<Layer>, val steepen: Steepen?) {
    /** `weight[out][in][y][x]`, for a 3x3 kernel whose taps are [step] pixels apart. */
    class Layer(private val weight: Array<Array<Array<FloatArray>>>, val bias: FloatArray, val step: Int) {
        /** How much input channel [channel] at this tap adds to each output. */
        fun column(y: Int, x: Int, channel: Int) = FloatArray(4) { weight[it][channel][y][x] }

        fun isEmpty(y: Int, x: Int) = weight.all { out -> out.all { it[y][x] == 0f } }
    }

    /** The S-curve the media crate's `NETWORK` describes; [span] bounds how far it moves a pixel. */
    class Steepen(val strength: Float, val low: Float, val high: Float, val darken: Float, val span: Float)

    companion object {
        val MIN_SCALE = Upscaling.minScale()

        fun mpvShader() = Upscaling.mpvShader()

        fun load(): UpscaleNetwork {
            val root = Json.parseToJsonElement(Upscaling.network()).jsonObject
            return UpscaleNetwork(
                root.getValue("span").jsonPrimitive.float,
                root.getValue("layers").jsonArray.map { element ->
                    val layer = element.jsonObject
                    Layer(
                        layer.getValue("weight").jsonArray.map { out ->
                            out.jsonArray.map { input ->
                                input.jsonArray.map { row -> floats(row.jsonArray) }.toTypedArray()
                            }.toTypedArray()
                        }.toTypedArray(),
                        floats(layer.getValue("bias").jsonArray),
                        layer["step"]?.jsonPrimitive?.int ?: 1,
                    )
                },
                root["steepen"]?.jsonObject?.let { s ->
                    fun value(name: String) = s.getValue(name).jsonPrimitive.float
                    Steepen(value("strength"), value("low"), value("high"), value("darken"), value("span"))
                },
            )
        }

        private fun floats(array: JsonArray) = FloatArray(array.size) { array[it].jsonPrimitive.float }
    }
}
