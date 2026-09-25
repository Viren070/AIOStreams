fn main() {
    println!("cargo:rerun-if-changed=icons/aiostreams.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon("icons/aiostreams.ico")
            .set("ProductName", "AIOStreams")
            .set("FileDescription", "AIOStreams")
            .compile()
            .expect("could not embed the Windows resources");
    }
}
