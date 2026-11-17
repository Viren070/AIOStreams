// Drawing a picture with GL: each mask goes up once as alpha, small ones packed
// into an atlas and large ones into textures of their own, and the GPU blends
// them over each other as tinted quads, in order. While it lasts, the store
// keeps masks nothing shows, as they'd still be on the GPU when shown again.
#pragma once

#include "masks.h"

typedef struct GlMasks GlMasks;

// Both with the context current. `small` for a device short of memory.
GlMasks *gl_masks_new(MaskStore *store, int small);
void gl_masks_free(GlMasks *gl);

// Clears the `width` by `height` window and draws the picture over it.
void gl_masks_draw(GlMasks *gl, const Picture *picture, int width, int height);
