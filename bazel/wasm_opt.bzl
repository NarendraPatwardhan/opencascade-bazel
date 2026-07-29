"""Post-link Binaryen size pass (AgentOS wasm_opt policy).

Compilers already emit release-small code; Binaryen sees the final linked
module and applies WebAssembly-specific DCE, folding, and packing.
"""

# Feature allowlist: match browsers + our Emscripten exception-handling output.
# Avoid --all-features so Binaryen cannot introduce unsupported opcodes.
_FEATURES = [
    "--enable-sign-ext",
    "--enable-mutable-globals",
    "--enable-nontrapping-float-to-int",
    "--enable-bulk-memory",
    "--enable-bulk-memory-opt",
    "--enable-exception-handling",  # OCCT uses C++ exceptions via emcc
]

def _wasm_opt_impl(ctx):
    out = ctx.actions.declare_file(ctx.label.name + ".wasm")
    opt = ctx.file._optimizer
    features = " ".join(_FEATURES)
    ctx.actions.run_shell(
        inputs = [ctx.file.wasm],
        tools = [opt],
        outputs = [out],
        command = '"{opt}" {features} -Oz --converge -o "{out}" "{inp}"'.format(
            opt = opt.path,
            features = features,
            out = out.path,
            inp = ctx.file.wasm.path,
        ),
        mnemonic = "WasmOpt",
        progress_message = "Binaryen -Oz %{label}",
    )
    return [DefaultInfo(files = depset([out]), runfiles = ctx.runfiles(files = [out]))]

wasm_opt = rule(
    implementation = _wasm_opt_impl,
    doc = "Optimize one final linked .wasm with pinned Binaryen -Oz --converge.",
    attrs = {
        "wasm": attr.label(
            allow_single_file = [".wasm"],
            mandatory = True,
            doc = "Unoptimized (or emcc-linked) .wasm input.",
        ),
        "_optimizer": attr.label(
            default = Label("//third_party/binaryen:wasm-opt"),
            allow_single_file = True,
            cfg = "exec",
        ),
    },
)
