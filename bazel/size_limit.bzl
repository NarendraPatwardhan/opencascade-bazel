"""Fail the build if a single artifact exceeds a byte budget (AgentOS size_limit)."""

load("@bazel_skylib//rules:build_test.bzl", "build_test")

def _size_limit_check_impl(ctx):
    f = ctx.file.file
    ok = ctx.actions.declare_file(ctx.label.name + ".ok")
    ctx.actions.run_shell(
        inputs = [f],
        outputs = [ok],
        command = """set -euo pipefail
sz=$(wc -c < "{path}")
if [ "$sz" -gt "{max}" ]; then
  echo "{name}: $sz bytes — OVER the {max}-byte budget by $((sz - {max}))." >&2
  exit 1
fi
echo "{name}: $sz bytes ({max}-byte budget, $(({max} - sz)) headroom)."
touch "{ok}"
""".format(path = f.path, max = ctx.attr.max_bytes, name = f.basename, ok = ok.path),
        mnemonic = "SizeLimit",
        progress_message = "Size budget: %s" % f.short_path,
    )
    return [DefaultInfo(files = depset([ok]))]

_size_limit_check = rule(
    implementation = _size_limit_check_impl,
    attrs = {
        "file": attr.label(allow_single_file = True, mandatory = True),
        "max_bytes": attr.int(mandatory = True),
    },
)

def size_limit(name, file, max_bytes, tags = None):
    """Build-test that fails if `file` exceeds `max_bytes`."""
    _size_limit_check(
        name = name + ".check",
        file = file,
        max_bytes = max_bytes,
        tags = (tags or []) + ["manual"],
    )
    build_test(
        name = name,
        targets = [":" + name + ".check"],
        tags = tags,
    )
