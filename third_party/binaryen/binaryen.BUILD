# BUILD file for a Binaryen release tarball (version_*/bin/wasm-opt).
exports_files(["bin/wasm-opt"])

# Executable for Bazel actions (post-link size pass).
filegroup(
    name = "wasm-opt",
    srcs = ["bin/wasm-opt"],
    visibility = ["//visibility:public"],
)
