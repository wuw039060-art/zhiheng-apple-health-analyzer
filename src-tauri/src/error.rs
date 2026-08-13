use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("文件不存在或无法访问：{0}")]
    InvalidPath(String),
    #[error("不是受支持的 Apple 健康 ZIP：{0}")]
    InvalidArchive(String),
    #[error("压缩包安全检查未通过：{0}")]
    UnsafeArchive(String),
    #[error("健康数据 XML 解析失败：{0}")]
    Xml(String),
    #[error("本地数据库操作失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件读取失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP 读取失败：{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("内部序列化失败：{0}")]
    Json(#[from] serde_json::Error),
}

pub type AppResult<T> = Result<T, AppError>;
