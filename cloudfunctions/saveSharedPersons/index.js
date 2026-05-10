// 云函数：向他人共享账本写入数据（管理员权限）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function normalizeShareCode(code) {
  return String(code || '').trim().toUpperCase()
}

function isValidShareCode(code) {
  return /^[A-Z0-9]{6}$/.test(code)
}

function isValidRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (!record.id || typeof record.id !== 'string') return false
  if (!record.event || typeof record.event !== 'string') return false
  if (record.type !== 'in' && record.type !== 'out') return false
  const amount = Number(record.amount)
  if (!Number.isFinite(amount) || amount < 0) return false
  return true
}

function isValidPerson(person) {
  if (!person || typeof person !== 'object') return false
  if (!person.id || typeof person.id !== 'string') return false
  if (!person.name || typeof person.name !== 'string') return false
  if (!Array.isArray(person.records)) return false
  if (person.records.length > 5000) return false
  return person.records.every(isValidRecord)
}

exports.main = async (event, context) => {
  const shareCode = normalizeShareCode(event.shareCode)
  const { persons } = event
  if (!shareCode) return { success: false, message: '分享码不能为空' }
  if (!isValidShareCode(shareCode)) return { success: false, message: '分享码格式错误' }
  if (!Array.isArray(persons)) return { success: false, message: '数据格式错误' }
  if (persons.length > 5000) return { success: false, message: '数据量过大' }
  if (!persons.every(isValidPerson)) return { success: false, message: '数据结构校验失败' }

  const db = cloud.database()

  // 新模型：books 多账本
  const booksRes = await db.collection('books')
    .where({ shareCode })
    .get()

  if (booksRes.data.length === 0) {
    return { success: false, message: '分享码不存在' }
  }


  const docId = booksRes.data[0]._id
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  await db.collection('books').doc(docId).update({
    data: {
      persons,
      updateTime: Date.now(),
      cooperators: openid ? db.command.addToSet(openid) : undefined
    }
  })

  return { success: true }
}
