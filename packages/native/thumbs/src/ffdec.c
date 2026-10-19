#include <libavcodec/avcodec.h>
#include <libavutil/dict.h>
#include <libavutil/frame.h>
#include <libavutil/pixdesc.h>
#include <string.h>

typedef struct {
    AVCodecContext *ctx;
    AVPacket *pkt;
    AVFrame *frame;
} ffd;

typedef struct {
    int width, height, bits, log2_chroma_w, log2_chroma_h, planar_yuv;
    const uint8_t *data[3];
    int linesize[3];
    int color_range, color_primaries, color_trc, colorspace;
    int has_dovi;
    const char *pix_fmt;
} ffd_frame;

static void put_err(int ret, char *err, int errlen) {
    if (err && errlen > 0) av_strerror(ret, err, errlen);
}

ffd *ffd_open(const char *name, int threads, int skip_loop_filter, int fast, int low_delay, char *err, int errlen) {
    const AVCodec *codec = avcodec_find_decoder_by_name(name);
    if (!codec) {
        if (err) snprintf(err, errlen, "no decoder %s", name);
        return NULL;
    }
    ffd *d = av_mallocz(sizeof(*d));
    d->ctx = avcodec_alloc_context3(codec);
    d->pkt = av_packet_alloc();
    d->frame = av_frame_alloc();
    AVDictionary *opts = NULL;
    char n[16];
    snprintf(n, sizeof(n), "%d", threads);
    av_dict_set(&opts, "threads", n, 0);
    av_dict_set(&opts, "thread_type", "slice", 0);
    if (skip_loop_filter) av_dict_set(&opts, "skip_loop_filter", "all", 0);
    if (fast) av_dict_set(&opts, "flags2", "+fast", 0);
    if (low_delay) av_dict_set(&opts, "flags", "+low_delay", 0);
    // libdav1d: keep film grain out of the picture.
    av_dict_set(&opts, "export_side_data", "film_grain", 0);
    int ret = avcodec_open2(d->ctx, codec, &opts);
    av_dict_free(&opts);
    if (ret < 0) {
        put_err(ret, err, errlen);
        avcodec_free_context(&d->ctx);
        av_packet_free(&d->pkt);
        av_frame_free(&d->frame);
        av_free(d);
        return NULL;
    }
    return d;
}

int ffd_decode(ffd *d, const uint8_t *buf, int size, ffd_frame *out, char *err, int errlen) {
    av_frame_unref(d->frame);
    avcodec_flush_buffers(d->ctx);
    int ret = av_new_packet(d->pkt, size);
    if (ret < 0) return ret;
    memcpy(d->pkt->data, buf, size);
    d->pkt->flags |= AV_PKT_FLAG_KEY;
    ret = avcodec_send_packet(d->ctx, d->pkt);
    av_packet_unref(d->pkt);
    if (ret < 0) {
        put_err(ret, err, errlen);
        return ret;
    }
    avcodec_send_packet(d->ctx, NULL);
    ret = avcodec_receive_frame(d->ctx, d->frame);
    if (ret < 0) {
        put_err(ret, err, errlen);
        return ret;
    }
    const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(d->frame->format);
    memset(out, 0, sizeof(*out));
    out->width = d->frame->width;
    out->height = d->frame->height;
    out->pix_fmt = desc ? desc->name : "?";
    if (desc) {
        out->bits = desc->comp[0].depth;
        out->log2_chroma_w = desc->log2_chroma_w;
        out->log2_chroma_h = desc->log2_chroma_h;
        out->planar_yuv = (desc->flags & AV_PIX_FMT_FLAG_PLANAR) && !(desc->flags & AV_PIX_FMT_FLAG_RGB) &&
                          desc->nb_components >= 3 && !(desc->flags & AV_PIX_FMT_FLAG_BE) &&
                          desc->comp[1].plane == 1 && desc->comp[2].plane == 2;
    }
    for (int i = 0; i < 3; i++) {
        out->data[i] = d->frame->data[i];
        out->linesize[i] = d->frame->linesize[i];
    }
    out->color_range = d->frame->color_range;
    out->color_primaries = d->frame->color_primaries;
    out->color_trc = d->frame->color_trc;
    out->colorspace = d->frame->colorspace;
    out->has_dovi = av_frame_get_side_data(d->frame, AV_FRAME_DATA_DOVI_METADATA) != NULL;
    return 0;
}

void ffd_close(ffd *d) {
    if (!d) return;
    avcodec_free_context(&d->ctx);
    av_packet_free(&d->pkt);
    av_frame_free(&d->frame);
    av_free(d);
}
