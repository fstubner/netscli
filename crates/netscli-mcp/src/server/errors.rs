use thiserror::Error;

#[derive(Debug, Error)]
pub(super) enum RpcError {
    #[error("Invalid Request: {0}")]
    InvalidRequest(String),
    #[error("Not initialized")]
    NotInitialized,
    #[error("Method not found")]
    MethodNotFound,
    #[error("Invalid params: {0}")]
    InvalidParams(String),
    #[error("{0}")]
    ToolError(String),
    #[error("{0}")]
    Internal(String),
}

impl RpcError {
    pub(super) fn code(&self) -> i32 {
        match self {
            RpcError::InvalidRequest(_) => -32600,
            RpcError::NotInitialized => -32002,
            RpcError::MethodNotFound => -32601,
            RpcError::InvalidParams(_) => -32602,
            RpcError::ToolError(_) => -32000,
            RpcError::Internal(_) => -32603,
        }
    }
}
