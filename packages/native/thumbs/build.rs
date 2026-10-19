fn main() {
    let dir =
        std::env::var("FFMPEG_DIR").expect("FFMPEG_DIR: an FFmpeg prefix with include/ and lib/");
    cc::Build::new()
        .file("src/ffdec.c")
        .include(format!("{dir}/include"))
        .opt_level(2)
        .compile("ffdec");
    println!("cargo:rustc-link-search=native={dir}/lib");
    println!("cargo:rustc-link-lib=dylib=avcodec");
    println!("cargo:rustc-link-lib=dylib=avutil");
    println!("cargo:rerun-if-changed=src/ffdec.c");
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");
}
