#include <jni.h>
#include <math.h>
#include <stdint.h>
#include <string.h>

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
#define MAX_CHANNELS 8

enum { LEVEL, COMPRESSION, LIMITING, STATE_SIZE };

enum { L, R, C, LFE, LS, RS, BC };

// What each channel of Android's layouts is, by channel count.
static const int ROLES[MAX_CHANNELS + 1][MAX_CHANNELS] = {
    [3] = {L, R, C},
    [4] = {L, R, LS, RS},
    [5] = {L, R, C, LS, RS},
    [6] = {L, R, C, LFE, LS, RS},
    [7] = {L, R, C, LFE, LS, RS, BC},
    [8] = {L, R, C, LFE, LS, RS, LS, RS},
};

static float coefficient(float ms, int rate) {
    return 1.0f - expf(-1000.0f / (ms * (float)rate));
}

static float compressor_gain(float mean_square) {
    float over = 10.0f * log10f(fmaxf(mean_square, 1e-10f)) - THRESHOLD_DB;
    return powf(10.0f, (MAKEUP_DB - fmaxf(over, 0.0f) * (1.0f - 1.0f / RATIO)) / 20.0f);
}

// Stereo, or 5.1 from 6.1 and 7.1, at equal power and without the LFE in stereo.
static int mix_matrix(int channels, int outputs, float matrix[][MAX_CHANNELS]) {
    if (outputs != 2 && outputs != 6) return 0;
    memset(matrix, 0, sizeof(float) * MAX_CHANNELS * MAX_CHANNELS);
    const int five = outputs == 6;
    int surrounds = 0;
    for (int c = 0; c < channels; c++) surrounds += ROLES[channels][c] == LS;
    const float surround = five && surrounds == 1 ? 1.0f : HALF_POWER;
    for (int c = 0; c < channels; c++) {
        switch (ROLES[channels][c]) {
            case L: matrix[0][c] = 1.0f; break;
            case R: matrix[1][c] = 1.0f; break;
            case C:
                if (five) matrix[2][c] = 1.0f;
                else matrix[0][c] = matrix[1][c] = HALF_POWER;
                break;
            case LFE: if (five) matrix[3][c] = 1.0f; break;
            case LS: matrix[five ? 4 : 0][c] = surround; break;
            case RS: matrix[five ? 5 : 1][c] = surround; break;
            case BC:
                matrix[five ? 4 : 0][c] = five ? HALF_POWER : 0.5f;
                matrix[five ? 5 : 1][c] = five ? HALF_POWER : 0.5f;
                break;
        }
    }
    return 1;
}

JNIEXPORT jboolean JNICALL Java_io_github_viren070_aiostreams_exoplayer_SoundShaper_nativeShape(
        JNIEnv *env, jclass cls, jobject input, jint input_offset, jint frames, jint input_channels, jintArray map_array,
        jint rate, jobject output, jint output_offset, jint outputs, jboolean float_output, jfloat centre,
        jboolean night, jfloat gain, jfloatArray state_array) {
    const uint8_t *in_base = (*env)->GetDirectBufferAddress(env, input);
    uint8_t *out_base = (*env)->GetDirectBufferAddress(env, output);
    jsize channels = (*env)->GetArrayLength(env, map_array);
    if (!in_base || !out_base || channels < 1 || channels > MAX_CHANNELS || outputs > channels) return JNI_FALSE;
    float matrix[MAX_CHANNELS][MAX_CHANNELS];
    const int mixing = outputs < channels;
    if (mixing && !mix_matrix(channels, outputs, matrix)) return JNI_FALSE;
    const int16_t *in = (const int16_t *)(in_base + input_offset);
    jint map[MAX_CHANNELS];
    float state[STATE_SIZE];
    (*env)->GetIntArrayRegion(env, map_array, 0, channels, map);
    (*env)->GetFloatArrayRegion(env, state_array, 0, STATE_SIZE, state);
    const float attack = coefficient(5.0f, rate), release = coefficient(300.0f, rate);
    const float limiter_release = coefficient(100.0f, rate);
    // Mixing adds channels together, so the limiter catches it too.
    const int limiting = mixing || centre != 1.0f || night || gain != 1.0f;
    float s[MAX_CHANNELS], mixed[MAX_CHANNELS];
    for (int i = 0; i < frames; i++) {
        const int16_t *frame = in + i * input_channels;
        float sum = 0.0f;
        for (int c = 0; c < channels; c++) {
            s[c] = frame[map[c]] / FULL_SCALE * (c == CENTRE ? centre : 1.0f);
            sum += s[c] * s[c];
        }
        const float *o = s;
        if (mixing) {
            for (int k = 0; k < outputs; k++) {
                float v = 0.0f;
                for (int c = 0; c < channels; c++) v += matrix[k][c] * s[c];
                mixed[k] = v;
            }
            o = mixed;
        }
        float frame_gain = 1.0f;
        if (limiting) {
            frame_gain = gain;
            if (night) {
                float square = sum / channels;
                state[LEVEL] += (square - state[LEVEL]) * (square > state[LEVEL] ? attack : release);
                if (i % CONTROL_FRAMES == 0) state[COMPRESSION] = compressor_gain(state[LEVEL]);
                frame_gain *= state[COMPRESSION];
            }
            float peak = 0.0f;
            for (int k = 0; k < outputs; k++) peak = fmaxf(peak, fabsf(o[k] * frame_gain));
            state[LIMITING] = peak * state[LIMITING] > LIMIT
                ? LIMIT / peak
                : state[LIMITING] + (1.0f - state[LIMITING]) * limiter_release;
            frame_gain *= state[LIMITING];
        } else {
            state[LIMITING] = 1.0f;
        }
        if (float_output) {
            float *out = (float *)out_base + output_offset + i * outputs;
            for (int k = 0; k < outputs; k++) out[k] = o[k] * frame_gain;
        } else {
            int16_t *out = (int16_t *)out_base + output_offset + i * outputs;
            for (int k = 0; k < outputs; k++) out[k] = (int16_t)fmaxf(-32768.0f, fminf(32767.0f, o[k] * frame_gain * FULL_SCALE));
        }
    }
    (*env)->SetFloatArrayRegion(env, state_array, 0, STATE_SIZE, state);
    return JNI_TRUE;
}
