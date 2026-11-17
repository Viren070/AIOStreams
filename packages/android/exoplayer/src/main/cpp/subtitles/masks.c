#include "masks.h"

#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define BUCKETS 8192

// Pictures let go of whose memory later ones take, as writing fresh memory costs a fault for every page.
#define SPARES 4
#define SPARE_LEAST (64 << 10)  // bytes from which a picture's memory is worth keeping
#define SPARE_AGE 64            // pictures made since, after which it isn't

// An image of the picture being made.
typedef struct {
    const ASS_Image *image;
    Mask *mask;             // the store's, or NULL for one the picture is to own
    int fresh;              // the store's is new, its pixels still to copy
    int x, y;               // in the picture's block, when that carries it
    int carried;
} Slot;

struct MaskStore {
    pthread_mutex_t lock;
    Mask *buckets[BUCKETS];
    Mask *oldest, *newest;  // those nothing shows
    size_t kept, keep;
    atomic_size_t bytes;
    GpuPlace *retired;
    int retired_count, retired_cap;
    Picture *spare[SPARES];
    unsigned spared[SPARES];  // the picture count when each was let go of
    unsigned pictures;
    // The rendering thread's, for the picture it's making.
    Slot *slots;
    Slot **tall;
    int slots_cap;
};

MaskStore *masks_new(void) {
    MaskStore *store = calloc(1, sizeof(MaskStore));
    if (store) pthread_mutex_init(&store->lock, NULL);
    return store;
}

static unsigned bucket(uint32_t cache_id, const unsigned char *bitmap, int w, int h) {
    uint32_t hash = cache_id * 2654435761u ^ (uint32_t) (uintptr_t) bitmap * 40503u;
    return (hash ^ (uint32_t) w * 97u ^ (uint32_t) h) % BUCKETS;
}

static int same_view(const Mask *mask, const ASS_Image *image) {
    return mask->cache_id == image->cache_id && mask->bitmap == image->bitmap && mask->w == image->w &&
           mask->h == image->h && mask->stride == image->stride;
}

static size_t mask_bytes(const Mask *mask) { return (size_t) mask->w * mask->h; }

// Under the lock: leaves a texture for the showing thread to take back.
static void retire(MaskStore *store, const GpuPlace *place) {
    if (!place->texture) return;
    if (store->retired_count == store->retired_cap) {
        int cap = store->retired_cap ? store->retired_cap * 2 : 64;
        GpuPlace *grown = realloc(store->retired, cap * sizeof(GpuPlace));
        if (grown) {
            store->retired = grown;
            store->retired_cap = cap;
        }
    }
    // Without room the texture stays until its context goes.
    if (store->retired_count < store->retired_cap) store->retired[store->retired_count++] = *place;
}

// Under the lock.
static void forget(MaskStore *store, Mask *mask) {
    if (mask->cache_id) {
        Mask **link = &store->buckets[bucket(mask->cache_id, mask->bitmap, mask->w, mask->h)];
        while (*link != mask) link = &(*link)->next;
        *link = mask->next;
    }
    retire(store, &mask->gpu);
    free(mask);
}

static void unkeep(MaskStore *store, Mask *mask) {
    *(mask->older ? &mask->older->newer : &store->oldest) = mask->newer;
    *(mask->newer ? &mask->newer->older : &store->newest) = mask->older;
    mask->older = mask->newer = NULL;
    store->kept -= mask_bytes(mask);
}

// Under the lock: the image's mask, found or made; a made one's pixels are copied once the lock is let go.
static Mask *take(MaskStore *store, const ASS_Image *image, int *made) {
    // An image with no cache id has no lasting bitmap, so its copy isn't shared.
    Mask **head = image->cache_id ? &store->buckets[bucket(image->cache_id, image->bitmap, image->w, image->h)] : NULL;
    for (Mask *mask = head ? *head : NULL; mask; mask = mask->next) {
        if (!same_view(mask, image)) continue;
        if (!mask->refs++) {
            unkeep(store, mask);
            atomic_fetch_add(&store->bytes, mask_bytes(mask));
        }
        return mask;
    }
    Mask *mask = malloc(sizeof(Mask) + (size_t) image->w * image->h);
    if (!mask) return NULL;
    *mask = (Mask) {
        .cache_id = image->cache_id, .bitmap = image->bitmap, .w = image->w, .h = image->h, .stride = image->stride,
        .refs = 1, .pixels = (unsigned char *) (mask + 1), .span = image->w,
    };
    if (head) {
        mask->next = *head;
        *head = mask;
    }
    atomic_fetch_add(&store->bytes, mask_bytes(mask));
    *made = 1;
    return mask;
}

// Under the lock.
static void trim(MaskStore *store) {
    while (store->kept > store->keep) {
        Mask *oldest = store->oldest;
        unkeep(store, oldest);
        forget(store, oldest);
    }
}

// Under the lock.
static void drop(MaskStore *store, Mask *mask) {
    if (--mask->refs) return;
    atomic_fetch_sub(&store->bytes, mask_bytes(mask));
    if (!mask->cache_id || !store->keep) {
        forget(store, mask);
        return;
    }
    *(store->newest ? &store->newest->newer : &store->oldest) = mask;
    mask->older = store->newest;
    store->newest = mask;
    store->kept += mask_bytes(mask);
    trim(store);
}

// Zeroed memory for a picture of `bytes`: a spare's that isn't much more, or fresh.
static Picture *picture_memory(MaskStore *store, size_t bytes) {
    Picture *picture = NULL, *stale[SPARES];
    int stales = 0, best = -1;
    pthread_mutex_lock(&store->lock);
    store->pictures++;
    for (int i = 0; i < SPARES; i++) {
        Picture *spare = store->spare[i];
        if (!spare) continue;
        if (store->pictures - store->spared[i] > SPARE_AGE) {
            stale[stales++] = spare;
            store->spare[i] = NULL;
        } else if (spare->bytes >= bytes && spare->bytes <= 2 * bytes &&
                   (best < 0 || spare->bytes < store->spare[best]->bytes)) {
            best = i;
        }
    }
    if (best >= 0) {
        picture = store->spare[best];
        store->spare[best] = NULL;
    }
    pthread_mutex_unlock(&store->lock);
    for (int i = 0; i < stales; i++) free(stale[i]);
    if (!picture) {
        picture = calloc(1, bytes);
        if (picture) picture->bytes = bytes;
        return picture;
    }
    size_t held = picture->bytes;
    memset(picture, 0, bytes);
    picture->bytes = held;
    return picture;
}

// Under the lock: keeps the picture's memory as a spare if it's among the largest; returns what to free.
static Picture *picture_spare(MaskStore *store, Picture *picture) {
    if (picture->bytes < SPARE_LEAST) return picture;
    int least = 0;
    for (int i = 0; i < SPARES; i++) {
        if (!store->spare[i]) {
            least = i;
            break;
        }
        if (store->spare[i]->bytes < store->spare[least]->bytes) least = i;
    }
    Picture *out = store->spare[least];
    if (out && out->bytes >= picture->bytes) return picture;
    store->spare[least] = picture;
    store->spared[least] = store->pictures;
    return out;
}

static void copy(const ASS_Image *image, unsigned char *pixels, int span) {
    for (int y = 0; y < image->h; y++) memcpy(pixels + (size_t) y * span, image->bitmap + (size_t) y * image->stride, image->w);
}

static int taller_first(const void *a, const void *b) {
    return (*(Slot *const *) b)->image->h - (*(Slot *const *) a)->image->h;
}

static int slots_for(MaskStore *store, int count) {
    if (count <= store->slots_cap) return 1;
    int cap = count > 2 * store->slots_cap ? count : 2 * store->slots_cap;
    Slot *slots = realloc(store->slots, cap * sizeof(Slot));
    if (slots) store->slots = slots;
    Slot **tall = realloc(store->tall, cap * sizeof(Slot *));
    if (tall) store->tall = tall;
    if (!slots || !tall) return 0;
    store->slots_cap = cap;
    return 1;
}

// Lets go of the store's masks in the first `count` slots.
static void undo(MaskStore *store, int count) {
    pthread_mutex_lock(&store->lock);
    for (int i = 0; i < count; i++) {
        if (store->slots[i].mask) drop(store, store->slots[i].mask);
    }
    pthread_mutex_unlock(&store->lock);
}

Picture *masks_picture(MaskStore *store, const ASS_Image *images) {
    int count = 0;
    for (const ASS_Image *image = images; image; image = image->next) count += image->w > 0 && image->h > 0;
    if (!slots_for(store, count)) return NULL;
    Slot *slots = store->slots, **tall = store->tall;

    int taken = 0, talls = 0;
    pthread_mutex_lock(&store->lock);
    for (const ASS_Image *image = images; image; image = image->next) {
        if (image->w <= 0 || image->h <= 0) continue;
        Slot *slot = &slots[taken];
        *slot = (Slot) {.image = image};
        int own = !image->cache_id && image->w <= BLOCK_WIDTH && image->h <= BLOCK_ROWS;
        if (!own && !(slot->mask = take(store, image, &slot->fresh))) break;
        taken++;
        if (own || (slot->fresh && image->w <= BLOCK_WIDTH && image->h < BLOCK_TALLEST)) tall[talls++] = slot;
    }
    pthread_mutex_unlock(&store->lock);
    if (taken < count) {
        undo(store, taken);
        return NULL;
    }
    if (talls > 1) qsort(tall, talls, sizeof(Slot *), taller_first);
    Shelves shelves = {0};
    int own = 0, carried = 0;
    for (int i = 0; i < talls; i++) {
        Slot *slot = tall[i];
        if (shelves_place(&shelves, slot->image->w, slot->image->h, BLOCK_ROWS, &slot->x, &slot->y)) {
            slot->carried = 1;
            slot->mask ? carried++ : own++;
            continue;
        }
        // No room in the block for the rest: those that were to be the picture's own are the store's.
        for (; i < talls; i++) {
            Slot *left = tall[i];
            if (left->mask) continue;
            pthread_mutex_lock(&store->lock);
            left->mask = take(store, left->image, &left->fresh);
            pthread_mutex_unlock(&store->lock);
            if (!left->mask) {
                undo(store, count);
                return NULL;
            }
        }
    }
    int width = own + carried ? shelves_width(&shelves) : 0, height = own + carried ? shelves_height(&shelves) : 0;
    size_t bytes = sizeof(Picture) + count * sizeof(Placed) + own * sizeof(Mask) + carried * sizeof(Carried) +
                   (size_t) width * height;
    Picture *picture = picture_memory(store, bytes);
    if (!picture) {
        undo(store, count);
        return NULL;
    }
    picture->refs = 1;
    picture->count = count;
    picture->own = (Mask *) (picture->placed + count);
    picture->carried = (Carried *) (picture->own + own);
    picture->block = (unsigned char *) (picture->carried + carried);
    picture->block_width = width;
    picture->block_height = height;
    // Only this thread makes masks, and nothing shows the made ones until the picture is handed on.
    for (int i = 0; i < count; i++) {
        const Slot *slot = &slots[i];
        const ASS_Image *image = slot->image;
        Mask *mask = slot->mask;
        unsigned char *in_block = picture->block + (size_t) slot->y * width + slot->x;
        if (!mask) {
            mask = &picture->own[picture->own_count++];
            mask->w = image->w;
            mask->h = image->h;
            mask->pixels = in_block;
            mask->span = width;
            mask->gpu.x = slot->x;
            mask->gpu.y = slot->y;
        } else if (slot->carried) {
            picture->carried[picture->carried_count++] = (Carried) {mask, slot->x, slot->y};
        }
        if (slot->fresh) copy(image, mask->pixels, image->w);
        if (slot->carried) copy(image, in_block, width);
        picture->placed[i] = (Placed) {mask, image->dst_x, image->dst_y, image->color};
    }
    atomic_fetch_add(&store->bytes, picture->bytes);
    return picture;
}

void masks_release(MaskStore *store, Picture *picture) {
    if (!picture) return;
    pthread_mutex_lock(&store->lock);
    for (int i = 0; i < picture->count; i++) {
        if (!picture_owns(picture, picture->placed[i].mask)) drop(store, picture->placed[i].mask);
    }
    retire(store, &picture->gpu);
    atomic_fetch_sub(&store->bytes, picture->bytes);
    Picture *out = picture_spare(store, picture);
    pthread_mutex_unlock(&store->lock);
    free(out);
}

size_t masks_bytes(MaskStore *store) { return atomic_load(&store->bytes); }

void masks_keep(MaskStore *store, size_t bytes) {
    pthread_mutex_lock(&store->lock);
    store->keep = bytes;
    trim(store);
    pthread_mutex_unlock(&store->lock);
}

int masks_take_retired(MaskStore *store, GpuPlace *places, int max) {
    pthread_mutex_lock(&store->lock);
    int count = store->retired_count < max ? store->retired_count : max;
    if (count) {
        store->retired_count -= count;
        memcpy(places, store->retired + store->retired_count, count * sizeof(GpuPlace));
    }
    pthread_mutex_unlock(&store->lock);
    return count;
}

void masks_free(MaskStore *store) {
    if (!store) return;
    for (int i = 0; i < BUCKETS; i++) {
        for (Mask *mask = store->buckets[i], *next; mask; mask = next) {
            next = mask->next;
            free(mask);
        }
    }
    for (int i = 0; i < SPARES; i++) free(store->spare[i]);
    free(store->retired);
    free(store->slots);
    free(store->tall);
    pthread_mutex_destroy(&store->lock);
    free(store);
}
