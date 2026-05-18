// 云函数：读取他人共享账本（需要创建者批准）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function normalizeShareCode(code) {
  return String(code || '').trim().toUpperCase()
}

function isValidShareCode(code) {
  return /^[A-Z0-9]{6}$/.test(code)
}

exports.main = async (event, context) => {
  const shareCode = normalizeShareCode(event.shareCode)
  if (!shareCode) return { success: false, message: '分享码不能为空' }
  if (!isValidShareCode(shareCode)) return { success: false, message: '分享码格式错误' }

  const db = cloud.database()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const booksRes = await db.collection('books')
    .where({ shareCode })
    .get()

  if (booksRes.data.length === 0) {
    return { success: false, message: '分享码不存在，请确认后重试' }
  }

  const book = booksRes.data[0]

  // 权限检查：创建者可以直接访问
  if (openid === book.ownerOpenid) {
    return {
      success: true,
      persons: book.persons || [],
      ownerOpenid: book.ownerOpenid,
      shareCode,
      bookId: book._id,
      bookName: book.name || '共享账本',
      isOwner: true
    }
  }

  // 检查是否在已批准用户列表中
  const approvedUsers = book.approvedUsers || []
  const deletedUsers = book.deletedUsers || []
  const isApproved = approvedUsers.includes(openid) && !deletedUsers.includes(openid)
  if (!isApproved) {
    // 检查是否已经提交过申请
    const pendingUsers = book.pendingUsers || []
    const hasPending = pendingUsers.some(u => u.openid === openid)
    
    return {
      success: false,
      needApproval: true,
      hasPending,
      message: hasPending ? '您的加入申请正在等待创建者审批' : '需要创建者批准才能访问此账本',
      bookId: book._id,
      bookName: book.name || '共享账本',
      shareCode
    }
  }

  // 已批准用户，返回数据
  // 自动追踪到协作者列表
  await db.collection('books').doc(book._id).update({
    data: {
      deletedUsers: db.command.pull(openid),
      cooperators: db.command.addToSet(openid)
    }
  })

  return {
    success: true,
    persons: book.persons || [],
    ownerOpenid: book.ownerOpenid,
    shareCode,
    bookId: book._id,
    bookName: book.name || '共享账本',
    isOwner: false
  }
}
