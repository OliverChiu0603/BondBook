// 云函数：获取待审批的加入请求
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { bookId } = event
  
  if (!bookId) {
    return { success: false, message: '缺少账本ID' }
  }

  try {
    const db = cloud.database()
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID

    // 获取账本信息
    const bookRes = await db.collection('books').doc(bookId).get()
    
    if (!bookRes.data) {
      return { success: false, message: '账本不存在' }
    }
    
    const book = bookRes.data

    // 检查是否是创建者
    if (openid !== book.ownerOpenid) {
      return { success: false, message: '只有创建者可以查看加入请求' }
    }

    const pendingUsers = book.pendingUsers || []

    return {
      success: true,
      pendingUsers,
      count: pendingUsers.length
    }
  } catch (e) {
    console.error('获取待审批请求失败：', e)
    return { 
      success: false, 
      message: '获取失败，请重试',
      error: e.message 
    }
  }
}
