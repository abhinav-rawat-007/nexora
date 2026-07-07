pub fn empty_to_none(value: String) -> Option<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}

pub fn empty_option_to_none(value: Option<String>) -> Option<String> {
  value.and_then(empty_to_none)
}

pub fn split_args(args: &str) -> Vec<String> {
  let mut result = Vec::new();
  let mut current = String::new();
  let mut in_quotes = false;
  for ch in args.chars() {
    match ch {
      '"' => in_quotes = !in_quotes,
      ' ' if !in_quotes => {
        if !current.is_empty() {
          result.push(current.clone());
          current.clear();
        }
      }
      _ => current.push(ch),
    }
  }
  if !current.is_empty() {
    result.push(current);
  }
  result
}
