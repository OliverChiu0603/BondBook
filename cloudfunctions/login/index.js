// 云函数：用户登录并保存用户信息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 如果传入了用户信息（头像、昵称），保存到users集合
  if (event.userInfo) {
    const db = cloud.database()
    let { avatarUrl, nickName } = event.userInfo
    
    // 清理和验证昵称：移除首尾空格，限制长度为50个字符（支持emoji和特殊字符）
    if (nickName) {
      nickName = String(nickName).trim().substring(0, 50)
    }
    
    // 验证头像URL
    if (avatarUrl && typeof avatarUrl !== 'string') {
      avatarUrl = ''
    }
    
    try {
      // 查询用户是否已存在
      const userRes = await db.collection('users').where({ _openid: openid }).get()
      
      if (userRes.data.length > 0) {
        // 更新用户信息
        await db.collection('users').doc(userRes.data[0]._id).update({
          data: {
            avatarUrl: avatarUrl || '',
            nickName: nickName || '',
            updateTime: db.serverDate()
          }
        })
      } else {
        // 新增用户
        await db.collection('users').add({
          data: {
            _openid: openid,
            avatarUrl: avatarUrl || '',
            nickName: nickName || '',
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      }
    } catch (e) {
      console.error('保存用户信息失败：', e)
    }
  }
  
  // 获取用户信息
  try {
    const db = cloud.database()
    const userRes = await db.collection('users').where({ _openid: openid }).get()
    if (userRes.data.length > 0) {
      return {
        openid,
        userInfo: {
          avatarUrl: userRes.data[0].avatarUrl,
          nickName: userRes.data[0].nickName
        }
      }
    }
  } catch (e) {
    console.error('获取用户信息失败：', e)
  }
  
  return {
    openid,
    userInfo: null
  }
}
