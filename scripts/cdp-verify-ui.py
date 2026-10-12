#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent 一键自验 solo 真实 UI（debug 构建 + WebView2 CDP）。

用途：改完 UI / 主题 / IME 后，连上真实运行的 solo 窗口，截图 + 读 DOM 文本，
      让 Agent 不靠单测推断就能"看"到渲染结果。

机制（见 docs/agent-playbook.md §F）：
  - debug 构建默认在 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 注入
    --remote-debugging-port=9222（端口可用 SOLO_CDP_PORT 覆盖）；
    release 构建被 #[cfg(debug_assertions)] 剪除，永不暴露端口。
  - 本脚本只连已开的端口、或可选地自动起一个 debug 构建。

用法：
  python scripts/cdp-verify-ui.py                # 端口已开时直接连 + 截图 + 读 DOM
  python scripts/cdp-verify-ui.py --launch       # 端口没开则自动起 debug 构建再连
  python scripts/cdp-verify-ui.py --port 9223    # 换端口（同时起构建时用 SOLO_CDP_PORT）
  python scripts/cdp-verify-ui.py --out out.png  # 指定截图路径

退出码：0=成功；2=端口未就绪且未加 --launch；3=playwright 不可用且自动安装失败。
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = r"F:\fzz-Project\md-editor"
DEFAULT_PORT = 9222


def port_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_playwright() -> bool:
    """playwright 缺则装到当前 python（connect_over_cdp 不需要下载浏览器内核）。"""
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        print("[*] playwright 未安装，正在装到当前 python ...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"[!] playwright 自动安装失败: {e}", file=sys.stderr)
            return False


def set_windows_msvc_env(env: dict) -> None:
    """仅 Windows + 需要编译（--launch）时：手工注入 MSVC 环境。

    坑：WorkBuddy 沙箱的 Bash/PowerShell 都禁调 cmd.exe，文档的 vcvars64.bat 路线走不通；
        DevShell 模块本机解析异常（M:\\VS\\BuildToolsX），弃用。故纯 Python 手动注入。
        cargo 必须在 PATH（否则 tauri 调 cargo 报 program not found）；rc.exe 所在 SDK bin
        也必须在 PATH（tauri-winres 要用）。
    """
    if os.name != "nt":
        return
    msvc_base = r"M:\VS\BuildTools\VC\Tools\MSVC"
    if not os.path.isdir(msvc_base):
        return
    ver = sorted(os.listdir(msvc_base))[-1]
    sdk_base = r"C:\Program Files (x86)\Windows Kits\10"
    sdk_ver = sorted(os.listdir(os.path.join(sdk_base, "Lib")))[-1]
    msvc_root = os.path.join(msvc_base, ver)
    sdk_bin = os.path.join(sdk_base, "bin", sdk_ver, "x64")
    env["VCINSTALLDIR"] = r"M:\VS\BuildTools\VC"
    env["WindowsSdkDir"] = sdk_base + "\\"
    env["PATH"] = ";".join([
        os.path.join(msvc_root, "bin", "Hostx64", "x64"),
        sdk_bin,
        r"M:\rust\.cargo\bin",
        r"D:\nodejs",
        r"D:\nodejs\npm-global",  # bun 在 npm 全局 prefix（tauri.conf.json beforeDevCommand=bun run dev）
        os.path.join(ROOT, "node_modules", ".bin"),
        env.get("PATH", ""),
    ])
    env["INCLUDE"] = ";".join([
        os.path.join(msvc_root, "include"),
        os.path.join(sdk_base, "Include", sdk_ver, "ucrt"),
        os.path.join(sdk_base, "Include", sdk_ver, "um"),
        os.path.join(sdk_base, "Include", sdk_ver, "shared"),
    ])
    env["LIB"] = ";".join([
        os.path.join(msvc_root, "lib", "x64"),
        os.path.join(sdk_base, "Lib", sdk_ver, "ucrt", "x64"),
        os.path.join(sdk_base, "Lib", sdk_ver, "um", "x64"),
    ])
    env["CARGO_HOME"] = r"M:\rust\.cargo"
    env["RUSTUP_HOME"] = r"M:\rust\.rustup"


def launch_debug(port: int, timeout: int = 300) -> subprocess.Popen:
    env = os.environ.copy()
    set_windows_msvc_env(env)
    env["SOLO_CDP_PORT"] = str(port)  # 端口被占就换一个，避免单实例/端口冲突
    print(f"[*] 自动起 debug 构建 (SOLO_CDP_PORT={port})，最多等 {timeout}s ...")
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0
    # 输出落日志文件（勿 DEVNULL）：beforeDevCommand 失败时 tauri dev 秒退，
    # 没日志就等于盲猜；路径与下方超时提示一致。
    log_path = os.path.join(ROOT, "outputs", "tauri-dev-run.log")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    log_file = open(log_path, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        ["npx", "tauri", "dev"],
        cwd=ROOT,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_up(port):
            print(f"[+] CDP 端口 {port} 已就绪")
            return proc
        time.sleep(3)
    raise SystemExit(f"[!] tauri dev 在 {timeout}s 内未起好 CDP 端口 {port}（可能单实例冲突或编译报错，见 outputs/tauri-dev-run.log）")


def connect_and_shoot(port: int, out: str) -> None:
    from playwright.sync_api import sync_playwright

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{port}")
        print(f"[+] 已连 CDP，contexts={len(browser.contexts)}")
        page = None
        for ctx in browser.contexts:
            if ctx.pages:
                page = ctx.pages[0]
                break
        if page is None:
            page = browser.contexts[0].new_page()
        print(f"[+] page title={page.title()!r} url={page.url!r}")
        page.wait_for_timeout(2000)
        page.screenshot(path=out, full_page=False)
        txt = page.evaluate(
            "() => (document.body ? document.body.innerText.slice(0,200) : '(no body)')"
        )
        print(f"[+] DOM 文本样本: {txt!r}")
        print(f"[+] 截图 -> {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Agent 一键自验 solo 真实 UI（CDP 截图 + 读 DOM）")
    ap.add_argument("--launch", action="store_true", help="端口没开时自动起 debug 构建")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--out", default=os.path.join(ROOT, "outputs", "verify-ui.png"))
    ap.add_argument("--timeout", type=int, default=300, help="--launch 时等待构建的秒数")
    args = ap.parse_args()

    if not port_up(args.port):
        if args.launch:
            launch_debug(args.port, timeout=args.timeout)
        else:
            print(f"[!] 端口 {args.port} 未就绪。请先起 debug 版 (npx tauri dev)，或加 --launch。")
            raise SystemExit(2)

    if not ensure_playwright():
        raise SystemExit(3)

    connect_and_shoot(args.port, args.out)
    print("[done] 自验完成；Read 上面截图的路径确认渲染 / 主题 / 布局。")


if __name__ == "__main__":
    main()
