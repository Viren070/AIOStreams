{
  "targets": [
    {
      "target_name": "aios_crypto",
      "sources": ["src/aes_cbc.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-O2"],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      },
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_LDFLAGS": ["-undefined dynamic_lookup"],
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            }
          }
        ]
      ]
    }
  ]
}
