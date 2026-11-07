// One frame of the upscaling network: the picture's luma, each layer from the one before, the last
// layer's four values per pixel laid out at twice the size (steepened over each source pixel's luma
// range, when the network has that), then the picture with that correction added.
// A tile whose luma barely moved since its correction was made keeps that correction, so the layers only
// run where the picture changed, and a little around it for the network's reach.

#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>
#include <android/log.h>

#define TAG "upscaler"

enum { LUMA, SHUFFLE, COMPOSE, PLAIN, CHANGE, GROW, MARK, REFRESH, RANGE, FIRST_LAYER };

#define TILE 16

typedef struct {
    GLuint texture, framebuffer;
    int width, height;
} Target;

typedef struct {
    int programs;
    GLuint *program;
    GLint *matrix;
    GLuint array;
    Target luma, features[2], correction, reference, changed, work, range;
    GLuint stencil;
    int steepen;
    // Nothing kept from an earlier frame can be reused.
    int fresh;
    GLsync fence;
} Upscaler;

static GLuint compile(GLenum type, const char *text) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &text, NULL);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[512] = "";
        glGetShaderInfoLog(shader, sizeof log, NULL, log);
        __android_log_print(ANDROID_LOG_ERROR, TAG, "shader failed: %s", log);
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

static GLuint link_program(GLuint vertex, const char *text) {
    GLuint fragment = compile(GL_FRAGMENT_SHADER, text);
    if (!fragment) return 0;
    GLuint program = glCreateProgram();
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    glDeleteShader(fragment);
    GLint ok = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &ok);
    if (!ok) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "program failed to link");
        glDeleteProgram(program);
        return 0;
    }
    return program;
}

static void free_target(Target *target) {
    if (target->texture) glDeleteTextures(1, &target->texture);
    if (target->framebuffer) glDeleteFramebuffers(1, &target->framebuffer);
    memset(target, 0, sizeof *target);
}

static int make_target(Target *target, GLenum format, int width, int height, GLint filter) {
    free_target(target);
    target->width = width;
    target->height = height;
    glGenTextures(1, &target->texture);
    glBindTexture(GL_TEXTURE_2D, target->texture);
    glTexStorage2D(GL_TEXTURE_2D, 1, format, width, height);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glGenFramebuffers(1, &target->framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, target->framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target->texture, 0);
    return glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
}

static void free_upscaler(Upscaler *upscaler) {
    for (int i = 0; i < upscaler->programs; i++) {
        if (upscaler->program[i]) glDeleteProgram(upscaler->program[i]);
    }
    if (upscaler->array) glDeleteVertexArrays(1, &upscaler->array);
    free_target(&upscaler->luma);
    free_target(&upscaler->features[0]);
    free_target(&upscaler->features[1]);
    free_target(&upscaler->correction);
    free_target(&upscaler->reference);
    free_target(&upscaler->changed);
    free_target(&upscaler->work);
    free_target(&upscaler->range);
    if (upscaler->stencil) glDeleteRenderbuffers(1, &upscaler->stencil);
    if (upscaler->fence) glDeleteSync(upscaler->fence);
    free(upscaler->program);
    free(upscaler->matrix);
    free(upscaler);
}

static void into_target(const Target *target) {
    static const GLenum color = GL_COLOR_ATTACHMENT0;
    glBindFramebuffer(GL_FRAMEBUFFER, target->framebuffer);
    glInvalidateFramebuffer(GL_FRAMEBUFFER, 1, &color);
    glViewport(0, 0, target->width, target->height);
}

/** Keeps what the target holds, for one drawn into only in part. */
static void onto_target(const Target *target) {
    glBindFramebuffer(GL_FRAMEBUFFER, target->framebuffer);
    glViewport(0, 0, target->width, target->height);
}

static void run4(Upscaler *upscaler, int program, GLuint texture0, GLuint texture1, GLuint texture2, GLuint texture3) {
    glUseProgram(upscaler->program[program]);
    const GLuint textures[] = {texture0, texture1, texture2, texture3};
    for (int i = 3; i >= 0; i--) {
        glActiveTexture(GL_TEXTURE0 + i);
        glBindTexture(GL_TEXTURE_2D, textures[i]);
    }
    glDrawArrays(GL_TRIANGLES, 0, 3);
}

static void run(Upscaler *upscaler, int program, GLuint texture0, GLuint texture1) {
    run4(upscaler, program, texture0, texture1, 0, 0);
}

JNIEXPORT jlong JNICALL
Java_io_github_viren070_aiostreams_exoplayer_video_UpscalerNative_create(
    JNIEnv *env, jclass clazz, jstring vertex_text, jobjectArray fragments, jboolean steepen) {
    Upscaler *upscaler = calloc(1, sizeof *upscaler);
    if (!upscaler) return 0;
    upscaler->steepen = steepen;
    upscaler->programs = (*env)->GetArrayLength(env, fragments);
    upscaler->program = calloc(upscaler->programs, sizeof *upscaler->program);
    upscaler->matrix = calloc(upscaler->programs, sizeof *upscaler->matrix);
    const char *text = (*env)->GetStringUTFChars(env, vertex_text, NULL);
    GLuint vertex = compile(GL_VERTEX_SHADER, text);
    (*env)->ReleaseStringUTFChars(env, vertex_text, text);
    int ok = vertex != 0;
    for (int i = 0; ok && i < upscaler->programs; i++) {
        jstring fragment = (*env)->GetObjectArrayElement(env, fragments, i);
        text = (*env)->GetStringUTFChars(env, fragment, NULL);
        GLuint program = link_program(vertex, text);
        (*env)->ReleaseStringUTFChars(env, fragment, text);
        (*env)->DeleteLocalRef(env, fragment);
        upscaler->program[i] = program;
        ok = program != 0;
        if (ok) {
            glUseProgram(program);
            glUniform1i(glGetUniformLocation(program, "t0"), 0);
            glUniform1i(glGetUniformLocation(program, "t1"), 1);
            glUniform1i(glGetUniformLocation(program, "t2"), 2);
            glUniform1i(glGetUniformLocation(program, "t3"), 3);
            upscaler->matrix[i] = glGetUniformLocation(program, "st");
        }
    }
    if (vertex) glDeleteShader(vertex);
    if (!ok) {
        free_upscaler(upscaler);
        return 0;
    }
    glGenVertexArrays(1, &upscaler->array);
    glBindVertexArray(upscaler->array);
    glDisable(GL_DITHER);
    glDisable(GL_BLEND);
    glDisable(GL_DEPTH_TEST);
    return (jlong)(intptr_t)upscaler;
}

JNIEXPORT jboolean JNICALL
Java_io_github_viren070_aiostreams_exoplayer_video_UpscalerNative_size(
    JNIEnv *env, jclass clazz, jlong handle, jint width, jint height) {
    Upscaler *upscaler = (Upscaler *)(intptr_t)handle;
    int tiles_w = (width + TILE - 1) / TILE, tiles_h = (height + TILE - 1) / TILE;
    upscaler->fresh = 1;
    // Each layer reads only the one before, so two textures take turns. Luma filters linearly for
    // SHUFFLE; the layers read it at pixel centres, which filtering leaves as they are.
    if (!(make_target(&upscaler->luma, GL_R8, width, height, GL_LINEAR)
          && make_target(&upscaler->features[0], GL_RGBA8, width, height, GL_NEAREST)
          && make_target(&upscaler->features[1], GL_RGBA8, width, height, GL_NEAREST)
          && make_target(&upscaler->range, GL_RG8, width, height, GL_NEAREST)
          && make_target(&upscaler->correction, GL_R8, width * 2, height * 2, GL_LINEAR)
          && make_target(&upscaler->reference, GL_R8, width, height, GL_NEAREST)
          && make_target(&upscaler->changed, GL_R8, tiles_w, tiles_h, GL_NEAREST)
          && make_target(&upscaler->work, GL_R8, tiles_w, tiles_h, GL_NEAREST))) return JNI_FALSE;
    // One stencil for the layer and range targets: the tiles the layers run over this frame.
    if (upscaler->stencil) glDeleteRenderbuffers(1, &upscaler->stencil);
    glGenRenderbuffers(1, &upscaler->stencil);
    glBindRenderbuffer(GL_RENDERBUFFER, upscaler->stencil);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height);
    const Target *stenciled[] = {&upscaler->features[0], &upscaler->features[1], &upscaler->range};
    for (int i = 0; i < 3; i++) {
        glBindFramebuffer(GL_FRAMEBUFFER, stenciled[i]->framebuffer);
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, upscaler->stencil);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) return JNI_FALSE;
    }
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_io_github_viren070_aiostreams_exoplayer_video_UpscalerNative_draw(
    JNIEnv *env, jclass clazz, jlong handle, jint external, jfloatArray matrix_array,
    jint width, jint height, jboolean network) {
    Upscaler *upscaler = (Upscaler *)(intptr_t)handle;
    GLfloat matrix[16];
    (*env)->GetFloatArrayRegion(env, matrix_array, 0, 16, matrix);

    // The last frame not being done as this one arrives is what too slow looks like.
    jboolean busy = JNI_FALSE;
    if (upscaler->fence) {
        busy = glClientWaitSync(upscaler->fence, 0, 0) == GL_TIMEOUT_EXPIRED;
        glDeleteSync(upscaler->fence);
        upscaler->fence = NULL;
    }

    glActiveTexture(GL_TEXTURE0);
    if (network) {
        into_target(&upscaler->luma);
        glUseProgram(upscaler->program[LUMA]);
        glUniformMatrix4fv(upscaler->matrix[LUMA], 1, GL_FALSE, matrix);
        glBindTexture(GL_TEXTURE_EXTERNAL_OES, external);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        into_target(&upscaler->changed);
        if (upscaler->fresh) {
            glClearColor(1, 1, 1, 1);
            glClear(GL_COLOR_BUFFER_BIT);
        } else {
            run(upscaler, CHANGE, upscaler->luma.texture, upscaler->reference.texture);
        }
        upscaler->fresh = 0;
        into_target(&upscaler->work);
        run(upscaler, GROW, upscaler->changed.texture, 0);

        into_target(&upscaler->features[0]);
        glClear(GL_STENCIL_BUFFER_BIT);
        glEnable(GL_STENCIL_TEST);
        glStencilFunc(GL_ALWAYS, 1, 0xff);
        glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
        glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
        run(upscaler, MARK, upscaler->work.texture, 0);
        glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glStencilFunc(GL_EQUAL, 1, 0xff);
        glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);

        GLuint from = upscaler->luma.texture;
        int layers = upscaler->programs - FIRST_LAYER;
        for (int i = 0; i < layers; i++) {
            const Target *target = &upscaler->features[i & 1];
            into_target(target);
            glUseProgram(upscaler->program[FIRST_LAYER + i]);
            glBindTexture(GL_TEXTURE_2D, from);
            glDrawArrays(GL_TRIANGLES, 0, 3);
            from = target->texture;
        }
        if (upscaler->steepen) {
            into_target(&upscaler->range);
            run(upscaler, RANGE, upscaler->luma.texture, 0);
        }
        glDisable(GL_STENCIL_TEST);

        onto_target(&upscaler->correction);
        run4(upscaler, SHUFFLE, from, upscaler->changed.texture, upscaler->luma.texture, upscaler->range.texture);
        onto_target(&upscaler->reference);
        run(upscaler, REFRESH, upscaler->luma.texture, upscaler->changed.texture);
    } else {
        upscaler->fresh = 1;
    }

    static const GLenum window = GL_COLOR;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glInvalidateFramebuffer(GL_FRAMEBUFFER, 1, &window);
    glViewport(0, 0, width, height);
    int last = network ? COMPOSE : PLAIN;
    glUseProgram(upscaler->program[last]);
    glUniformMatrix4fv(upscaler->matrix[last], 1, GL_FALSE, matrix);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_EXTERNAL_OES, external);
    if (network) {
        glActiveTexture(GL_TEXTURE1);
        glBindTexture(GL_TEXTURE_2D, upscaler->correction.texture);
    }
    glDrawArrays(GL_TRIANGLES, 0, 3);
    upscaler->fence = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
    return busy;
}

JNIEXPORT void JNICALL
Java_io_github_viren070_aiostreams_exoplayer_video_UpscalerNative_release(
    JNIEnv *env, jclass clazz, jlong handle) {
    free_upscaler((Upscaler *)(intptr_t)handle);
}
