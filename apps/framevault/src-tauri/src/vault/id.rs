use uuid::Uuid;

/// 生成一个新 ID。
///
/// 用 **UUIDv7**：全局唯一、和路径/标题解耦、而且**自带时间排序属性**
/// （前 48 位是毫秒时间戳，所以按字符串排就是按时间排）。
/// 外部只该把它当 opaque ID，不要解析它的内部结构。
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_sortable_by_time() {
        let a = new_id();
        let b = new_id();

        assert_ne!(a, b);
        assert_eq!(a.len(), 36); // 8-4-4-4-12
        assert!(a <= b, "UUIDv7 按字符串排序应当约等于按生成时间排序");
    }
}
