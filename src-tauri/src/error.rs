use thiserror::Error;

#[derive(Debug, Error)]
pub enum NexoraError {
  #[error("{0}")]
  Message(String),
  #[error(transparent)]
  Io(#[from] std::io::Error),
  #[error(transparent)]
  Db(#[from] rusqlite::Error),
  #[error(transparent)]
  Reqwest(#[from] reqwest::Error),
}

impl serde::Serialize for NexoraError {
  fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    serializer.serialize_str(&self.to_string())
  }
}

pub type Result<T> = std::result::Result<T, NexoraError>;
