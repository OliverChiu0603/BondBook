# books 集合上线清单

## 1. 字段规范（文档级）

books 每条文档建议固定包含以下字段：

- name: string，账本名称，建议 1-30 字符
- shareCode: string，6 位大写字母/数字（例如 A1B2C3）
- persons: array，账本人情数据
- ownerOpenid: string，账本所有者 openid
- createTime: number，毫秒时间戳
- updateTime: number，毫秒时间戳

## 2. 索引建议（云开发控制台）

请在数据库 -> books -> 索引中配置：

1. 单字段索引：shareCode（升序）
- 用途：按分享码快速查询账本
- 建议：设置唯一（若控制台支持唯一约束）

2. 单字段索引：updateTime（降序）
- 用途：我的账本按最近更新时间排序

3. （可选）复合索引：ownerOpenid + updateTime(降序)
- 用途：若后续改为云函数拉取我的账本列表，可加速 owner 维度分页

## 3. 权限建议（最小权限）

如果你后续配置数据库权限规则，建议：

- books 的读写默认仅文档拥有者可访问（依赖 _openid）
- 跨用户共享读写仅通过云函数 getSharedPersons/saveSharedPersons 完成
- 禁止客户端直接按 shareCode 扫描所有文档

## 4. 当前代码已做的约束

- 客户端与云函数都对 shareCode 做了 trim + upper 处理
- shareCode 强校验为 6 位大写字母/数字
- 创建账本时会尝试生成未占用的分享码
- saveSharedPersons 云函数会校验 persons/person/record 基本结构

## 5. 发布前核对

1. 重新部署云函数：
- cloudfunctions/getSharedPersons
- cloudfunctions/saveSharedPersons

2. 云数据库确认存在 books 集合。

3. 在真机验证以下流程：
- 新建多本账本
- 切换账本后数据隔离
- 不同账本分享给不同用户
- 共享用户写入后仅影响对应账本
