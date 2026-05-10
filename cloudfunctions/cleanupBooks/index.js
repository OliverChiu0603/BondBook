// 云函数：清理所有协作者都删除的账本
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  // 获取所有账本
  const books = await db.collection('books').get()
  let deletedCount = 0
  for (const book of books.data) {
    // 获取所有协作者 openid（owner + 所有协作者）
    const allUsers = new Set([book.ownerOpenid, ...(book.cooperators||[])]);
    // 若 deletedUsers 覆盖所有协作者，则物理删除
    if (Array.isArray(book.deletedUsers) && [...allUsers].every(u => book.deletedUsers.includes(u))) {
      await db.collection('books').doc(book._id).remove()
      deletedCount++
    }
  }
  return { deletedCount }
}
