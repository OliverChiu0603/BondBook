// 云函数：账本拥有者移除协作者
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { bookId, cooperatorOpenid } = event
  if (!bookId || !cooperatorOpenid) return { success: false, message: '参数缺失' }
  
  const db = cloud.database()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  try {
    const doc = await db.collection('books').doc(bookId).get()
    if (!doc.data) return { success: false, message: '账本不存在' }
    if (doc.data.ownerOpenid !== openid) return { success: false, message: '无权限' }
    
    // 从协作者列表和已批准列表中同时移除
    await db.collection('books').doc(bookId).update({
      data: {
        cooperators: db.command.pull(cooperatorOpenid),
        approvedUsers: db.command.pull(cooperatorOpenid),
        deletedUsers: db.command.addToSet(cooperatorOpenid),
        updateTime: Date.now()
      }
    })
    
    return { success: true, message: '已移除' }
  } catch (e) {
    console.error('移除协作者失败：', e)
    return { success: false, message: '移除失败：' + (e.errMsg || e.message || '未知错误') }
  }
}
