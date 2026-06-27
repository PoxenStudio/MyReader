use turso::{Row, Value};
use serde_json::{Number, Value as JsonValue};

use crate::Error;

/// Convert a turso row column to a JSON value
pub fn to_json(row: &Row, idx: usize) -> Result<JsonValue, Error> {
    let value = row.get_value(idx)?;
    value_to_json(value)
}

/// Convert a turso Value to a JSON value
fn value_to_json(value: Value) -> Result<JsonValue, Error> {
    match value {
        Value::Null => Ok(JsonValue::Null),
        Value::Integer(i) => Ok(JsonValue::Number(Number::from(i))),
        Value::Real(f) => Number::from_f64(f)
            .map(JsonValue::Number)
            .ok_or_else(|| Error::UnsupportedDatatype(format!("Invalid float value: {}", f))),
        Value::Text(s) => Ok(JsonValue::String(s)),
        Value::Blob(bytes) => {
            // Convert blob to array of numbers
            let arr: Vec<JsonValue> = bytes
                .into_iter()
                .map(|b| JsonValue::Number(Number::from(b)))
                .collect();
            Ok(JsonValue::Array(arr))
        }
    }
}
