pub mod desktop;
pub mod document;
pub mod image;
pub mod window;

pub use desktop::{register_shell_new, unregister_shell_new};
pub use document::{
    authorize_image_asset, import_document_image, open_document, resolve_document_image_path,
    save_document,
};
pub use image::fetch_remote_image;
pub use window::{
    attach_close_interceptor, print_document, reveal_in_finder, set_window_background_color,
};
