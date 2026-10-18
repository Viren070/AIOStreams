#include <jni.h>
#include <stdlib.h>

#define METHOD(name) Java_io_github_viren070_aiostreams_exoplayer_StreamCache_##name

JNIEXPORT jobject JNICALL METHOD(nativeAllocate)(JNIEnv *env, jclass clazz, jint size) {
    void *block = malloc((size_t) size);
    if (!block) return NULL;
    return (*env)->NewDirectByteBuffer(env, block, size);
}

JNIEXPORT void JNICALL METHOD(nativeFree)(JNIEnv *env, jclass clazz, jobject buffer) {
    free((*env)->GetDirectBufferAddress(env, buffer));
}

