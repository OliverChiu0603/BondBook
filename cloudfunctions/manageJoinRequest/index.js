// 云函数：管理加入请求（批准/拒绝）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { bookId, requestOpenid, action } = event // action: 'approve' | 'reject'
  
  if (!bookId || !requestOpenid || !action) {
    return { success: false, message: '参数不完整' }
  }

  const db = cloud.database()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 获取账本信息
  const bookRes = await db.collection('books').doc(bookId).get()
  const book = bookRes.data

  // 检查是否是创建者
  if (openid !== book.ownerOpenid) {
    return { success: false, message: '只有创建者可以审批加入请求' }
  }

  const pendingUsers = book.pendingUsers || []
  const requestUser = pendingUsers.find(u => u.openid === requestOpenid)
  
  if (!requestUser) {
    return { success: false, message: '未找到该申请' }
  }

  if (action === 'approve') {
    // 批准：从待审批列表移除，添加到已批准列表
    const newPendingUsers = pendingUsers.filter(u => u.openid !== requestOpenid)
    const approvedUsers = book.approvedUsers || []
    
    await db.collection('books').doc(bookId).update({
      data: {
        pendingUsers: newPendingUsers,
        approvedUsers: db.command.addToSet(requestOpenid)
      }
    })

    return { success: true, message: '已批准' }
  } else if (action === 'reject') {
    // 拒绝：从待审批列表移除
    const newPendingUsers = pendingUsers.filter(u => u.openid !== requestOpenid)
    
    await db.collection('books').doc(bookId).update({
      data: {
        pendingUsers: newPendingUsers
      }
    })

    return { success: true, message: '已拒绝' }
  } else {
    return { success: false, message: '无效的操作' }
  }
}
