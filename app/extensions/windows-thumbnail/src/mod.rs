//! Windows Thumbnail Provider for MyReader
//!
//! This module provides Windows Explorer thumbnail support for eBook files.
//! Thumbnails are only shown when MyReader is set as the default application.
//!
//! Supported formats: EPUB, MOBI, AZW, AZW3, KF8, FB2, CBZ, CBR

#![allow(non_snake_case)]

mod com_provider;
mod extraction;

pub use extraction::*;
