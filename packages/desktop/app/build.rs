fn main() {
    println!("cargo:rerun-if-changed=icons/aiostreams.ico");
    match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("windows") => {
            winresource::WindowsResource::new()
                .set_icon("icons/aiostreams.ico")
                .set("ProductName", "AIOStreams")
                .set("FileDescription", "AIOStreams")
                .compile()
                .expect("could not embed the Windows resources");
        }
        // libmpv's libraries find each other through the run paths of the app that loads them.
        Ok("macos") => {
            println!("cargo:rustc-link-arg-bins=-Wl,-rpath,@executable_path/../Frameworks");
            if std::env::var("PROFILE").as_deref() == Ok("debug") {
                let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
                    Ok("aarch64") => "arm64",
                    _ => "x86_64",
                };
                let vendor = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../vendor")
                    .join(format!("macos-{arch}"));
                println!("cargo:rustc-link-arg-bins=-Wl,-rpath,{}", vendor.display());
            }
        }
        _ => {}
    }
}
