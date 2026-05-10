// 云函数：申请加入账本
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { shareCode } = event
  if (!shareCode) {
    return { success: false, message: '分享码不能为空' }
  }

  const db = cloud.database()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 尝试获取用户信息（可选，如果没有就用默认值）
  let nickName = `用户${openid.slice(-6)}`
  let avatarUrl = ''
  
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).get()
    if (userRes.data.length > 0) {
      const userInfo = userRes.data[0]
      nickName = userInfo.nickName ? String(userInfo.nickName).trim().substring(0, 50) : nickName
      avatarUrl = userInfo.avatarUrl && typeof userInfo.avatarUrl === 'string' ? userInfo.avatarUrl : ''
    }
  } catch (e) {
    // users 集合不存在或查询失败，使用默认值
    console.log('获取用户信息失败，使用默认值:', e.errMsg || e.message)
  }

  // 查找账本
  const booksRes = await db.collection('books').where({ shareCode }).get()
  if (booksRes.data.length === 0) {
    return { success: false, message: '分享码不存在' }
  }

  const book = booksRes.data[0]

  // 检查是否是创建者
  if (openid === book.ownerOpenid) {
    return { success: false, message: '您是此账本的创建者，无需申请' }
  }

  // 检查是否已经被批准
  const approvedUsers = book.approvedUsers || []
  if (approvedUsers.includes(openid)) {
    return { success: false, message: '您已经有访问权限' }
  }

  // 检查是否已经提交过申请
  const pendingUsers = book.pendingUsers || []
  const existingRequest = pendingUsers.find(u => u.openid === openid)
  if (existingRequest) {
    return { success: false, message: '您已经提交过申请，请等待审批' }
  }

  // 添加到待审批列表
  await db.collection('books').doc(book._id).update({
    data: {
      pendingUsers: db.command.push({
        openid,
        nickName,
        avatarUrl,
        requestTime: db.serverDate()
      })
    }
  })

  return { success: true, message: '申请已提交，请等待创建者审批' }
}
