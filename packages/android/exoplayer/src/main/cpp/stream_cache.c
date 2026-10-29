#include <jni.h>
#include <stdlib.h>

#define METHOD(name) Java_io_github_viren070_aiostreams_exoplayer_cache_BlockMemory_##name

JNIEXPORT jobject JNICALL METHOD(allocate)(JNIEnv *env, jclass clazz, jint size) {
    void *block = malloc((size_t) size);
    if (!block) return NULL;
    return (*env)->NewDirectByteBuffer(env, block, size);
}

JNIEXPORT void JNICALL METHOD(free)(JNIEnv *env, jclass clazz, jobject buffer) {
    free((*env)->GetDirectBufferAddress(env, buffer));
}

