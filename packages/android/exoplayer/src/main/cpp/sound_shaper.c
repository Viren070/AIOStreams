#include <jni.h>
#include <math.h>
#include <stdint.h>

#define CENTRE 2
#define FULL_SCALE 32768.0f
// -1 dBFS.
#define LIMIT 0.891f
#define HALF_POWER 0.70710678f
// The compressor's gain is worked out once a block, as the logarithms cost more than the rest of a frame.
#define CONTROL_FRAMES 32
#define THRESHOLD_DB -24.0f
#define RATIO 6.0f
#define MAKEUP_DB 12.0f

enum { LEVEL, COMPRESSION, LIMITING, STATE_SIZE };

static float coefficient(float ms, int rate) {
    return 1.0f - expf(-1000.0f / (ms * (float)rate));
}

static float compressor_gain(float mean_square) {
    float over = 10.0f * log10f(fmaxf(mean_square, 1e-10f)) - THRESHOLD_DB;
    return powf(10.0f, (MAKEUP_DB - fmaxf(over, 0.0f) * (1.0f - 1.0f / RATIO)) / 20.0f);
}

JNIEXPORT jboolean JNICALL Java_io_github_viren070_aiostreams_exoplayer_SoundShaper_nativeShape(
        JNIEnv *env, jclass cls, jobject input, jint input_offset, jint frames, jint input_channels, jintArray map_array,
        jint rate, jobject output, jint output_offset, jint output_channels, jboolean float_output, jfloat centre,
        jboolean night, jfloat gain, jfloatArray state_array) {
    const uint8_t *in_base = (*env)->GetDirectBufferAddress(env, input);
    uint8_t *out_base = (*env)->GetDirectBufferAddress(env, output);
    jsize channels = (*env)->GetArrayLength(env, map_array);
    if (!in_base || !out_base || channels > 8) return JNI_FALSE;
    const int16_t *in = (const int16_t *)(in_base + input_offset);
    jint map[8];
    float state[STATE_SIZE];
    (*env)->GetIntArrayRegion(env, map_array, 0, channels, map);
    (*env)->GetFloatArrayRegion(env, state_array, 0, STATE_SIZE, state);
    const float attack = coefficient(5.0f, rate), release = coefficient(300.0f, rate);
    const float limiter_release = coefficient(100.0f, rate);
    const int shaping = centre != 1.0f || night || gain != 1.0f;
    float s[8];
    for (int i = 0; i < frames; i++) {
        const int16_t *frame = in + i * input_channels;
        float frame_gain = 1.0f;
        if (shaping) {
            float sum = 0.0f;
            for (int c = 0; c < channels; c++) {
                s[c] = frame[map[c]] / FULL_SCALE * (c == CENTRE ? centre : 1.0f);
                sum += s[c] * s[c];
            }
            frame_gain = gain;
            if (night) {
                float square = sum / channels;
                state[LEVEL] += (square - state[LEVEL]) * (square > state[LEVEL] ? attack : release);
                if (i % CONTROL_FRAMES == 0) state[COMPRESSION] = compressor_gain(state[LEVEL]);
                frame_gain *= state[COMPRESSION];
            }
            float peak = 0.0f;
            for (int c = 0; c < channels; c++) peak = fmaxf(peak, fabsf(s[c] * frame_gain));
            state[LIMITING] = peak * state[LIMITING] > LIMIT
                ? LIMIT / peak
                : state[LIMITING] + (1.0f - state[LIMITING]) * limiter_release;
            frame_gain *= state[LIMITING];
        } else {
            for (int c = 0; c < channels; c++) s[c] = frame[map[c]] / FULL_SCALE;
            state[LIMITING] = 1.0f;
        }
        if (!float_output) {
            int16_t *out = (int16_t *)out_base + output_offset + i * channels;
            for (int c = 0; c < channels; c++) out[c] = (int16_t)fmaxf(-32768.0f, fminf(32767.0f, s[c] * frame_gain * FULL_SCALE));
            continue;
        }
        float *out = (float *)out_base + output_offset + i * output_channels;
        for (int c = 0; c < output_channels; c++) out[c] = s[c] * frame_gain;
        if (channels == 7) {
            // Back centre goes to both surrounds.
            out[4] += s[6] * frame_gain * HALF_POWER;
            out[5] += s[6] * frame_gain * HALF_POWER;
        } else if (channels == 8) {
            // Back and side surrounds together.
            out[4] = (out[4] + s[6] * frame_gain) * HALF_POWER;
            out[5] = (out[5] + s[7] * frame_gain) * HALF_POWER;
        }
    }
    (*env)->SetFloatArrayRegion(env, state_array, 0, STATE_SIZE, state);
    return JNI_TRUE;
}
