// libass, owned by one thread, which renders moments ahead of the video into
// a queue: each moment's images become a picture of masks copied into a store,
// as libass keeps them only until it renders again. Another thread takes the
// moment each video frame shows and draws it into a surface of its own, which
// the compositor lays over the video as a single layer: blended on the CPU into
// one premultiplied picture, or by the GPU from the masks. It draws through GL,
// so each buffer carries the time its video frame shows at, as MediaCodec gives
// the video's; without GL, the window's buffers are drawn directly.

#include <dlfcn.h>
#include <errno.h>
#include <jni.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include "../ass/ass.h"
#include "blend.h"
#include "gl.h"
#include "gl_masks.h"
#include "masks.h"

// The libs AAR's libass.so.
#define LIBASS(X) \
    X(library_init) X(library_done) X(set_message_cb) X(set_extract_fonts) X(add_font) X(clear_fonts) \
    X(renderer_init) X(renderer_done) X(set_fonts) X(set_frame_size) X(set_storage_size) X(set_margins) \
    X(set_use_margins) X(set_font_scale) X(set_line_position) X(new_track) X(free_track) \
    X(process_codec_private) X(process_chunk) X(read_memory) X(render_frame) \
    X(set_selective_style_override_enabled) X(set_selective_style_override) X(set_cache_limits) X(flush_events)

static struct {
#define MEMBER(name) __typeof__(ass_##name) *name;
    LIBASS(MEMBER)
#undef MEMBER
} libass;

static int load_libass(void) {
    if (libass.render_frame) return 1;
    void *lib = dlopen("libass.so", RTLD_NOW);
    if (!lib) return 0;
#define RESOLVE(name) if (!(libass.name = dlsym(lib, "ass_" #name))) return 0;
    LIBASS(RESOLVE)
#undef RESOLVE
    return 1;
}

typedef struct {
    long long time_ms;
    Picture *picture;
} Moment;

#define QUEUE_SIZE 128

typedef struct {
    // The rendering thread's.
    ASS_Library *library;
    ASS_Renderer *renderer;
    char *bundled;
    char *font;
    int width;
    int height;
    int cache_mb;
    Picture *last;  // what it rendered last, which an unchanged moment shares

    // The showing thread's.
    ANativeWindow *window;
    int window_width;
    int window_height;
    Picture *shown;
    int gpu;        // draws with GlMasks rather than blending on the CPU
    // What the picture holds images on, which the next one has to clear.
    ARect drawn;
    ANativeWindow_Buffer buffer;
    int pending;  // drawn, not yet posted
    // With GL: the rectangle the picture's images cover, blended into `scratch` and drawn from a
    // texture that grows to the largest yet; or the masks, drawn by `masks_gl`.
    EGLDisplay display;
    EGLContext context;
    EGLSurface surface;
    PFNEGLPRESENTATIONTIMEANDROIDPROC presentation_time;
    GLuint program;
    GLint extent;
    GLuint texture;
    int texture_width;
    int texture_height;
    uint32_t *scratch;
    size_t scratch_pixels;
    GlMasks *masks_gl;

    MaskStore *masks;

    // Shared, under the lock: the moments rendered ahead, oldest first.
    pthread_mutex_t lock;
    pthread_cond_t queued;
    Moment queue[QUEUE_SIZE];
    int first;
    int count;
} Surface;

// Under the lock.
static void release(Surface *surface, Picture *picture) {
    if (!picture || --picture->refs) return;
    masks_release(surface->masks, picture);
}

// Under the lock: drops the queued moments from `time_ms` on.
static void drop_from(Surface *surface, long long time_ms) {
    while (surface->count) {
        Moment *last = &surface->queue[(surface->first + surface->count - 1) % QUEUE_SIZE];
        if (last->time_ms < time_ms) break;
        release(surface, last->picture);
        surface->count--;
    }
}

static void message(int level, const char *format, va_list args, void *data) {
    if (level <= 1) __android_log_vprint(ANDROID_LOG_WARN, "libass", format, args);
}

static int empty(const ARect *rect) { return rect->right <= rect->left || rect->bottom <= rect->top; }

static void include(ARect *rect, int left, int top, int right, int bottom) {
    if (empty(rect)) {
        *rect = (ARect) {left, top, right, bottom};
        return;
    }
    if (left < rect->left) rect->left = left;
    if (top < rect->top) rect->top = top;
    if (right > rect->right) rect->right = right;
    if (bottom > rect->bottom) rect->bottom = bottom;
}

#define METHOD(name) Java_io_github_viren070_aiostreams_exoplayer_subtitles_ass_AssNative_##name

static void start_renderer(Surface *surface) {
    surface->renderer = libass.renderer_init(surface->library);
    if (surface->cache_mb) libass.set_cache_limits(surface->renderer, 0, surface->cache_mb);
    libass.set_fonts(surface->renderer, surface->font, "sans-serif", ASS_FONTPROVIDER_AUTODETECT, NULL, 1);
    if (surface->width) libass.set_frame_size(surface->renderer, surface->width, surface->height);
}

// Zero when libass can't be loaded. `font` is drawn where a script's fonts are missing, as mpv does.
JNIEXPORT jlong JNICALL METHOD(create)(JNIEnv *env, jclass clazz, jstring font) {
    if (!load_libass()) return 0;
    Surface *surface = calloc(1, sizeof(Surface));
    surface->masks = masks_new();
    pthread_mutex_init(&surface->lock, NULL);
    pthread_cond_init(&surface->queued, NULL);
    surface->library = libass.library_init();
    libass.set_message_cb(surface->library, message, NULL);
    libass.set_extract_fonts(surface->library, 1);
    const char *path = (*env)->GetStringUTFChars(env, font, NULL);
    surface->bundled = strdup(path);
    surface->font = strdup(path);
    (*env)->ReleaseStringUTFChars(env, font, path);
    start_renderer(surface);
    return (jlong) surface;
}

JNIEXPORT void JNICALL METHOD(addFont)(JNIEnv *env, jclass clazz, jlong handle, jstring name, jbyteArray data) {
    Surface *surface = (Surface *) handle;
    const char *chars = (*env)->GetStringUTFChars(env, name, NULL);
    jbyte *bytes = (*env)->GetByteArrayElements(env, data, NULL);
    libass.add_font(surface->library, chars, (const char *) bytes, (*env)->GetArrayLength(env, data));
    (*env)->ReleaseByteArrayElements(env, data, bytes, JNI_ABORT);
    (*env)->ReleaseStringUTFChars(env, name, chars);
}

// libass frees a library's fonts safely only once no renderer uses them, so the renderer starts over.
JNIEXPORT void JNICALL METHOD(clearFonts)(JNIEnv *env, jclass clazz, jlong handle) {
    Surface *surface = (Surface *) handle;
    libass.renderer_done(surface->renderer);
    libass.clear_fonts(surface->library);
    start_renderer(surface);
}

// libass keeps the font it picked for each name, so fonts added later need a new renderer.
JNIEXPORT void JNICALL METHOD(reloadFonts)(JNIEnv *env, jclass clazz, jlong handle) {
    Surface *surface = (Surface *) handle;
    libass.renderer_done(surface->renderer);
    start_renderer(surface);
}

// A track of the file's, from its header; Matroska sends its lines one by one.
JNIEXPORT jlong JNICALL METHOD(newTrack)(JNIEnv *env, jclass clazz, jlong handle, jbyteArray header) {
    ASS_Track *track = libass.new_track(((Surface *) handle)->library);
    jsize size = (*env)->GetArrayLength(env, header);
    jbyte *bytes = (*env)->GetByteArrayElements(env, header, NULL);
    // Some muxers end the header with a NUL.
    while (size > 0 && bytes[size - 1] == 0) size--;
    libass.process_codec_private(track, (char *) bytes, size);
    (*env)->ReleaseByteArrayElements(env, header, bytes, JNI_ABORT);
    return (jlong) track;
}

// A whole script, as a file added from outside holds it.
JNIEXPORT jlong JNICALL METHOD(readScript)(JNIEnv *env, jclass clazz, jlong handle, jbyteArray script) {
    jsize size = (*env)->GetArrayLength(env, script);
    char *copy = malloc(size + 1);
    (*env)->GetByteArrayRegion(env, script, 0, size, (jbyte *) copy);
    copy[size] = 0;
    ASS_Track *track = libass.read_memory(((Surface *) handle)->library, copy, size, NULL);
    free(copy);
    return (jlong) track;
}

JNIEXPORT void JNICALL METHOD(addLine)(
        JNIEnv *env, jclass clazz, jlong track, jbyteArray line, jlong startMs, jlong durationMs) {
    jsize size = (*env)->GetArrayLength(env, line);
    void *bytes = (*env)->GetPrimitiveArrayCritical(env, line, NULL);
    libass.process_chunk((ASS_Track *) track, bytes, size, startMs, durationMs);
    (*env)->ReleasePrimitiveArrayCritical(env, line, bytes, JNI_ABORT);
}

JNIEXPORT void JNICALL METHOD(freeTrack)(JNIEnv *env, jclass clazz, jlong track) {
    libass.free_track((ASS_Track *) track);
}

JNIEXPORT void JNICALL METHOD(flushTrack)(JNIEnv *env, jclass clazz, jlong track) {
    libass.flush_events((ASS_Track *) track);
}

JNIEXPORT void JNICALL METHOD(setCacheLimit)(JNIEnv *env, jclass clazz, jlong handle, jint mb) {
    Surface *surface = (Surface *) handle;
    surface->cache_mb = mb;
    libass.set_cache_limits(surface->renderer, 0, mb);
}

// The texture's `extent` over the viewport, texel for pixel: highp reaches every texel.
static const char *VERTEX =
    "attribute vec2 corner;\n"
    "uniform vec2 extent;\n"
    "varying vec2 at;\n"
    "void main() {\n"
    "    at = vec2(corner.x + 1.0, 1.0 - corner.y) * 0.5 * extent;\n"
    "    gl_Position = vec4(corner, 0.0, 1.0);\n"
    "}\n";
static const char *FRAGMENT =
    "#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
    "precision highp float;\n"
    "#else\n"
    "precision mediump float;\n"
    "#endif\n"
    "varying vec2 at;\n"
    "uniform sampler2D picture;\n"
    "void main() {\n"
    "    gl_FragColor = texture2D(picture, at);\n"
    "}\n";

static void stop_gl(Surface *surface) {
    if (surface->display == EGL_NO_DISPLAY) return;
    if (surface->context != EGL_NO_CONTEXT && eglGetCurrentContext() == surface->context) {
        gl_masks_free(surface->masks_gl);
        glDeleteTextures(1, &surface->texture);
        glDeleteProgram(surface->program);
    }
    eglMakeCurrent(surface->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (surface->surface != EGL_NO_SURFACE) eglDestroySurface(surface->display, surface->surface);
    if (surface->context != EGL_NO_CONTEXT) eglDestroyContext(surface->display, surface->context);
    // The display stays initialised, as the app's own drawing uses it.
    surface->display = EGL_NO_DISPLAY;
    surface->surface = EGL_NO_SURFACE;
    surface->context = EGL_NO_CONTEXT;
    surface->presentation_time = NULL;
    surface->masks_gl = NULL;
    surface->program = surface->texture = 0;
    surface->texture_width = surface->texture_height = 0;
    free(surface->scratch);
    surface->scratch = NULL;
    surface->scratch_pixels = 0;
}

static int start_gl(Surface *surface, int width, int height) {
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, NULL, NULL)) return 0;
    surface->display = display;
    const EGLint attributes[] = {
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE,
    };
    const EGLint version[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    EGLConfig config;
    EGLint configs = 0;
    if (!eglChooseConfig(display, attributes, &config, 1, &configs) || configs < 1) return stop_gl(surface), 0;
    surface->context = eglCreateContext(display, config, EGL_NO_CONTEXT, version);
    if (surface->context == EGL_NO_CONTEXT) return stop_gl(surface), 0;
    ANativeWindow_setBuffersGeometry(surface->window, width, height, WINDOW_FORMAT_RGBA_8888);
    surface->surface = eglCreateWindowSurface(display, config, surface->window, NULL);
    if (surface->surface == EGL_NO_SURFACE ||
        !eglMakeCurrent(display, surface->surface, surface->surface, surface->context)) {
        return stop_gl(surface), 0;
    }
    const char *extensions = eglQueryString(display, EGL_EXTENSIONS);
    if (extensions && strstr(extensions, "EGL_ANDROID_presentation_time")) {
        surface->presentation_time = (PFNEGLPRESENTATIONTIMEANDROIDPROC) eglGetProcAddress("eglPresentationTimeANDROID");
    }

    static const char *const corner[] = {"corner"};
    surface->program = gl_program(VERTEX, FRAGMENT, corner, 1);
    if (!surface->program) return stop_gl(surface), 0;
    surface->extent = glGetUniformLocation(surface->program, "extent");
    surface->texture = gl_texture(GL_RGBA, 0, 0);
    glDisable(GL_DITHER);
    if (glGetError() != GL_NO_ERROR) return stop_gl(surface), 0;
    return 1;
}

// The showing thread's window, drawn through GL when it can be.
JNIEXPORT void JNICALL METHOD(setWindow)(
        JNIEnv *env, jclass clazz, jlong handle, jobject view, jint width, jint height) {
    Surface *surface = (Surface *) handle;
    stop_gl(surface);
    if (surface->window) ANativeWindow_release(surface->window);
    surface->window = view ? ANativeWindow_fromSurface(env, view) : NULL;
    surface->drawn = (ARect) {0, 0, 0, 0};
    surface->pending = 0;
    if (!surface->window) return;
    surface->window_width = width;
    surface->window_height = height;
    if (start_gl(surface, width, height)) return;
    __android_log_print(ANDROID_LOG_WARN, "libass", "drawing subtitles without GL");
    ANativeWindow_setBuffersGeometry(surface->window, width, height, WINDOW_FORMAT_RGBA_8888);
}

// The showing thread's: whether the GPU draws the masks, where there's GL.
JNIEXPORT void JNICALL METHOD(setGpu)(JNIEnv *env, jclass clazz, jlong handle, jboolean on) {
    Surface *surface = (Surface *) handle;
    surface->gpu = on;
    if (on) return;
    gl_masks_free(surface->masks_gl);
    surface->masks_gl = NULL;
}

// Whether a posted picture carries the time its video frame shows at.
JNIEXPORT jboolean JNICALL METHOD(stamped)(JNIEnv *env, jclass clazz, jlong handle) {
    return ((Surface *) handle)->presentation_time != NULL;
}

// The size the rendering thread renders at.
JNIEXPORT void JNICALL METHOD(setFrameSize)(JNIEnv *env, jclass clazz, jlong handle, jint width, jint height) {
    Surface *surface = (Surface *) handle;
    surface->width = width;
    surface->height = height;
    libass.set_frame_size(surface->renderer, width, height);
}

// The video's place in the frame: margins are negative where it is cropped.
JNIEXPORT void JNICALL METHOD(setLayout)(
        JNIEnv *env, jclass clazz, jlong handle, jint videoWidth, jint videoHeight,
        jint top, jint bottom, jint left, jint right, jboolean useMargins,
        jfloat fontScale, jdouble linePosition) {
    ASS_Renderer *renderer = ((Surface *) handle)->renderer;
    libass.set_storage_size(renderer, videoWidth, videoHeight);
    libass.set_margins(renderer, top, bottom, left, right);
    libass.set_use_margins(renderer, useMargins);
    libass.set_font_scale(renderer, fontScale);
    libass.set_line_position(renderer, linePosition);
}

static void use_font(Surface *surface, const char *path) {
    if (!strcmp(path, surface->font)) return;
    free(surface->font);
    surface->font = strdup(path);
    libass.set_fonts(surface->renderer, surface->font, "sans-serif", ASS_FONTPROVIDER_AUTODETECT, NULL, 1);
}

// `override` is AssStyle's NONE, SCALE or FORCE.
JNIEXPORT void JNICALL METHOD(setStyle)(
        JNIEnv *env, jclass clazz, jlong handle, jint override, jint color, jint outlineColor,
        jint backColor, jdouble outlineSize, jint borderStyle, jboolean bold, jdouble shadowSize, jstring fontFile) {
    Surface *surface = (Surface *) handle;
    ASS_Renderer *renderer = surface->renderer;
    if (fontFile) {
        const char *path = (*env)->GetStringUTFChars(env, fontFile, NULL);
        use_font(surface, path);
        (*env)->ReleaseStringUTFChars(env, fontFile, path);
    } else {
        use_font(surface, surface->bundled);
    }
    int flags = override ? ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE : 0;
    if (override == 2) {
        flags |= ASS_OVERRIDE_BIT_FONT_NAME | ASS_OVERRIDE_BIT_FONT_SIZE_FIELDS | ASS_OVERRIDE_BIT_COLORS |
                 ASS_OVERRIDE_BIT_BORDER | ASS_OVERRIDE_BIT_BLUR;
    }
    libass.set_selective_style_override_enabled(renderer, flags);
    // mpv's defaults, in its 720-line units, scaled to the 288 lines the style is set at.
    double scale = 288 / 720.0;
    ASS_Style style = {
        .FontName = "sans-serif",
        .FontSize = 38 * scale,
        .PrimaryColour = color,
        .SecondaryColour = color,
        .OutlineColour = outlineColor,
        .BackColour = backColor,
        .Bold = bold,
        .ScaleX = 1,
        .ScaleY = 1,
        .BorderStyle = borderStyle,
        .Outline = outlineSize * scale,
        .Shadow = shadowSize * scale,
        .Alignment = 2,
        .MarginL = 19 * scale,
        .MarginR = 19 * scale,
        .MarginV = 34 * scale,
    };
    libass.set_selective_style_override(renderer, &style);
}

// Renders the track at `timeMs` onto the end of the queue, which is to have room.
JNIEXPORT void JNICALL METHOD(queue)(JNIEnv *env, jclass clazz, jlong handle, jlong track, jlong timeMs) {
    Surface *surface = (Surface *) handle;
    int changed = 1;
    ASS_Image *images = track ? libass.render_frame(surface->renderer, (ASS_Track *) track, timeMs, &changed) : NULL;
    Picture *picture = NULL;
    if (changed || !surface->last) {
        picture = masks_picture(surface->masks, images);
        if (!picture) return;
    }
    pthread_mutex_lock(&surface->lock);
    if (picture) {
        release(surface, surface->last);
        surface->last = picture;
    }
    surface->last->refs++;
    drop_from(surface, timeMs);
    surface->queue[(surface->first + surface->count++) % QUEUE_SIZE] = (Moment) {timeMs, surface->last};
    pthread_cond_broadcast(&surface->queued);
    pthread_mutex_unlock(&surface->lock);
}

// Whether the queue holds fewer moments and pictures than these.
JNIEXPORT jboolean JNICALL METHOD(room)(JNIEnv *env, jclass clazz, jlong handle, jint moments, jlong bytes) {
    Surface *surface = (Surface *) handle;
    pthread_mutex_lock(&surface->lock);
    int room = surface->count < moments && surface->count < QUEUE_SIZE;
    pthread_mutex_unlock(&surface->lock);
    return room && masks_bytes(surface->masks) < (size_t) bytes;
}

// Drops the queued moments from `timeMs` on, whose subtitles changed.
JNIEXPORT void JNICALL METHOD(dropFrom)(JNIEnv *env, jclass clazz, jlong handle, jlong timeMs) {
    Surface *surface = (Surface *) handle;
    pthread_mutex_lock(&surface->lock);
    drop_from(surface, timeMs);
    pthread_mutex_unlock(&surface->lock);
}

// Takes the queued moment for `timeMs` to show, dropping those before it: -1 when it isn't
// queued, 1 when it differs from what shows, 0 when it doesn't. With `waitMs`, waits that long
// for the moment to be queued.
JNIEXPORT jint JNICALL METHOD(take)(JNIEnv *env, jclass clazz, jlong handle, jlong timeMs, jint waitMs) {
    Surface *surface = (Surface *) handle;
    struct timespec until;
    clock_gettime(CLOCK_REALTIME, &until);
    until.tv_nsec += (long) waitMs * 1000000;
    until.tv_sec += until.tv_nsec / 1000000000;
    until.tv_nsec %= 1000000000;
    pthread_mutex_lock(&surface->lock);
    int taken = -1;
    for (;;) {
        while (surface->count && surface->queue[surface->first].time_ms < timeMs) {
            release(surface, surface->queue[surface->first].picture);
            surface->first = (surface->first + 1) % QUEUE_SIZE;
            surface->count--;
        }
        if (surface->count && surface->queue[surface->first].time_ms == timeMs) {
            Picture *picture = surface->queue[surface->first].picture;
            surface->first = (surface->first + 1) % QUEUE_SIZE;
            surface->count--;
            taken = picture != surface->shown;
            release(surface, surface->shown);
            surface->shown = picture;
            break;
        }
        // Later moments queued before an earlier one was asked for go once it comes.
        if (!waitMs || pthread_cond_timedwait(&surface->queued, &surface->lock, &until) == ETIMEDOUT) break;
    }
    pthread_mutex_unlock(&surface->lock);
    return taken;
}

// Whether a mask is drawn: libass places them within the frame, which is the window's size but for a moment
// after it changes.
static int drawn_mask(const Surface *surface, const Placed *placed) {
    return placed->x + placed->mask->w <= surface->window_width && placed->y + placed->mask->h <= surface->window_height;
}

// Blends the picture's masks into the rectangle they cover, which a texture brings to the window.
static void draw_blended(Surface *surface, const Picture *picture, ARect next) {
    glViewport(0, 0, surface->window_width, surface->window_height);
    // A clear costs a tiled GPU nothing.
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    if (empty(&next)) return;
    int width = next.right - next.left, height = next.bottom - next.top;
    size_t pixels = (size_t) width * height;
    if (pixels > surface->scratch_pixels) {
        uint32_t *scratch = realloc(surface->scratch, pixels * 4);
        if (!scratch) return;
        surface->scratch = scratch;
        surface->scratch_pixels = pixels;
    }
    memset(surface->scratch, 0, pixels * 4);
    for (int i = 0; i < picture->count; i++) {
        if (drawn_mask(surface, &picture->placed[i])) blend(&picture->placed[i], surface->scratch, width, next.left, next.top);
    }
    static const GLfloat corners[] = {-1, -1, 1, -1, -1, 1, 1, 1};
    glUseProgram(surface->program);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, corners);
    glEnableVertexAttribArray(0);
    glDisableVertexAttribArray(1);
    glDisableVertexAttribArray(2);
    glDisable(GL_BLEND);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    glBindTexture(GL_TEXTURE_2D, surface->texture);
    if (width > surface->texture_width || height > surface->texture_height) {
        if (width > surface->texture_width) surface->texture_width = width;
        if (height > surface->texture_height) surface->texture_height = height;
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, surface->texture_width, surface->texture_height, 0, GL_RGBA,
                     GL_UNSIGNED_BYTE, NULL);
    }
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, surface->scratch);
    glUniform2f(surface->extent, (float) width / surface->texture_width, (float) height / surface->texture_height);
    // GL counts rows from the bottom.
    glViewport(next.left, surface->window_height - next.bottom, width, height);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

// Without GL: blends into the window's next buffer, clearing only what changed.
static int draw_window(Surface *surface, const Picture *picture, ARect next) {
    ARect dirty = surface->drawn;
    if (!empty(&next)) include(&dirty, next.left, next.top, next.right, next.bottom);
    // The window copies the rest from the buffer before, and may widen the rectangle.
    if (ANativeWindow_lock(surface->window, &surface->buffer, &dirty) != 0) return 0;
    ANativeWindow_Buffer *buffer = &surface->buffer;
    if (dirty.right > buffer->width) dirty.right = buffer->width;
    if (dirty.bottom > buffer->height) dirty.bottom = buffer->height;
    uint32_t *bits = buffer->bits;
    for (int y = dirty.top; y < dirty.bottom; y++) {
        memset(bits + y * buffer->stride + dirty.left, 0, (dirty.right - dirty.left) * 4);
    }
    for (int i = 0; picture && i < picture->count; i++) {
        const Placed *placed = &picture->placed[i];
        if (placed->x + placed->mask->w <= buffer->width && placed->y + placed->mask->h <= buffer->height) {
            blend(placed, bits, buffer->stride, 0, 0);
        }
    }
    return 1;
}

// Draws the shown moment into the next buffer.
JNIEXPORT jboolean JNICALL METHOD(draw)(JNIEnv *env, jclass clazz, jlong handle) {
    Surface *surface = (Surface *) handle;
    if (!surface->window) return JNI_FALSE;
    const Picture *picture = surface->shown;
    ARect next = {0, 0, 0, 0};
    for (int i = 0; picture && i < picture->count; i++) {
        const Placed *placed = &picture->placed[i];
        if (drawn_mask(surface, placed)) include(&next, placed->x, placed->y, placed->x + placed->mask->w, placed->y + placed->mask->h);
    }
    if (empty(&next) && empty(&surface->drawn)) return JNI_FALSE;
    if (surface->gpu && surface->context != EGL_NO_CONTEXT && !surface->masks_gl) {
        // The app limits libass's cache where memory is short.
        surface->masks_gl = gl_masks_new(surface->masks, surface->cache_mb != 0);
        if (!surface->masks_gl) surface->gpu = 0;
    }
    if (surface->context == EGL_NO_CONTEXT) {
        if (!draw_window(surface, picture, next)) return JNI_FALSE;
    } else if (surface->gpu) {
        gl_masks_draw(surface->masks_gl, picture, surface->window_width, surface->window_height);
    } else {
        draw_blended(surface, picture, next);
    }
    surface->drawn = next;
    surface->pending = 1;
    return JNI_TRUE;
}

// Posts the drawn picture, with GL for the compositor to show at `atNanos`, or at once when 0.
JNIEXPORT void JNICALL METHOD(post)(JNIEnv *env, jclass clazz, jlong handle, jlong atNanos) {
    Surface *surface = (Surface *) handle;
    if (!surface->pending) return;
    surface->pending = 0;
    if (surface->context == EGL_NO_CONTEXT) {
        ANativeWindow_unlockAndPost(surface->window);
        return;
    }
    if (surface->presentation_time) {
        // The window keeps the last time it was given: a picture for no frame shows now.
        if (!atNanos) {
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            atNanos = now.tv_sec * 1000000000LL + now.tv_nsec;
        }
        surface->presentation_time(surface->display, surface->surface, atNanos);
    }
    eglSwapBuffers(surface->display, surface->surface);
}

// Once neither thread uses it any more.
JNIEXPORT void JNICALL METHOD(release)(JNIEnv *env, jclass clazz, jlong handle) {
    Surface *surface = (Surface *) handle;
    stop_gl(surface);
    if (surface->window) ANativeWindow_release(surface->window);
    drop_from(surface, INT64_MIN);
    release(surface, surface->last);
    release(surface, surface->shown);
    pthread_cond_destroy(&surface->queued);
    pthread_mutex_destroy(&surface->lock);
    libass.renderer_done(surface->renderer);
    libass.library_done(surface->library);
    masks_free(surface->masks);
    free(surface->bundled);
    free(surface->font);
    free(surface);
}
