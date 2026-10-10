#include <dlfcn.h>
#include <jni.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

typedef struct DoviRpu DoviRpu;
typedef struct {
    const uint8_t *data;
    size_t len;
} DoviData;

static struct {
    DoviRpu *(*parse_unspec62_nalu)(const uint8_t *, size_t);
    int32_t (*convert_rpu_with_mode)(DoviRpu *, uint8_t);
    const DoviData *(*write_unspec62_nalu)(DoviRpu *);
    void (*data_free)(const DoviData *);
    void (*rpu_free)(DoviRpu *);
} dovi;

// Profile 8.1 with the mapping curves made no-ops, for a base layer that plays without its enhancement layer.
#define MODE_TO_81 2
#define RPU 62
#define ENHANCEMENT_LAYER 63

JNIEXPORT jboolean JNICALL
Java_io_github_viren070_aiostreams_exoplayer_DolbyVisionNative_nativeLoadLibdovi(JNIEnv *env, jclass cls) {
    void *lib = dlopen("libdovi.so", RTLD_NOW);
    if (!lib) return JNI_FALSE;
#define RESOLVE(name) if (!(dovi.name = (__typeof__(dovi.name))dlsym(lib, "dovi_" #name))) return JNI_FALSE;
    RESOLVE(parse_unspec62_nalu) RESOLVE(convert_rpu_with_mode) RESOLVE(write_unspec62_nalu)
    RESOLVE(data_free) RESOLVE(rpu_free)
#undef RESOLVE
    return JNI_TRUE;
}

// Where the next start code from `from` begins, a fourth leading zero included, or `end`.
static const uint8_t *next_unit(const uint8_t *from, const uint8_t *end) {
    const uint8_t *p = from;
    while (end - p >= 3) {
        const uint8_t *one = memchr(p + 2, 1, (size_t)(end - p - 2));
        if (!one) break;
        if (!one[-1] && !one[-2]) {
            const uint8_t *unit = one - 2;
            return unit > from && !unit[-1] ? unit - 1 : unit;
        }
        p = one - 1;
    }
    return end;
}

static void put(uint8_t **out, const uint8_t *data, size_t length) {
    if (*out != data) memmove(*out, data, length);
    *out += length;
}

// The last RPU converted on this thread and what it became, as frames often repeat one.
static _Thread_local struct {
    size_t in_length, out_length;
    uint8_t in[2048], out[2048];
} last;

// The RPU unit at `unit` as profile 8.1 at `*out`, or left out if libdovi rejects it or it would outgrow the unit.
static int put_rpu_81(uint8_t **out, const uint8_t *unit, const uint8_t *header, const uint8_t *next) {
    const uint8_t *end = next;
    // Zeros before the next start code belong to the byte stream, not the unit.
    while (end > header && !end[-1]) end--;
    size_t length = (size_t)(end - header);
    const DoviData *data = NULL;
    const uint8_t *rpu_81 = last.out;
    size_t length_81 = last.out_length;
    if (length != last.in_length || memcmp(header, last.in, length)) {
        DoviRpu *rpu = dovi.parse_unspec62_nalu(header, length);
        if (!rpu) return 0;
        if (dovi.convert_rpu_with_mode(rpu, MODE_TO_81) == 0) data = dovi.write_unspec62_nalu(rpu);
        dovi.rpu_free(rpu);
        rpu_81 = data ? data->data : NULL;
        length_81 = data ? data->len : 0;
        last.in_length = 0;
        if (length <= sizeof last.in && length_81 <= sizeof last.out) {
            memcpy(last.in, header, length);
            if (length_81) memcpy(last.out, rpu_81, length_81);
            last.in_length = length;
            last.out_length = length_81;
        }
    }
    int put_it = length_81 && (size_t)(next - *out) >= (size_t)(header - unit) + length_81;
    if (put_it) {
        put(out, unit, (size_t)(header - unit));
        put(out, rpu_81, length_81);
    }
    if (data) dovi.data_free(data);
    return put_it;
}

JNIEXPORT jlong JNICALL
Java_io_github_viren070_aiostreams_exoplayer_DolbyVisionNative_nativeRewrite(
    JNIEnv *env, jclass cls, jbyteArray sample, jint from, jint length, jboolean convert) {
    uint8_t *start = (*env)->GetPrimitiveArrayCritical(env, sample, NULL);
    if (!start) return length;
    start += from;
    convert = convert && dovi.rpu_free;
    const uint8_t *end = start + length;
    uint8_t *o = start;
    jlong converted = 0;
    const uint8_t *unit = next_unit(start, end);
    put(&o, start, (size_t)(unit - start));
    while (unit < end) {
        const uint8_t *header = unit + (unit[2] == 1 ? 3 : 4);
        const uint8_t *next = header < end ? next_unit(header, end) : end;
        int type = header < end ? *header >> 1 & 0x3F : -1;
        if (type == RPU && convert) {
            converted += put_rpu_81(&o, unit, header, next);
        } else if (type != RPU && type != ENHANCEMENT_LAYER) {
            put(&o, unit, (size_t)(next - unit));
        }
        unit = next;
    }
    (*env)->ReleasePrimitiveArrayCritical(env, sample, start - from, 0);
    return converted << 32 | (jlong)(o - start);
}
