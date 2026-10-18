//! 构建脚本：把 web/dist 里的前端资源嵌进二进制（单文件、轻量）。
//! 如果前端还没构建，就嵌入一个占位页，保证 cargo build 始终可用。
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn collect(dir: &Path, base: &Path, out: &mut String) -> usize {
    let mut count = 0;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            count += collect(&path, base, out);
        } else if path.is_file() {
            let rel = match path.strip_prefix(base) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let abs = path.to_string_lossy().replace('\\', "/");
            println!("cargo:rerun-if-changed={}", path.display());
            out.push_str(&format!(
                "    ({:?}, include_bytes!({:?})),\n",
                rel, abs
            ));
            count += 1;
        }
    }
    count
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../web/dist");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", dist.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let dest = out_dir.join("embedded_web.rs");
    let mut body = String::new();
    let count = if dist.is_dir() {
        collect(&dist, &dist, &mut body)
    } else {
        0
    };

    if count == 0 {
        let placeholder = r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Steam Cards</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#1a1a1a;color:#e7e5e4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{max-width:560px;padding:32px;border:1px solid #3f3f3f;border-radius:16px;background:#232323}h1{color:#d4714e;margin-top:0}code{background:#2d2d2d;padding:2px 6px;border-radius:6px}</style></head><body><div><h1>Steam Cards</h1><p>前端还没有构建。</p><p>在仓库的 <code>web/</code> 目录执行 <code>npm install &amp;&amp; npm run build</code>，再重新 <code>cargo build</code> 即可把界面嵌进这个二进制。</p></div></body></html>"#;
        body.push_str(&format!(
            "    (\"index.html\", {placeholder:?}.as_bytes()),\n"
        ));
    }

    let generated = format!(
        "// 由 build.rs 自动生成：web/dist 的嵌入式资源清单\npub static EMBEDDED_WEB: &[(&str, &[u8])] = &[\n{body}];\n"
    );
    fs::write(&dest, generated).expect("write embedded_web.rs");
    println!("cargo:warning=embedded web assets: {} file(s)", count.max(1));
}
