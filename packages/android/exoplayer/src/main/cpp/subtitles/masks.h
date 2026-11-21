// libass's masks, copied once and shared by the moments queued to show them, as libass keeps its own
// only until it renders again.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include "../ass/ass.h"

// A block: masks laid out for the GPU to take in one upload, in shelves one under another. An empty row
// and column after each mask keep another's texels from its edge.
#define BLOCK_WIDTH 2048    // the atlas's
#define BLOCK_ROWS 2048     // the most a picture's has, which any atlas fits
#define BLOCK_TALLEST 512   // rows from which a shared mask gets a texture of its own, as it would hold a block's for long

typedef struct {
    int x, y, shelf, width;
} Shelves;

// Where the next mask of a block goes, the tallest given first; 0 when the block would be over `rows`.
static inline int shelves_place(Shelves *shelves, int w, int h, int rows, int *x, int *y) {
    int next = shelves->x + w > BLOCK_WIDTH;
    int top = next ? shelves->y + shelves->shelf + 1 : shelves->y;
    if (top + h >= rows) return 0;
    if (next) *shelves = (Shelves) {.y = top, .width = shelves->width};
    if (h > shelves->shelf) shelves->shelf = h;
    *x = shelves->x;
    *y = shelves->y;
    shelves->x += w + 1;
    if (shelves->x - 1 > shelves->width) shelves->width = shelves->x - 1;
    return 1;
}

static inline int shelves_width(const Shelves *shelves) { return shelves->width + (shelves->width < BLOCK_WIDTH); }
static inline int shelves_height(const Shelves *shelves) { return shelves->y + shelves->shelf + 1; }

// Where the showing thread has a mask, or a picture's block, on the GPU.
typedef struct {
    unsigned owner;         // the GlMasks that put it there
    unsigned texture;       // one of its own, or 0 in the atlas
    int texture_width, texture_height;
    int block;              // of the atlas
    unsigned packing;       // the block's when it went in
    int x, y;               // in the atlas
} GpuPlace;

typedef struct Mask {
    // The image's view of its cached bitmap, as a clipped image shows part of one.
    uint32_t cache_id;
    const unsigned char *bitmap;
    int w, h, stride;

    int refs;               // pictures showing it
    struct Mask *next;      // in its bucket
    struct Mask *older, *newer;  // among those nothing shows
    unsigned char *pixels;  // w by h, in rows `span` apart
    int span;
    GpuPlace gpu;           // the showing thread's; of a picture's own mask, its x and y in the block
} Mask;

typedef struct {
    Mask *mask;
    int x, y;
    uint32_t color;         // RGBA; A is transparency
} Placed;

// A shared mask whose pixels a picture's block carries too, and where.
typedef struct {
    Mask *mask;
    int x, y;
} Carried;

// A rendered moment's images, as placed masks.
typedef struct {
    int refs;
    int count;
    // The masks new with the picture, in one block for the GPU to take at once: its own, which libass
    // gave no cache id, so that no other picture can show them, and copies of the shared ones.
    Mask *own;
    int own_count;
    Carried *carried;
    int carried_count;
    unsigned char *block;
    int block_width, block_height;
    GpuPlace gpu;           // the block's, the showing thread's
    size_t bytes;
    Placed placed[];
} Picture;

static inline int picture_owns(const Picture *picture, const Mask *mask) {
    return mask >= picture->own && mask < picture->own + picture->own_count;
}

typedef struct MaskStore MaskStore;

MaskStore *masks_new(void);
void masks_free(MaskStore *store);

// The images as a picture of placed masks, copying the masks the store hasn't got.
Picture *masks_picture(MaskStore *store, const ASS_Image *images);
void masks_release(MaskStore *store, Picture *picture);

// Bytes of masks shown and pictures alive.
size_t masks_bytes(MaskStore *store);

// The most bytes of masks nothing shows to keep, for when they show again; none to begin with.
void masks_keep(MaskStore *store, size_t bytes);

// The textures of masks and blocks let go of, which only the showing thread may free; returns how many.
int masks_take_retired(MaskStore *store, GpuPlace *places, int max);
