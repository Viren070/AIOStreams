// libass's masks, copied once and shared by the moments queued to show them, as libass keeps its own
// only until it renders again.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include "../ass/ass.h"

// Where the showing thread has a mask on the GPU.
typedef struct {
    unsigned owner;         // the GlMasks that put it there
    unsigned texture;       // one of its own, or 0 in the atlas
    int texture_width, texture_height;
    int strip;              // of the atlas
    unsigned packing;       // the strip's when it went in
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
    unsigned char *pixels;  // w by h
    GpuPlace gpu;           // the showing thread's
} Mask;

typedef struct {
    Mask *mask;
    int x, y;
    uint32_t color;         // RGBA; A is transparency
} Placed;

// A rendered moment's images, as placed masks.
typedef struct {
    int refs;
    int count;
    Placed placed[];
} Picture;

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

// The textures of masks let go of, which only the showing thread may free; returns how many.
int masks_take_retired(MaskStore *store, GpuPlace *places, int max);
