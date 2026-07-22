// error.rs — 统一错误类型
//
// 用 thiserror 派生，方便在命令里 ? 传播

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Db(#[from] rusqlite::Error),

    #[error("IO 错误：{0}")]
    Io(#[from] std::io::Error),

    #[error("时间解析错误：{0}")]
    Time(#[from] chrono::ParseError),

    #[error("JSON 错误：{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Msg(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, ser: S) -> std::result::Result<S::Ok, S::Error>
    where S: serde::Serializer
    {
        ser.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
