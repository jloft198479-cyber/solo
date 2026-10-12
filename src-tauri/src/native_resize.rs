//! Windows 原生边缘缩放热区（边框覆盖子窗）。
//!
//! # 为什么需要这个模块
//!
//! `decorations(false) + transparent(true) + shadow(true)` 下，
//! tauri-runtime-wry 的无边框缩放实现（`undecorated_resizing.rs`）在阴影
//! 模式只保留窗口顶部一条原生命中带（实测 `TAURI_DRAG_RESIZE_BORDERS` 子窗
//! 区域仅 `整宽 × SM_CYFRAME`，左/右/下内缘全无）。客户区内部边缘原本全靠
//! 前端 8 个透明 div 走 `startResizeDragging` 异步 IPC，存在竞态窗口，表现为
//! 「拉一次不动、连续试两三次才中」。
//!
//! # 修法：边框覆盖子窗（与官方顶边带完全同构）
//!
//! 在父窗上创建一个铺满客户区的 `WS_CHILD` 子窗，用窗口区域镂空成边框
//! （四角 corner×corner、四边 edge 厚），z-order 顶在 WebView2 之上：
//! - `WM_NCHITTEST` 在边框区域内直接返回 `HTLEFT/HTTOPLEFT/...`，系统据此
//!   显示真缩放光标（不是 CSS 假光标）；
//! - `WM_NCLBUTTONDOWN` 转发给父窗，由 `DefWindowProc` 进入系统原生缩放
//!   模态循环——零 JS、零 IPC、零竞态，Aero 吸附/双击最大化全部继承；
//! - 父窗 `WM_SIZE` 后同步尺寸、重建区域，并在 tauri 子窗调整完之后把本层
//!   重新置顶（四角才不会被其顶边条判成 HTTOP）。
//!
//! 边厚取 `SM_CxSIZEFRAME + SM_CxPADDEDBORDER`（100% DPI = 8px，与窗口外侧
//! 阴影原生带等宽，内外拼成连续 16px），角 12 逻辑像素随 DPI 缩放。
//!
//! # v1 教训（为什么不是子类化父窗）
//!
//! 曾经只在父窗窗口过程链顶端拦截 `WM_NCHITTEST` 补内缘命中：对父窗直接
//! `SendMessage(WM_NCHITTEST)` 扫描全部正确，但真实鼠标在客户区内的消息
//! 命中的是 `Chrome_RenderWidgetHostHWND`（WebView2 子窗），父窗过程根本
//! 收不到——静态扫描给了假绿灯，真机仍然不灵。结论：命中层必须在
//! WebView2 **之上**（z-order 更高的兄弟子窗），只在父窗上做文章无效。
//!
//! # 守卫
//!
//! - 全屏：tao 移除父窗 `WS_SIZEBOX` 样式，区域清空、命中穿透；
//! - 最大化：`GetWindowPlacement` 判定，同样禁用（与 tauri 行为一致）。
//!
//! 前端 div / IPC 路径在 Windows 上自此不被触发，组件保留作 macOS 兜底。
#![cfg(target_os = "windows")]

use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, HBRUSH, HGDIOBJ, HRGN, RGN_COPY, RGN_OR,
    ScreenToClient, SetWindowRgn,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

// 消息常量（windows crate 0.61 已导出同名常量，局部别名只为可读性）。
const WM_SIZE: u32 = 0x0005;
const WM_WINDOWPOSCHANGED: u32 = 0x0047;
const WM_NCHITTEST: u32 = 0x0084;
const WM_NCLBUTTONDOWN: u32 = 0x00A1;
const WM_NCDESTROY: u32 = 0x0082;

/// 子类标识（FourCC `SOR2`），避开 tao / tauri-runtime-wry 已注册的子类 id。
const OVERLAY_SUBCLASS_ID: usize = 0x534F_5232;

const CLASS_NAME: PCWSTR = w!("SOLO_RESIZE_OVERLAY");
const WINDOW_NAME: PCWSTR = w!("SOLO_RESIZE_OVERLAY_WINDOW");

const USER_DEFAULT_SCREEN_DPI: u32 = 96;

/// 客户区内角区厚度（CSS 逻辑像素），与前端角热区（12px）对齐。
const CORNER_LOGICAL_PX: f32 = 12.0;

struct OverlayData {
    child: HWND,
}

/// 给窗口挂上原生边缘缩放覆盖层。幂等（已挂则跳过）。
pub fn attach(window: &tauri::WebviewWindow) {
    // CreateWindow / SetWindowSubclass 必须在窗口所属线程调用。editor-N
    // 窗口由 async command 在 tokio worker 线程创建，故一律派发到主线程。
    let main_thread_window = window.clone();
    let result = window.run_on_main_thread(move || unsafe {
        let Ok(parent) = main_thread_window.hwnd() else {
            return;
        };
        // 幂等：已存在同名子窗说明挂载过。
        if FindWindowExW(Some(parent), None, CLASS_NAME, PCWSTR::null()).is_ok() {
            return;
        }
        register_window_class();
        if let Some(data) = create_overlay(parent) {
            update_overlay(&*data, parent);
            let _ = SetWindowSubclass(
                parent,
                Some(parent_subclass_proc),
                OVERLAY_SUBCLASS_ID,
                data as usize,
            );
        }
    });
    if let Err(error) = result {
        eprintln!("[native-resize] 挂载边缘缩放覆盖层失败: {error}");
    }
}

/// 注册覆盖子窗的窗口类（重复注册失败可忽略，与 tauri 同款写法）。
unsafe fn register_window_class() {
    let Ok(hinstance) = GetModuleHandleW(PCWSTR::null()) else {
        return;
    };
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: WNDCLASS_STYLES::default(),
        lpfnWndProc: Some(overlay_wndproc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: HINSTANCE(hinstance.0),
        hIcon: HICON::default(),
        hCursor: HCURSOR::default(),
        hbrBackground: HBRUSH::default(),
        lpszMenuName: PCWSTR::null(),
        lpszClassName: CLASS_NAME,
        hIconSm: HICON::default(),
    };
    let _ = RegisterClassExW(&class as *const WNDCLASSEXW);
}

/// 创建铺满父窗客户区、区域镂空（仅边框实体）的覆盖子窗。
///
/// 返回堆分配的状态指针，所有权随子类 dwRefData 移交，WM_NCDESTROY 回收。
unsafe fn create_overlay(parent: HWND) -> Option<*mut OverlayData> {
    let hinstance = HINSTANCE(GetModuleHandleW(PCWSTR::null()).ok()?.0);

    let mut rect = RECT::default();
    GetClientRect(parent, &mut rect).ok()?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    let child = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        CLASS_NAME,
        WINDOW_NAME,
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        0,
        0,
        width,
        height,
        Some(parent),
        None,
        Some(hinstance),
        None,
    )
    .ok()?;

    Some(Box::into_raw(Box::new(OverlayData { child })))
}

/// 父窗口过程钩子：同步尺寸、区域，并在 tauri 自己的覆盖子窗调整完后
/// 再把本层顶到最前，保证四角不被其顶边条盖住。
unsafe extern "system" fn parent_subclass_proc(
    parent: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id_subclass: usize,
    data_ptr: usize,
) -> LRESULT {
    match msg {
        WM_SIZE | WM_WINDOWPOSCHANGED => {
            // 先让窗口过程链下游（含 tauri-runtime-wry 的子类）完成调整，
            // 最后再落本层的尺寸 / 区域 / z-order，终态以本层为准。
            // WM_WINDOWPOSCHANGED 是一批移动/缩放/状态消息的最后一条，
            // 最大化→还原的过渡消息可能分多批到达，必须在它上面再断言一次，
            // 否则区域会短暂停留在「最大化的空区域」上（还原后数秒抓不到边）。
            let result = DefSubclassProc(parent, msg, wparam, lparam);
            update_overlay(&*(data_ptr as *const OverlayData), parent);
            result
        }
        WM_NCDESTROY => {
            let result = DefSubclassProc(parent, msg, wparam, lparam);
            let data = &*(data_ptr as *const OverlayData);
            // 父窗销毁时子窗通常已被系统连带销毁，失败无害。
            let _ = DestroyWindow(data.child);
            let _ = RemoveWindowSubclass(parent, Some(parent_subclass_proc), OVERLAY_SUBCLASS_ID);
            drop(Box::from_raw(data_ptr as *mut OverlayData));
            result
        }
        _ => DefSubclassProc(parent, msg, wparam, lparam),
    }
}

/// 重新设定覆盖子窗的尺寸 / 命中区域 / z-order。
///
/// - 尺寸铺满父窗客户区；
/// - 可缩放且非最大化时区域为边框（边 8 / 角 12，随 DPI）；
/// - 不可缩放（含全屏）或最大化时区域为空，鼠标事件全部穿透。
unsafe fn update_overlay(data: &OverlayData, parent: HWND) {
    let child = data.child;

    let mut rect = RECT::default();
    if GetClientRect(parent, &mut rect).is_err() {
        return;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    let _ = SetWindowPos(
        child,
        Some(HWND_TOP),
        0,
        0,
        width,
        height,
        SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
    );

    let style = WINDOW_STYLE(GetWindowLongW(parent, GWL_STYLE) as u32);
    let resizable = (style & WS_SIZEBOX).0 != 0;
    let region = if resizable && !is_maximized(parent) {
        frame_region(parent, width, height)
    } else {
        // 空区域：覆盖窗存在但永不命中，等同禁用。
        CreateRectRgn(0, 0, 0, 0)
    };

    if SetWindowRgn(child, Some(region), true) == 0 {
        // 成功时区域所有权移交系统；失败才需要手动释放。
        let _ = DeleteObject(HGDIOBJ(region.0));
    }
}

/// 覆盖子窗窗口过程：边框区域内给出原生 HT* 命中，按下时转发
/// WM_NCLBUTTONDOWN 给父窗，由 DefWindowProc 进入系统原生缩放模态循环。
unsafe extern "system" fn overlay_wndproc(
    child: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_NCHITTEST => {
            if let Ok(parent) = GetParent(child) {
                if let Some(hit) = edge_hit_test(parent, lparam) {
                    return LRESULT(hit as i32 as isize);
                }
            }
            // 理论上区域外的像素消息根本到不了本窗；防御性穿透。
            LRESULT(HTTRANSPARENT as i32 as isize)
        }
        WM_NCLBUTTONDOWN => {
            if let Ok(parent) = GetParent(child) {
                if let Some(hit) = edge_hit_test(parent, lparam) {
                    // 标准 WM_NCLBUTTONDOWN：lParam 低字 x、高字 y（屏幕坐标）。
                    let x = signed_low_word(lparam.0) as u16 as isize;
                    let y = signed_high_word(lparam.0) as u16 as isize;
                    let packed = (y << 16) | (x & 0xFFFF);
                    let _ = PostMessageW(
                        Some(parent),
                        WM_NCLBUTTONDOWN,
                        WPARAM(hit as usize),
                        LPARAM(packed),
                    );
                    return LRESULT(0);
                }
            }
            DefWindowProcW(child, msg, wparam, lparam)
        }
        _ => DefWindowProcW(child, msg, wparam, lparam),
    }
}

/// 计算屏幕坐标点相对父窗客户区的缩放命中。
///
/// 守卫：① 父窗样式含 WS_SIZEBOX（全屏时 tao 移除它）；② 非最大化。
/// 角区优先于边；边厚取系统缩放框度量（100% DPI 下 8px），角 12 逻辑像素。
unsafe fn edge_hit_test(parent: HWND, lparam: LPARAM) -> Option<u32> {
    let style = WINDOW_STYLE(GetWindowLongW(parent, GWL_STYLE) as u32);
    if (style & WS_SIZEBOX).0 == 0 {
        return None;
    }
    if is_maximized(parent) {
        return None;
    }

    let mut client = RECT::default();
    GetClientRect(parent, &mut client).ok()?;

    let mut point = POINT {
        x: signed_low_word(lparam.0),
        y: signed_high_word(lparam.0),
    };
    if !ScreenToClient(parent, &mut point).as_bool() {
        return None;
    }
    if point.x < 0 || point.y < 0 || point.x >= client.right || point.y >= client.bottom {
        return None;
    }

    let (edge_x, edge_y, corner) = edge_metrics(parent);

    let near_left = point.x < corner;
    let near_right = point.x >= client.right - corner;
    let near_top = point.y < corner;
    let near_bottom = point.y >= client.bottom - corner;

    let hit = if near_left && near_top {
        HTTOPLEFT
    } else if near_right && near_top {
        HTTOPRIGHT
    } else if near_left && near_bottom {
        HTBOTTOMLEFT
    } else if near_right && near_bottom {
        HTBOTTOMRIGHT
    } else if point.x < edge_x {
        HTLEFT
    } else if point.x >= client.right - edge_x {
        HTRIGHT
    } else if point.y < edge_y {
        HTTOP
    } else if point.y >= client.bottom - edge_y {
        HTBOTTOM
    } else {
        return None;
    };
    Some(hit)
}

/// 边厚 = 系统缩放框 + 填充边框（与外侧阴影原生带等宽）；角厚随 DPI 缩放
/// 且不小于边厚。
unsafe fn edge_metrics(parent: HWND) -> (i32, i32, i32) {
    let dpi = GetDpiForWindow(parent);
    let edge_x = GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi)
        + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
    let edge_y = GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi)
        + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
    let corner = ((CORNER_LOGICAL_PX * dpi as f32) / USER_DEFAULT_SCREEN_DPI as f32)
        .round()
        .max(edge_x as f32)
        .max(edge_y as f32) as i32;
    (edge_x, edge_y, corner)
}

/// 构造边框区域：四角 corner×corner 方块 + 四边 edge 厚条带。
unsafe fn frame_region(parent: HWND, width: i32, height: i32) -> HRGN {
    let (edge_x, edge_y, corner) = edge_metrics(parent);
    let parts: [(i32, i32, i32, i32); 8] = [
        // 四角
        (0, 0, corner, corner),
        (width - corner, 0, width, corner),
        (0, height - corner, corner, height),
        (width - corner, height - corner, width, height),
        // 四边（夹在两角之间）
        (corner, 0, width - corner, edge_y),
        (corner, height - edge_y, width - corner, height),
        (0, corner, edge_x, height - corner),
        (width - edge_x, corner, width, height - corner),
    ];

    let result = CreateRectRgn(0, 0, 0, 0);
    for (index, &(x1, y1, x2, y2)) in parts.iter().enumerate() {
        let piece = CreateRectRgn(x1, y1, x2, y2);
        if index == 0 {
            let _ = CombineRgn(Some(result), Some(piece), Some(piece), RGN_COPY);
        } else {
            let _ = CombineRgn(Some(result), Some(result), Some(piece), RGN_OR);
        }
        let _ = DeleteObject(HGDIOBJ(piece.0));
    }
    result
}

unsafe fn is_maximized(window: HWND) -> bool {
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..WINDOWPLACEMENT::default()
    };
    GetWindowPlacement(window, &mut placement)
        .map(|_| placement.showCmd == SW_MAXIMIZE.0 as u32)
        .unwrap_or(false)
}

/// WM_* lParam 的低 16 位（有符号，多显示器负坐标需要）。
fn signed_low_word(value: isize) -> i32 {
    ((value as u32) & 0xFFFF) as u16 as i16 as i32
}

/// WM_* lParam 的高 16 位（有符号）。
fn signed_high_word(value: isize) -> i32 {
    (((value as u32) >> 16) & 0xFFFF) as u16 as i16 as i32
}
