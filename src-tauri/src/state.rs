use crate::error::AppError;
use crate::models::AppOpenPathsPayload;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

#[derive(Default)]
pub struct StartupOpenRequests(pub Mutex<Option<AppOpenPathsPayload>>);

impl StartupOpenRequests {
    pub fn replace(&self, payload: AppOpenPathsPayload) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))? = Some(payload);
        Ok(())
    }

    pub fn take(&self) -> Result<Option<AppOpenPathsPayload>, AppError> {
        let payload = self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .take();
        Ok(payload)
    }
}

#[derive(Default)]
pub struct PendingWindowPaths(pub Mutex<HashMap<String, AppOpenPathsPayload>>);

impl PendingWindowPaths {
    pub fn insert(&self, label: String, payload: AppOpenPathsPayload) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .insert(label, payload);
        Ok(())
    }

    pub fn take(&self, label: &str) -> Result<Option<AppOpenPathsPayload>, AppError> {
        Ok(self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .remove(label))
    }
}

#[derive(Default)]
pub struct LoadedWindows(pub Mutex<HashSet<String>>);

impl LoadedWindows {
    pub fn mark_loaded(&self, label: String) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .insert(label);
        Ok(())
    }

    pub fn has_loaded_window(&self) -> Result<bool, AppError> {
        let has_loaded = !self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .is_empty();
        Ok(has_loaded)
    }
}
