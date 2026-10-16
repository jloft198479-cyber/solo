#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
solo 编辑体验体检：在真实运行的 debug 构建上采集一组交互耗时基线。

口径说明（读数前必读）：
- 所有数字含 CDP 合成事件的开销（IPC 往返），不是 ProseMirror 内部纯计算耗时；
  用途是「同一台机器上优化前后对比」，不是绝对值排名。
- 轮询判据用浏览器侧 wait_for_function，墙钟计时含最后一次 IPC（毫秒级误差）。
- 打字测试的 200 字符走 CDP Input 域，每键延迟 ≈ 合成开销 + 主线程处理。

━━━ 已知坑（2026-10-12 四轮实测，部分未收敛，完善前必读）━━━
1. 【命令面板是 toggle】Ctrl+K 开/关是同一个键。「同文件重复打开」等场景面板不关，
   下一次 Ctrl+K 变成「关」⇒ 后续所有等待条目全部超时。⇒ 每次面板操作前后
   必须 close_palette()（已加，但整套长序列仍未跑通，见第 4 条）。
2. 【recent 是异步的】不能等「任一 .palette-item」——47 个命令条目先渲染，
   必须等目标文件条目本身 `wait_for_selector(".palette-item:has-text('<名>')")`。
3. 【recent 异步插入会重排】元素位移/detach ⇒ wait 之后 sleep 0.5s 再点，
   click timeout 拉到 15s（自带 stable 重试）。
4. 【脏文档切文件弹 Tauri 原生确认框】CDP 关不掉，整条链路挂死 ⇒ ensure_clean()
   先保存。但「点保存后 is-dirty 仍在」的情形 2026-10-12 未定位
   （疑似 overlay 拦截点击或原生错误框）⇒ 长序列目前不可靠。
5. 【未采用的更稳路线（推荐下次完善时用）】`npx tauri dev -- <file.md>` 启动即开文件
   （Rust 侧 open_paths_from_args 支持），一个实例只测一个文档的
   type/wc/save/outline 四个指标，完全绕开面板 toggle 与脏态切换。
6. 【起实例】cdp-verify-ui.py 的 launch_debug 用 Popen 起 npx 会
   FileNotFoundError（.cmd 无 shell 找不到）；可行路线 =
   python set_windows_msvc_env() 后用 Popen(['bash','-c','npx tauri dev'])。
   ⚠️ 别在 bash 里 export INCLUDE——MSYS 路径（/m/VS/...）会让 cl.exe
   找不到 windows.h，必须用原生 Windows 路径（python 侧设置）。
7. 【venv】playwright 只装在托管 venv：
   C:\\Users\\fzz198479.NOVA\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe
   （Windows venv 布局在 Scripts/，不是 bin/）。
8. 【已拿到的基线（2026-10-12，干净运行）】open-10k ≈285–309ms ·
   open-100k ≈289ms · open-450k ≈645ms（沙盒文档生成口径见 regen_sandbox，
   三份文档各 ~1/10/45 万字、每 20 段一个二级标题）。

用法：
  <venv python> scripts/perf-baseline.py            # 连已开的 CDP 端口
  <venv python> scripts/perf-baseline.py --launch   # 端口没开则自动起 debug 构建
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = r"F:\fzz-Project\md-editor"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
DEFAULT_PORT = 9222

SESSION_PATH = os.path.expandvars(
    r"%LOCALAPPDATA%\com.solomarkdown\session\document-session.json"
)
SANDBOX = os.path.join(ROOT, ".sandbox-perf")
DOCS = {
    # min_wc = 编辑器字数统计口径的宽松下限（≠ 字符数：getEditorWordCount 另有口径）
    "10k": ("perf-10k.md", 1_000),
    "100k": ("perf-100k.md", 20_000),
    "450k": ("perf-450k.md", 100_000),  # heavy 档：状态栏显示 ≈N 字（打开时算一次）
}


def port_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def backup_session() -> str | None:
    if not os.path.exists(SESSION_PATH):
        return None
    bak = SESSION_PATH + ".perf-bak"
    shutil.copy2(SESSION_PATH, bak)
    return bak


def write_session(recent: list[str]) -> None:
    os.makedirs(os.path.dirname(SESSION_PATH), exist_ok=True)
    with open(SESSION_PATH, "w", encoding="utf-8") as f:
        json.dump({"recentFiles": recent, "readingPositions": {}}, f)


def restore_session(bak: str | None) -> None:
    if bak and os.path.exists(bak):
        shutil.copy2(bak, SESSION_PATH)
        os.remove(bak)


def regen_sandbox() -> None:
    """重生成沙盒文档：清掉打字测试留下的脏痕，保证下次可复现。"""
    def gen(n_paras: int, name: str) -> None:
        lines = []
        for i in range(n_paras):
            if i % 20 == 0:
                lines.append(f"## 第 {i//20+1} 节标题")
            lines.append(
                f"第 {i+1} 段：他说：「**重点**」在这里，我们需要一段足够长的中文文字来模拟真实写作，"
                f"包含标点、[链接](https://example.com)和`行内代码`，让内容更接近实际文档。"
                f"第 {i+1} 段：他说：「**重点**」在这里，我们需要一段足够长的中文文字来模拟真实写作，"
                f"包含标点、[链接](https://example.com)和`行内代码`，让内容更接近实际文档。"
            )
        with open(os.path.join(SANDBOX, name), "w", encoding="utf-8") as f:
            f.write("\n\n".join(lines) + "\n")

    os.makedirs(SANDBOX, exist_ok=True)
    gen(50, "perf-10k.md")
    gen(500, "perf-100k.md")
    gen(2200, "perf-450k.md")


def stat_word_text(page) -> str:
    return page.evaluate(
        "() => { const el = document.querySelector('.minimal-statusbar');"
        " return el ? el.innerText : ''; }"
    )


def wait_word_count(page, min_count: int, timeout_ms: int = 60_000) -> None:
    page.wait_for_function(
        "(min) => {"
        "  const el = document.querySelector('.minimal-statusbar');"
        "  if (!el) return false;"
        "  const m = el.innerText.match(/([\\d,]+)\\s*字/);"
        "  return m ? parseInt(m[1].replace(/,/g, '')) >= min : false;"
        "}",
        arg=min_count,
        timeout=timeout_ms,
    )


def close_palette(page) -> None:
    """确保命令面板关闭：Ctrl+K 是 toggle 语义，面板残留会让下一次 Ctrl+K 变成「关」，
    后续等待条目全部超时（实测根因）。每次面板操作前后都显式归位。"""
    if page.query_selector(".palette-dialog"):
        page.keyboard.press("Escape")
        try:
            page.wait_for_selector(".palette-dialog", state="detached", timeout=2_000)
        except Exception:
            pass


def ensure_clean(page) -> None:
    """切换文件前保证当前文档干净：脏则先点保存并等成功态。
    否则 openDocumentWithPrompt 会弹 Tauri 原生确认框——CDP 关不掉，整条链路挂死。"""
    if page.query_selector(".statusbar-save-btn.is-dirty"):
        page.click(".statusbar-save-btn", timeout=5_000)
        try:
            page.wait_for_selector(".statusbar-stat--success", timeout=10_000)
        except Exception:
            page.wait_for_selector(".statusbar-save-btn.is-clean", timeout=5_000)


def measure_open(page, key: str) -> float:
    """Ctrl+K → 点最近文件条目 → 字数就绪。返回毫秒。"""
    name, min_wc = DOCS[key]
    ensure_clean(page)
    close_palette(page)
    page.keyboard.press("Control+k")
    # ⚠️ 不能等「任一 .palette-item」——47 个命令条目先渲染，recent 是异步读取的，
    # 必须等目标文件条目本身出现（否则 click 踩竞态，实测 5s 超时）。
    page.wait_for_selector(f".palette-item:has-text('{name}')", timeout=10_000)
    # recent 异步插入会重排列表（元素位移/detach），等重排落定再点；
    # click 自带 stable 重试，窗口拉到 15s 兜底。
    time.sleep(0.5)
    page.click(f".palette-item:has-text('{name}')", timeout=15_000)
    t0 = time.perf_counter()
    wait_word_count(page, min_wc)
    close_palette(page)
    return (time.perf_counter() - t0) * 1000


def measure_type(page, chars: int = 200) -> float:
    """编辑器内连续输入，返回每键毫秒。"""
    close_palette(page)
    page.click(".ProseMirror", timeout=5_000)
    page.keyboard.press("End")
    t0 = time.perf_counter()
    page.keyboard.type("测" * chars, delay=0)
    total_ms = (time.perf_counter() - t0) * 1000
    return total_ms / chars


def measure_wc_latency(page) -> float:
    """打 1 个中文字 → 状态栏字数 +1（设计防抖 150ms）。中文字保证计数 +1。"""
    before = stat_word_text(page)
    m = re.search(r"([\d,]+)\s*字", before)
    if not m:
        return float("nan")
    target = int(m.group(1).replace(",", "")) + 1
    close_palette(page)
    page.click(".ProseMirror", timeout=5_000)
    t0 = time.perf_counter()
    page.keyboard.type("测", delay=0)
    page.wait_for_function(
        "(n) => {"
        "  const el = document.querySelector('.minimal-statusbar');"
        "  if (!el) return false;"
        "  const m = el.innerText.match(/([\\d,]+)\\s*字/);"
        "  return m ? parseInt(m[1].replace(/,/g, '')) >= n : false;"
        "}",
        arg=target,
        timeout=10_000,
    )
    return (time.perf_counter() - t0) * 1000


def measure_save_latency(page) -> float:
    """脏文档点保存按钮 → 「已保存」类 success 状态出现。"""
    close_palette(page)
    # 先制造脏态
    page.click(".ProseMirror", timeout=5_000)
    page.keyboard.type("脏", delay=0)
    time.sleep(0.05)
    t0 = time.perf_counter()
    page.click(".statusbar-save-btn", timeout=5_000)
    page.wait_for_selector(".statusbar-stat--success", timeout=10_000)
    return (time.perf_counter() - t0) * 1000


def measure_outline_ready(page, key: str) -> float:
    """打开文档后大纲首条出现（emitImmediateStats 同步路径）。"""
    name, _ = DOCS[key]
    ensure_clean(page)
    close_palette(page)
    page.keyboard.press("Control+k")
    page.wait_for_selector(f".palette-item:has-text('{name}')", timeout=10_000)
    time.sleep(0.5)  # 等 recent 异步重排落定
    page.click(f".palette-item:has-text('{name}')", timeout=15_000)
    close_palette(page)
    # 确保大纲面板开着
    if not page.query_selector(".outline-panel.is-open"):
        page.click(".outline-list-icon", timeout=5_000)
    t0 = time.perf_counter()
    page.wait_for_selector(".outline-panel.is-open .outline-item", timeout=30_000)
    return (time.perf_counter() - t0) * 1000


def median(xs: list[float]) -> float:
    xs = sorted(x for x in xs if x == x)
    return xs[len(xs) // 2] if xs else float("nan")


def run(page) -> list[tuple[str, float]]:
    rows: list[tuple[str, float]] = []
    page.wait_for_selector(".minimal-statusbar", timeout=30_000)
    time.sleep(1.0)  # 等初始 stats 落定

    # 先做全部「打开」测量（文档均干净，不弹原生确认框）
    for key in ("10k", "450k"):
        samples = []
        for _ in range(3):
            samples.append(measure_open(page, key))
        rows.append((f"open-{key}", median(samples)))
    rows.append(("open-100k", measure_open(page, "100k")))

    # 大纲就绪（此时 10k 已加载过？不——最后打开的是 100k；重新打开 10k 测大纲）
    rows.append(("outline-ready-10k", measure_outline_ready(page, "10k")))

    # 打字链路（10k normal 档：wc 实时；450k heavy 档：wc 降级）
    rows.append(("type-10k", measure_type(page, 200)))
    rows.append(("wc-latency-10k", measure_wc_latency(page)))
    rows.append(("save-latency-10k", measure_save_latency(page)))
    ensure_clean(page)
    rows.append(("open-450k-again", measure_open(page, "450k")))
    rows.append(("type-450k", measure_type(page, 200)))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--launch", action="store_true")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()

    if not port_up(args.port):
        if not args.launch:
            print(f"[!] 端口 {args.port} 未就绪，加 --launch 自动起 debug 构建")
            raise SystemExit(2)
        from cdp_verify_ui import launch_debug

        launch_debug(args.port)

    bak = backup_session()
    regen_sandbox()
    write_session([os.path.join(SANDBOX, DOCS[k][0]) for k in ("450k", "100k", "10k")])

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://localhost:{args.port}")
            page = None
            for ctx in browser.contexts:
                if ctx.pages:
                    page = ctx.pages[0]
                    break
            if page is None:
                page = browser.contexts[0].new_page()
            rows = run(page)

        print("\n===== 体验基线（ms，3 次取中位 / 单次）=====")
        for name, v in rows:
            print(f"  {name:<22} {v:>10.1f}")

        out = os.path.join(ROOT, "outputs", "perf-baseline-2026-10-12.md")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write("# solo 编辑体验基线（2026-10-12，debug 构建 + CDP 实测）\n\n")
            f.write("口径：含 CDP 合成事件开销；用于同机优化前后对比，非绝对值排名。\n\n")
            f.write("| 指标 | ms |\n|---|---|\n")
            for name, v in rows:
                f.write(f"| {name} | {v:.1f} |\n")
        print(f"\n[+] 基线表 -> {out}")
    finally:
        restore_session(bak)
        regen_sandbox()  # 清掉打字脏痕
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/IM", "solo.exe"],
                           capture_output=True)
        print("[*] 已恢复 session.json + 重生成沙盒文档 + 关闭实例")


if __name__ == "__main__":
    main()
