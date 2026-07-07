use serde_json::Value;

/// Minimal recursive-descent parser for Valve's KeyValues (VDF) text format:
/// nested `"key" "value"` pairs and `"key" { ... }` blocks.
pub fn parse_vdf_object(content: &str) -> Value {
  let mut chars = content.chars().peekable();
  parse_vdf_block(&mut chars)
}

fn parse_vdf_block(chars: &mut std::iter::Peekable<std::str::Chars>) -> Value {
  let mut map = serde_json::Map::new();
  loop {
    skip_vdf_whitespace(chars);
    match chars.peek() {
      None => break,
      Some('}') => {
        chars.next();
        break;
      }
      Some('"') => {
        let key = read_vdf_string(chars);
        skip_vdf_whitespace(chars);
        match chars.peek() {
          Some('"') => {
            let value = read_vdf_string(chars);
            map.insert(key, Value::String(value));
          }
          Some('{') => {
            chars.next();
            map.insert(key, parse_vdf_block(chars));
          }
          _ => {}
        }
      }
      Some(_) => {
        chars.next();
      }
    }
  }
  Value::Object(map)
}

fn skip_vdf_whitespace(chars: &mut std::iter::Peekable<std::str::Chars>) {
  while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
    chars.next();
  }
}

fn read_vdf_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
  chars.next();
  let mut out = String::new();
  while let Some(ch) = chars.next() {
    match ch {
      '"' => break,
      '\\' => {
        if let Some(next) = chars.next() {
          out.push(next);
        }
      }
      _ => out.push(ch),
    }
  }
  out
}

pub fn get_direct_ci<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
  let Value::Object(map) = value else { return None };
  map.iter().find(|(candidate, _)| candidate.eq_ignore_ascii_case(key)).map(|(_, nested)| nested)
}

pub fn parse_vdf_values(content: &str, key: &str) -> Vec<String> {
  let needle = format!("\"{}\"", key);
  content
    .lines()
    .filter_map(|line| {
      let trimmed = line.trim();
      if !trimmed.starts_with(&needle) {
        return None;
      }
      let rest = trimmed[needle.len()..].trim();
      if !rest.starts_with('"') {
        return None;
      }
      let end = rest[1..].find('"')?;
      Some(rest[1..=end].to_string())
    })
    .collect()
}
