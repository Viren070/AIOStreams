#include "gl_masks.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "gl.h"

// The atlas: one texture cut into strips, filled in turn. A strip is emptied whole when its turn comes
// again, and the masks still shown from it go up anew into the strip being filled.
#define STRIP_WIDTH 2048
#define STRIP_HEIGHT 512
#define STRIPS 16

#define KEPT (32 << 20)     // bytes of masks nothing shows that the store keeps
#define KEPT_SMALL (8 << 20)
#define POOL_STEP 256       // own textures' sizes round up to it, so freed ones fit later masks
#define POOL_MAX 64
#define FLOATS 8            // a vertex: corner, texel, colour
#define RETIRED_BATCH 64

typedef struct {
    short x, y, w;
} Node;

typedef struct {
    Node *skyline;          // the top of what's packed, left to right
    int nodes;
    unsigned packing;       // changes when it's emptied
    unsigned used;          // the draw that last drew from it
} Strip;

typedef struct {
    GLuint texture;
    int width, height;
} Pooled;

struct GlMasks {
    MaskStore *store;
    unsigned id;            // the owner of what it puts on the GPU
    GLuint program, buffer;
    GLint size;
    GLuint atlas;
    int side;               // the atlas's, which `columns` strips span
    int columns, strips;
    Strip strip[STRIPS];
    int current;            // the strip being filled
    unsigned draws;
    Pooled pool[POOL_MAX];
    int pooled;
    float *verts;
    size_t verts_cap;
};

// Owners and packings stay unique across contexts, as masks outlive them.
static atomic_uint next_id;

static unsigned new_id(void) { return atomic_fetch_add(&next_id, 1) + 1; }

static const char *VERTEX =
    "attribute vec2 corner;\n"
    "attribute vec2 texel;\n"
    "attribute vec4 tint;\n"
    "uniform vec2 size;\n"
    "varying vec2 at;\n"
    "varying vec4 color;\n"
    "void main() {\n"
    "    at = texel;\n"
    "    color = tint;\n"
    "    gl_Position = vec4(corner.x / size.x * 2.0 - 1.0, 1.0 - corner.y / size.y * 2.0, 0.0, 1.0);\n"
    "}\n";
static const char *FRAGMENT =
    "#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
    "precision highp float;\n"
    "#else\n"
    "precision mediump float;\n"
    "#endif\n"
    "varying vec2 at;\n"
    "varying vec4 color;\n"
    "uniform sampler2D mask;\n"
    "void main() {\n"
    "    float k = texture2D(mask, at).a * color.a;\n"
    "    gl_FragColor = vec4(color.rgb * k, k);\n"
    "}\n";

GlMasks *gl_masks_new(MaskStore *store, int small) {
    GlMasks *gl = calloc(1, sizeof(GlMasks));
    if (!gl) return NULL;
    static const char *const attributes[] = {"corner", "texel", "tint"};
    gl->program = gl_program(VERTEX, FRAGMENT, attributes, 3);
    if (!gl->program) {
        free(gl);
        return NULL;
    }
    gl->store = store;
    gl->id = new_id();
    gl->current = -1;
    gl->size = glGetUniformLocation(gl->program, "size");
    glGenBuffers(1, &gl->buffer);
    // Texels of a larger atlas are finer than a GPU without highp can address.
    GLint largest = 0, range[2] = {0, 0}, precision = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &largest);
    glGetShaderPrecisionFormat(GL_FRAGMENT_SHADER, GL_HIGH_FLOAT, range, &precision);
    gl->side = !small && largest >= 2 * STRIP_WIDTH && precision ? 2 * STRIP_WIDTH : STRIP_WIDTH;
    gl->columns = gl->side / STRIP_WIDTH;
    gl->strips = gl->columns * (gl->side / STRIP_HEIGHT);
    gl->atlas = gl_texture(GL_ALPHA, gl->side, gl->side);
    masks_keep(store, small ? KEPT_SMALL : KEPT);
    return gl;
}

void gl_masks_free(GlMasks *gl) {
    if (!gl) return;
    masks_keep(gl->store, 0);
    for (int i = 0; i < gl->pooled; i++) glDeleteTextures(1, &gl->pool[i].texture);
    glDeleteTextures(1, &gl->atlas);
    for (int i = 0; i < STRIPS; i++) free(gl->strip[i].skyline);
    glDeleteBuffers(1, &gl->buffer);
    glDeleteProgram(gl->program);
    free(gl->verts);
    free(gl);
}

// Skyline bottom-left: of the places the rectangle can sit on the skyline, the one whose top is lowest.
static int skyline_fit(const Strip *strip, int i, int w, int h) {
    if (strip->skyline[i].x + w > STRIP_WIDTH) return -1;
    int y = 0;
    for (int left = w; left > 0; left -= strip->skyline[i++].w) {
        if (strip->skyline[i].y > y) y = strip->skyline[i].y;
        if (y + h > STRIP_HEIGHT) return -1;
    }
    return y;
}

static int skyline_place(Strip *strip, int w, int h, int *x, int *y) {
    int best = -1, best_top = STRIP_HEIGHT + 1, best_width = 0;
    for (int i = 0; i < strip->nodes; i++) {
        int at = skyline_fit(strip, i, w, h);
        if (at < 0) continue;
        if (at + h < best_top || (at + h == best_top && strip->skyline[i].w < best_width)) {
            best = i;
            best_top = at + h;
            best_width = strip->skyline[i].w;
            *y = at;
        }
    }
    if (best < 0 || strip->nodes == STRIP_WIDTH) return 0;
    Node *nodes = strip->skyline;
    *x = nodes[best].x;
    memmove(nodes + best + 1, nodes + best, (strip->nodes - best) * sizeof(Node));
    nodes[best] = (Node) {(short) *x, (short) best_top, (short) w};
    strip->nodes++;
    // The nodes under the rectangle go, and the one it reaches into shrinks.
    for (int i = best + 1; i < strip->nodes;) {
        int covered = nodes[i - 1].x + nodes[i - 1].w - nodes[i].x;
        if (covered <= 0) break;
        if (covered < nodes[i].w) {
            nodes[i].x += covered;
            nodes[i].w -= covered;
            break;
        }
        memmove(nodes + i, nodes + i + 1, (--strip->nodes - i) * sizeof(Node));
    }
    for (int i = 0; i + 1 < strip->nodes;) {
        if (nodes[i].y != nodes[i + 1].y) {
            i++;
            continue;
        }
        nodes[i].w += nodes[i + 1].w;
        memmove(nodes + i + 1, nodes + i + 2, (--strip->nodes - i - 1) * sizeof(Node));
    }
    return 1;
}

static int strip_empty(Strip *strip) {
    if (!strip->skyline && !(strip->skyline = malloc(STRIP_WIDTH * sizeof(Node)))) return 0;
    strip->skyline[0] = (Node) {0, 0, STRIP_WIDTH};
    strip->nodes = 1;
    strip->packing = new_id();
    return 1;
}

// A place for a w by h rectangle in the strip being filled, or in the next this draw hasn't drawn from,
// emptied; -1 when there's none.
static int atlas_place(GlMasks *gl, int w, int h, int *x, int *y) {
    if (gl->current >= 0 && skyline_place(&gl->strip[gl->current], w, h, x, y)) return gl->current;
    for (int i = 1; i <= gl->strips; i++) {
        int next = (gl->current + i) % gl->strips;
        Strip *strip = &gl->strip[next];
        if (strip->used == gl->draws) continue;
        if (!strip_empty(strip)) return -1;
        gl->current = next;
        return skyline_place(strip, w, h, x, y) ? next : -1;
    }
    return -1;
}

static GLuint pool_take(GlMasks *gl, int w, int h, int *width, int *height) {
    *width = (w + POOL_STEP - 1) / POOL_STEP * POOL_STEP;
    *height = (h + POOL_STEP - 1) / POOL_STEP * POOL_STEP;
    // The smallest that holds it, unless that wastes more than it uses.
    int best = -1, most = 2 * *width * *height;
    for (int i = 0; i < gl->pooled; i++) {
        const Pooled *pooled = &gl->pool[i];
        if (pooled->width < w || pooled->height < h || pooled->width * pooled->height > most) continue;
        best = i;
        most = pooled->width * pooled->height;
    }
    if (best < 0) return gl_texture(GL_ALPHA, *width, *height);
    GLuint texture = gl->pool[best].texture;
    *width = gl->pool[best].width;
    *height = gl->pool[best].height;
    gl->pool[best] = gl->pool[--gl->pooled];
    return texture;
}

static void pool_give(GlMasks *gl, GLuint texture, int width, int height) {
    if (gl->pooled < POOL_MAX) gl->pool[gl->pooled++] = (Pooled) {texture, width, height};
    else glDeleteTextures(1, &texture);
}

// Takes back the textures of masks let go of; other contexts' died with them.
static void take_back(GlMasks *gl) {
    GpuPlace places[RETIRED_BATCH];
    int count;
    while ((count = masks_take_retired(gl->store, places, RETIRED_BATCH)) > 0) {
        for (int i = 0; i < count; i++) {
            if (places[i].owner == gl->id)
                pool_give(gl, places[i].texture, places[i].texture_width, places[i].texture_height);
        }
    }
}

// Gives the mask a place on the GPU unless it has one: in the atlas, or in a texture of its own when
// it's too large or the picture alone fills the atlas.
static void resident(GlMasks *gl, Mask *mask) {
    GpuPlace *place = &mask->gpu;
    if (place->owner == gl->id) {
        if (place->texture) return;
        Strip *strip = &gl->strip[place->strip];
        if (strip->packing == place->packing) {
            strip->used = gl->draws;
            return;
        }
    }
    place->owner = gl->id;
    place->texture = 0;
    // A row and a column between masks keep a neighbour out of a mask's edge.
    int w = mask->w, h = mask->h;
    if (w < STRIP_WIDTH && h < STRIP_HEIGHT &&
        (place->strip = atlas_place(gl, w + 1, h + 1, &place->x, &place->y)) >= 0) {
        Strip *strip = &gl->strip[place->strip];
        strip->used = gl->draws;
        place->packing = strip->packing;
        place->x += place->strip % gl->columns * STRIP_WIDTH;
        place->y += place->strip / gl->columns * STRIP_HEIGHT;
        glBindTexture(GL_TEXTURE_2D, gl->atlas);
        glTexSubImage2D(GL_TEXTURE_2D, 0, place->x, place->y, w, h, GL_ALPHA, GL_UNSIGNED_BYTE, mask->pixels);
        return;
    }
    place->texture = pool_take(gl, w, h, &place->texture_width, &place->texture_height);
    glBindTexture(GL_TEXTURE_2D, place->texture);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_ALPHA, GL_UNSIGNED_BYTE, mask->pixels);
}

static void flush(GlMasks *gl, GLuint texture, const float *end) {
    size_t floats = end - gl->verts;
    if (!floats) return;
    glBindTexture(GL_TEXTURE_2D, texture);
    glBufferData(GL_ARRAY_BUFFER, floats * sizeof(float), gl->verts, GL_STREAM_DRAW);
    glDrawArrays(GL_TRIANGLES, 0, floats / FLOATS);
}

void gl_masks_draw(GlMasks *gl, const Picture *picture, int width, int height) {
    take_back(gl);
    glViewport(0, 0, width, height);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    if (!picture || !picture->count) return;

    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    gl->draws++;
    for (int i = 0; i < picture->count; i++) resident(gl, picture->placed[i].mask);

    glUseProgram(gl->program);
    glUniform2f(gl->size, width, height);
    glEnable(GL_BLEND);
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    glBindBuffer(GL_ARRAY_BUFFER, gl->buffer);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, FLOATS * sizeof(float), (void *) 0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, FLOATS * sizeof(float), (void *) (2 * sizeof(float)));
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, FLOATS * sizeof(float), (void *) (4 * sizeof(float)));
    for (int i = 0; i < 3; i++) glEnableVertexAttribArray(i);

    size_t need = (size_t) picture->count * 6 * FLOATS;
    if (need > gl->verts_cap) {
        float *verts = realloc(gl->verts, need * sizeof(float));
        if (!verts) return;
        gl->verts = verts;
        gl->verts_cap = need;
    }
    // One draw per run of masks on the same texture, as the order is the blending's.
    float *v = gl->verts;
    GLuint bound = 0;
    for (int i = 0; i < picture->count; i++) {
        const Placed *placed = &picture->placed[i];
        const Mask *mask = placed->mask;
        const GpuPlace *place = &mask->gpu;
        GLuint texture = place->texture ? place->texture : gl->atlas;
        if (texture != bound) {
            flush(gl, bound, v);
            v = gl->verts;
            bound = texture;
        }
        float tw = place->texture ? place->texture_width : gl->side, th = place->texture ? place->texture_height : gl->side;
        float tx = place->texture ? 0 : place->x, ty = place->texture ? 0 : place->y;
        float u0 = tx / tw, v0 = ty / th, u1 = (tx + mask->w) / tw, v1 = (ty + mask->h) / th;
        float x0 = placed->x, y0 = placed->y, x1 = x0 + mask->w, y1 = y0 + mask->h;
        float r = (placed->color >> 24) / 255.f, g = ((placed->color >> 16) & 0xff) / 255.f;
        float b = ((placed->color >> 8) & 0xff) / 255.f, a = (255 - (placed->color & 0xff)) / 255.f;
        const float corners[6][4] = {{x0, y0, u0, v0}, {x1, y0, u1, v0}, {x0, y1, u0, v1},
                                     {x1, y0, u1, v0}, {x1, y1, u1, v1}, {x0, y1, u0, v1}};
        for (int k = 0; k < 6; k++) {
            *v++ = corners[k][0];
            *v++ = corners[k][1];
            *v++ = corners[k][2];
            *v++ = corners[k][3];
            *v++ = r;
            *v++ = g;
            *v++ = b;
            *v++ = a;
        }
    }
    flush(gl, bound, v);
}
