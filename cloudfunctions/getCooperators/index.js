// 云函数：获取账本的协作者详细信息
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
    const currentOpenid = wxContext.OPENID

    // 获取账本信息
    const bookRes = await db.collection('books').doc(bookId).get()
    
    if (!bookRes.data) {
      return { success: false, message: '账本不存在' }
    }
    
    const book = bookRes.data
    const cooperators = book.cooperators || []
    const ownerOpenid = book.ownerOpenid

    // 获取创建者信息
    let ownerInfo = null
    try {
      const ownerRes = await db.collection('users').where({ _openid: ownerOpenid }).get()
      if (ownerRes.data.length > 0) {
        ownerInfo = {
          openid: ownerOpenid,
          nickName: ownerRes.data[0].nickName || '创建者',
          avatarUrl: ownerRes.data[0].avatarUrl || '',
          role: 'owner'
        }
      }
    } catch (e) {
      console.error('获取创建者信息失败：', e)
    }

    // 获取所有协作者的详细信息
    const cooperatorsList = []
    for (const openid of cooperators) {
      try {
        const userRes = await db.collection('users').where({ _openid: openid }).get()
        if (userRes.data.length > 0) {
          cooperatorsList.push({
            openid,
            nickName: userRes.data[0].nickName || '微信用户',
            avatarUrl: userRes.data[0].avatarUrl || '',
            role: 'cooperator'
          })
        } else {
          // 如果找不到用户信息，仍然显示但只有openid
          cooperatorsList.push({
            openid,
            nickName: `用户${openid.slice(-6)}`,
            avatarUrl: '',
            role: 'cooperator'
          })
        }
      } catch (e) {
        console.error(`获取协作者${openid}信息失败：`, e)
        cooperatorsList.push({
          openid,
          nickName: `用户${openid.slice(-6)}`,
          avatarUrl: '',
          role: 'cooperator'
        })
      }
    }

    // 判断当前用户的身份
    const isOwner = currentOpenid === ownerOpenid
    const isCooperator = cooperators.includes(currentOpenid)

    return {
      success: true,
      owner: ownerInfo,
      cooperators: cooperatorsList,
      totalCount: cooperatorsList.length + (ownerInfo ? 1 : 0),
      currentUserRole: isOwner ? 'owner' : (isCooperator ? 'cooperator' : 'none')
    }
  } catch (e) {
    console.error('获取协作者信息失败：', e)
    return { 
      success: false, 
      message: '获取失败，请重试',
      error: e.message 
    }
  }
}
