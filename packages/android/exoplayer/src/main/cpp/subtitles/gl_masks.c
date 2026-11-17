#include "gl_masks.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "gl.h"

// The atlas: one texture as wide as a block, whose rows fill in turn. Coming round, the filling empties
// the blocks in its way and passes over those the draw shows; when those leave no room, the atlas is emptied.
#define ROWS 8192
#define ROWS_SMALL 2048
#define STAGED_ROWS 1024    // the most rows of shared masks laid out for one upload

#define KEPT (32 << 20)     // bytes of masks nothing shows that the store keeps
#define KEPT_SMALL (8 << 20)
#define POOL_STEP 256       // own textures' sizes round up to it, so freed ones fit later masks
#define POOL_MAX 64
#define FLOATS 8            // a vertex: corner, texel, colour
#define RETIRED_BATCH 64

// A block's rows in the atlas.
typedef struct {
    short y, height;
    unsigned packing;       // changes when they're emptied
    unsigned used;          // the draw that last drew from them
} Block;

// The masks a draw is bringing in count as in this one, which has no rows.
#define INCOMING 0

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
    int rows;
    Block *block;           // a block has two rows at least, so half its first row numbers it, from 1
    unsigned short *row;    // the block each row is in, or 0
    int head;               // the row filling goes on from
    unsigned draws;
    Pooled pool[POOL_MAX];
    int pooled;
    float *verts;
    size_t verts_cap;
    Mask **incoming;
    int incoming_cap;
    unsigned char *staging; // a block of shared masks on its way up
    size_t staging_cap;
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

void gl_masks_free(GlMasks *gl) {
    if (!gl) return;
    masks_keep(gl->store, 0);
    for (int i = 0; i < gl->pooled; i++) glDeleteTextures(1, &gl->pool[i].texture);
    glDeleteTextures(1, &gl->atlas);
    glDeleteBuffers(1, &gl->buffer);
    glDeleteProgram(gl->program);
    free(gl->block);
    free(gl->row);
    free(gl->verts);
    free(gl->incoming);
    free(gl->staging);
    free(gl);
}

GlMasks *gl_masks_new(MaskStore *store, int small) {
    GlMasks *gl = calloc(1, sizeof(GlMasks));
    if (!gl) return NULL;
    static const char *const attributes[] = {"corner", "texel", "tint"};
    gl->program = gl_program(VERTEX, FRAGMENT, attributes, 3);
    // Texels of a taller atlas are finer than a GPU without highp can address.
    GLint largest = 0, range[2] = {0, 0}, precision = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &largest);
    glGetShaderPrecisionFormat(GL_FRAGMENT_SHADER, GL_HIGH_FLOAT, range, &precision);
    gl->rows = !small && largest >= ROWS && precision ? ROWS : ROWS_SMALL;
    gl->block = calloc(gl->rows / 2 + 1, sizeof(Block));
    gl->row = calloc(gl->rows, sizeof(*gl->row));
    if (!gl->program || !gl->block || !gl->row) {
        glDeleteProgram(gl->program);
        free(gl->block);
        free(gl->row);
        free(gl);
        return NULL;
    }
    gl->store = store;
    gl->id = new_id();
    gl->size = glGetUniformLocation(gl->program, "size");
    glGenBuffers(1, &gl->buffer);
    gl->atlas = gl_texture(GL_ALPHA, BLOCK_WIDTH, gl->rows);
    masks_keep(store, small ? KEPT_SMALL : KEPT);
    return gl;
}

// Whether the place still holds, which marks it as shown by this draw.
static int there(GlMasks *gl, const GpuPlace *place) {
    if (place->owner != gl->id) return 0;
    if (place->texture) return 1;
    Block *block = &gl->block[place->block];
    if (block->packing != place->packing) return 0;
    block->used = gl->draws;
    return 1;
}

// Rows for a block: the first from where filling left off that hold nothing this draw shows, emptied.
// -1 when it has gone round without finding any.
static int rows_for(GlMasks *gl, int height) {
    int y = gl->head, passed = 0;
    for (;;) {
        if (y + height > gl->rows) {
            passed += gl->rows - y;
            y = 0;
        }
        if (passed > gl->rows) return -1;
        const Block *shown = NULL;
        for (int r = y; r < y + height && !shown; r++) {
            if (gl->row[r] && gl->block[gl->row[r]].used == gl->draws) shown = &gl->block[gl->row[r]];
        }
        if (!shown) break;
        passed += shown->y + shown->height - y;
        y = shown->y + shown->height;
    }
    for (int r = y; r < y + height; r++) {
        if (!gl->row[r]) continue;
        Block *old = &gl->block[gl->row[r]];
        memset(gl->row + old->y, 0, old->height * sizeof(*gl->row));
        old->packing = 0;
    }
    int index = 1 + y / 2;
    gl->block[index] = (Block) {(short) y, (short) height, new_id(), gl->draws};
    for (int r = y; r < y + height; r++) gl->row[r] = (unsigned short) index;
    gl->head = y + height;
    return y;
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

// Takes back the textures of what was let go of; other contexts' died with them.
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

static void own_texture(GlMasks *gl, GpuPlace *place, int w, int h, const unsigned char *pixels) {
    *place = (GpuPlace) {.owner = gl->id};
    place->texture = pool_take(gl, w, h, &place->texture_width, &place->texture_height);
    glBindTexture(GL_TEXTURE_2D, place->texture);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_ALPHA, GL_UNSIGNED_BYTE, pixels);
}

static void atlas_upload(GlMasks *gl, int top, int width, int height, const unsigned char *pixels) {
    glBindTexture(GL_TEXTURE_2D, gl->atlas);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, top, width, height, GL_ALPHA, GL_UNSIGNED_BYTE, pixels);
}

static int taller_first(const void *a, const void *b) {
    return (*(const Mask *const *) b)->h - (*(const Mask *const *) a)->h;
}

// Lays out the incoming masks from `first` that make one block and uploads it; returns the mask after
// them, or -1 when there's no room for it.
static int stage(GlMasks *gl, int first, int count) {
    Mask **masks = gl->incoming;
    Shelves shelves = {0};
    int end = first;
    for (; end < count; end++) {
        Mask *mask = masks[end];
        if (!shelves_place(&shelves, mask->w, mask->h, STAGED_ROWS, &mask->gpu.x, &mask->gpu.y)) break;
    }
    int width = shelves_width(&shelves), height = shelves_height(&shelves);
    size_t texels = (size_t) width * height;
    if (texels > gl->staging_cap) {
        unsigned char *staging = realloc(gl->staging, texels);
        if (!staging) return -1;
        gl->staging = staging;
        gl->staging_cap = texels;
    }
    int top = rows_for(gl, height);
    if (top < 0) return -1;
    int index = gl->row[top];
    memset(gl->staging, 0, texels);
    for (int i = first; i < end; i++) {
        Mask *mask = masks[i];
        int x = mask->gpu.x, y = mask->gpu.y;
        unsigned char *to = gl->staging + (size_t) y * width + x;
        for (int r = 0; r < mask->h; r++) memcpy(to + (size_t) r * width, mask->pixels + (size_t) r * mask->span, mask->w);
        mask->gpu = (GpuPlace) {.owner = gl->id, .block = index, .packing = gl->block[index].packing, .x = x, .y = top + y};
    }
    atlas_upload(gl, top, width, height, gl->staging);
    return end;
}

static void bring_in(GlMasks *gl, Picture *picture) {
    if (picture->count > gl->incoming_cap) {
        Mask **incoming = realloc(gl->incoming, picture->count * sizeof(Mask *));
        if (!incoming) return;
        gl->incoming = incoming;
        gl->incoming_cap = picture->count;
    }
    for (int afresh = 0;; afresh = 1) {
        gl->block[INCOMING].packing = new_id();
        // What's there is shown before anything is emptied for what isn't.
        for (int i = 0; i < picture->count; i++) {
            if (!picture_owns(picture, picture->placed[i].mask)) there(gl, &picture->placed[i].mask->gpu);
        }
        int room = 1;
        if (picture->block_height && !there(gl, &picture->gpu)) {
            int top = rows_for(gl, picture->block_height);
            if (top >= 0) {
                int index = gl->row[top];
                picture->gpu = (GpuPlace) {.owner = gl->id, .block = index, .packing = gl->block[index].packing, .y = top};
                atlas_upload(gl, top, picture->block_width, picture->block_height, picture->block);
            }
            room = top >= 0;
        }
        // The shared masks the block carries are there with it, unless they are elsewhere.
        const GpuPlace *with = &picture->gpu;
        for (int i = 0; room && !with->texture && i < picture->carried_count; i++) {
            const Carried *carried = &picture->carried[i];
            if (there(gl, &carried->mask->gpu)) continue;
            carried->mask->gpu = (GpuPlace) {.owner = gl->id, .block = with->block, .packing = with->packing,
                                             .x = carried->x, .y = with->y + carried->y};
        }
        // A picture may show a mask twice: once it's coming in, it counts as there.
        int count = 0;
        for (int i = 0; i < picture->count; i++) {
            Mask *mask = picture->placed[i].mask;
            if (picture_owns(picture, mask) || there(gl, &mask->gpu)) continue;
            if (mask->w > BLOCK_WIDTH || mask->h >= BLOCK_TALLEST) {
                own_texture(gl, &mask->gpu, mask->w, mask->h, mask->pixels);
                continue;
            }
            mask->gpu = (GpuPlace) {.owner = gl->id, .block = INCOMING, .packing = gl->block[INCOMING].packing};
            gl->incoming[count++] = mask;
        }
        if (count > 1) qsort(gl->incoming, count, sizeof(Mask *), taller_first);
        for (int next = 0; room && next < count; room = next >= 0) next = stage(gl, next, count);
        if (room) return;
        if (afresh) {
            // More than the atlas holds.
            if (picture->block_height && !there(gl, &picture->gpu))
                own_texture(gl, &picture->gpu, picture->block_width, picture->block_height, picture->block);
            for (int i = 0; i < count; i++) {
                Mask *mask = gl->incoming[i];
                if (mask->gpu.block == INCOMING && !mask->gpu.texture) own_texture(gl, &mask->gpu, mask->w, mask->h, mask->pixels);
            }
            return;
        }
        // The blocks the picture shows left no room.
        for (int index = 1; index <= gl->rows / 2; index++) gl->block[index].packing = 0;
        memset(gl->row, 0, gl->rows * sizeof(*gl->row));
        gl->head = 0;
    }
}

static void flush(GlMasks *gl, GLuint texture, const float *end) {
    size_t floats = end - gl->verts;
    if (!floats) return;
    glBindTexture(GL_TEXTURE_2D, texture);
    glBufferData(GL_ARRAY_BUFFER, floats * sizeof(float), gl->verts, GL_STREAM_DRAW);
    glDrawArrays(GL_TRIANGLES, 0, floats / FLOATS);
}

void gl_masks_draw(GlMasks *gl, Picture *picture, int width, int height) {
    take_back(gl);
    glViewport(0, 0, width, height);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    if (!picture || !picture->count) return;

    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    gl->draws++;
    bring_in(gl, picture);

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
        // The picture's own masks are where its block is.
        int own = picture_owns(picture, mask);
        const GpuPlace *place = own ? &picture->gpu : &mask->gpu;
        GLuint texture = place->texture ? place->texture : gl->atlas;
        if (texture != bound) {
            flush(gl, bound, v);
            v = gl->verts;
            bound = texture;
        }
        float tw = place->texture ? place->texture_width : BLOCK_WIDTH, th = place->texture ? place->texture_height : gl->rows;
        float tx = place->texture ? 0 : place->x, ty = place->texture ? 0 : place->y;
        if (own) tx += mask->gpu.x, ty += mask->gpu.y;
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
