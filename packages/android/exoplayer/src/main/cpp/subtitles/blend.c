#include "blend.h"

static inline uint32_t div255(uint32_t x) { return (x + 128 + ((x + 128) >> 8)) >> 8; }

// The colour over the picture so far, from pixel `x` of a row on.
static void blend_row(const uint8_t *src, uint32_t *dst, int x, int width,
                      uint32_t r, uint32_t g, uint32_t b, uint32_t opacity) {
    for (; x < width; x++) {
        uint32_t k = div255(src[x] * opacity);
        if (!k) continue;
        uint32_t d = dst[x], keep = 255 - k;
        uint32_t dr = d & 0xff, dg = (d >> 8) & 0xff, db = (d >> 16) & 0xff, da = d >> 24;
        dst[x] = (div255(r * k + dr * keep)) |
                 (div255(g * k + dg * keep) << 8) |
                 (div255(b * k + db * keep) << 16) |
                 ((k + div255(da * keep)) << 24);
    }
}

#if defined(__ARM_NEON)
#include <arm_neon.h>

static inline uint8x8_t div255x8(uint16x8_t x) { return vraddhn_u16(x, vrshrq_n_u16(x, 8)); }

// Eight pixels of mask, the same sums as blend_row.
static inline void blend8(uint8x8_t mask, uint32_t *dst, uint8x8_t vr, uint8x8_t vg, uint8x8_t vb, uint8x8_t vo) {
    uint8x8_t k = div255x8(vmull_u8(mask, vo));
#if defined(__aarch64__)
    if (!vmaxv_u8(k)) return;
#endif
    uint8x8_t keep = vmvn_u8(k);
    uint8x8x4_t d = vld4_u8((uint8_t *) dst);
    d.val[0] = div255x8(vmlal_u8(vmull_u8(vr, k), d.val[0], keep));
    d.val[1] = div255x8(vmlal_u8(vmull_u8(vg, k), d.val[1], keep));
    d.val[2] = div255x8(vmlal_u8(vmull_u8(vb, k), d.val[2], keep));
    d.val[3] = vadd_u8(k, div255x8(vmull_u8(d.val[3], keep)));
    vst4_u8((uint8_t *) dst, d);
}

void blend(const Placed *placed, uint32_t *bits, int stride, int left, int top) {
    const Mask *mask = placed->mask;
    uint32_t r = placed->color >> 24, g = (placed->color >> 16) & 0xff, b = (placed->color >> 8) & 0xff;
    uint32_t opacity = 255 - (placed->color & 0xff);
    uint8x8_t vr = vdup_n_u8(r), vg = vdup_n_u8(g), vb = vdup_n_u8(b), vo = vdup_n_u8(opacity);
#if defined(__aarch64__)
    uint32x4_t solid = vdupq_n_u32(r | g << 8 | b << 16 | 0xffu << 24);
#endif
    for (int y = 0; y < mask->h; y++) {
        const uint8_t *src = mask->pixels + y * mask->span;
        uint32_t *dst = bits + (placed->y - top + y) * stride + placed->x - left;
        int x = 0;
#if defined(__aarch64__)
        // Most of a mask is empty, and full coverage by an opaque colour is just the colour.
        for (; x + 16 <= mask->w; x += 16) {
            uint8x16_t m = vld1q_u8(src + x);
            if (!vmaxvq_u8(m)) continue;
            if (opacity == 255 && vminvq_u8(m) == 255) {
                vst1q_u32(dst + x, solid);
                vst1q_u32(dst + x + 4, solid);
                vst1q_u32(dst + x + 8, solid);
                vst1q_u32(dst + x + 12, solid);
                continue;
            }
            blend8(vget_low_u8(m), dst + x, vr, vg, vb, vo);
            blend8(vget_high_u8(m), dst + x + 8, vr, vg, vb, vo);
        }
#endif
        for (; x + 8 <= mask->w; x += 8) blend8(vld1_u8(src + x), dst + x, vr, vg, vb, vo);
        blend_row(src, dst, x, mask->w, r, g, b, opacity);
    }
}
#else
void blend(const Placed *placed, uint32_t *bits, int stride, int left, int top) {
    const Mask *mask = placed->mask;
    uint32_t r = placed->color >> 24, g = (placed->color >> 16) & 0xff, b = (placed->color >> 8) & 0xff;
    uint32_t opacity = 255 - (placed->color & 0xff);
    for (int y = 0; y < mask->h; y++) {
        blend_row(mask->pixels + y * mask->span, bits + (placed->y - top + y) * stride + placed->x - left,
                  0, mask->w, r, g, b, opacity);
    }
}
#endif
